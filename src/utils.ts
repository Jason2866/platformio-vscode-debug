export function hexFormat(value: number, padding: number = 8, includePrefix: boolean = true): string {
    let result = value.toString(16);
    while (result.length < padding) {
        result = '0' + result;
    }
    return includePrefix ? '0x' + result : result;
}

export function binaryFormat(
    value: number,
    padding: number = 0,
    includePrefix: boolean = true,
    groupByNibble: boolean = false
): string {
    let result = (value >>> 0).toString(2);
    while (result.length < padding) {
        result = '0' + result;
    }

    if (groupByNibble) {
        const extraZeros = 4 - (result.length % 4);
        for (let i = 0; i < extraZeros; i++) {
            result = '0' + result;
        }
        const groups = result.match(/[01]{4}/g);
        result = groups.join(' ');
        result = result.substring(extraZeros);
    }

    return includePrefix ? '0b' + result : result;
}

export function createMask(offset: number, width: number): number {
    let mask = 0;
    const end = offset + width - 1;
    for (let i = offset; i <= end; i++) {
        mask = (mask | (1 << i)) >>> 0;
    }
    return mask;
}

export function extractBits(value: number, offset: number, width: number): number {
    return ((value & createMask(offset, width)) >>> offset) >>> 0;
}

export function parseQuery(queryString: string): { [key: string]: string } {
    const params: { [key: string]: string } = {};
    const pairs = (queryString[0] === '?' ? queryString.substr(1) : queryString).split('&');
    for (const pair of pairs) {
        const parts = pair.split('=');
        params[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || '');
    }
    return params;
}

export function encodeDisassembly(name: string, file: string): string {
    let uri = 'disassembly:///';
    if (file) {
        uri += `${file}:`;
    }
    uri += `${name}.dbgasm?func=${name}&file=${file || ''}`;
    return uri;
}
