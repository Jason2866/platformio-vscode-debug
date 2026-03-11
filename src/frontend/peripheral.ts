import * as fs from 'fs';
import * as vscode from 'vscode';
import * as xml2js from 'xml2js';
import { NumberFormat } from '../common';
import {
    hexFormat,
    binaryFormat,
    createMask,
    extractBits,
} from '../utils';

export enum RecordType {
    Peripheral = 1,
    Register = 2,
    Field = 3,
    Cluster = 4,
}

export enum AccessType {
    ReadOnly = 1,
    ReadWrite = 2,
    WriteOnly = 3,
}

const ACCESS_MAP: { [key: string]: AccessType } = {
    'read-only': AccessType.ReadOnly,
    'write-only': AccessType.WriteOnly,
    'read-write': AccessType.ReadWrite,
    'writeOnce': AccessType.WriteOnly,
    'read-writeOnce': AccessType.ReadWrite,
};

export class TreeNode extends vscode.TreeItem {
    constructor(
        public label: string,
        public collapsibleState: vscode.TreeItemCollapsibleState,
        public contextValue: string,
        public node: BaseNode
    ) {
        super(label, collapsibleState);
        this.command = {
            command: 'platformio-debug.peripherals.selectedNode',
            arguments: [node],
            title: 'Selected Node',
        };
        this.tooltip = (node ? node.description : undefined) || label;
    }
}

export class BaseNode {
    public expanded: boolean = false;
    public format: NumberFormat = NumberFormat.Auto;
    public description: string;

    constructor(public recordType: RecordType) {}

    selected(): Promise<boolean> {
        return Promise.resolve(false);
    }

    update(): Promise<boolean> {
        return Promise.resolve(false);
    }

    performUpdate(): Promise<boolean> {
        return Promise.resolve(false);
    }

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
}

function parseInteger(value: string): number | undefined {
    if (/^0b([01]+)$/i.test(value)) {
        return parseInt(value.substring(2), 2);
    }
    if (/^0x([0-9a-f]+)$/i.test(value)) {
        return parseInt(value.substring(2), 16);
    }
    if (/^[0-9]+/i.test(value)) {
        return parseInt(value, 10);
    }
    if (/^#[0-1]+/i.test(value)) {
        return parseInt(value.substring(1), 2);
    }
    return undefined;
}

function parseDimIndex(dimIndex: string, count: number): string[] {
    if (dimIndex.indexOf(',') !== -1) {
        const items = dimIndex.split(',').map((s) => s.trim());
        if (items.length !== count) {
            throw new Error('dimIndex Element has invalid specification.');
        }
        return items;
    }

    if (/^([0-9]+)\-([0-9]+)$/i.test(dimIndex)) {
        const parts = dimIndex.split('-').map((s) => parseInteger(s));
        const start = parts[0];
        if (parts[1] - start + 1 < count) {
            throw new Error('dimIndex Element has invalid specification.');
        }
        const result: string[] = [];
        for (let i = 0; i < count; i++) {
            result.push(`${start + i}`);
        }
        return result;
    }

    if (/^[a-zA-Z]\-[a-zA-Z]$/.test(dimIndex)) {
        const startChar = dimIndex.charCodeAt(0);
        if (dimIndex.charCodeAt(2) - startChar + 1 < count) {
            throw new Error('dimIndex Element has invalid specification.');
        }
        const result: string[] = [];
        for (let i = 0; i < count; i++) {
            result.push(String.fromCharCode(startChar + i));
        }
        return result;
    }

    return [];
}

class EnumerationValue {
    constructor(
        public name: string,
        public description: string,
        public value: number
    ) {}
}

// ============================================================================
// PeripheralNode
// ============================================================================

export class PeripheralNode extends BaseNode {
    public name: string;
    public description: string;
    public baseAddress: number;
    public totalLength: number;
    public groupName: string;
    public resetValue: number;
    public size: number;
    public children: BaseNode[] = [];
    public currentValue: number[];

    constructor(options: any) {
        super(RecordType.Peripheral);
        this.name = options.name;
        this.description = options.description;
        this.baseAddress = options.baseAddress;
        this.totalLength = options.totalLength;
        this.groupName = options.groupName || '';
        this.resetValue = options.resetValue || 0;
        this.size = options.size || 32;
    }

    getTreeNode(): TreeNode {
        const label = this.name + '  [' + hexFormat(this.baseAddress) + ']';
        return new TreeNode(
            label,
            this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
            'peripheral',
            this
        );
    }

    getChildren(): BaseNode[] {
        return this.children;
    }

    setChildren(children: BaseNode[]): void {
        this.children = children;
        this.children.sort((a: any, b: any) => (a.offset > b.offset ? 1 : -1));
    }

    addChild(child: BaseNode): void {
        this.children.push(child);
        this.children.sort((a: any, b: any) => (a.offset > b.offset ? 1 : -1));
    }

    getBytes(offset: number, size: number): Uint8Array {
        try {
            return new Uint8Array(this.currentValue.slice(offset, offset + size));
        } catch (e) {
            return new Uint8Array(0);
        }
    }

    getAddress(offset: number): number {
        return this.baseAddress + offset;
    }

    getFormat(): NumberFormat {
        return this.format;
    }

    update(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (this.expanded) {
                vscode.debug.activeDebugSession
                    .customRequest('read-memory', {
                        address: this.baseAddress,
                        length: this.totalLength > 32768 ? 32768 : this.totalLength,
                    })
                    .then(
                        (result: any) => {
                            this.currentValue = result.bytes;
                            this.children.forEach((child) => child.update());
                            resolve(true);
                        },
                        (error: any) => {
                            reject(error);
                        }
                    );
            } else {
                resolve(false);
            }
        });
    }

    selected(): Promise<boolean> {
        return this.update();
    }

    dumpSettings(): any[] {
        const settings: any[] = [];
        if (this.format !== NumberFormat.Auto || this.expanded) {
            settings.push({
                node: `${this.name}`,
                expanded: this.expanded,
                format: this.format,
            });
        }
        this.children.forEach((child: any) => {
            settings.push(...child.dumpSettings(`${this.name}`));
        });
        return settings;
    }

    _findByPath(path: string[]): BaseNode | null {
        if (path.length === 0) {
            return this;
        }
        const child = (this.children as any[]).find((c) => c.name === path[0]);
        return child ? child._findByPath(path.slice(1)) : null;
    }
}

// ============================================================================
// ClusterNode
// ============================================================================

export class ClusterNode extends BaseNode {
    public name: string;
    public description: string;
    public offset: number;
    public accessType: AccessType;
    public size: number;
    public resetValue: number;
    public children: BaseNode[] = [];

    constructor(public parent: any, options: any) {
        super(RecordType.Cluster);
        this.name = options.name;
        this.description = options.description;
        this.offset = options.addressOffset;
        this.accessType = options.accessType || AccessType.ReadWrite;
        this.size = options.size || parent.size;
        this.resetValue = options.resetValue || parent.resetValue;
        this.parent.addChild(this);
    }

    getTreeNode(): TreeNode {
        const label = `${this.name} [${hexFormat(this.offset, 0)}]`;
        return new TreeNode(
            label,
            this.expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
            'cluster',
            this
        );
    }

    getChildren(): BaseNode[] {
        return this.children;
    }

    setChildren(children: BaseNode[]): void {
        this.children = children.slice(0, children.length);
        this.children.sort((a: any, b: any) => (a.offset > b.offset ? 1 : -1));
    }

    addChild(child: BaseNode): void {
        this.children.push(child);
        this.children.sort((a: any, b: any) => (a.offset > b.offset ? 1 : -1));
    }

    getBytes(offset: number, size: number): Uint8Array {
        return this.parent.getBytes(this.offset + offset, size);
    }

    getAddress(offset: number): number {
        return this.parent.getAddress(this.offset + offset);
    }

    getFormat(): NumberFormat {
        return this.format !== NumberFormat.Auto ? this.format : this.parent.getFormat();
    }

    update(): Promise<boolean> {
        return Promise.resolve(true);
    }

    dumpSettings(parentPath: string): any[] {
        const settings: any[] = [];
        if (this.format !== NumberFormat.Auto || this.expanded) {
            settings.push({
                node: `${parentPath}.${this.name}`,
                expanded: this.expanded,
                format: this.format,
            });
        }
        this.children.forEach((child: any) => {
            settings.push(...child.dumpSettings(`${parentPath}.${this.name}`));
        });
        return settings;
    }

    _findByPath(path: string[]): BaseNode | null {
        if (path.length === 0) {
            return this;
        }
        const child = (this.children as any[]).find((c) => c.name === path[0]);
        return child ? child._findByPath(path.slice(1)) : null;
    }
}

// ============================================================================
// RegisterNode
// ============================================================================

export class RegisterNode extends BaseNode {
    public name: string;
    public description: string;
    public offset: number;
    public accessType: AccessType;
    public size: number;
    public resetValue: number;
    public currentValue: number;
    public hexLength: number;
    public maxValue: number;
    public binaryRegex: RegExp;
    public hexRegex: RegExp;
    public children: BaseNode[] = [];

    constructor(public parent: any, options: any) {
        super(RecordType.Register);
        this.name = options.name;
        this.description = options.description;
        this.offset = options.addressOffset;
        this.accessType = options.accessType || parent.accessType;
        this.size = options.size || parent.size;
        this.resetValue = options.resetValue !== undefined ? options.resetValue : parent.resetValue;
        this.currentValue = this.resetValue;
        this.hexLength = Math.ceil(this.size / 4);
        this.maxValue = Math.pow(2, this.size);
        this.binaryRegex = new RegExp(`^0b[01]{1,${this.size}}$`, 'i');
        this.hexRegex = new RegExp(`^0x[0-9a-f]{1,${this.hexLength}}$`, 'i');
        this.parent;
        this.parent.addChild(this);
    }

    reset(): void {
        this.currentValue = this.resetValue;
    }

    extractBits(offset: number, width: number): number {
        return extractBits(this.currentValue, offset, width);
    }

    updateBits(offset: number, width: number, value: number): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const maxVal = Math.pow(2, width);
            if (value > maxVal) {
                return reject(
                    `Value entered is invalid. Maximum value for this field is ${maxVal - 1} (${hexFormat(maxVal - 1, 0)})`
                );
            }
            const mask = createMask(offset, width);
            const shiftedValue = value << offset;
            const newValue = (this.currentValue & ~mask) | shiftedValue;
            this.updateValueInternal(newValue).then(resolve, reject);
        });
    }

    getTreeNode(): TreeNode {
        let contextValue = 'registerRW';
        if (this.accessType === AccessType.ReadOnly) {
            contextValue = 'registerRO';
        } else if (this.accessType === AccessType.WriteOnly) {
            contextValue = 'registerWO';
        }

        let label = `${this.name} [${hexFormat(this.offset, 0)}]`;
        if (this.accessType === AccessType.WriteOnly) {
            label += ' - <Write Only>';
        } else {
            switch (this.getFormat()) {
                case NumberFormat.Decimal:
                    label += ` = ${this.currentValue.toString()}`;
                    break;
                case NumberFormat.Binary:
                    label += ` = ${binaryFormat(this.currentValue, this.hexLength * 4, false, true)}`;
                    break;
                default:
                    label += ` = ${hexFormat(this.currentValue, this.hexLength)}`;
                    break;
            }
        }

        const collapsible =
            this.children && this.children.length > 0
                ? this.expanded
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;

        return new TreeNode(label, collapsible, contextValue, this);
    }

    getChildren(): BaseNode[] {
        return this.children || [];
    }

    setChildren(children: BaseNode[]): void {
        this.children = children.slice(0, children.length);
        this.children.sort((a: any, b: any) => (a.offset > b.offset ? 1 : -1));
    }

    addChild(child: BaseNode): void {
        this.children.push(child);
        this.children.sort((a: any, b: any) => (a.offset > b.offset ? 1 : -1));
    }

    getFormat(): NumberFormat {
        return this.format !== NumberFormat.Auto ? this.format : this.parent.getFormat();
    }

    getCopyValue(): string {
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return this.currentValue.toString();
            case NumberFormat.Binary:
                return binaryFormat(this.currentValue, this.hexLength * 4);
            default:
                return hexFormat(this.currentValue, this.hexLength);
        }
    }

    performUpdate(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            vscode.window
                .showInputBox({ prompt: 'Enter new value: (prefix hex with 0x, binary with 0b)' })
                .then((input) => {
                    let value: number;
                    if (input.match(this.hexRegex)) {
                        value = parseInt(input.substr(2), 16);
                    } else if (input.match(this.binaryRegex)) {
                        value = parseInt(input.substr(2), 2);
                    } else if (input.match(/^[0-9]+/)) {
                        value = parseInt(input, 10);
                        if (value >= this.maxValue) {
                            return reject(
                                `Value entered (${value}) is greater than the maximum value of ${this.maxValue}`
                            );
                        }
                    } else {
                        return reject('Value entered is not a valid format.');
                    }
                    this.updateValueInternal(value).then(resolve, reject);
                });
        });
    }

    private updateValueInternal(newValue: number): Promise<boolean> {
        const address = this.parent.getAddress(this.offset);
        const bytes: string[] = [];
        const byteCount = this.size / 8;

        for (let i = 0; i < byteCount; i++) {
            const byte = newValue & 0xff;
            newValue >>>= 8;
            let hexByte = byte.toString(16);
            if (hexByte.length === 1) {
                hexByte = '0' + hexByte;
            }
            bytes[i] = hexByte;
        }

        return new Promise((resolve, reject) => {
            vscode.debug.activeDebugSession
                .customRequest('write-memory', { address, data: bytes.join('') })
                .then(
                    (result: any) => {
                        this.parent.update().then(
                            () => {},
                            () => {}
                        );
                        resolve(true);
                    },
                    reject
                );
        });
    }

    update(): Promise<boolean> {
        const byteCount = this.size / 8;
        const bytes = this.parent.getBytes(this.offset, byteCount);
        const buffer = Buffer.from(bytes);

        switch (byteCount) {
            case 1:
                this.currentValue = buffer.readUInt8(0);
                break;
            case 2:
                this.currentValue = buffer.readUInt16LE(0);
                break;
            case 4:
                this.currentValue = buffer.readUInt32LE(0);
                break;
            default:
                vscode.window.showErrorMessage(
                    `Register ${this.name} has invalid size: ${this.size}. Should be 8, 16 or 32.`
                );
        }

        this.children.forEach((child) => child.update());
        return Promise.resolve(true);
    }

    dumpSettings(parentPath: string): any[] {
        const settings: any[] = [];
        if (this.format !== NumberFormat.Auto || this.expanded) {
            settings.push({
                node: `${parentPath}.${this.name}`,
                expanded: this.expanded,
                format: this.format,
            });
        }
        this.children.forEach((child: any) => {
            settings.push(...child.dumpSettings(`${parentPath}.${this.name}`));
        });
        return settings;
    }

    _findByPath(path: string[]): BaseNode | null {
        if (path.length === 0) {
            return this;
        }
        if (path.length === 1) {
            return (this.children as any[]).find((c) => c.name === path[0]);
        }
        return null;
    }
}

// ============================================================================
// FieldNode
// ============================================================================

export class FieldNode extends BaseNode {
    public name: string;
    public description: string;
    public offset: number;
    public width: number;
    public accessType: AccessType;
    public enumeration: any;
    public enumerationMap: { [name: string]: number };
    public enumerationValues: string[];

    constructor(public parent: RegisterNode, options: any) {
        super(RecordType.Field);
        this.name = options.name;
        this.description = options.description;
        this.offset = options.offset;
        this.width = options.width;

        if (options.accessType) {
            if (parent.accessType === AccessType.ReadOnly && options.accessType !== AccessType.ReadOnly) {
                this.accessType = AccessType.ReadOnly;
            } else if (parent.accessType === AccessType.WriteOnly && options.accessType !== AccessType.WriteOnly) {
                this.accessType = AccessType.WriteOnly;
            } else {
                this.accessType = options.accessType;
            }
        } else {
            this.accessType = parent.accessType;
        }

        if (options.enumeration) {
            this.enumeration = options.enumeration;
            this.enumerationMap = {};
            this.enumerationValues = [];
            for (const key in options.enumeration) {
                const name = options.enumeration[key].name;
                this.enumerationValues.push(name);
                this.enumerationMap[name] = key as any;
            }
        }

        this.parent.addChild(this);
    }

    getTreeNode(): TreeNode {
        const value = this.parent.extractBits(this.offset, this.width);
        let enumEntry: EnumerationValue | null = null;
        let label = this.name;
        const startBit = this.offset;
        let contextValue = 'field';

        label += `[${this.offset + this.width - 1}:${startBit}]`;

        if (this.name.toLowerCase() === 'reserved') {
            contextValue = 'field-res';
        } else if (this.accessType === AccessType.WriteOnly) {
            label += ' - <Write Only>';
        } else {
            let formattedValue = '';
            switch (this.getFormat()) {
                case NumberFormat.Decimal:
                    formattedValue = value.toString();
                    break;
                case NumberFormat.Binary:
                    formattedValue = binaryFormat(value, this.width);
                    break;
                case NumberFormat.Hexidecimal:
                    formattedValue = hexFormat(value, Math.ceil(this.width / 4), true);
                    break;
                default:
                    formattedValue =
                        this.width >= 4
                            ? hexFormat(value, Math.ceil(this.width / 4), true)
                            : binaryFormat(value, this.width);
                    break;
            }

            if (this.enumeration && this.enumeration[value]) {
                enumEntry = this.enumeration[value];
                label += ` = ${enumEntry.name} (${formattedValue})`;
            } else {
                label += ` = ${formattedValue}`;
            }
        }

        if (this.parent.accessType === AccessType.ReadOnly) {
            contextValue = 'field-ro';
        }

        return new TreeNode(label, vscode.TreeItemCollapsibleState.None, contextValue, this);
    }

    performUpdate(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            if (this.enumeration) {
                vscode.window.showQuickPick(this.enumerationValues).then(
                    (selected) => {
                        if (selected === undefined) {
                            return reject('Input not selected');
                        }
                        const value = this.enumerationMap[selected];
                        this.parent.updateBits(this.offset, this.width, value as any).then(resolve, reject);
                    }
                );
            } else {
                vscode.window
                    .showInputBox({ prompt: 'Enter new value: (prefix hex with 0x, binary with 0b)' })
                    .then((input) => {
                        const value = parseInteger(input);
                        if (value === undefined) {
                            return reject('Unable to parse input value.');
                        }
                        this.parent.updateBits(this.offset, this.width, value).then(resolve, reject);
                    });
            }
        });
    }

    getCopyValue(): string {
        const value = this.parent.extractBits(this.offset, this.width);
        switch (this.getFormat()) {
            case NumberFormat.Decimal:
                return value.toString();
            case NumberFormat.Binary:
                return binaryFormat(value, this.width);
            case NumberFormat.Hexidecimal:
                return hexFormat(value, Math.ceil(this.width / 4), true);
            default:
                return this.width >= 4
                    ? hexFormat(value, Math.ceil(this.width / 4), true)
                    : binaryFormat(value, this.width);
        }
    }

    getFormat(): NumberFormat {
        return this.format !== NumberFormat.Auto ? this.format : this.parent.getFormat();
    }

    dumpSettings(parentPath: string): any[] {
        if (this.format !== NumberFormat.Auto) {
            return [{ node: `${parentPath}.${this.name}`, format: this.format }];
        }
        return [];
    }

    _findByPath(path: string[]): BaseNode | null {
        return path.length === 0 ? this : null;
    }
}

// ============================================================================
// PeripheralTreeProvider
// ============================================================================

export class PeripheralTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode>();
    public onDidChangeTreeData = this._onDidChangeTreeData.event;
    private peripherials: PeripheralNode[] = [];
    private loaded: boolean = false;
    private viewExpanded: boolean = false;
    private svdPath: string;
    private initialSettings: any[];

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    dumpSettings(): any[] {
        const settings: any[] = [];
        this.peripherials.forEach((peripheral) => {
            settings.push(...peripheral.dumpSettings());
        });
        return settings;
    }

    _parseFields(fieldDefs: any[], parent: RegisterNode): FieldNode[] {
        const fields: FieldNode[] = [];
        fieldDefs.map((field) => {
            let offset: number;
            let width: number;
            const description = field.description ? field.description[0] : '';

            if (field.bitOffset && field.bitWidth) {
                offset = parseInteger(field.bitOffset[0]);
                width = parseInteger(field.bitWidth[0]);
            } else if (field.bitRange) {
                let range = field.bitRange[0];
                range = range.substring(1, range.length - 1);
                range = range.split(':');
                const msb = parseInteger(range[0]);
                const lsb = parseInteger(range[1]);
                width = msb - lsb + 1;
                offset = lsb;
            } else if (field.msb && field.lsb) {
                const msb = parseInteger(field.msb[0]);
                const lsb = parseInteger(field.lsb[0]);
                width = msb - lsb + 1;
                offset = lsb;
            } else {
                throw new Error(
                    `Unable to parse SVD file: field ${field.name[0]} must have either bitOffset and bitWidth elements, bitRange Element, or msb and lsb elements.`
                );
            }

            let enumeration: any = null;
            if (field.enumeratedValues) {
                enumeration = {};
                field.enumeratedValues[0].enumeratedValue.map((enumVal: any) => {
                    if (enumVal.value && enumVal.value.length > 0) {
                        const name = enumVal.name[0];
                        const desc = enumVal.description ? enumVal.description[0] : name;
                        const val = parseInteger(enumVal.value[0].toLowerCase());
                        enumeration[val] = new EnumerationValue(name, desc, val);
                    }
                });
            }

            const fieldOptions: any = {
                name: field.name[0],
                description,
                offset,
                width,
                enumeration,
            };

            if (field.dim) {
                if (!field.dimIncrement) {
                    throw new Error(
                        `Unable to parse SVD file: field ${field.name[0]} has dim element, with no dimIncrement element.`
                    );
                }
                const dimCount = parseInteger(field.dim[0]);
                const dimIncrement = parseInteger(field.dimIncrement[0]);
                let dimIndices: string[] = [];
                if (field.dimIndex) {
                    dimIndices = parseDimIndex(field.dimIndex[0], dimCount);
                } else {
                    for (let i = 0; i < dimCount; i++) {
                        dimIndices.push(`${i}`);
                    }
                }
                const baseName = field.name[0];
                const baseOffset = offset;
                for (let i = 0; i < dimCount; i++) {
                    const name = baseName.replace('%s', dimIndices[i]);
                    fields.push(
                        new FieldNode(parent, {
                            ...fieldOptions,
                            name,
                            offset: baseOffset + dimIncrement * i,
                        })
                    );
                }
            } else {
                fields.push(new FieldNode(parent, { ...fieldOptions }));
            }
        });
        return fields;
    }

    _parseRegisters(registerDefs: any[], parent: any): RegisterNode[] {
        const registers: RegisterNode[] = [];
        registerDefs.forEach((reg) => {
            const options: any = {};
            if (reg.description) {
                options.description = reg.description[0];
            }
            if (reg.access) {
                options.accessType = ACCESS_MAP[reg.access[0]];
            }
            if (reg.size) {
                options.size = parseInteger(reg.size[0]);
            }
            if (reg.resetValue) {
                options.resetValue = parseInteger(reg.resetValue[0]);
            }

            if (reg.dim) {
                if (!reg.dimIncrement) {
                    throw new Error(
                        `Unable to parse SVD file: register ${reg.name[0]} has dim element, with no dimIncrement element.`
                    );
                }
                const dimCount = parseInteger(reg.dim[0]);
                const dimIncrement = parseInteger(reg.dimIncrement[0]);
                let dimIndices: string[] = [];
                if (reg.dimIndex) {
                    dimIndices = parseDimIndex(reg.dimIndex[0], dimCount);
                } else {
                    for (let i = 0; i < dimCount; i++) {
                        dimIndices.push(`${i}`);
                    }
                }
                const baseName = reg.name[0];
                const baseOffset = parseInteger(reg.addressOffset[0]);
                for (let i = 0; i < dimCount; i++) {
                    const name = baseName.replace('%s', dimIndices[i]);
                    const registerNode = new RegisterNode(parent, {
                        ...options,
                        name,
                        addressOffset: baseOffset + dimIncrement * i,
                    });
                    if (reg.fields && reg.fields.length === 1) {
                        this._parseFields(reg.fields[0].field, registerNode);
                    }
                    registers.push(registerNode);
                }
            } else {
                const registerNode = new RegisterNode(parent, {
                    ...options,
                    name: reg.name[0],
                    addressOffset: parseInteger(reg.addressOffset[0]),
                });
                if (reg.fields && reg.fields.length === 1) {
                    this._parseFields(reg.fields[0].field, registerNode);
                }
                registers.push(registerNode);
            }
        });
        registers.sort((a, b) => (a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : 0));
        return registers;
    }

    _parseClusters(clusterDefs: any[], parent: any): ClusterNode[] {
        const clusters: ClusterNode[] = [];
        if (!clusterDefs) {
            return [];
        }
        clusterDefs.forEach((cluster) => {
            const options: any = {};
            if (cluster.description) {
                options.description = cluster.description[0];
            }
            if (cluster.access) {
                options.accessType = ACCESS_MAP[cluster.access[0]];
            }
            if (cluster.size) {
                options.size = parseInteger(cluster.size[0]);
            }
            if (cluster.resetValue) {
                options.resetValue = parseInteger(cluster.resetValue);
            }

            if (cluster.dim) {
                if (!cluster.dimIncrement) {
                    throw new Error(
                        `Unable to parse SVD file: cluster ${cluster.name[0]} has dim element, with no dimIncrement element.`
                    );
                }
                const dimCount = parseInteger(cluster.dim[0]);
                const dimIncrement = parseInteger(cluster.dimIncrement[0]);
                let dimIndices: string[] = [];
                if (cluster.dimIndex) {
                    dimIndices = parseDimIndex(cluster.dimIndex[0], dimCount);
                } else {
                    for (let i = 0; i < dimCount; i++) {
                        dimIndices.push(`${i}`);
                    }
                }
                const baseName = cluster.name[0];
                const baseOffset = parseInteger(cluster.addressOffset[0]);
                for (let i = 0; i < dimCount; i++) {
                    const name = baseName.replace('%s', dimIndices[i]);
                    const clusterNode = new ClusterNode(parent, {
                        ...options,
                        name,
                        addressOffset: baseOffset + dimIncrement * i,
                    });
                    if (cluster.register) {
                        this._parseRegisters(cluster.register, clusterNode);
                    }
                    clusters.push(clusterNode);
                }
            } else {
                const clusterNode = new ClusterNode(parent, {
                    ...options,
                    name: cluster.name[0],
                    addressOffset: parseInteger(cluster.addressOffset[0]),
                });
                if (cluster.register) {
                    this._parseRegisters(cluster.register, clusterNode);
                    clusters.push(clusterNode);
                }
            }
        });
        return clusters;
    }

    _parsePeripheral(peripheralDef: any, defaults: any): PeripheralNode {
        const totalLength = parseInteger(peripheralDef.addressBlock[0].size[0]);
        const options: any = {
            name: peripheralDef.name[0],
            baseAddress: parseInteger(peripheralDef.baseAddress[0]),
            description: peripheralDef.description[0],
            totalLength,
        };

        if (peripheralDef.access) {
            options.accessType = ACCESS_MAP[peripheralDef.access[0]];
        }
        if (peripheralDef.size) {
            options.size = parseInteger(peripheralDef.size[0]);
        }
        if (peripheralDef.resetValue) {
            options.resetValue = parseInteger(peripheralDef.resetValue[0]);
        }
        if (peripheralDef.groupName) {
            options.groupName = peripheralDef.groupName[0];
        }

        const peripheral = new PeripheralNode(options);

        if (peripheralDef.registers[0].register) {
            this._parseRegisters(peripheralDef.registers[0].register, peripheral);
        }
        if (peripheralDef.registers[0].cluster) {
            this._parseClusters(peripheralDef.registers[0].cluster, peripheral);
        }

        return peripheral;
    }

    _loadSVD(svdPath: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            fs.readFile(svdPath, 'utf8', (err, data) => {
                if (err) {
                    return reject(err);
                }
                xml2js.parseString(data, (parseErr: any, result: any) => {
                    if (parseErr) {
                        return reject(parseErr);
                    }
                    try {
                        const peripheralMap: { [name: string]: any } = {};
                        const defaults: any = {
                            accessType: AccessType.ReadWrite,
                            size: 32,
                            resetValue: 0,
                        };

                        if (result.device.resetValue) {
                            defaults.resetValue = parseInteger(result.device.resetValue[0]);
                        }
                        if (result.device.size) {
                            defaults.size = parseInteger(result.device.size[0]);
                        }
                        if (result.device.access) {
                            defaults.accessType = ACCESS_MAP[result.device.access[0]];
                        }

                        result.device.peripherals[0].peripheral.forEach((periph: any) => {
                            const name = periph.name[0];
                            peripheralMap[name] = periph;
                        });

                        // Handle derived peripherals
                        for (const name in peripheralMap) {
                            const periph = peripheralMap[name];
                            if (periph.$ && periph.$.derivedFrom) {
                                const base = peripheralMap[periph.$.derivedFrom];
                                peripheralMap[name] = { ...base, ...periph };
                            }
                        }

                        this.peripherials = [];
                        for (const name in peripheralMap) {
                            this.peripherials.push(this._parsePeripheral(peripheralMap[name], defaults));
                        }

                        this.peripherials.sort((a, b) =>
                            a.groupName > b.groupName
                                ? 1
                                : a.groupName < b.groupName
                                ? -1
                                : a.name > b.name
                                ? 1
                                : a.name < b.name
                                ? -1
                                : 0
                        );

                        return resolve(true);
                    } catch (e) {
                        return reject(e);
                    }
                });
            });
        });
    }

    _findNodeByPath(path: string): BaseNode | null {
        const parts = path.split('.');
        const peripheral = this.peripherials.find((p) => p.name === parts[0]);
        return peripheral ? peripheral._findByPath(parts.slice(1)) : null;
    }

    getTreeItem(element: TreeNode): TreeNode {
        return element;
    }

    getChildren(element?: TreeNode): TreeNode[] {
        this.viewExpanded = true;
        if (!vscode.debug.activeDebugSession) {
            return [];
        }

        if (this.peripherials.length > 0) {
            if (element) {
                return element.node.getChildren().map((child) => child.getTreeNode());
            }
            return this.peripherials.map((p) => p.getTreeNode());
        }

        if (!this.loaded) {
            this._update();
        }

        return [
            new TreeNode(
                this.svdPath ? 'Loading...' : 'No Information',
                vscode.TreeItemCollapsibleState.None,
                'message',
                null
            ),
        ];
    }

    private async _load(): Promise<boolean> {
        if (this.svdPath) {
            this.loaded = true;
            this.peripherials = [];
            return new Promise((resolve) => {
                setTimeout(async () => {
                    try {
                        await this._loadSVD(this.svdPath);
                        if (this.initialSettings) {
                            this.initialSettings.forEach((setting) => {
                                const node = this._findNodeByPath(setting.node);
                                if (node) {
                                    node.expanded = setting.expanded || false;
                                    node.format = setting.format;
                                }
                            });
                        }
                    } catch (e) {
                        this.peripherials = [];
                        vscode.window.showErrorMessage(`Unable to parse SVD file: ${e.toString()}`);
                    }
                    resolve(true);
                }, 1000);
            });
        }
    }

    private async _update(): Promise<void> {
        if (this.viewExpanded) {
            if (!this.loaded) {
                await this._load();
            }
            try {
                await Promise.all(this.peripherials.map((p) => p.update()));
            } catch (e) {
                // Ignore update errors
            }
            this.refresh();
        }
    }

    onDidExpandElement(event: any): void {
        event.element.node.expanded = true;
        event.element.node.update();
        this.refresh();
    }

    onDidCollapseElement(event: any): void {
        event.element.node.expanded = false;
    }

    debugSessionStarted(svdPath: string, savedState: any[]): void {
        this.peripherials = [];
        this.loaded = false;
        this.svdPath = svdPath;
        this.initialSettings = savedState;
    }

    debugSessionTerminated(): void {
        this.peripherials = [];
        this.loaded = false;
        this.refresh();
    }

    debugStopped(): Promise<void> {
        return this._update();
    }

    debugContinued(): void {}
}
