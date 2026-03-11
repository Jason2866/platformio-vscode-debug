import * as vscode from 'vscode';

/** TreeDataProvider for platformio-debug.memory. */
export class MemoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    public onDidChangeTreeData = this._onDidChangeTreeData.event;
    private history: string[] = [];

    /** Refreshes the tree view. */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Serialises history for persistence. */
    dumpSettings(): string[] {
        return this.history;
    }

    /** Returns history nodes or a prompt item. */
    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!vscode.debug.activeDebugSession) {
            return [];
        }

        if (this.history.length) {
            return this.getHistoryNodes();
        }

        const item = new vscode.TreeItem('Enter address...');
        item.command = {
            title: 'Enter memory address...',
            command: 'platformio-debug.examineMemory',
        };
        return [item];
    }

    private getHistoryNodes(): vscode.TreeItem[] {
        return this.history.map((entry) => {
            const item = new vscode.TreeItem(entry);
            item.command = {
                title: `Examine memory at ${entry}`,
                command: 'platformio-debug.examineMemory',
                arguments: entry.split('+'),
            };
            return item;
        });
    }

    /** Returns the tree item unchanged. */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /** Adds an address+length entry. */
    pushHistory(address: string, length: string): void {
        const entry = `${address}+${length}`;
        if (!this.history.includes(entry)) {
            this.history.push(entry);
            this.refresh();
        }
    }

    /** Removes a specific history entry. */
    deleteHistory(address: string, length: string): void {
        const entry = `${address}+${length}`;
        if (this.history.includes(entry)) {
            this.history = this.history.filter((e) => e !== entry);
            this.refresh();
        }
    }

    /** Clears all history. */
    clearHistory(): void {
        this.history = [];
        this.refresh();
    }

    /** Restores saved history. */
    debugSessionStarted(savedState: string[]): void {
        this.history = savedState || [];
        this.refresh();
    }

    /** Clears state on termination. */
    debugSessionTerminated(): void {
        this.history = [];
        this.refresh();
    }
}
