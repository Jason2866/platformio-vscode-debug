import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import { VariableObject, MIError } from './types';
import { parseMI, MINode } from '../mi_parse';

export function escape(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const MI_OUTPUT_REGEX = /^(?:\d*|undefined)[\*\+\=]|[\~\@\&\^]/;
const GDB_PROMPT_REGEX = /(?:\d*|undefined)\(gdb\)/;
const BREAK_COUNT_REGEX = /\d+/;

function isPlainOutput(line: string): boolean {
    return !MI_OUTPUT_REGEX.exec(line);
}

export class MI2 extends EventEmitter {
    private process: childProcess.ChildProcess;
    private currentToken: number = 1;
    private handlers: { [token: number]: (result: MINode) => void } = {};
    public printCalls: boolean;
    public debugOutput: boolean;
    private debugReadyFired: boolean = false;
    private debugReadyTimeout: any;
    private buffer: string;
    private errbuf: string;

    constructor(
        public application: string,
        public args: string[]
    ) {
        super();
    }

    /** Spawns GDB and sends startup MI commands. */
    connect(cwd: string, commands: string[]): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const args = [...this.args];
            const env = Object.create(process.env);
            if (process.env.PLATFORMIO_PATH) {
                env.PATH = process.env.PLATFORMIO_PATH;
                env.Path = process.env.PLATFORMIO_PATH;
            }

            this.process = childProcess.spawn(this.application, args, {
                cwd,
                env,
                shell: process.platform === 'win32',
            });

            this.process.stdout.on('data', this.stdout.bind(this));
            this.process.stderr.on('data', this.stderr.bind(this));
            this.process.on('exit', (() => {
                this.emit('quit');
            }).bind(this));
            this.process.on('error', ((err: Error) => {
                this.emit('launcherror', err);
            }).bind(this));

            const initCommands = [
                this.sendCommand('gdb-set target-async on', true),
                ...commands.map((cmd) => this.sendCommand(cmd)),
            ];
            Promise.all(initCommands).then(() => {
                resolve(true);
            }, reject);
        });
    }

    /** Buffers and dispatches stdout lines. */
    stdout(data: any): void {
        this.buffer += typeof data === 'string' ? data : data.toString('utf8');
        const newlineIndex = this.buffer.lastIndexOf('\n');
        if (newlineIndex !== -1) {
            this.onOutput(this.buffer.substr(0, newlineIndex));
            this.buffer = this.buffer.substr(newlineIndex + 1);
        }
        if (this.buffer.length) {
            if (this.onOutputPartial(this.buffer)) {
                this.buffer = '';
            }
        }
    }

    /** Buffers and logs stderr lines. */
    stderr(data: any): void {
        this.errbuf += typeof data === 'string' ? data : data.toString('utf8');
        const newlineIndex = this.errbuf.lastIndexOf('\n');
        if (newlineIndex !== -1) {
            this.onOutputStderr(this.errbuf.substr(0, newlineIndex));
            this.errbuf = this.errbuf.substr(newlineIndex + 1);
        }
        if (this.errbuf.length) {
            this.logNoNewLine('stderr', this.errbuf);
            this.errbuf = '';
        }
    }

    /** Splits and logs multi-line stderr. */
    onOutputStderr(output: string): void {
        const lines = output.split('\n');
        lines.forEach((line) => {
            this.log('stderr', line);
        });
    }

    /** Handles partial line; logs non-MI output. */
    onOutputPartial(line: string): boolean {
        if (isPlainOutput(line)) {
            this.logNoNewLine('stdout', line);
            return true;
        }
        return false;
    }

    /** Parses and routes MI output lines. */
    onOutput(output: string): void {
        const lines = output.split('\n');
        lines.forEach((line) => {
            if (isPlainOutput(line)) {
                if (!GDB_PROMPT_REGEX.exec(line)) {
                    this.log('stdout', line);
                }
            } else {
                const parsed = parseMI(line);
                if (this.debugOutput) {
                    this.log('log', 'GDB -> App: ' + JSON.stringify(parsed));
                }

                let handled = false;

                if (parsed.token !== undefined && this.handlers[parsed.token]) {
                    this.handlers[parsed.token](parsed);
                    delete this.handlers[parsed.token];
                    handled = true;
                }

                if (!handled && parsed.resultRecords && parsed.resultRecords.resultClass === 'error') {
                    this.log('stderr', parsed.result('msg') || line);
                }

                if (parsed.outOfBandRecord) {
                    parsed.outOfBandRecord.forEach((record: any) => {
                        if (record.isStream) {
                            if (record.content.includes('PlatformIO: Initialization completed')) {
                                this.debugReadyTimeout = setTimeout(() => {
                                    this.debugReadyFired = true;
                                    this.emit('debug-ready');
                                }, 200);
                                this.once('generic-stopped', () => {
                                    if (!this.debugReadyFired) {
                                        clearTimeout(this.debugReadyTimeout);
                                        this.emit('debug-ready');
                                    }
                                });
                            }
                            this.log(record.type, record.content);
                        } else if (record.type === 'exec') {
                            this.emit('exec-async-output', parsed);
                            if (record.asyncClass === 'running') {
                                this.emit('running', parsed);
                            } else if (record.asyncClass === 'stopped') {
                                const reason = parsed.record('reason');
                                if (reason === 'breakpoint-hit') {
                                    this.emit('breakpoint', parsed);
                                } else if (reason === 'end-stepping-range') {
                                    this.emit('step-end', parsed);
                                } else if (reason === 'function-finished') {
                                    this.emit('step-out-end', parsed);
                                } else if (reason === 'signal-received') {
                                    this.emit('signal-stop', parsed);
                                } else if (reason === 'exited-normally') {
                                    this.emit('exited-normally', parsed);
                                } else if (reason === 'exited') {
                                    this.log('stderr', 'Program exited with code ' + parsed.record('exit-code'));
                                    this.emit('exited-normally', parsed);
                                } else {
                                    if (this.debugReadyFired) {
                                        this.log('console', 'Not implemented stop reason (assuming exception): ' + reason);
                                    }
                                    this.emit('stopped', parsed);
                                }
                                this.emit('generic-stopped', parsed);
                            } else {
                                this.log('log', JSON.stringify(parsed));
                            }
                        } else if (record.type === 'notify') {
                            if (record.asyncClass === 'thread-created') {
                                const threadId = parsed.result('id');
                                const threadGroupId = parsed.result('group-id');
                                this.emit('thread-created', { threadId, threadGroupId });
                            } else if (record.asyncClass === 'thread-exited') {
                                const threadId = parsed.result('id');
                                const threadGroupId = parsed.result('group-id');
                                this.emit('thread-exited', { threadId, threadGroupId });
                            } else if (record.asyncClass === 'thread-selected') {
                                const threadId = parsed.result('id');
                                this.emit('thread-selected', { threadId });
                            }
                        }
                    });
                    handled = true;
                }

                if (parsed.token === undefined && parsed.resultRecords === undefined && parsed.outOfBandRecord.length === 0) {
                    handled = true;
                }

                if (!handled) {
                    this.log('log', 'Unhandled: ' + JSON.stringify(parsed));
                }
            }
        });
    }

    /** Sends -gdb-exit; optional force-kill after 1s. */
    stop(forceKill: boolean = false): void {
        if (forceKill) {
            const proc = this.process;
            const killTimeout = setTimeout(() => {
                process.kill(-proc.pid);
            }, 1000);
            this.process.on('exit', (code: any) => {
                clearTimeout(killTimeout);
            });
        }
        this.sendRaw('-gdb-exit');
    }

    /** Sends -target-detach with fallback kill. */
    detach(): void {
        const proc = this.process;
        const killTimeout = setTimeout(() => {
            process.kill(-proc.pid);
        }, 1000);
        this.process.on('exit', (code: any) => {
            clearTimeout(killTimeout);
        });
        this.sendRaw('-target-detach');
    }

    /** Interrupts a thread. */
    interrupt(threadId: number): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.sendCommand(`exec-interrupt --thread ${threadId}`).then(
                (result) => {
                    resolve(result.resultRecords.resultClass === 'done');
                },
                reject
            );
        });
    }

    /** Continues a thread. */
    continue(threadId: number): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.sendCommand(`exec-continue --thread ${threadId}`).then(
                (result) => {
                    resolve(result.resultRecords.resultClass === 'running');
                },
                reject
            );
        });
    }

    /** Steps to next line/instruction. */
    next(threadId: number, instruction: boolean): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const command = instruction ? 'exec-next-instruction' : 'exec-next';
            this.sendCommand(`${command} --thread ${threadId}`).then(
                (result) => {
                    resolve(result.resultRecords.resultClass === 'running');
                },
                reject
            );
        });
    }

    /** Steps into next line/instruction. */
    step(threadId: number, instruction: boolean): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const command = instruction ? 'exec-step-instruction' : 'exec-step';
            this.sendCommand(`${command} --thread ${threadId}`).then(
                (result) => {
                    resolve(result.resultRecords.resultClass === 'running');
                },
                reject
            );
        });
    }

    /** Steps out of current function. */
    stepOut(threadId: number): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.sendCommand(`exec-finish --thread ${threadId}`).then(
                (result) => {
                    resolve(result.resultRecords.resultClass === 'running');
                },
                reject
            );
        });
    }

    /** Restarts by sending MI commands. */
    restart(commands: string[]): Promise<boolean> {
        return this._sendCommandSequence(commands);
    }

    /** Sends MI commands in order. */
    _sendCommandSequence(commands: string[]): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const executeNext = ((remaining: string[]) => {
                if (remaining.length === 0) {
                    resolve(true);
                    return;
                }
                const cmd = remaining[0];
                this.sendCommand(cmd).then(
                    (result) => {
                        executeNext(remaining.slice(1));
                    },
                    reject
                );
            }).bind(this);
            executeNext(commands);
        });
    }

    /** Changes value via gdb-set var. */
    changeVariable(name: string, rawValue: string): Promise<MINode> {
        return this.sendCommand('gdb-set var ' + name + '=' + rawValue);
    }

    /** Sets a condition on a breakpoint. */
    setBreakPointCondition(breakpointNumber: number, condition: string): Promise<MINode> {
        return this.sendCommand('break-condition ' + breakpointNumber + ' ' + condition);
    }

    /** Inserts a breakpoint via break-insert. */
    addBreakPoint(breakpoint: any): Promise<any> {
        return new Promise((resolve, reject) => {
            let args = '';

            if (breakpoint.countCondition) {
                if (breakpoint.countCondition[0] === '>') {
                    args += '-i ' + BREAK_COUNT_REGEX.exec(breakpoint.countCondition.substr(1))[0] + ' ';
                } else {
                    const count = BREAK_COUNT_REGEX.exec(breakpoint.countCondition)[0];
                    if (count.length !== breakpoint.countCondition.length) {
                        this.log(
                            'stderr',
                            "Unsupported break count expression: '" +
                            breakpoint.countCondition +
                            "'. Only supports 'X' for breaking once after X times or '>X' for ignoring the first X breaks"
                        );
                        args += '-t ';
                    } else if (parseInt(count) !== 0) {
                        args += '-t -i ' + parseInt(count) + ' ';
                    }
                }
            }

            if (breakpoint.raw) {
                args += '*' + escape(breakpoint.raw);
            } else {
                args += '"' + escape(breakpoint.file) + ':' + breakpoint.line + '"';
            }

            this.sendCommand(`break-insert ${args}`).then(
                (result) => {
                    if (result.resultRecords.resultClass === 'done') {
                        const bkptNumber = parseInt(result.result('bkpt.number'));
                        breakpoint.number = bkptNumber;
                        if (breakpoint.condition) {
                            this.setBreakPointCondition(bkptNumber, breakpoint.condition).then(
                                (condResult) => {
                                    if (condResult.resultRecords.resultClass === 'done') {
                                        resolve(breakpoint);
                                    } else {
                                        resolve(null);
                                    }
                                },
                                reject
                            );
                        } else {
                            resolve(breakpoint);
                        }
                    } else {
                        resolve(null);
                    }
                },
                reject
            );
        });
    }

    /** Removes breakpoints by number. */
    removeBreakpoints(breakpointNumbers: number[]): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (breakpointNumbers.length === 0) {
                resolve(true);
            } else {
                const cmd = 'break-delete ' + breakpointNumbers.join(' ');
                this.sendCommand(cmd).then(
                    (result) => {
                        resolve(result.resultRecords.resultClass === 'done');
                    },
                    reject
                );
            }
        });
    }

    /** Retrieves info for a single frame. */
    getFrame(threadId: number, frameLevel: number): Promise<any> {
        return new Promise((resolve, reject) => {
            const cmd = `stack-info-frame --thread ${threadId} --frame ${frameLevel}`;
            this.sendCommand(cmd).then(
                (result) => {
                    const frame = result.result('frame');
                    const level = MINode.valueOf(frame, 'level');
                    const address = MINode.valueOf(frame, 'addr');
                    const func = MINode.valueOf(frame, 'func');
                    const file = MINode.valueOf(frame, 'file');
                    const fullname = MINode.valueOf(frame, 'fullname');
                    let line = 0;
                    const lineStr = MINode.valueOf(frame, 'line');
                    if (lineStr) {
                        line = parseInt(lineStr);
                    }
                    resolve({
                        address,
                        fileName: file,
                        file: fullname,
                        function: func,
                        level,
                        line,
                    });
                },
                reject
            );
        });
    }

    /** Retrieves a slice of the call stack. */
    getStack(threadId: number, startFrame: number, levels: number): Promise<any[]> {
        return new Promise((resolve, reject) => {
            this.sendCommand(`stack-list-frames --thread ${threadId} ${startFrame} ${levels}`).then(
                (result) => {
                    const stack = result.result('stack');
                    const frames: any[] = [];
                    stack.forEach((entry: any) => {
                        const level = MINode.valueOf(entry, '@frame.level');
                        const address = MINode.valueOf(entry, '@frame.addr');
                        const func = MINode.valueOf(entry, '@frame.func');
                        const file = MINode.valueOf(entry, '@frame.file');
                        const fullname = MINode.valueOf(entry, '@frame.fullname');
                        let line = 0;
                        const lineStr = MINode.valueOf(entry, '@frame.line');
                        if (lineStr) {
                            line = parseInt(lineStr);
                        }
                        const from = parseInt(MINode.valueOf(entry, '@frame.from'));
                        frames.push({
                            address,
                            fileName: file,
                            file: fullname,
                            function: func || from,
                            level,
                            line,
                        });
                    });
                    resolve(frames);
                },
                reject
            );
        });
    }

    /** Retrieves local variables via stack-list-variables. */
    async getStackVariables(threadId: number, frameLevel: number): Promise<any[]> {
        const result = await this.sendCommand(
            `stack-list-variables --thread ${threadId} --frame ${frameLevel} --simple-values`
        );
        const variables = result.result('variables');
        const vars: any[] = [];
        for (const variable of variables) {
            const name = MINode.valueOf(variable, 'name');
            const valueStr = MINode.valueOf(variable, 'value');
            const type = MINode.valueOf(variable, 'type');
            vars.push({ name, valueStr, type, raw: variable });
        }
        return vars;
    }

    /** Reads memory and returns hex string. */
    async examineMemory(address: number, length: number): Promise<string> {
        let result = '';
        let currentAddress = address;
        while (length > 0) {
            const chunkSize = length > 1024 ? 1024 : length;
            const response = await this.sendCommand(
                `data-read-memory-bytes 0x${currentAddress.toString(16)} ${chunkSize}`
            );
            result += response.result('memory[0].contents');
            length -= chunkSize;
            currentAddress += chunkSize;
        }
        return result;
    }

    /** Evaluates an expression via data-evaluate-expression. */
    evalExpression(expression: string): Promise<MINode> {
        return new Promise((resolve, reject) => {
            this.sendCommand('data-evaluate-expression ' + expression).then(
                (result) => {
                    resolve(result);
                },
                reject
            );
        });
    }

    /** Creates a var object via var-create. */
    async varCreate(expression: string, name: string = '-'): Promise<VariableObject> {
        const result = await this.sendCommand(`var-create ${name} @ "${expression}"`);
        return new VariableObject(result.result(''));
    }

    /** Evaluates a var object via var-evaluate-expression. */
    async varEvalExpression(name: string): Promise<MINode> {
        return this.sendCommand(`var-evaluate-expression ${name}`);
    }

    /** Lists children via var-list-children. */
    async varListChildren(name: string): Promise<VariableObject[]> {
        const result = await this.sendCommand(`var-list-children --all-values ${name}`);
        return (result.result('children') || []).map((child: any) => new VariableObject(child[1]));
    }

    /** Updates var objects via var-update. */
    async varUpdate(name: string = '*'): Promise<MINode> {
        return this.sendCommand(`var-update --all-values ${name}`);
    }

    /** Assigns a value via var-assign. */
    async varAssign(name: string, value: string): Promise<MINode> {
        return this.sendCommand(`var-assign ${name} ${value}`);
    }

    /** Emits msg without trailing newline. */
    logNoNewLine(type: string, message: string): void {
        this.emit('msg', type, message);
    }

    /** Emits msg with newline as needed. */
    log(type: string, message: string): void {
        this.emit('msg', type, message[message.length - 1] === '\n' ? message : message + '\n');
    }

    /** Sends a user-typed command (MI or console). */
    sendUserInput(command: string): Promise<MINode> {
        if (command.startsWith('-')) {
            return this.sendCommand(command.substr(1));
        }
        return this.sendCommand(`interpreter-exec console "${command}"`);
    }

    /** Writes raw MI command to stdin. */
    sendRaw(raw: string): void {
        if (this.printCalls) {
            this.log('log', raw);
        }
        this.process.stdin.write(raw + '\n');
    }

    /** Sends numbered MI command; resolves on reply. */
    sendCommand(command: string, suppressErrors: boolean = false): Promise<MINode> {
        const token = this.currentToken++;
        return new Promise((resolve, reject) => {
            this.handlers[token] = (result: MINode) => {
                if (result && result.resultRecords && result.resultRecords.resultClass === 'error') {
                    if (suppressErrors) {
                        this.log('stderr', `WARNING: Error executing command '${command}'`);
                        resolve(result);
                    } else {
                        reject(new MIError(result.result('msg') || 'Internal error', command));
                    }
                } else {
                    resolve(result);
                }
            };
            this.sendRaw(token + '-' + command);
        });
    }

    /** True if GDB child is running. */
    isReady(): boolean {
        return !!this.process;
    }
}
