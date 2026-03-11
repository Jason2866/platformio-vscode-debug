import { MINode } from './mi_parse';

const VARIABLE_ASSIGNMENT_REGEX = /^([a-zA-Z_\-][a-zA-Z0-9_\-]*|\[\d+\])\s*=\s*/;
const VARIABLE_NAME_REGEX = /^[a-zA-Z_\-][a-zA-Z0-9_\-]*/;
const ANGLE_BRACKET_REGEX = /^\<.+?\>/;
const HEX_STRING_REGEX = /^(0x[0-9a-fA-F]+\s*)"/;
const HEX_REGEX = /^0x[0-9a-fA-F]+/;
const NULL_PTR_REGEX = /^0x0+\b/;
const CHAR_CODE_STRING_REGEX = /^(\d+) ['"]/;
const NUMBER_REGEX = /^\d+(\.\d+)?/;

/** Determines if a value string is expandable. */
export function isExpandable(value: string): number {
    value = value.trim();
    if (value.length === 0) {
        return 0;
    }
    if (value.startsWith('{...}')) {
        /** Determines if a value string is expandable. */
        return 2;
    }
    if (value[0] === '{') {
        return 1;
    }
    if (value.startsWith('true') || value.startsWith('false') || NULL_PTR_REGEX.exec(value) || HEX_STRING_REGEX.exec(value)) {
        return 0;
    }
    if (HEX_REGEX.exec(value)) {
        return 2;
    }
    // Check other patterns but always return 0 for them
    CHAR_CODE_STRING_REGEX.exec(value) || NUMBER_REGEX.exec(value) || VARIABLE_NAME_REGEX.exec(value) || ANGLE_BRACKET_REGEX.exec(value);
    return 0;
}

/** Parses a GDB value string into a DAP variable tree. */
export function expandValue(
    createVariableReference: (name: string | any, options?: any) => number,
    value: string,
    root: string = '',
    extra?: any
): any {
    /** Parses a GDB value string into a DAP variable tree. */
    const parseQuotedString = (): string => {
        value = value.trim();
        if (value[0] !== '"' && value[0] !== "'") {
            return '';
        }

        let pos = 1;
        let scanning = true;
        const quote = value[0];
        let remaining = value.substr(1);
        let escaped = false;

        while (scanning) {
            if (escaped) {
                escaped = false;
            } else if (remaining[0] === '\\') {
                escaped = true;
            } else if (remaining[0] === quote) {
                scanning = false;
            }
            remaining = remaining.substr(1);
            pos++;
        }

        const result = value.substr(0, pos).trim();
        value = value.substr(pos).trim();
        return result;
    };

    const stack = [root];
    let lastAssignedVariable = '';

    const buildFullExpression = (name: string): string => {
        let fullPath = '';
        let derefPrefix = '';
        stack.push(name);
        stack.forEach((part) => {
            derefPrefix = '';
            if (part === '') {
                // skip
            } else if (part.startsWith('[')) {
                fullPath += part;
            } else if (fullPath) {
                while (part.startsWith('*')) {
                    derefPrefix += '*';
                    part = part.substr(1);
                }
                fullPath = fullPath + '.' + part;
            } else {
                fullPath = part;
            }
        });
        stack.pop();
        return derefPrefix + fullPath;
    };

    let parseValue: () => any;
    let parseCommaValue: () => any;
    let parseNamedValue: (pushToStack?: boolean) => any;
    let parseCommaNamedValue: (pushToStack?: boolean) => any;
    let createResult: (name: string, val: any) => any;

    parseValue = (): any => {
        value = value.trim();

        if (value[0] === '"') {
            return parseQuotedString();
        }

        if (value[0] === '{') {
            // Parse object/array
            return (() => {
                value = value.trim();
                if (value[0] !== '{') {
                    return;
                }
                value = value.substr(1).trim();
                if (value[0] === '}') {
                    value = value.substr(1).trim();
                    return [];
                }
                if (value.startsWith('...')) {
                    value = value.substr(3).trim();
                    if (value[0] === '}') {
                        value = value.substr(1).trim();
                        return '<...>';
                    }
                }

                // Check if this is an array or named values
                const equalsIdx = value.indexOf('=');
                const braceIdx = value.indexOf('{');
                const commaIdx = value.indexOf(',');

                let checkIdx = braceIdx;
                if (commaIdx !== -1 && commaIdx < braceIdx) {
                    checkIdx = commaIdx;
                }

                if ((checkIdx !== -1 && equalsIdx > checkIdx) || equalsIdx === -1) {
                    // Array of values
                    const arr: any[] = [];
                    stack.push('[0]');
                    let val = parseValue();
                    stack.pop();
                    arr.push(createResult('[0]', val));

                    let index = 0;
                    for (;;) {
                        stack.push('[' + (++index) + ']');
                        val = parseCommaValue();
                        if (!val) {
                            stack.pop();
                            break;
                        }
                        stack.pop();
                        arr.push(createResult('[' + index + ']', val));
                    }
                    value = value.substr(1).trim();
                    return arr;
                }

                // Named values
                let named = parseNamedValue(true);
                if (named) {
                    const arr: any[] = [];
                    arr.push(named);
                    while ((named = parseCommaNamedValue(true))) {
                        arr.push(named);
                    }
                    value = value.substr(1).trim();
                    return arr;
                }
            })();
        }

        // Parse primitive value
        return (() => {
            value = value.trim();
            let match: RegExpExecArray;
            let result: any;

            if (value.length === 0) {
                result = undefined;
            } else if (value.startsWith('true')) {
                result = 'true';
                value = value.substr(4).trim();
            } else if (value.startsWith('false')) {
                result = 'false';
                value = value.substr(5).trim();
            } else if ((match = NULL_PTR_REGEX.exec(value))) {
                result = '<nullptr>';
                value = value.substr(match[0].length).trim();
            } else if ((match = HEX_STRING_REGEX.exec(value))) {
                value = value.substr(match[1].length).trim();
                result = parseQuotedString();
            } else if ((match = HEX_REGEX.exec(value))) {
                result = '*' + match[0];
                value = value.substr(match[0].length).trim();
            } else if ((match = CHAR_CODE_STRING_REGEX.exec(value))) {
                result = match[1];
                value = value.substr(match[0].length - 1);
                result += ' ' + parseQuotedString();
            } else if (
                (match = NUMBER_REGEX.exec(value)) ||
                (match = VARIABLE_NAME_REGEX.exec(value)) ||
                (match = ANGLE_BRACKET_REGEX.exec(value))
            ) {
                result = match[0];
                value = value.substr(match[0].length).trim();
            } else {
                result = value;
            }

            return result;
        })();
    };

    parseNamedValue = (pushToStack: boolean = false): any => {
        value = value.trim();
        const match = VARIABLE_ASSIGNMENT_REGEX.exec(value);
        if (!match) {
            return;
        }
        value = value.substr(match[0].length).trim();
        const name = (lastAssignedVariable = match[1]);
        if (pushToStack) {
            stack.push(lastAssignedVariable);
        }
        const val = parseValue();
        if (pushToStack) {
            stack.pop();
        }
        return createResult(name, val);
    };

    createResult = (name: string, val: any): any => {
        let variablesReference = 0;

        if (typeof val === 'object') {
            variablesReference = createVariableReference(val);
            val = 'Object';
        }

        if (typeof val === 'string' && val.startsWith('*0x')) {
            if (extra && MINode.valueOf(extra, 'arg') === '1') {
                variablesReference = createVariableReference(buildFullExpression('*(' + name), { arg: true });
                val = '<args>';
            } else {
                variablesReference = createVariableReference(buildFullExpression('*' + name));
                val = 'Object@' + val;
            }
        }

        if (typeof val === 'string' && val.startsWith('<...>')) {
            variablesReference = createVariableReference(buildFullExpression(name));
            val = '...';
        }

        return {
            name,
            value: val,
            variablesReference,
        };
    };

    parseCommaValue = (): any => {
        value = value.trim();
        if (value[0] === ',') {
            value = value.substr(1).trim();
            return parseValue();
        }
    };

    parseCommaNamedValue = (pushToStack: boolean = false): any => {
        value = value.trim();
        if (value[0] === ',') {
            value = value.substr(1).trim();
            return parseNamedValue(pushToStack);
        }
    };

    value = value.trim();
    return parseValue();
}
