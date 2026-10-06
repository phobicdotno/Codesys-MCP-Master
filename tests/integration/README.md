# Manual CODESYS Integration Tests

These tests require a real CODESYS installation and cannot run in CI.

## Prerequisites
- CODESYS 3.5 SP19 or SP21 installed
- No other CODESYS instances running
- Node.js 18+

## Steps

### 1. Build the package
```bash
npm run build
```

### 2. Test persistent mode
```bash
node dist/bin.js \
  --codesys-path "C:\path\to\CODESYS.exe" \
  --codesys-profile "CODESYS V3.5 SP21 Patch 3" \
  --mode persistent \
  --verbose
```

**Verify:**
- CODESYS UI opens
- Console shows "CODESYS watcher is ready"
- The MCP server accepts connections

### 3. Test headless fallback
```bash
node dist/bin.js \
  --codesys-path "C:\path\to\CODESYS.exe" \
  --codesys-profile "CODESYS V3.5 SP21 Patch 3" \
  --mode headless
```

### 4. Test --detect flag
```bash
node dist/bin.js --detect
```

**Verify:** Lists installed CODESYS versions.

### 5. Ctrl+C shutdown
- Press Ctrl+C during persistent mode
- Verify CODESYS shuts down cleanly
