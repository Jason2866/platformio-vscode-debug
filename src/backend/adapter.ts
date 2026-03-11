import * as crypto from 'crypto';
import * as fs from 'fs';
import { setTimeout } from 'timers';
import {
    DebugSession,
    Event,
    Handles,
    InitializedEvent,
    OutputEvent,
    TerminatedEvent,
    ThreadEvent,
    Thread,
    StackFrame,
    Scope,
    Source,
    ContinuedEvent,
} from 'vscode-debugadapter';
import { StoppedEvent, AdapterOutputEvent } from '../common';
import { hexFormat, encodeDisassembly, parseQuery } from '../utils';
import { VariableObject, MIError } from './mi2/types';
import { expandValue } from './expand_value';
import { MI2 } from './mi2/mi2';
import { MINode } from './mi_parse';
import { SymbolTable } from './symbols';

class ExtendedVariable {
    constructor(
        public name: string,
        public options: any
    ) {}
}

const STATIC_HANDLES_START = 65536;    // 0x10000
const STATIC_HANDLES_END = 131071;     // 0x1FFFF

class CustomStopEvent extends Event {
    constructor(reason: string, threadID: number) {
        super('custom-stop', { reason, threadID });
    }
}

class CustomContinuedEvent extends Event {
    constructor(threadID: number, allThreads: boolean = true) {
        super('custom-continued', { threadID, allThreads });
    }
}

export class GDBDebugSession extends DebugSession {
    private variableHandles = new Handles<string | VariableObject | ExtendedVariable>(131072);
    private variableHandlesReverse: { [name: string]: number } = {};
    private forceDisassembly: boolean = false;
    private activeEditorPath: string | null = null;
    private currentThreadId: number = 0;
    private stopped: boolean = false;
    private stoppedReason: string = '';
    private breakpointMap: Map<string, any[]> = new Map();
    private fileExistsCache: Map<string, boolean> = new Map();
    private miDebugger: MI2;
    private args: any;
    private quit: boolean;
    private attached: boolean;
    private started: boolean;
    private crashed: boolean;
    private debugReady: boolean;
    private symbolTable: SymbolTable;

    constructor(debuggerLinesStartAt1?: boolean, isServer?: boolean) {
        super(debuggerLinesStartAt1, isServer);
    }

    initDebugger(): void {
        this.miDebugger.on('launcherror', this.launchError.bind(this));
        this.miDebugger.on('quit', this.quitEvent.bind(this));
        this.miDebugger.on('exited-normally', this.quitEvent.bind(this));
        this.miDebugger.on('stopped', this.stopEvent.bind(this));
        this.miDebugger.on('msg', this.handleMsg.bind(this));
        this.miDebugger.on('breakpoint', this.handleBreakpoint.bind(this));
        this.miDebugger.on('step-end', this.handleBreak.bind(this));
        this.miDebugger.on('step-out-end', this.handleBreak.bind(this));
        this.miDebugger.on('signal-stop', this.handlePause.bind(this));
        this.miDebugger.on('running', this.handleRunning.bind(this));
        this.miDebugger.on('thread-created', this.handleThreadCreated.bind(this));
        this.miDebugger.on('thread-exited', this.handleThreadExited.bind(this));
        this.miDebugger.on('thread-selected', this.handleThreadSelected.bind(this));
        this.sendEvent(new InitializedEvent());
    }

    protected initializeRequest(response: any, args: any): void {
        response.body.supportsConditionalBreakpoints = true;
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsHitConditionalBreakpoints = true;
        response.body.supportsRestartRequest = true;
        response.body.supportsSetVariable = true;
        response.body.supportsTerminateRequest = true;
        response.body.supportsValueFormattingOptions = true;
        this.sendResponse(response);
    }

    protected launchRequest(response: any, args: any): void {
        this.args = args;
        this.processLaunchAttachRequest(response, false);
    }

    protected attachRequest(response: any, args: any): void {
        this.args = args;
        this.processLaunchAttachRequest(response, true);
    }

    private processLaunchAttachRequest(response: any, isAttach: boolean): void {
        this.quit = false;
        this.attached = false;
        this.started = false;
        this.crashed = false;
        this.debugReady = false;
        this.stopped = false;
        this.breakpointMap = new Map();
        this.fileExistsCache = new Map();

        const pioArgs = ['debug'];
        if (this.args.projectEnvName) {
            pioArgs.push('-e', this.args.projectEnvName);
        }
        if (this.args.loadMode) {
            pioArgs.push('--load-mode', this.args.loadMode);
        }
        pioArgs.push('--interface', 'gdb', '--interpreter=mi2', '-q');

        this.miDebugger = new MI2('platformio', pioArgs);
        this.initDebugger();
        this.miDebugger.printCalls = !!this.args.showDevDebugOutput;
        this.miDebugger.debugOutput = !!this.args.showDevDebugOutput;

        this.miDebugger.once('debug-ready', () => {
            this.debugReady = true;
            this.stopped = true;
            this.stoppedReason = 'start';
            this.sendEvent(new StoppedEvent('start', this.currentThreadId, true));
            this.sendEvent(new CustomStopEvent('start', this.currentThreadId));
        });

        this.miDebugger
            .connect(this.args.cwd, [
                'interpreter-exec console "source .pioinit"',
                'enable-pretty-printing',
            ])
            .then(
                () => {
                    this.symbolTable = new SymbolTable(this.args.toolchainBinDir, this.args.executable);
                    try {
                        this.symbolTable.loadSymbols();
                        this.started = true;
                        this.sendResponse(response);
                    } catch (err) {
                        if (this.args.toolchainBinDir) {
                            this.sendErrorResponse(
                                response,
                                102,
                                `Failed to load symbols from executable file: ${err.toString()}`
                            );
                        }
                    }
                },
                (err) => {
                    this.sendErrorResponse(response, 103, `Failed to launch GDB: ${err.toString()}`);
                }
            );
    }

    protected customRequest(command: string, response: any, args: any): void {
        switch (command) {
            case 'set-force-disassembly':
                response.body = { success: true };
                this.forceDisassembly = args.force;
                if (this.stopped) {
                    this.activeEditorPath = null;
                    this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
                    this.sendEvent(new StoppedEvent(this.stoppedReason, this.currentThreadId, true));
                }
                this.sendResponse(response);
                break;

            case 'load-function-symbols':
                response.body = { functionSymbols: this.symbolTable.getFunctionSymbols() };
                this.sendResponse(response);
                break;

            case 'set-active-editor':
                this.activeEditorPath = args.path;
                response.body = {};
                this.sendResponse(response);
                break;

            case 'get-arguments':
                response.body = this.args;
                this.sendResponse(response);
                break;

            case 'read-memory':
                this.customReadMemoryRequest(response, args.address, args.length);
                break;

            case 'write-memory':
                this.customWriteMemoryRequest(response, args.address, args.data);
                break;

            case 'read-registers':
                this.customReadRegistersRequest(response);
                break;

            case 'read-register-list':
                this.customReadRegisterListRequest(response);
                break;

            case 'disassemble':
                this.disassembleRequest(response, args);
                break;

            case 'execute-command':
                let cmd: string = args.command;
                cmd = cmd.startsWith('-') ? cmd.substring(1) : `interpreter-exec console "${cmd}"`;
                this.miDebugger.sendCommand(cmd).then(
                    (result) => {
                        response.body = result.resultRecords;
                        this.sendResponse(response);
                    },
                    (err) => {
                        response.body = err;
                        this.sendErrorResponse(response, 110, 'Unable to execute command');
                    }
                );
                break;

            default:
                response.body = { error: 'Invalid command.' };
                this.sendResponse(response);
        }
    }

    protected async disassembleRequest(response: any, args: any): Promise<void> {
        if (args.function) {
            try {
                const result = await this.getDisassemblyForFunction(args.function, args.file);
                response.body = {
                    instructions: result.instructions,
                    name: result.name,
                    file: result.file,
                    address: result.address,
                    length: result.length,
                };
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 1, `Unable to disassemble: ${err.toString()}`);
            }
        } else if (args.startAddress) {
            try {
                let func = this.symbolTable.getFunctionAtAddress(args.startAddress);
                if (func) {
                    func = await this.getDisassemblyForFunction(func.name, func.file);
                    response.body = {
                        instructions: func.instructions,
                        name: func.name,
                        file: func.file,
                        address: func.address,
                        length: func.length,
                    };
                    this.sendResponse(response);
                } else {
                    const instructions = await this.getDisassemblyForAddresses(
                        args.startAddress,
                        args.length || 256
                    );
                    response.body = { instructions };
                    this.sendResponse(response);
                }
            } catch (err) {
                this.sendErrorResponse(response, 1, `Unable to disassemble: ${err.toString()}`);
            }
        } else {
            this.sendErrorResponse(response, 1, 'Unable to disassemble; invalid parameters.');
        }
    }

    private async getDisassemblyForFunction(functionName: string, file: string): Promise<any> {
        const func = this.symbolTable.getFunctionByName(functionName, file);
        if (!func) {
            throw new Error(`Unable to find function with name ${functionName}.`);
        }
        if (func.instructions) {
            return func;
        }

        const startAddress = func.address;
        const endAddress = func.address + func.length;
        const result = await this.miDebugger.sendCommand(
            `data-disassemble -s ${hexFormat(startAddress, 8)} -e ${hexFormat(endAddress, 8)} -- 2`
        );

        const instructions = result.result('asm_insns').map((entry: any) => ({
            address: MINode.valueOf(entry, 'address'),
            functionName: MINode.valueOf(entry, 'func-name'),
            offset: parseInt(MINode.valueOf(entry, 'offset')),
            instruction: MINode.valueOf(entry, 'inst'),
            opcodes: MINode.valueOf(entry, 'opcodes'),
        }));

        func.instructions = instructions;
        return func;
    }

    private async getDisassemblyForAddresses(startAddress: number, length: number): Promise<any[]> {
        const endAddress = startAddress + length;
        const result = await this.miDebugger.sendCommand(
            `data-disassemble -s ${hexFormat(startAddress, 8)} -e ${hexFormat(endAddress, 8)} -- 2`
        );

        return result.result('asm_insns').map((entry: any) => ({
            address: MINode.valueOf(entry, 'address'),
            functionName: MINode.valueOf(entry, 'func-name'),
            offset: parseInt(MINode.valueOf(entry, 'offset')),
            instruction: MINode.valueOf(entry, 'inst'),
            opcodes: MINode.valueOf(entry, 'opcodes'),
        }));
    }

    private customReadMemoryRequest(response: any, address: number, length: number): void {
        this.miDebugger.examineMemory(address, length).then(
            (data) => {
                const bytes = data.match(/[0-9a-f]{2}/g).map((hex: string) => parseInt(hex, 16));
                response.body = {
                    startAddress: address,
                    endAddress: address + bytes.length,
                    bytes,
                };
                this.sendResponse(response);
            },
            (err) => {
                response.body = { error: err };
                this.sendErrorResponse(response, 114, `Unable to read memory: ${err.toString()}`);
            }
        );
    }

    private customWriteMemoryRequest(response: any, address: number, data: string): void {
        const hexAddr = hexFormat(address, 8);
        this.miDebugger.sendCommand(`data-write-memory-bytes ${hexAddr} ${data}`).then(
            (result) => {
                this.sendResponse(response);
            },
            (err) => {
                response.body = { error: err };
                this.sendErrorResponse(response, 114, `Unable to write memory: ${err.toString()}`);
            }
        );
    }

    private customReadRegistersRequest(response: any): void {
        this.miDebugger.sendCommand('data-list-register-values x').then(
            (result) => {
                if (result.resultRecords.resultClass === 'done') {
                    const registers = result.resultRecords.results[0][1];
                    response.body = registers.map((reg: any) => {
                        const obj: any = {};
                        reg.forEach((pair: any) => {
                            obj[pair[0]] = pair[1];
                        });
                        return obj;
                    });
                } else {
                    response.body = { error: 'Unable to parse response' };
                }
                this.sendResponse(response);
            },
            (err) => {
                response.body = { error: err };
                this.sendErrorResponse(response, 115, `Unable to read registers: ${err.toString()}`);
            }
        );
    }

    private customReadRegisterListRequest(response: any): void {
        this.miDebugger.sendCommand('data-list-register-names').then(
            (result) => {
                if (result.resultRecords.resultClass === 'done') {
                    let names: string[];
                    result.resultRecords.results.forEach((entry: any) => {
                        if (entry[0] === 'register-names') {
                            names = entry[1];
                        }
                    });
                    response.body = names;
                } else {
                    response.body = { error: result.resultRecords.results };
                }
                this.sendResponse(response);
            },
            (err) => {
                response.body = { error: err };
                this.sendErrorResponse(response, 116, `Unable to read register list: ${err.toString()}`);
            }
        );
    }

    protected disconnectRequest(response: any, args: any): void {
        if (this.miDebugger) {
            if (this.attached) {
                this.miDebugger.detach();
            } else {
                this.miDebugger.stop(true);
            }
        }
        this.sendResponse(response);
    }

    protected terminateRequest(response: any, args: any): void {
        if (this.miDebugger) {
            this.miDebugger.stop();
        }
        this.sendResponse(response);
    }

    protected restartRequest(response: any, args: any): void {
        const doRestart = () => {
            this.miDebugger
                .restart(['interpreter-exec console "pio_restart_target"'])
                .then(
                    (result) => {
                        this.sendResponse(response);
                        setTimeout(() => {
                            this.stopped = true;
                            this.stoppedReason = 'restart';
                            this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
                            this.sendEvent(new StoppedEvent('restart', this.currentThreadId, true));
                        }, 50);
                    },
                    (err) => {
                        this.sendErrorResponse(response, 6, `Could not restart: ${err}`);
                    }
                );
        };

        if (this.stopped) {
            doRestart();
        } else {
            this.miDebugger.once('generic-stopped', doRestart);
            this.miDebugger.sendCommand('exec-interrupt');
        }
    }

    private handleAdapterOutput(text: string): void {
        this.sendEvent(new AdapterOutputEvent(text, 'out'));
    }

    private handleMsg(type: string, message: string): void {
        if (type === 'target') {
            type = 'stdout';
        }
        if (type === 'log') {
            type = 'stderr';
        }
        this.sendEvent(new OutputEvent(message, type));
    }

    private handleRunning(info: any): void {
        this.stopped = false;
        this.sendEvent(new ContinuedEvent(this.currentThreadId, true));
        this.sendEvent(new CustomContinuedEvent(this.currentThreadId, true));
    }

    private handleBreakpoint(info: any): void {
        const threadId = parseInt(info.record('thread-id') || this.currentThreadId);
        this.stopped = true;
        this.stoppedReason = 'breakpoint';
        this.sendEvent(new StoppedEvent('breakpoint', threadId, true));
        this.sendEvent(new CustomStopEvent('breakpoint', threadId));
    }

    private handleBreak(info: any): void {
        this.stopped = true;
        this.stoppedReason = 'step';
        this.sendEvent(new StoppedEvent('step', this.currentThreadId, true));
        this.sendEvent(new CustomStopEvent('step', this.currentThreadId));
    }

    private handlePause(info: any): void {
        this.stopped = true;
        this.stoppedReason = 'user request';
        this.sendEvent(new StoppedEvent('user request', this.currentThreadId, true));
        this.sendEvent(new CustomStopEvent('user request', this.currentThreadId));
    }

    private handleThreadCreated(info: any): void {
        this.sendEvent(new ThreadEvent('started', info.threadId));
    }

    private handleThreadExited(info: any): void {
        this.sendEvent(new ThreadEvent('exited', info.threadId));
    }

    private handleThreadSelected(info: any): void {
        this.currentThreadId = info.threadId;
        this.sendEvent(new ThreadEvent('selected', info.threadId));
    }

    private stopEvent(info: any): void {
        if (!this.started) {
            this.crashed = true;
        }
        if (!this.quit) {
            this.stopped = true;
            this.stoppedReason = 'exception';
            this.sendEvent(new StoppedEvent('exception', this.currentThreadId, true));
            this.sendEvent(new CustomStopEvent('exception', this.currentThreadId));
        }
    }

    private quitEvent(): void {
        this.quit = true;
        this.sendEvent(new TerminatedEvent());
    }

    private launchError(err: any): void {
        this.handleMsg('stderr', `Could not start debugger process > ${err.toString()}\n`);
        this.quitEvent();
    }

    protected setFunctionBreakPointsRequest(response: any, args: any): void {
        if (!args.breakpoints || !args.breakpoints.length) {
            return;
        }

        const setBreakpoints = async (shouldContinue: boolean) => {
            const promises: Promise<any>[] = [];
            args.breakpoints.forEach((bp: any) => {
                promises.push(
                    this.miDebugger.addBreakPoint({
                        raw: bp.name,
                        condition: bp.condition,
                        countCondition: bp.hitCondition,
                    })
                );
            });

            try {
                const results = await Promise.all(promises);
                const breakpoints: any[] = [];
                results.forEach((result) => {
                    if (result[0]) {
                        breakpoints.push({ line: result[1].line });
                    }
                });
                response.body = { breakpoints };
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 10, err.toString());
            }

            if (shouldContinue) {
                await this.miDebugger.sendCommand('exec-continue');
            }
        };

        const doSet = async () => {
            if (this.stopped) {
                await setBreakpoints(false);
            } else {
                this.miDebugger.sendCommand('exec-interrupt');
                this.miDebugger.once('generic-stopped', () => {
                    setBreakpoints(true);
                });
            }
        };

        if (this.debugReady) {
            doSet();
        } else {
            this.miDebugger.once('debug-ready', doSet);
        }
    }

    protected setBreakPointsRequest(response: any, args: any): void {
        const setBreakpoints = async (shouldContinue: boolean) => {
            this.debugReady = true;
            const existingBreakpoints = (this.breakpointMap.get(args.source.path) || []).map(
                (bp: any) => bp.number
            );

            try {
                await this.miDebugger.removeBreakpoints(existingBreakpoints);
                this.breakpointMap.set(args.source.path, []);

                const promises: Promise<any>[] = [];
                const decodedPath = decodeURIComponent(args.source.path);

                if (decodedPath.startsWith('disassembly:/')) {
                    const params = parseQuery(decodedPath.substr(decodedPath.indexOf('?')));
                    const func = await this.getDisassemblyForFunction(params.func, params.file);
                    args.breakpoints.forEach((bp: any) => {
                        if (bp.line <= func.instructions.length) {
                            const instruction = func.instructions[bp.line - 1];
                            promises.push(
                                this.miDebugger.addBreakPoint({
                                    file: args.source.path,
                                    line: bp.line,
                                    condition: bp.condition,
                                    countCondition: bp.hitCondition,
                                    raw: instruction.address,
                                })
                            );
                        }
                    });
                } else {
                    args.breakpoints.forEach((bp: any) => {
                        promises.push(
                            this.miDebugger.addBreakPoint({
                                file: args.source.path,
                                line: bp.line,
                                condition: bp.condition,
                                countCondition: bp.hitCondition,
                            })
                        );
                    });
                }

                const results = (await Promise.all(promises)).filter((r) => r !== null);
                response.body = {
                    breakpoints: results.map((bp: any) => ({
                        line: bp.line,
                        id: bp.number,
                        verified: true,
                    })),
                };
                this.breakpointMap.set(args.source.path, results);
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 9, err.toString());
            }

            if (shouldContinue) {
                await this.miDebugger.sendCommand('exec-continue');
            }
        };

        const doSet = async () => {
            if (this.stopped) {
                await setBreakpoints(false);
            } else {
                await this.miDebugger.sendCommand('exec-interrupt');
                this.miDebugger.once('generic-stopped', () => {
                    setBreakpoints(true);
                });
            }
        };

        if (this.debugReady) {
            doSet();
        } else {
            this.miDebugger.once('debug-ready', doSet);
        }
    }

    protected async threadsRequest(response: any): Promise<void> {
        if (!this.stopped) {
            response.body = { threads: [] };
            this.sendResponse(response);
            return;
        }

        try {
            const result = await this.miDebugger.sendCommand('thread-list-ids');
            const threadIds: number[] = result.result('thread-ids').map((t: any) => parseInt(t[1]));
            const currentThreadId = result.result('current-thread-id');

            if (currentThreadId) {
                this.currentThreadId = parseInt(currentThreadId);
            } else {
                await this.miDebugger.sendCommand(`thread-select ${threadIds[0]}`);
                this.currentThreadId = threadIds[0];
            }

            const threadInfoResults = await Promise.all(
                threadIds.map((id) => this.miDebugger.sendCommand(`thread-info ${id}`))
            );

            const threads = threadInfoResults
                .map((info) => {
                    let thread = info.result('threads');
                    if (thread.length === 1) {
                        thread = thread[0];
                        const id = parseInt(MINode.valueOf(thread, 'id'));
                        const targetId = MINode.valueOf(thread, 'target-id');
                        const details = MINode.valueOf(thread, 'details');
                        return new Thread(id, details || targetId);
                    }
                    return null;
                })
                .filter((t) => t !== null);

            response.body = { threads };
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 1, `Unable to get thread information: ${err}`);
        }
    }

    protected async stackTraceRequest(response: any, args: any): Promise<void> {
        try {
            const stack = await this.miDebugger.getStack(args.threadId, args.startFrame, args.levels);
            const frames: StackFrame[] = [];

            for (const frame of stack) {
                const frameIndex = 0xffff & ((args.threadId << 8) | (0xff & frame.level));
                const filePath = frame.file;
                let useDisassembly = this.forceDisassembly || !filePath;

                if (!useDisassembly) {
                    useDisassembly = !(await this.checkFileExists(filePath));
                }

                if (
                    !useDisassembly &&
                    this.activeEditorPath &&
                    this.activeEditorPath.startsWith('disassembly://')
                ) {
                    const func = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
                    if (func && encodeDisassembly(func.name, func.file) === this.activeEditorPath) {
                        useDisassembly = true;
                    }
                }

                try {
                    if (useDisassembly) {
                        const disassembly = await this.getDisassemblyForFunction(
                            frame.function,
                            frame.fileName
                        );
                        let lineNumber = -1;
                        disassembly.instructions.forEach((instruction: any, index: number) => {
                            if (instruction.address === frame.address) {
                                lineNumber = index + 1;
                            }
                        });

                        if (lineNumber !== -1) {
                            const uri = encodeDisassembly(disassembly.name, disassembly.file);
                            frames.push(
                                new StackFrame(
                                    frameIndex,
                                    `${frame.function}@${frame.address}`,
                                    new Source(disassembly.name, uri),
                                    lineNumber,
                                    0
                                )
                            );
                        } else {
                            frames.push(
                                new StackFrame(
                                    frameIndex,
                                    frame.function + '@' + frame.address,
                                    null,
                                    frame.line,
                                    0
                                )
                            );
                        }
                    } else {
                        frames.push(
                            new StackFrame(
                                frameIndex,
                                frame.function + '@' + frame.address,
                                new Source(frame.fileName, filePath),
                                frame.line,
                                0
                            )
                        );
                    }
                } catch (err) {
                    frames.push(
                        new StackFrame(
                            frameIndex,
                            frame.function + '@' + frame.address,
                            null,
                            frame.line,
                            0
                        )
                    );
                }
            }

            response.body = { stackFrames: frames };
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 12, `Failed to get Stack Trace: ${err.toString()}`);
        }
    }

    protected configurationDoneRequest(response: any, args: any): void {
        this.sendResponse(response);
    }

    protected scopesRequest(response: any, args: any): void {
        const scopes = new Array<Scope>();
        scopes.push(new Scope('Local', parseInt(args.frameId), false));
        scopes.push(new Scope('Global', 254, false));
        scopes.push(new Scope('Static', STATIC_HANDLES_START + parseInt(args.frameId), false));
        response.body = { scopes };
        this.sendResponse(response);
    }

    private createVariable(name: string | VariableObject, options?: any): number {
        if (options) {
            return this.variableHandles.create(new ExtendedVariable(name as string, options));
        }
        return this.variableHandles.create(name as any);
    }

    private findOrCreateVariable(variable: VariableObject): number {
        let id: number;
        if (this.variableHandlesReverse.hasOwnProperty(variable.name)) {
            id = this.variableHandlesReverse[variable.name];
        } else {
            id = this.createVariable(variable);
            this.variableHandlesReverse[variable.name] = id;
        }
        return variable.isCompound() ? id : 0;
    }

    private async getVarObjByName(expression: string, name: string): Promise<VariableObject> {
        let varObj: VariableObject;

        try {
            const updateResult = await this.miDebugger.varUpdate(name);
            updateResult.result('changelist').forEach((change: any) => {
                const changeName = MINode.valueOf(change, 'name');
                const handle = this.variableHandlesReverse[changeName];
                (this.variableHandles.get(handle) as VariableObject).applyChanges(change);
            });
            const handle = this.variableHandlesReverse[name];
            varObj = this.variableHandles.get(handle) as VariableObject;
        } catch (err) {
            if (!(err instanceof MIError && err.message === 'Variable object not found')) {
                throw err;
            }
            varObj = await this.miDebugger.varCreate(expression, name);
            const id = this.findOrCreateVariable(varObj);
            varObj.exp = expression;
            varObj.id = id;
        }

        return varObj;
    }

    private async stackVariablesRequest(
        threadId: number,
        frameLevel: number,
        response: any,
        args: any
    ): Promise<void> {
        const variables: any[] = [];
        try {
            const stackVars = await this.miDebugger.getStackVariables(threadId, frameLevel);
            for (const stackVar of stackVars) {
                try {
                    const varName = `var_local_${stackVar.name}`;
                    const varObj = await this.getVarObjByName(stackVar.name, varName);
                    variables.push(varObj.toProtocolVariable());
                } catch (err) {
                    variables.push({
                        name: stackVar.name,
                        value: `<${err}>`,
                        variablesReference: 0,
                    });
                }
            }
            response.body = { variables };
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
        }
    }

    private async globalVariablesRequest(response: any, args: any): Promise<void> {
        const globalVars = this.symbolTable.getGlobalVariables();
        const variables: any[] = [];

        try {
            for (const globalVar of globalVars) {
                const varName = `var_global_${globalVar.name}`;
                const varObj = await this.getVarObjByName(globalVar.name, varName);
                variables.push(varObj.toProtocolVariable());
            }
            response.body = { variables };
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 1, `Could not get global variable information: ${err}`);
        }
    }

    private async staticVariablesRequest(
        threadId: number,
        frameLevel: number,
        response: any,
        args: any
    ): Promise<void> {
        const variables: any[] = [];
        try {
            const frameInfo = await this.miDebugger.getFrame(threadId, frameLevel);
            const fileName = frameInfo.fileName;
            const staticVars = this.symbolTable.getStaticVariables(fileName);

            for (const staticVar of staticVars) {
                const varName = `var_static_${fileName}_${staticVar.name}`;
                const varObj = await this.getVarObjByName(staticVar.name, varName);
                variables.push(varObj.toProtocolVariable());
            }
            response.body = { variables };
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 1, `Could not get global variable information: ${err}`);
        }
    }

    private async variableMembersRequest(
        expression: string,
        response: any,
        args: any
    ): Promise<void> {
        let evalResult: MINode;
        try {
            evalResult = await this.miDebugger.evalExpression(JSON.stringify(expression));
            try {
                let expanded: any = expandValue(
                    this.createVariable.bind(this),
                    evalResult.result('value'),
                    expression,
                    evalResult
                );

                if (expanded) {
                    if (typeof expanded[0] === 'string') {
                        const formatValue = (v: any): string => {
                            if (typeof v === 'object') {
                                if (v.length !== undefined) {
                                    return v.join(', ');
                                }
                                return JSON.stringify(v);
                            }
                            return v;
                        };
                        expanded = [
                            {
                                name: '<value>',
                                value: formatValue(expanded),
                                variablesReference: 0,
                            },
                        ];
                    }
                    response.body = { variables: expanded };
                    this.sendResponse(response);
                } else {
                    this.sendErrorResponse(response, 2, 'Could not expand variable');
                }
            } catch (err) {
                this.sendErrorResponse(response, 2, `Could not expand variable: ${err}`);
            }
        } catch (err) {
            this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
        }
    }

    protected async variablesRequest(response: any, args: any): Promise<void> {
        let varRef: any;

        if (args.variablesReference === 254) {
            return this.globalVariablesRequest(response, args);
        }

        if (args.variablesReference >= 256 && args.variablesReference < STATIC_HANDLES_START) {
            const frameLevel = 0xff & args.variablesReference;
            const threadId = (0xff00 & args.variablesReference) >>> 8;
            return this.stackVariablesRequest(threadId, frameLevel, response, args);
        }

        if (
            args.variablesReference >= STATIC_HANDLES_START &&
            args.variablesReference <= STATIC_HANDLES_END
        ) {
            const frameLevel = 0xff & args.variablesReference;
            const threadId = (0xff00 & args.variablesReference) >>> 8;
            return this.staticVariablesRequest(threadId, frameLevel, response, args);
        }

        varRef = this.variableHandles.get(args.variablesReference);

        if (typeof varRef === 'string') {
            return this.variableMembersRequest(varRef, response, args);
        }

        if (typeof varRef === 'object') {
            if (varRef instanceof VariableObject) {
                const parent = varRef;
                try {
                    const children = await this.miDebugger.varListChildren(varRef.name);
                    const variables = children.map((child) => {
                        const id = this.findOrCreateVariable(child);
                        child.id = id;
                        if (/^\d+$/.test(child.exp)) {
                            child.fullExp = `${parent.fullExp || parent.exp}[${child.exp}]`;
                        } else {
                            child.fullExp = `${parent.fullExp || parent.exp}.${child.exp}`;
                        }
                        return child.toProtocolVariable();
                    });
                    response.body = { variables };
                    this.sendResponse(response);
                } catch (err) {
                    this.sendErrorResponse(response, 1, `Could not expand variable: ${err}`);
                }
            } else if (varRef instanceof ExtendedVariable) {
                const extVar = varRef;
                if (extVar.options.arg) {
                    const variables: any[] = [];
                    let firstNull = true;
                    let index = 0;

                    const done = () => {
                        response.body = { variables };
                        this.sendResponse(response);
                    };

                    const fetchNext = async () => {
                        const evalResult = await this.miDebugger.evalExpression(
                            JSON.stringify(`${extVar.name}+${index})`)
                        );
                        try {
                            const expanded = expandValue(
                                this.createVariable.bind(this),
                                evalResult.result('value'),
                                extVar.name,
                                evalResult
                            );

                            if (expanded) {
                                if (typeof expanded === 'string') {
                                    if (expanded === '<nullptr>') {
                                        if (!firstNull) {
                                            return done();
                                        }
                                        firstNull = false;
                                    } else if (expanded[0] !== '"') {
                                        variables.push({
                                            name: '[err]',
                                            value: expanded,
                                            variablesReference: 0,
                                        });
                                        return done();
                                    }
                                    variables.push({
                                        name: `[${index++}]`,
                                        value: expanded,
                                        variablesReference: 0,
                                    });
                                    fetchNext();
                                } else {
                                    variables.push({
                                        name: '[err]',
                                        value: expanded,
                                        variablesReference: 0,
                                    });
                                    done();
                                }
                            } else {
                                this.sendErrorResponse(response, 15, 'Could not expand variable');
                            }
                        } catch (err) {
                            this.sendErrorResponse(response, 14, `Could not expand variable: ${err}`);
                        }
                    };

                    fetchNext();
                } else {
                    this.sendErrorResponse(
                        response,
                        13,
                        `Unimplemented variable request options: ${JSON.stringify(extVar.options)}`
                    );
                }
            } else {
                response.body = { variables: varRef };
                this.sendResponse(response);
            }
        } else {
            response.body = { variables: [] };
            this.sendResponse(response);
        }
    }

    protected async evaluateRequest(response: any, args: any): Promise<void> {
        if (args.context === 'watch') {
            try {
                const varName = `watch_${crypto.createHash('md5').update(args.expression).digest('hex')}}`;
                const varObj = await this.getVarObjByName(args.expression, varName);
                response.body = {
                    result: varObj.value,
                    variablesReference: varObj.id,
                };
                this.sendResponse(response);
            } catch (err) {
                response.body = {
                    result: `<${err.toString()}>`,
                    variablesReference: 0,
                };
                this.sendErrorResponse(response, 7, err.toString());
            }
        } else if (args.context === 'hover') {
            try {
                const result = await this.miDebugger.evalExpression(args.expression);
                response.body = {
                    variablesReference: 0,
                    result: result.result('value'),
                };
                this.sendResponse(response);
            } catch (err) {
                this.sendErrorResponse(response, 7, err.toString());
            }
        } else {
            this.miDebugger.sendUserInput(args.expression).then(
                (result) => {
                    response.body =
                        result === undefined
                            ? { result: '', variablesReference: 0 }
                            : { result: JSON.stringify(result), variablesReference: 0 };
                    this.sendResponse(response);
                },
                (err) => {
                    this.sendErrorResponse(response, 8, err.toString());
                }
            );
        }
    }

    protected async setVariableRequest(response: any, args: any): Promise<void> {
        try {
            let varName = args.name;
            const varRef = this.variableHandles.get(args.variablesReference);

            if (varRef) {
                varName = `${(varRef as VariableObject).name}.${args.name}`;
            } else if (args.variablesReference === 254) {
                varName = `var_global_${args.name}`;
            } else if (args.variablesReference >= 256 && args.variablesReference < STATIC_HANDLES_START) {
                varName = `var_local_${args.name}`;
            } else if (
                args.variablesReference >= STATIC_HANDLES_START &&
                args.variablesReference <= STATIC_HANDLES_END
            ) {
                varName = `var_static_${args.name}`;
            }

            const result = await this.miDebugger.varAssign(varName, args.value);
            response.body = { value: result.result('value') };
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 11, `Could not update variable: ${err}`);
        }
    }

    protected pauseRequest(response: any, args: any): void {
        this.miDebugger.interrupt(args.threadId).then(
            (result) => {
                this.sendResponse(response);
            },
            (err) => {
                this.sendErrorResponse(response, 3, `Could not pause: ${err}`);
            }
        );
    }

    protected continueRequest(response: any, args: any): void {
        this.miDebugger.continue(args.threadId).then(
            (result) => {
                response.body = { allThreadsContinued: true };
                this.sendResponse(response);
            },
            (err) => {
                this.sendErrorResponse(response, 2, `Could not continue: ${err}`);
            }
        );
    }

    protected async stepInRequest(response: any, args: any): Promise<void> {
        try {
            let useDisassembly = this.forceDisassembly;
            if (!useDisassembly) {
                const frame = await this.miDebugger.getFrame(args.threadId, 0);
                useDisassembly = !(await this.checkFileExists(frame.file));

                if (
                    this.activeEditorPath &&
                    this.activeEditorPath.startsWith('disassembly://')
                ) {
                    const func = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
                    if (encodeDisassembly(func.name, func.file) === this.activeEditorPath) {
                        useDisassembly = true;
                    }
                }
            }
            await this.miDebugger.step(args.threadId, useDisassembly);
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 6, `Could not step over: ${err}`);
        }
    }

    protected stepOutRequest(response: any, args: any): void {
        this.miDebugger.stepOut(args.threadId).then(
            (result) => {
                this.sendResponse(response);
            },
            (err) => {
                this.sendErrorResponse(response, 5, `Could not step out: ${err}`);
            }
        );
    }

    protected async nextRequest(response: any, args: any): Promise<void> {
        try {
            let useDisassembly = this.forceDisassembly;
            if (!useDisassembly) {
                const frame = await this.miDebugger.getFrame(args.threadId, 0);
                useDisassembly = !(await this.checkFileExists(frame.file));

                if (
                    this.activeEditorPath &&
                    this.activeEditorPath.startsWith('disassembly://')
                ) {
                    const func = this.symbolTable.getFunctionByName(frame.function, frame.fileName);
                    if (encodeDisassembly(func.name, func.file) === this.activeEditorPath) {
                        useDisassembly = true;
                    }
                }
            }
            await this.miDebugger.next(args.threadId, useDisassembly);
            this.sendResponse(response);
        } catch (err) {
            this.sendErrorResponse(response, 6, `Could not step over: ${err}`);
        }
    }

    private checkFileExists(file: string): Promise<boolean> {
        if (!file) {
            return Promise.resolve(false);
        }
        if (this.fileExistsCache.has(file)) {
            return Promise.resolve(this.fileExistsCache.get(file));
        }
        return new Promise((resolve, reject) => {
            fs.exists(file, (exists) => {
                this.fileExistsCache.set(file, exists);
                resolve(exists);
            });
        });
    }
}

DebugSession.run(GDBDebugSession);
