import * as vscode from 'vscode';
import { NumberFormat } from '../common';
import { hexFormat, binaryFormat, extractBits } from '../utils';

/** Classifies register tree node types. */
export enum RecordType {
    Register = 0,
    Field = 1,
}

export class TreeNode extends vscode.TreeItem {
    constructor(
        public label: string,
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public contextValue: string,
        public node: BaseNode
    ) {
        super(label, collapsibleState);
        this.command = {
            command: 'platformio-debug.registers.selectedNode',
            arguments: [node],
            title: 'Selected Node',
        };
    }
/** TreeItem for registers panel. */
}

export class BaseNode {
    public format: NumberFormat = NumberFormat.Auto;
    public expanded: boolean = false;

    constructor(public recordType: RecordType) {}

    getChildren(): BaseNode[] {
        return [];
    }

    getTreeNode(): TreeNode {
        return null;
    }

    getCopyValue(): string | null {
        return null;
    }

    setFormat(format: NumberFormat): void {
        this.format = format;
    }
/** Base for register tree nodes. */
}

export class RegisterNode extends BaseNode {
    public name: string;
    public index: number;
    public fields: FieldNode[];
    public currentValue: number;

    constructor(name: string, index: number) {
        super(RecordType.Register);
        this.name = name;
        this.index = index;

        if (name.toUpperCase() === 'XPSR' || name.toUpperCase() === 'CPSR') {
            this.fields = [
                new FieldNode('Negative Flag (N)', 31, 1, this),
                new FieldNode('Zero Flag (Z)', 30, 1, this),
                new FieldNode('Carry or borrow flag (C)', 29, 1, this),
                new FieldNode('Overflow Flag (V)', 28, 1, this),
                new FieldNode('Saturation Flag (Q)', 27, 1, this),
                new FieldNode('GE', 16, 4, this),
                new FieldNode('Interrupt Number', 0, 8, this),
                new FieldNode('ICI/IT', 25, 2, this),
                new FieldNode('ICI/IT', 10, 6, this),
                new FieldNode('Thumb State (T)', 24, 1, this),
            ];
        } else if (name.toUpperCase() === 'CONTROL') {
            this.fields = [
                new FieldNode('FPCA', 2, 1, this),
                new FieldNode('SPSEL', 1, 1, this),
                new FieldNode('nPRIV', 0, 1, this),
            ];
        }

        this.currentValue = 0;
    }

    /** CPU register node; may have FieldNode children. */
    extractBits(offset: number, width: number): number {
        return extractBits(this.currentValue, offset, width);
    }

    getTreeNode(): TreeNode {
        let label = `${this.name} = `;
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                label += this.currentValue.toString();
                break;
            case NumberFormat.Binary:
                label += binaryFormat(this.currentValue, 32, false, true);
                break;
            default:
                label += hexFormat(this.currentValue, 8);
                break;
        }

        if (this.fields && this.fields.length > 0) {
            return new TreeNode(
                label,
                this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
                'register',
                this
            );
        }
        return new TreeNode(label, vscode.TreeItemCollapsibleState.None, 'register', this);
    }

    getChildren(): BaseNode[] {
        return this.fields;
    }

    setValue(value: number): void {
        this.currentValue = value;
    }

    getCopyValue(): string {
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return this.currentValue.toString();
            case NumberFormat.Binary:
                return binaryFormat(this.currentValue, 32);
            default:
                return hexFormat(this.currentValue, 8);
        }
    }

    getFormat(): NumberFormat {
        return this.format;
    }

    dumpSettings(): any[] {
        const settings: any[] = [];
        if (this.expanded || this.format !== NumberFormat.Auto) {
            settings.push({
                node: this.name,
                format: this.format,
                expanded: this.expanded,
            });
        }
        if (this.fields) {
            settings.push(
                ...this.fields.map((field) => field.dumpSettings()).filter((s) => s !== null)
            );
        }
        return settings;
    }
/** Named bit-field within special registers. */
}

export class FieldNode extends BaseNode {
    constructor(
        public name: string,
        public offset: number,
        public size: number,
        public register: RegisterNode
    ) {
        super(RecordType.Field);
    }

    getTreeNode(): TreeNode {
        const value = this.register.extractBits(this.offset, this.size);
        let label = `${this.name} = `;

        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                label += value.toString();
                break;
            case NumberFormat.Binary:
                label += binaryFormat(value, this.size, false, true);
                break;
            case NumberFormat.Hexidecimal:
                label += hexFormat(value, Math.ceil(this.size / 4), true);
                break;
            default:
                label +=
                    this.size >= 4
                        ? hexFormat(value, Math.ceil(this.size / 4), true)
                        : binaryFormat(value, this.size, false, true);
                break;
        }

        return new TreeNode(label, vscode.TreeItemCollapsibleState.None, 'field', this);
    }

    getCopyValue(): string {
        const value = this.register.extractBits(this.offset, this.size);
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return value.toString();
            case NumberFormat.Binary:
                return binaryFormat(value, this.size);
            case NumberFormat.Hexidecimal:
                return hexFormat(value, Math.ceil(this.size / 4), true);
            default:
                return this.size >= 4
                    ? hexFormat(value, Math.ceil(this.size / 4), true)
                    : binaryFormat(value, this.size);
        }
    }

    getFormat(): NumberFormat {
        return this.format === NumberFormat.Auto ? this.register.getFormat() : this.format;
    }

    dumpSettings(): any {
        if (this.format !== NumberFormat.Auto) {
            return { node: `${this.register.name}.${this.name}`, format: this.format };
        }
        return null;
    }
/** TreeDataProvider for platformio-debug.registers. */
}

export class RegisterTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<void>();
    public onDidChangeTreeData = this._onDidChangeTreeData.event;
    private loaded: boolean = false;
    private viewExpanded: boolean = false;
    private registers: RegisterNode[] = [];
    private registerMap: { [index: number]: RegisterNode } = {};
    private initialSettings: any[];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /** Serialises settings for persistence. */
    dumpSettings(): any[] {
        const settings: any[] = [];
        this.registers.forEach((reg) => {
            settings.push(...reg.dumpSettings());
        });
        return settings;
    }

    /** Fetches register list and current values. */
    fetchRegisterList(): void {
        if (!vscode.debug.activeDebugSession) {
            return;
        }

        if (this.loaded) {
            this._fetchRegisterValues();
        } else {
            vscode.debug.activeDebugSession.customRequest('read-register-list').then((names: any) => {
                this.loaded = true;
                this.createRegisters(names);
                this._fetchRegisterValues();
            });
        }
    }

    private _fetchRegisterValues(): void {
        vscode.debug.activeDebugSession.customRequest('read-registers').then((registers: any) => {
            registers.forEach((reg: any) => {
                const index = parseInt(reg.number, 10);
                const value = parseInt(reg.value, 16);
                const registerNode = this.registerMap[index];
                if (registerNode) {
                    registerNode.setValue(value);
                }
            });
            this.refresh();
        });
    }

    /** Returns the tree item unchanged. */
    getTreeItem(element: TreeNode): TreeNode {
        return element;
    }

    private createRegisters(names: string[]): void {
        this.registerMap = {};
        this.registers = [];

        names.forEach((name, index) => {
            if (name) {
                const reg = new RegisterNode(name, index);
                this.registers.push(reg);
                this.registerMap[index] = reg;
            }
        });

        if (this.initialSettings) {
            this.initialSettings.forEach((setting) => {
                if (setting.node.indexOf('.') === -1) {
                    const reg = this.registers.find((r) => r.name === setting.node);
                    if (reg) {
                        if (setting.expanded) {
                            reg.expanded = setting.expanded;
                        }
                        if (setting.format) {
                            reg.setFormat(setting.format);
                        }
                    }
                } else {
                    const [regName, fieldName] = setting.node.split('.');
                    const reg = this.registers.find((r) => r.name === regName);
                    if (reg) {
                        const field = reg.getChildren().find((f: any) => f.name === fieldName);
                        if (field && setting.format) {
                            field.setFormat(setting.format);
                        }
                    }
                }
            });
        }

        this.refresh();
    }

    /** Updates register values from array. */
    updateRegisterValues(values: any[]): void {
        values.forEach((val) => {
            this.registerMap[val.number].setValue(val.value);
        });
        this.refresh();
    }

    /** Returns child nodes for display. */
    getChildren(element?: TreeNode): any[] {
        this.viewExpanded = true;
        if (!vscode.debug.activeDebugSession) {
            return [];
        }

        if (this.registers.length > 0) {
            if (element) {
                return element.node.getChildren().map((child) => child.getTreeNode());
            }
            return this.registers.map((reg) => reg.getTreeNode());
        }

        if (!this.loaded) {
            setTimeout(() => this.fetchRegisterList(), 1000);
        }

        return [new TreeNode('Loading...', vscode.TreeItemCollapsibleState.None, 'message', null)];
    }

    /** Clears register state on termination. */
    debugSessionTerminated(): void {
        this.loaded = false;
        this.registers = [];
        this.registerMap = {};
        this.refresh();
    }

    /** Restores saved settings on start. */
    debugSessionStarted(savedState: any[]): void {
        this.loaded = false;
        this.registers = [];
        this.registerMap = {};
        this.initialSettings = savedState;
    }

    /** Refreshes values when target stops. */
    debugStopped(): void {
        if (this.viewExpanded) {
            this.fetchRegisterList();
        }
    }

    /** No-op on continue. */
    debugContinued(): void {}
}
