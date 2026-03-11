import * as vscode from 'vscode';

/** TreeDataProvider for platformio-debug.disassembly. */
export class DisassemblyTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    public onDidChangeTreeData = this._onDidChangeTreeData.event;
    private forced: boolean = false;

    /** Refreshes the tree view. */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Returns disassemble/toggle items when session is active. */
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

    /** Returns the tree item unchanged. */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /** Updates forced-disassembly state and refreshes. */
    updateForcedState(forced: boolean): void {
        this.forced = forced;
        this.refresh();
    }

    /** Refreshes on debug session start. */
    debugSessionStarted(): void {
        this.refresh();
    }

    /** Resets forced state and refreshes. */
    debugSessionTerminated(): void {
        this.updateForcedState(false);
    }
}
