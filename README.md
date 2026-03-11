# pioarduino-vscode-debug

A VSCode debugger extension for PlatformIO/Arduino projects with full MI3/MI4 support.

## Features

- GDB-based debugging via Machine Interface (MI) protocol
- Support for MI2, MI3, and MI4 protocol versions
- Breakpoint management (including multi-location breakpoints)
- Variable inspection and modification
- Memory viewer and editor
- CPU register inspection
- Disassembly view
- Peripheral viewer for embedded systems
- Call stack navigation
- Step debugging (step in, step over, step out)

## Requirements

- **VSCode**: Version 1.82.0 or newer
- **GDB**: Version 7.0 or newer (12.0+ recommended for MI4 support)
- **OpenOCD**: Version 0.10.0 or newer (0.12.0+ recommended)
- **PlatformIO**: For Arduino/embedded development

## Installation

```bash
npm install
npm run build
```

## GDB/MI Protocol Support

This extension supports multiple versions of the GDB Machine Interface protocol:

### MI2 (GDB 7.x - 8.x)
Legacy support for older GDB versions.

### MI3 (GDB 9.x - 11.x)
- Enhanced multi-location breakpoint support
- Improved handling of template functions and inline code
- Better breakpoint output format

### MI4 (GDB 12.x+)
- Script field as list for breakpoint commands
- Latest protocol improvements
- Recommended for new projects

The extension automatically adapts to the MI version used by your GDB instance. No configuration changes are required.

## Usage

1. Open your PlatformIO/Arduino project in VSCode
2. Set breakpoints in your code
3. Start debugging (F5)
4. Use the debug toolbar to control execution

### Debugging Features

- **Breakpoints**: Click in the gutter to set/remove breakpoints
- **Conditional Breakpoints**: Right-click on a breakpoint to add conditions
- **Watch Variables**: Add variables to the watch panel
- **Memory View**: Inspect memory contents at specific addresses
- **Disassembly**: View assembly code for your functions
- **Registers**: Monitor CPU register values
- **Peripherals**: View hardware peripheral states (embedded systems)

## Configuration

The extension works with standard VSCode launch configurations. Example:

```json
{
  "type": "gdb",
  "request": "launch",
  "name": "PlatformIO Debug",
  "executable": "${workspaceFolder}/.pio/build/target/firmware.elf",
  "target": "localhost:3333",
  "cwd": "${workspaceFolder}",
  "gdbpath": "arm-none-eabi-gdb"
}
```

## Compatibility

### Tested Platforms
- Arduino (AVR, ARM)
- ESP32 / ESP8266
- STM32 (all series)
- Raspberry Pi Pico (RP2040)
- Nordic nRF52
- Other ARM Cortex-M microcontrollers

### Debug Probes
- ST-Link
- J-Link
- CMSIS-DAP
- Black Magic Probe
- USB-to-Serial adapters (for ESP32/ESP8266)

## Troubleshooting

### Breakpoints not working
1. Ensure your code is compiled with debug symbols (`-g` flag)
2. Check that GDB version is 7.0 or newer: `gdb --version`
3. Verify OpenOCD is running and connected to your target

### Multi-location breakpoints
If you're debugging template functions or inline code and breakpoints behave unexpectedly, ensure you're using GDB 9.0+ (MI3) for proper multi-location breakpoint support.

### Connection issues
1. Check that OpenOCD is running: `openocd -f interface/stlink.cfg -f target/stm32f4x.cfg`
2. Verify the target port (default: 3333)
3. Check firewall settings

## Development

### Building
```bash
npm run build
```

### Testing
```bash
npm test
```

### Test Coverage
```bash
npm run test:coverage
```

## Architecture

```
src/
├── backend/          # GDB communication layer
│   ├── adapter.ts    # Debug adapter implementation
│   ├── mi2/          # MI protocol implementation
│   │   ├── mi2.ts    # MI command interface
│   │   └── types.ts  # MI data types
│   ├── mi_parse.ts   # MI output parser
│   └── symbols.ts    # Symbol management
├── frontend/         # VSCode UI providers
│   ├── configprovider.ts
│   ├── disassembly_*.ts
│   ├── memory_*.ts
│   ├── peripheral.ts
│   └── registers.ts
├── extension.ts      # Extension entry point
└── common.ts         # Shared utilities
```

## Contributing

Contributions are welcome! Please ensure:
1. All tests pass: `npm test`
2. Code follows TypeScript best practices
3. New features include tests
4. Documentation is updated

## License

See [LICENSE](LICENSE) file for details.

## Changelog

### Version 1.1.0
- Added MI3/MI4 protocol support
- Enhanced multi-location breakpoint handling
- Improved compatibility with GDB 9.0+ and 12.0+
- Added comprehensive breakpoint parsing tests
- Better error handling for breakpoint operations

### Version 1.0.0
- Initial release
- MI2 protocol support
- Basic debugging features

## References

- [GDB Machine Interface Documentation](https://sourceware.org/gdb/current/onlinedocs/gdb/GDB_002fMI.html)
- [OpenOCD Documentation](https://openocd.org/doc/)
- [VSCode Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
- [PlatformIO Documentation](https://docs.platformio.org/)

## Support

For issues and feature requests, please use the [GitHub issue tracker](https://github.com/Jason2866/pioarduino-vscode-debug/issues).
