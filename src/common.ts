import { Event } from '@vscode/debugadapter';

/**
 * Defines the numeric display format used when rendering register and peripheral values.
 */
export enum NumberFormat {
    Auto = 0,
    Hexidecimal = 1,
    Decimal = 2,
    Binary = 3,
}

/**
 * Custom debug adapter event emitted when the adapter produces output (e.g. stdout/stderr).
 */
export class AdapterOutputEvent extends Event {
    constructor(content: string, type: string) {
        super('adapter-output', { content, type });
    }
}

/**
 * Custom debug adapter event emitted when the debuggee stops execution.
 */
export class StoppedEvent extends Event {
    constructor(reason: string, threadId: number, allThreadsStopped: boolean) {
        super('stopped', { reason, threadId, allThreadsStopped });
    }
}

/**
 * Custom debug adapter event used to record telemetry actions.
 */
export class TelemetryEvent extends Event {
    constructor(category: string, action: string, label: string, parameters: any = {}) {
        super('record-event', { category, action, label, parameters });
    }
}

/**
 * Classifies the kind of a symbol found in the executable's symbol table.
 */
export enum SymbolType {
    Function = 0,
    File = 1,
    Object = 2,
    Normal = 3,
}

/**
 * Describes the visibility/linkage scope of a symbol.
 */
export enum SymbolScope {
    Local = 0,
    Global = 1,
    Neither = 2,
    Both = 3,
}
