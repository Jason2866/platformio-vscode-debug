import * as vscode from 'vscode';

export class DisassemblyTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem>();
    public onDidChangeTreeData = this._onDidChangeTreeData.event;
    private forced: boolean = false;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!vscode.debug.activeDebugSession) {
            return [];
        }

        const disassembleItem = new vscode.TreeItem('Disassemble function');
        disassembleItem.command = {
            title: 'Disassemble function',
            command: 'platformio-debug.viewDisassembly',
        };

        const switchLabel = 'Switch to ' + (this.forced ? 'code' : 'assembly');
        const switchItem = new vscode.TreeItem(switchLabel);
        switchItem.command = {
            title: switchLabel,
            command: 'platformio-debug.setForceDisassembly',
            arguments: [this.forced ? 'Auto' : 'Forced'],
        };

        return [disassembleItem, switchItem];
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    updateForcedState(forced: boolean): void {
        this.forced = forced;
        this.refresh();
    }

    debugSessionStarted(): void {
        this.refresh();
    }

    debugSessionTerminated(): void {
        this.updateForcedState(false);
    }
}
