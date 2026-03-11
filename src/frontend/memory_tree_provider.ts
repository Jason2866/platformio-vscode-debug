import * as vscode from 'vscode';

export class MemoryTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    public onDidChangeTreeData = this._onDidChangeTreeData.event;
    private history: string[] = [];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    dumpSettings(): string[] {
        return this.history;
    }

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

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    pushHistory(address: string, length: string): void {
        const entry = `${address}+${length}`;
        if (!this.history.includes(entry)) {
            this.history.push(entry);
            this.refresh();
        }
    }

    deleteHistory(address: string, length: string): void {
        const entry = `${address}+${length}`;
        if (this.history.includes(entry)) {
            this.history = this.history.filter((e) => e !== entry);
            this.refresh();
        }
    }

    clearHistory(): void {
        this.history = [];
        this.refresh();
    }

    debugSessionStarted(savedState: string[]): void {
        this.history = savedState || [];
        this.refresh();
    }

    debugSessionTerminated(): void {
        this.history = [];
        this.refresh();
    }
}
