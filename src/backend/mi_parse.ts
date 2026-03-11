const OCTAL_ESCAPE_REGEX = /^[0-7]{3}/;

export class MINode {
    public token: number;
    public outOfBandRecord: any[];
    public resultRecords: any;

    constructor(token: number, outOfBandRecord: any[], resultRecords: any) {
        this.token = token;
        this.outOfBandRecord = outOfBandRecord;
        this.resultRecords = resultRecords;
    }

    static valueOf(startNode: any, path: string): any {
        if (!startNode) {
            return undefined;
        }

        const KEY_REGEX = /^\.?([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
        const INDEX_REGEX = /^\[(\d+)\](?:$|\.)/;

        path = path.trim();
        if (!path) {
            return startNode;
        }

        let current = startNode;

        do {
            let match = KEY_REGEX.exec(path);
            if (match) {
                path = path.substr(match[0].length);
                if (!current.length || typeof current === 'string') {
                    return undefined;
                } else {
                    const matches: any[] = [];
                    for (const item of current) {
                        if (item[0] === match[1]) {
                            matches.push(item[1]);
                        }
                    }
                    if (matches.length > 1) {
                        current = matches;
                    } else if (matches.length === 1) {
                        current = matches[0];
                    } else {
                        return undefined;
                    }
                }
            } else if (path[0] === '@') {
                current = [current];
                path = path.substr(1);
            } else {
                match = INDEX_REGEX.exec(path);
                if (!match) {
                    return undefined;
                }
                path = path.substr(match[0].length);
                const index = parseInt(match[1]);
                if (current.length && typeof current !== 'string' && index >= 0 && index < current.length) {
                    current = current[index];
                } else if (index !== 0) {
                    return undefined;
                }
            }

            path = path.trim();
        } while (path);

        return current;
    }

    record(path: string): any {
        if (this.outOfBandRecord) {
            return MINode.valueOf(this.outOfBandRecord[0].output, path);
        }
    }

    result(path: string): any {
        if (this.resultRecords) {
            return MINode.valueOf(this.resultRecords.results, path);
        }
    }
}

const OUT_OF_BAND_REGEX = /^(?:(\d*|undefined)([\*\+\=])|([\~\@\&]))/;
const RESULT_REGEX = /^(\d*)\^(done|running|connected|error|exit)/;
const NEWLINE_REGEX = /^\r\n?/;
const VARIABLE_NAME_REGEX = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*)/;
const ASYNC_CLASS_REGEX = /^(.*?),/;

function parseString(input: string): [string, string] {
    if (input[0] !== '"') {
        return ['', input];
    }

    let pos = 1;
    let scanning = true;
    let str = input.substr(1);
    let escaped = false;

    while (scanning) {
        if (escaped) {
            escaped = false;
        } else if (str[0] === '\\') {
            escaped = true;
        } else if (str[0] === '"') {
            scanning = false;
        }
        str = str.substr(1);
        pos++;
    }

    let result: string;
    try {
        result = parseCString(input.substr(0, pos));
    } catch (e) {
        result = input.substr(0, pos);
    }

    return [result, input.substr(pos)];
}

function parseCString(str: string): string {
    const buffer = Buffer.alloc(str.length * 4);
    let offset = 0;

    if (str[0] !== '"' || str[str.length - 1] !== '"') {
        throw new Error('Not a valid string');
    }
    str = str.slice(1, -1);

    let escaped = false;
    for (let i = 0; i < str.length; i++) {
        if (escaped) {
            let octalMatch;
            if (str[i] === '\\') {
                offset += buffer.write('\\', offset);
            } else if (str[i] === '"') {
                offset += buffer.write('"', offset);
            } else if (str[i] === "'") {
                offset += buffer.write("'", offset);
            } else if (str[i] === 'n') {
                offset += buffer.write('\n', offset);
            } else if (str[i] === 'r') {
                offset += buffer.write('\r', offset);
            } else if (str[i] === 't') {
                offset += buffer.write('\t', offset);
            } else if (str[i] === 'b') {
                offset += buffer.write('\b', offset);
            } else if (str[i] === 'f') {
                offset += buffer.write('\f', offset);
            } else if (str[i] === 'v') {
                offset += buffer.write('\v', offset);
            } else if (str[i] === '0') {
                offset += buffer.write('\0', offset);
            } else if ((octalMatch = OCTAL_ESCAPE_REGEX.exec(str.substr(i)))) {
                buffer.writeUInt8(parseInt(octalMatch[0], 8), offset++);
                i += 2;
            } else {
                offset += buffer.write(str[i], offset);
            }
            escaped = false;
        } else if (str[i] === '\\') {
            escaped = true;
        } else {
            if (str[i] === '"') {
                throw new Error('Not a valid string');
            }
            offset += buffer.write(str[i], offset);
        }
    }

    return buffer.slice(0, offset).toString('utf8');
}

export function parseMI(output: string): MINode {
    let token: number;
    const outOfBandRecords: any[] = [];
    let resultRecords: any;

    const asyncClassMap: { [key: string]: string } = {
        '*': 'exec',
        '+': 'status',
        '=': 'notify',
    };

    const streamClassMap: { [key: string]: string } = {
        '~': 'console',
        '@': 'target',
        '&': 'log',
    };

    let parseValue: () => any;
    let parseResult: () => any;
    let parseCommaValue: () => any;
    let parseCommaResult: () => any;

    parseValue = (): any => {
        if (output[0] === '"') {
            const [str, rest] = parseString(output);
            output = rest;
            return str;
        } else if (output[0] === '{' || output[0] === '[') {
            const isList = output[0] === '[';
            output = output.substr(1);
            if (output[0] === '}' || output[0] === ']') {
                output = output.substr(1);
                return [];
            }

            if (isList) {
                let val = parseValue();
                if (val) {
                    const arr: any[] = [];
                    arr.push(val);
                    while ((val = parseCommaValue()) !== undefined) {
                        arr.push(val);
                    }
                    output = output.substr(1);
                    return arr;
                }
            }

            let result = parseResult();
            if (result) {
                const arr: any[] = [];
                arr.push(result);
                while ((result = parseCommaResult())) {
                    arr.push(result);
                }
                output = output.substr(1);
                return arr;
            }

            output = (isList ? '[' : '{') + output;
        }
        return undefined;
    };

    parseResult = (): any => {
        const match = VARIABLE_NAME_REGEX.exec(output);
        if (match) {
            output = output.substr(match[0].length + 1); // +1 for '='
            return [match[1], parseValue()];
        }
    };

    parseCommaValue = (): any => {
        if (output[0] === ',') {
            output = output.substr(1);
            return parseValue();
        }
    };

    parseCommaResult = (): any => {
        if (output[0] === ',') {
            output = output.substr(1);
            return parseResult();
        }
    };

    let match: RegExpExecArray;

    while ((match = OUT_OF_BAND_REGEX.exec(output))) {
        output = output.substr(match[0].length);

        if (match[1] && token === undefined && match[1] !== 'undefined') {
            token = parseInt(match[1]);
        }

        if (match[2]) {
            const classMatch = ASYNC_CLASS_REGEX.exec(output);
            output = output.substr(classMatch[1].length);
            const record: any = {
                isStream: false,
                type: asyncClassMap[match[2]],
                asyncClass: classMatch[1],
                output: [],
            };
            let res;
            while ((res = parseCommaResult())) {
                record.output.push(res);
            }
            outOfBandRecords.push(record);
        } else if (match[3]) {
            const [content, rest] = parseString(output);
            output = rest;
            const record: any = {
                isStream: true,
                type: streamClassMap[match[3]],
                content,
            };
            outOfBandRecords.push(record);
        }

        output = output.replace(NEWLINE_REGEX, '');
    }

    if ((match = RESULT_REGEX.exec(output))) {
        output = output.substr(match[0].length);
        if (match[1] && token === undefined) {
            token = parseInt(match[1]);
        }
        resultRecords = {
            resultClass: match[2],
            results: [],
        };
        let res;
        while ((res = parseCommaResult())) {
            resultRecords.results.push(res);
        }
        output = output.replace(NEWLINE_REGEX, '');
    }

    return new MINode(token, outOfBandRecords || [], resultRecords);
}
