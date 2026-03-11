import * as vscode from 'vscode';
import { NumberFormat, SymbolScope } from './common';
import { encodeDisassembly } from './utils';
import { PlatformIODebugConfigurationProvider } from './frontend/configprovider';
import { DisassemblyContentProvider } from './frontend/disassembly_content_provider';
import { DisassemblyTreeProvider } from './frontend/disassembly_tree_provider';
import { MemoryContentProvider } from './frontend/memory_content_provider';
import { MemoryTreeProvider } from './frontend/memory_tree_provider';
import { PeripheralTreeProvider, RecordType as PeripheralRecordType } from './frontend/peripheral';
import { RegisterTreeProvider, RecordType as RegisterRecordType } from './frontend/registers';

class PlatformIODebugExtension {
    private adapterOutputChannel: vscode.OutputChannel = null;
    private functionSymbols: any[] = null;
    private context: vscode.ExtensionContext;
    private registerProvider: RegisterTreeProvider;
    private peripheralProvider: PeripheralTreeProvider;
    private memoryTreeProvider: MemoryTreeProvider;
    private disassemblyTreeProvider: DisassemblyTreeProvider;
    private memoryContentProvider: MemoryContentProvider;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.registerProvider = new RegisterTreeProvider();
        this.peripheralProvider = new PeripheralTreeProvider();
        this.memoryTreeProvider = new MemoryTreeProvider();
        this.disassemblyTreeProvider = new DisassemblyTreeProvider();
        this.memoryContentProvider = new MemoryContentProvider();

        const peripheralTreeView = vscode.window.createTreeView('platformio-debug.peripherals', {
            treeDataProvider: this.peripheralProvider,
        });

        context.subscriptions.push(
            vscode.debug.registerDebugConfigurationProvider(
                'platformio-debug',
                new PlatformIODebugConfigurationProvider()
            ),
            peripheralTreeView,
            peripheralTreeView.onDidExpandElement(
                this.peripheralProvider.onDidExpandElement.bind(this.peripheralProvider)
            ),
            peripheralTreeView.onDidCollapseElement(
                this.peripheralProvider.onDidCollapseElement.bind(this.peripheralProvider)
            ),
            vscode.window.registerTreeDataProvider('platformio-debug.registers', this.registerProvider),
            vscode.window.registerTreeDataProvider('platformio-debug.memory', this.memoryTreeProvider),
            vscode.window.registerTreeDataProvider('platformio-debug.disassembly', this.disassemblyTreeProvider),
            vscode.workspace.registerTextDocumentContentProvider('examinememory', this.memoryContentProvider),
            vscode.workspace.registerTextDocumentContentProvider('disassembly', new DisassemblyContentProvider()),

            vscode.commands.registerCommand('platformio-debug.peripherals.updateNode', this.peripheralsUpdateNode.bind(this)),
            vscode.commands.registerCommand('platformio-debug.peripherals.selectedNode', this.peripheralsSelectedNode.bind(this)),
            vscode.commands.registerCommand('platformio-debug.peripherals.copyValue', this.peripheralsCopyValue.bind(this)),
            vscode.commands.registerCommand('platformio-debug.peripherals.setFormat', this.peripheralsSetFormat.bind(this)),
            vscode.commands.registerCommand('platformio-debug.registers.selectedNode', this.registersSelectedNode.bind(this)),
            vscode.commands.registerCommand('platformio-debug.registers.copyValue', this.registersCopyValue.bind(this)),
            vscode.commands.registerCommand('platformio-debug.registers.setFormat', this.registersSetFormat.bind(this)),
            vscode.commands.registerCommand('platformio-debug.memory.deleteHistoryItem', this.memoryDeleteHistoryItem.bind(this)),
            vscode.commands.registerCommand('platformio-debug.memory.clearHistory', this.memoryClearHistory.bind(this)),
            vscode.commands.registerCommand('platformio-debug.examineMemory', this.examineMemory.bind(this)),
            vscode.commands.registerCommand('platformio-debug.viewDisassembly', this.showDisassembly.bind(this)),
            vscode.commands.registerCommand('platformio-debug.setForceDisassembly', this.setForceDisassembly.bind(this)),

            vscode.debug.onDidReceiveDebugSessionCustomEvent(this.receivedCustomEvent.bind(this)),
            vscode.debug.onDidStartDebugSession(this.debugSessionStarted.bind(this)),
            vscode.debug.onDidTerminateDebugSession(this.debugSessionTerminated.bind(this)),
            vscode.window.onDidChangeActiveTextEditor(this.activeEditorChanged.bind(this)),
            vscode.window.onDidChangeTextEditorSelection((e) => {
                if (e && e.textEditor.document.fileName.endsWith('.dbgmem')) {
                    this.memoryContentProvider.handleSelection(e);
                }
            })
        );
    }

    private isPIODebugSession(): boolean {
        return vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'platformio-debug';
    }

    private activeEditorChanged(editor: vscode.TextEditor): void {
        if (!editor || !this.isPIODebugSession()) {
            return;
        }

        const uri = editor.document.uri;
        if (uri.scheme === 'file') {
            vscode.debug.activeDebugSession.customRequest('set-active-editor', { path: uri.path });
        } else if (uri.scheme === 'disassembly') {
            vscode.debug.activeDebugSession.customRequest('set-active-editor', {
                path: `${uri.scheme}://${uri.authority}${uri.path}`,
            });
        }
    }

    private async showDisassembly(): Promise<void> {
        if (!this.isPIODebugSession()) {
            vscode.window.showErrorMessage('No debugging session available');
            return;
        }

        if (!this.functionSymbols) {
            try {
                const result = await vscode.debug.activeDebugSession.customRequest('load-function-symbols');
                this.functionSymbols = result.functionSymbols;
            } catch (e) {
                vscode.window.showErrorMessage('Unable to load symbol table. Disassembly view unavailable.');
            }
        }

        try {
            const funcName = await vscode.window.showInputBox({
                placeHolder: 'main',
                ignoreFocusOut: true,
                prompt: 'Function Name to Disassemble',
            });

            const matches = this.functionSymbols.filter((s) => s.name === funcName);
            let uri: string;

            if (matches.length === 1) {
                uri = encodeDisassembly(matches[0].name, matches[0].file);
            } else if (matches.length > 1) {
                const selected = await vscode.window.showQuickPick(
                    matches.map((m) => ({
                        label: m.name,
                        name: m.name,
                        file: m.file,
                        scope: m.scope,
                        description:
                            m.scope === SymbolScope.Global ? 'Global Scope' : `Static in ${m.file}`,
                    })),
                    { ignoreFocusOut: true }
                );
                uri = encodeDisassembly(selected.name, selected.file);
            } else {
                vscode.window.showErrorMessage(`No function with name ${funcName} found.`);
                return;
            }

            if (uri) {
                vscode.window.showTextDocument(vscode.Uri.parse(uri));
            }
        } catch (e) {
            vscode.window.showErrorMessage('Unable to show disassembly.');
        }
    }

    private setForceDisassembly(force?: string): void {
        const doSet = (value: string) => {
            const forced = value === 'Forced';
            this.disassemblyTreeProvider.updateForcedState(forced);
            return vscode.debug.activeDebugSession.customRequest('set-force-disassembly', { force: forced });
        };

        if (force) {
            return doSet(force) as any;
        }

        vscode.window
            .showQuickPick(
                [
                    {
                        label: 'Auto',
                        description: 'Show disassembly for functions when source cannot be located.',
                    },
                    {
                        label: 'Forced',
                        description: 'Always show disassembly for functions.',
                    },
                ],
                { matchOnDescription: true, ignoreFocusOut: true }
            )
            .then(
                (selected) => {
                    doSet(selected.label);
                },
                (err) => {}
            );
    }

    private memoryDeleteHistoryItem(item: any): void {
        const [address, length] = item.label.split('+');
        this.memoryTreeProvider.deleteHistory(address, length);
    }

    private memoryClearHistory(): void {
        this.memoryTreeProvider.clearHistory();
    }

    private examineMemory(address?: string, length?: string): any {
        function validateInput(input: string): string | null {
            if (/^0x[0-9a-f]{1,8}$/i.test(input) || /^[0-9]+$/i.test(input)) {
                return input;
            }
            return null;
        }

        if (!this.isPIODebugSession()) {
            vscode.window.showErrorMessage('No debugging session available');
            return;
        }

        if (address && length) {
            return this.showMemoryContent(address, length);
        }

        vscode.window
            .showInputBox({
                placeHolder: 'Prefix with 0x for hexidecimal format',
                ignoreFocusOut: true,
                prompt: 'A start memory address',
            })
            .then(
                (addressInput) => {
                    if (validateInput(addressInput)) {
                        vscode.window
                            .showInputBox({
                                placeHolder: 'Prefix with 0x for hexidecimal format',
                                ignoreFocusOut: true,
                                prompt: 'How many bytes to read?',
                            })
                            .then(
                                (lengthInput) => {
                                    if (validateInput(lengthInput)) {
                                        this.memoryTreeProvider.pushHistory(addressInput, lengthInput);
                                        this.showMemoryContent(addressInput, lengthInput);
                                    } else {
                                        vscode.window.showErrorMessage('Invalid length entered');
                                    }
                                },
                                (err) => {}
                            );
                    } else {
                        vscode.window.showErrorMessage('Invalid memory address entered');
                    }
                },
                (err) => {}
            );
    }

    private showMemoryContent(address: string, length: string): void {
        vscode.workspace
            .openTextDocument(
                vscode.Uri.parse(
                    `examinememory:///Memory%20[${address}+${length}].dbgmem?address=${address}&length=${length}&timestamp=${new Date().getTime()}`
                )
            )
            .then(
                (doc) => {
                    vscode.window.showTextDocument(doc, { viewColumn: 2, preview: false });
                },
                (error) => {
                    vscode.window.showErrorMessage(`Failed to examine memory: ${error}`);
                }
            );
    }

    private peripheralsUpdateNode(node: any): void {
        node.node.performUpdate().then(
            (result: boolean) => {
                if (result) {
                    this.peripheralProvider.refresh();
                }
            },
            (error: any) => {
                vscode.window.showErrorMessage(`Unable to update value: ${error.toString()}`);
            }
        );
    }

    private peripheralsSelectedNode(node: any): void {
        if (node.recordType !== PeripheralRecordType.Field) {
            node.expanded = !node.expanded;
        }
        node.selected().then(
            (result: boolean) => {
                if (result) {
                    this.peripheralProvider.refresh();
                }
            },
            (error: any) => {}
        );
    }

    private peripheralsCopyValue(node: any): void {
        const value = node.node.getCopyValue();
        if (value) {
            vscode.env.clipboard.writeText(value);
        }
    }

    private async peripheralsSetFormat(node: any): Promise<void> {
        const selected = await vscode.window.showQuickPick([
            { label: 'Auto', description: 'Automatically choose format (Inherits from parent)', value: NumberFormat.Auto },
            { label: 'Hex', description: 'Format value in hexidecimal', value: NumberFormat.Hexidecimal },
            { label: 'Decimal', description: 'Format value in decimal', value: NumberFormat.Decimal },
            { label: 'Binary', description: 'Format value in binary', value: NumberFormat.Binary },
        ]);
        node.node.setFormat(selected.value);
        this.peripheralProvider.refresh();
    }

    private registersSelectedNode(node: any): void {
        if (node.recordType !== RegisterRecordType.Field) {
            node.expanded = !node.expanded;
        }
    }

    private registersCopyValue(node: any): void {
        const value = node.node.getCopyValue();
        if (value) {
            vscode.env.clipboard.writeText(value);
        }
    }

    private async registersSetFormat(node: any): Promise<void> {
        const selected = await vscode.window.showQuickPick([
            { label: 'Auto', description: 'Automatically choose format (Inherits from parent)', value: NumberFormat.Auto },
            { label: 'Hex', description: 'Format value in hexidecimal', value: NumberFormat.Hexidecimal },
            { label: 'Decimal', description: 'Format value in decimal', value: NumberFormat.Decimal },
            { label: 'Binary', description: 'Format value in binary', value: NumberFormat.Binary },
        ]);
        node.node.setFormat(selected.value);
        this.registerProvider.refresh();
    }

    private debugSessionStarted(session: vscode.DebugSession): void {
        if (session.type === 'platformio-debug') {
            this.functionSymbols = null;
            session.customRequest('get-arguments').then(
                (args: any) => {
                    this.registerProvider.debugSessionStarted(
                        this.context.workspaceState.get('debugRegistersTreeState')
                    );
                    this.peripheralProvider.debugSessionStarted(
                        args.svdPath,
                        this.context.workspaceState.get('debugPeripheralsTreeState')
                    );
                    this.memoryTreeProvider.debugSessionStarted(
                        this.context.workspaceState.get('debugMemoryTreeState')
                    );
                    this.disassemblyTreeProvider.debugSessionStarted();
                },
                (error: any) => {
                    console.error(error);
                }
            );
        }
    }

    private debugSessionTerminated(session: vscode.DebugSession): void {
        if (session.type === 'platformio-debug') {
            this.context.workspaceState.update(
                'debugRegistersTreeState',
                this.registerProvider.dumpSettings()
            );
            this.context.workspaceState.update(
                'debugPeripheralsTreeState',
                this.peripheralProvider.dumpSettings()
            );
            this.context.workspaceState.update(
                'debugMemoryTreeState',
                this.memoryTreeProvider.dumpSettings()
            );

            this.registerProvider.debugSessionTerminated();
            this.peripheralProvider.debugSessionTerminated();
            this.memoryTreeProvider.debugSessionTerminated();
            this.disassemblyTreeProvider.debugSessionTerminated();
        }
    }

    private receivedCustomEvent(e: vscode.DebugSessionCustomEvent): void {
        if (!this.isPIODebugSession()) {
            return;
        }

        switch (e.event) {
            case 'custom-stop':
                this.receivedStopEvent(e);
                break;
            case 'custom-continued':
                this.receivedContinuedEvent(e);
                break;
            case 'adapter-output':
                this.receivedAdapterOutput(e);
                break;
            case 'record-event':
                this.receivedEvent(e);
                break;
        }
    }

    private receivedStopEvent(e: vscode.DebugSessionCustomEvent): void {
        this.peripheralProvider.debugStopped();
        this.registerProvider.debugStopped();

        vscode.workspace.textDocuments
            .filter((doc) => doc.fileName.endsWith('.dbgmem'))
            .forEach((doc) => {
                this.memoryContentProvider.update(doc);
            });
    }

    private receivedContinuedEvent(e: vscode.DebugSessionCustomEvent): void {
        this.peripheralProvider.debugContinued();
        this.registerProvider.debugContinued();
    }

    private receivedEvent(e: vscode.DebugSessionCustomEvent): void {}

    private receivedAdapterOutput(e: vscode.DebugSessionCustomEvent): void {
        if (!this.adapterOutputChannel) {
            this.adapterOutputChannel = vscode.window.createOutputChannel('Adapter Output');
        }

        let content: string = e.body.content;
        if (!content.endsWith('\n')) {
            content += '\n';
        }
        this.adapterOutputChannel.append(content);
    }
}

export function activate(context: vscode.ExtensionContext): PlatformIODebugExtension {
    return new PlatformIODebugExtension(context);
}

export function deactivate(): void {}
