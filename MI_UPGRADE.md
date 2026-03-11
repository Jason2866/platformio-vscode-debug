# MI3/MI4 Protocol Upgrade

## Overview

This codebase has been upgraded to support GDB Machine Interface versions 3 and 4 (MI3/MI4), while maintaining backward compatibility with MI2.

## Changes Made

### 1. Enhanced Breakpoint Parsing (`src/backend/mi2/mi2.ts`)

**Problem**: 
- MI3 (GDB 9+) changed the output format for multi-location breakpoints
- MI4 (GDB 12+) changed the "script" field to be a list instead of a string

**Solution**:
The `addBreakPoint()` method now handles both single and multi-location breakpoints:

```typescript
// Handles both formats:
// MI2: bkpt={number="1",...}
// MI3+: bkpt={number="1",...} or bkpt={locations=[{number="1.1",...}]}
```

### 2. MI Async Mode

Added `gdb-set mi-async on` during initialization to ensure proper async behavior with modern GDB versions.

## Compatibility

### Supported GDB Versions
- **GDB 7.x - 8.x**: MI2 (legacy support)
- **GDB 9.x - 11.x**: MI3 (multi-location breakpoint fixes)
- **GDB 12.x+**: MI4 (script field as list)

### Supported OpenOCD Versions
- **OpenOCD 0.10.0+**: All versions supported
- **OpenOCD 0.12.0+**: Recommended for best compatibility

## Testing Recommendations

1. **Multi-location breakpoints**: Test with template functions or inline functions that generate multiple breakpoint locations
2. **Conditional breakpoints**: Verify conditions work correctly
3. **Breakpoint scripts**: Test breakpoints with commands (MI4 specific)

## Known Limitations

1. The code uses a fallback approach for breakpoint number extraction, which should work across all MI versions
2. Script field parsing (MI4) is handled by the existing parser but may need additional validation for complex scripts

## Migration Notes

No configuration changes are required. The code automatically adapts to the MI version used by the connected GDB instance.

### For Users

If you experience issues with breakpoints:
1. Check your GDB version: `gdb --version`
2. Ensure GDB is version 7.0 or newer
3. For best results, use GDB 12.0+ with MI4 support

### For Developers

The MI parser (`src/backend/mi_parse.ts`) is version-agnostic and handles all MI output formats. The key changes are in how we extract breakpoint information from the parsed results.

## References

- [GDB MI Documentation](https://sourceware.org/gdb/current/onlinedocs/gdb/GDB_002fMI.html)
- [GDB 9 NEWS - MI3 Changes](https://sourceware.org/git/?p=binutils-gdb.git;a=blob;f=gdb/NEWS)
- [GDB 12 NEWS - MI4 Changes](https://sourceware.org/git/?p=binutils-gdb.git;a=blob;f=gdb/NEWS)
