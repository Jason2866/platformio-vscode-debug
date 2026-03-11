import * as vscode from 'vscode';
import { hexFormat, parseQuery } from '../utils';

/** TextDocumentContentProvider for examinememory://. */
export class MemoryContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public onDidChange = this._onDidChange.event;

    private firstBytePos = 10;
    private lastBytePos = this.firstBytePos + 48 - 1;
    private firstAsciiPos = this.lastBytePos + 3;
    private lastAsciiPos = this.firstAsciiPos + 16;

    private smallDecorationType = vscode.window.createTextEditorDecorationType({
        borderWidth: '1px',
        borderStyle: 'solid',
        overviewRulerColor: 'blue',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        light: { borderColor: 'darkblue' },
        dark: { borderColor: 'lightblue' },
    });

    /** Returns hex+ASCII memory dump for the URI. */
    provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
        return new Promise((resolve, reject) => {
            const params = parseQuery(uri.query);
            const address = params.address.startsWith('0x')
                ? parseInt(params.address.substring(2), 16)
                : parseInt(params.address, 10);
            const length = params.length.startsWith('0x')
                ? parseInt(params.length.substring(2), 16)
                : parseInt(params.length, 10);

            vscode.debug.activeDebugSession
                .customRequest('read-memory', { address, length: length || 32 })
                .then(
                    (result: any) => {
                        const bytes: number[] = result.bytes;
                        let rowAddress = address - (address % 16);
                        const offset = address - rowAddress;
                        let output = '';

                        output += '  Offset: 00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F \t\n';
                        output += hexFormat(rowAddress, 8, false) + ': ';

                        let asciiStr = '';
                        for (let i = 0; i < offset; i++) {
                            output += '   ';
                            asciiStr += ' ';
                        }

                        for (let i = 0; i < length; i++) {
                            const byte = bytes[i];
                            output += hexFormat(byte, 2, false).toUpperCase() + ' ';
                            asciiStr +=
                                byte <= 32 || (byte >= 127 && byte <= 159)
                                    ? '.'
                                    : String.fromCharCode(bytes[i]);

                            if ((address + i) % 16 === 15 && i < length - 1) {
                                output += '  ' + asciiStr;
                                asciiStr = '';
                                output += '\n';
                                rowAddress += 16;
                                output += hexFormat(rowAddress, 8, false) + ': ';
                            }
                        }

                        const remaining = (16 - ((address + length) % 16)) % 16;
                        for (let i = 0; i < remaining; i++) {
                            output += '   ';
                        }
                        output += '  ' + asciiStr;
                        output += '\n';

                        resolve(output);
                    },
                    (error: any) => {
                        vscode.window.showErrorMessage(
                            `Unable to read memory from ${hexFormat(address, 8)} to ${hexFormat(address + length, 8)}`
                        );
                        reject(error.toString());
                    }
                );
        });
    }

    /** Triggers a content refresh. */
    update(document: vscode.TextDocument): void {
        this._onDidChange.fire(document.uri);
    }

    /** Maps editor position to byte offset. */
    getOffset(position: vscode.Position): number | undefined {
        if (position.line < 1 || position.character < this.firstBytePos) {
            return;
        }

        let offset = 16 * (position.line - 1);
        const charOffset = position.character - this.firstBytePos;

        if (position.character >= this.firstBytePos && position.character <= this.lastBytePos) {
            offset += Math.floor(charOffset / 3);
        } else if (position.character >= this.firstAsciiPos) {
            offset += position.character - this.firstAsciiPos;
        }

        return offset;
    }

    /** Maps byte offset to editor position. */
    getPosition(offset: number, isAscii: boolean = false): vscode.Position {
        const line = 1 + Math.floor(offset / 16);
        let character = offset % 16;
        if (isAscii) {
            character += this.firstAsciiPos;
        } else {
            character = this.firstBytePos + 3 * character;
        }
        return new vscode.Position(line, character);
    }

    /** Builds ranges for a contiguous byte range. */
    getRanges(startOffset: number, endOffset: number, isAscii: boolean): vscode.Range[] {
        const startPos = this.getPosition(startOffset, isAscii);
        let endPos = this.getPosition(endOffset, isAscii);
        endPos = new vscode.Position(endPos.line, endPos.character + (isAscii ? 1 : 2));

        const ranges: vscode.Range[] = [];
        const startChar = isAscii ? this.firstAsciiPos : this.firstBytePos;
        const endChar = isAscii ? this.lastAsciiPos : this.lastBytePos;

        for (let line = startPos.line; line <= endPos.line; ++line) {
            const lineStart = new vscode.Position(line, line === startPos.line ? startPos.character : startChar);
            const lineEnd = new vscode.Position(line, line === endPos.line ? endPos.character : endChar);
            ranges.push(new vscode.Range(lineStart, lineEnd));
        }

        return ranges;
    }

    /** Applies decorations for the selected range. */
    handleSelection(event: vscode.TextEditorSelectionChangeEvent): void {
        const lineCount = event.textEditor.document.lineCount;
        if (
            event.selections[0].start.line + 1 === lineCount ||
            event.selections[0].end.line + 1 === lineCount
        ) {
            event.textEditor.setDecorations(this.smallDecorationType, []);
            return;
        }

        const startOffset = this.getOffset(event.selections[0].start);
        const endOffset = this.getOffset(event.selections[0].end);

        if (startOffset === undefined || endOffset === undefined) {
            event.textEditor.setDecorations(this.smallDecorationType, []);
            return;
        }

        let ranges = this.getRanges(startOffset, endOffset, false);
        ranges = ranges.concat(this.getRanges(startOffset, endOffset, true));
        event.textEditor.setDecorations(this.smallDecorationType, ranges);
    }
}
