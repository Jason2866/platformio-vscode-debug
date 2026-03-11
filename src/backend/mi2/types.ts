import { MINode } from '../mi_parse';

export class VariableObject {
    public name: string;
    public exp: string;
    public numchild: number;
    public type: string;
    public value: string;
    public threadId: string;
    public frozen: boolean;
    public dynamic: boolean;
    public displayhint: string;
    public hasMore: boolean;
    public id: number;
    public fullExp: string;

    constructor(node: any) {
        this.name = MINode.valueOf(node, 'name');
        this.exp = MINode.valueOf(node, 'exp');
        this.numchild = parseInt(MINode.valueOf(node, 'numchild'));
        this.type = MINode.valueOf(node, 'type');
        this.value = MINode.valueOf(node, 'value');
        this.threadId = MINode.valueOf(node, 'thread-id');
        this.frozen = !!MINode.valueOf(node, 'frozen');
        this.dynamic = !!MINode.valueOf(node, 'dynamic');
        this.displayhint = MINode.valueOf(node, 'displayhint');
        this.hasMore = !!MINode.valueOf(node, 'has_more');
    }

    applyChanges(node: any): void {
        this.value = MINode.valueOf(node, 'value');
        if (MINode.valueOf(node, 'type_changed')) {
            this.type = MINode.valueOf(node, 'new_type');
        }
        this.dynamic = !!MINode.valueOf(node, 'dynamic');
        this.displayhint = MINode.valueOf(node, 'displayhint');
        this.hasMore = !!MINode.valueOf(node, 'has_more');
    }

    isCompound(): boolean {
        return (
            this.numchild > 0 ||
            this.value === '{...}' ||
            (this.dynamic && (this.displayhint === 'array' || this.displayhint === 'map'))
        );
    }

    toProtocolVariable(): any {
        return {
            name: this.exp,
            evaluateName: this.fullExp || this.exp,
            value: this.value === undefined ? '<unknown>' : this.value,
            type: this.type,
            presentationHint: { kind: this.displayhint },
            variablesReference: this.id,
        };
    }
}

export class MIError {
    public readonly message: string;
    public readonly source: string;

    constructor(message: string, source: string) {
        Object.defineProperty(this, 'name', {
            get: () => this.constructor.name,
        });
        Object.defineProperty(this, 'message', {
            get: () => message,
        });
        Object.defineProperty(this, 'source', {
            get: () => source,
        });
        Error.captureStackTrace(this, this.constructor);
    }

    toString(): string {
        return `${(this as any).message} (from ${(this as any).source})`;
    }
}

Object.setPrototypeOf(MIError, Object.create(Error.prototype));
(MIError as any).prototype.constructor = MIError;
