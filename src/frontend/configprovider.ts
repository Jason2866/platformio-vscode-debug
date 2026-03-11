import * as vscode from 'vscode';

export class PlatformIODebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor() {}

    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration> {
        (config as any).cwd = folder ? folder.uri.fsPath : vscode.workspace.rootPath;
        return config;
    }
}
