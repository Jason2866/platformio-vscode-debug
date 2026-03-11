# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-11

### Added
- **MI3/MI4 Protocol Support**: Full compatibility with GDB 9.0+ (MI3) and GDB 12.0+ (MI4)
- **Enhanced Breakpoint Parsing**: Robust handling of multi-location breakpoints (template functions, inline code)
- **MI Async Mode**: Added `gdb-set mi-async on` for better async behavior with modern GDB
- **Comprehensive Test Suite**: 20 new tests for breakpoint parsing across all MI versions
- **Documentation**: 
  - `MI_UPGRADE.md` - Detailed upgrade documentation
  - `README.md` - Complete project documentation
  - `CHANGELOG.md` - Version history

### Changed
- **Breakpoint Number Extraction**: Now handles both single and multi-location breakpoint formats
- **Error Handling**: Added NaN check for breakpoint number parsing
- **Package Version**: Bumped to 1.1.0
- **Package Description**: Updated to reflect MI3/MI4 support

### Fixed
- Multi-location breakpoint parsing for template functions
- Compatibility with GDB 12.0+ default MI4 mode
- Breakpoint script field handling (MI4 list format)

### Technical Details

#### Modified Files
- `src/backend/mi2/mi2.ts`:
  - Enhanced `addBreakPoint()` method with MI3/MI4 support
  - Added `mi-async` initialization command
  - Improved error handling for invalid breakpoint numbers

#### New Files
- `__tests__/mi2/breakpoint-parsing.test.ts` - Comprehensive breakpoint parsing tests
- `MI_UPGRADE.md` - MI3/MI4 upgrade documentation
- `README.md` - Project documentation
- `CHANGELOG.md` - This file

### Compatibility

#### Supported GDB Versions
- GDB 7.x - 8.x (MI2) ✅
- GDB 9.x - 11.x (MI3) ✅
- GDB 12.x+ (MI4) ✅

#### Supported OpenOCD Versions
- OpenOCD 0.10.0+ ✅
- OpenOCD 0.12.0+ ✅ (Recommended)

### Migration Guide

No breaking changes. The extension automatically detects and adapts to the MI version used by your GDB instance.

#### For Users
- Update GDB to version 12.0+ for best results (optional)
- No configuration changes required
- Existing launch configurations continue to work

#### For Developers
- Review `MI_UPGRADE.md` for implementation details
- Run `npm test` to verify compatibility
- Check `__tests__/mi2/breakpoint-parsing.test.ts` for examples

### Testing

All tests passing:
- 20 new breakpoint parsing tests
- 60 existing workflow tests
- Total: 80 tests, 100% pass rate

```bash
npm test
# Test Suites: 2 passed, 2 total
# Tests:       80 passed, 80 total
```

### Known Issues

None at this time.

### Deprecations

None. MI2 support is maintained for backward compatibility.

---

## [1.0.0] - Previous Release

### Added
- Initial release
- GDB MI2 protocol support
- Basic debugging features:
  - Breakpoint management
  - Variable inspection
  - Memory viewer
  - Register viewer
  - Disassembly view
  - Peripheral viewer
  - Call stack navigation
  - Step debugging
- VSCode integration
- PlatformIO/Arduino support
- OpenOCD integration

### Supported Platforms
- Arduino (AVR, ARM)
- ESP32 / ESP8266
- STM32 (all series)
- ARM Cortex-M microcontrollers

---

## Future Roadmap

### Planned for 1.2.0
- [ ] Enhanced peripheral viewer with SVD file support
- [ ] Improved memory editor with data visualization
- [ ] RTOS thread awareness
- [ ] Better error messages and diagnostics

### Planned for 2.0.0
- [ ] DAP (Debug Adapter Protocol) native support
- [ ] Python GDB scripting integration
- [ ] Advanced breakpoint types (watchpoints, tracepoints)
- [ ] Performance profiling integration

---

## Contributing

See [README.md](README.md) for contribution guidelines.

## License

See [LICENSE](LICENSE) file for details.
