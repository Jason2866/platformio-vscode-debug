import * as vscode from 'vscode';

/** VS Code debug configuration provider for platformio-debug. */
export class PlatformIODebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor() {}

    /** Resolves cwd to the workspace folder path. */
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration> {
        (config as any).cwd = folder ? folder.uri.fsPath : vscode.workspace.rootPath;
        return config;
    }
}
