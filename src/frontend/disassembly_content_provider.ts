import * as vscode from 'vscode';
import { parseQuery } from '../utils';

export class DisassemblyContentProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): Thenable<string> {
        return new Promise((resolve, reject) => {
            const params = parseQuery(uri.query);
            vscode.debug.activeDebugSession
                .customRequest('disassemble', { function: params.func, file: params.file })
                .then(
                    (result: any) => {
                        const instructions = result.instructions;
                        let output = '';
                        instructions.forEach((instruction: any) => {
                            output += `${instruction.address}: ${this.padEnd(15, instruction.opcodes)} \t${instruction.instruction}\n`;
                        });
                        resolve(output);
                    },
                    (error: any) => {
                        vscode.window.showErrorMessage(error.message);
                        reject(error.message);
                    }
                );
        });
    }

    private padEnd(targetLength: number, str: string): string {
        for (let i = str.length; i < targetLength; i++) {
            str += ' ';
        }
        return str;
    }
}
