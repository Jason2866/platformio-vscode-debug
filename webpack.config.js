'use strict';
const path = require('path');

/**@type {import('webpack').Configuration[]}*/
module.exports = [
    {
        name: 'extension',
        target: 'node',
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'extension.js',
            libraryTarget: 'umd',
            globalObject: 'global',
            library: 'platformio-vscode-debug',
        },
        externals: {
            vscode: 'vscode',
            '@vscode/debugadapter': '@vscode/debugadapter',
            xml2js: 'xml2js',
        },
        resolve: {
            extensions: ['.ts', '.js'],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: 'ts-loader',
                },
            ],
        },
        devtool: false,
    },
    {
        name: 'adapter',
        target: 'node',
        entry: './src/backend/adapter.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'adapter.js',
            libraryTarget: 'umd',
            globalObject: 'global',
            library: 'platformio-vscode-debug',
        },
        externals: {
            vscode: 'vscode',
            '@vscode/debugadapter': '@vscode/debugadapter',
            xml2js: 'xml2js',
        },
        resolve: {
            extensions: ['.ts', '.js'],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: 'ts-loader',
                },
            ],
        },
        devtool: false,
    },
];
