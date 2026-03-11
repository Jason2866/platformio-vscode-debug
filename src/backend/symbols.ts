import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SymbolType, SymbolScope } from '../common';

const SYMBOL_REGEX = /^([0-9a-f]{8})\s([lg\ !])([w\ ])([C\ ])([W\ ])([I\ ])([dD\ ])([FfO\ ])\s([^\s]+)\s([0-9a-f]+)\s(.*)\r?$/;
const DEMANGLED_NAME_REGEX = /^_Z[^\d]*(\d+)(.+)$/;

const TYPE_MAP: { [key: string]: SymbolType } = {
    'F': SymbolType.Function,
    'f': SymbolType.File,
    'O': SymbolType.Object,
    ' ': SymbolType.Normal,
};

const SCOPE_MAP: { [key: string]: SymbolScope } = {
    'l': SymbolScope.Local,
    'g': SymbolScope.Global,
    ' ': SymbolScope.Neither,
    '!': SymbolScope.Both,
};

/** Describes a single objdump --syms entry. */
export interface SymbolInformation {
    address: number;
    type: SymbolType;
    scope: SymbolScope;
    section: string;
    length: number;
    name: string;
    file: string | null;
    instructions: any[] | null;
    hidden: boolean;
}

/** Loads/queries symbols from an ELF via objdump. */
export class SymbolTable {
    private symbols: SymbolInformation[] = [];

    constructor(
        private toolchainBinDir: string,
        private executable: string
    ) {}

    /** Runs objdump and populates internal symbol list. */
    loadSymbols(): void {
        let objdumpPath = '';
        fs.readdirSync(this.toolchainBinDir).forEach((file) => {
            if (file.includes('objdump') && fs.existsSync(path.join(this.toolchainBinDir, file))) {
                objdumpPath = path.join(this.toolchainBinDir, file);
            }
        });

        if (!objdumpPath) {
            throw new Error('Could not find "objdump" program');
        }

        const lines = childProcess
            .spawnSync(objdumpPath, ['--syms', this.executable])
            .stdout.toString()
            .split('\n');

        let currentFile: string | null = null;

        for (const line of lines) {
            const match = line.match(SYMBOL_REGEX);
            if (!match) {
                continue;
            }

            const type = TYPE_MAP[match[8]];
            const scope = SCOPE_MAP[match[2]];
            let name = match[11].trim();
            let hidden = false;

            if (match[7] === 'd' && match[8] === 'f') {
                currentFile = name;
            } else {
                if (name.startsWith('.hidden')) {
                    name = name.substring(7).trim();
                    hidden = true;
                }

                const demangledMatch = name.match(DEMANGLED_NAME_REGEX);
                if (demangledMatch) {
                    if (type !== SymbolType.Function) {
                        continue;
                    }
                    const nameLength = parseInt(demangledMatch[1]);
                    name = demangledMatch[2].substr(0, nameLength);

                    if (demangledMatch[2].length > nameLength) {
                        const nestedMatch = demangledMatch[2].substr(nameLength).match(/^(\d+)(.+)$/);
                        if (nestedMatch) {
                            name += '::' + nestedMatch[2].substr(0, parseInt(nestedMatch[1]));
                        }
                    }
                }

                this.symbols.push({
                    address: parseInt(match[1], 16),
                    type,
                    scope,
                    section: match[9].trim(),
                    length: parseInt(match[10], 16),
                    name,
                    file: scope === SymbolScope.Local ? currentFile : null,
                    instructions: null,
                    hidden,
                });
            }
        }
    }

    /** Returns function symbol containing address. */
    getFunctionAtAddress(address: number): SymbolInformation | undefined {
        const matches = this.symbols.filter(
            (sym) =>
                sym.type === SymbolType.Function &&
                sym.address <= address &&
                sym.address + sym.length > address
        );
        if (matches && matches.length !== 0) {
            return matches[0];
        }
    }

    /** Returns all function symbols. */
    getFunctionSymbols(): SymbolInformation[] {
        return this.symbols.filter((sym) => sym.type === SymbolType.Function);
    }

    /** Returns all global object symbols. */
    getGlobalVariables(): SymbolInformation[] {
        return this.symbols.filter(
            (sym) => sym.type === SymbolType.Object && sym.scope === SymbolScope.Global
        );
    }

    /** Returns file-local object symbols. */
    getStaticVariables(file: string): SymbolInformation[] {
        return this.symbols.filter(
            (sym) =>
                sym.type === SymbolType.Object &&
                sym.scope === SymbolScope.Local &&
                sym.file === file
        );
    }

    /** Looks up function by name (local first). */
    getFunctionByName(name: string, file: string): SymbolInformation | null {
        let matches = this.symbols.filter(
            (sym) =>
                sym.type === SymbolType.Function &&
                sym.scope === SymbolScope.Local &&
                sym.name === name &&
                sym.file === file
        );
        if (matches.length !== 0) {
            return matches[0];
        }

        matches = this.symbols.filter(
            (sym) =>
                sym.type === SymbolType.Function &&
                sym.scope !== SymbolScope.Local &&
                sym.name === name
        );
        if (matches.length !== 0) {
            return matches[0];
        }

        return null;
    }
}
