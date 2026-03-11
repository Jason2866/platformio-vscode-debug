import { Event } from 'vscode-debugadapter';

export enum NumberFormat {
    Auto = 0,
    Hexidecimal = 1,
    Decimal = 2,
    Binary = 3,
}

export class AdapterOutputEvent extends Event {
    constructor(content: string, type: string) {
        super('adapter-output', { content, type });
    }
}

export class StoppedEvent extends Event {
    constructor(reason: string, threadId: number, allThreadsStopped: boolean) {
        super('stopped', { reason, threadId, allThreadsStopped });
    }
}

export class TelemetryEvent extends Event {
    constructor(category: string, action: string, label: string, parameters: any = {}) {
        super('record-event', { category, action, label, parameters });
    }
}

export enum SymbolType {
    Function = 0,
    File = 1,
    Object = 2,
    Normal = 3,
}

export enum SymbolScope {
    Local = 0,
    Global = 1,
    Neither = 2,
    Both = 3,
}
