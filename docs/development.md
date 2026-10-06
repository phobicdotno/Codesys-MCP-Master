# Development

```bash
npm install        # dependencies
npm run build      # compile TypeScript + copy Python scripts to dist/
npm test           # all tests (vitest)
npm run typecheck  # tsc --noEmit
```

If vitest ever hangs before running a test, check that `package.json` has no UTF-8 BOM (it broke vitest's config loading until 2026-10-05). `node tests/run-without-vitest.mjs` runs the same tests without vitest.

## Layout

```
src/
  bin.ts              CLI entry point
  server.ts           MCP tool/resource registration (132 tools, 3 resources)
  launcher.ts         CODESYS process management
  ipc.ts              File-based IPC transport
  headless.ts         Headless fallback executor
  ide-bridge.ts       Passthrough to the CODESYS SP22 MCP server (ide_ tools)
  script-manager.ts   Python template loading + interpolation
  scripts/            IronPython scripts (watcher + helpers + tool scripts)
tests/
  unit/               Unit tests (IPC, script manager, launcher)
  integration/        Script-preparation tests (no CODESYS required)
```

Internals (IPC protocol, watcher, lifecycle): [../ARCHITECTURE.md](../ARCHITECTURE.md). Releasing to npm: [RELEASING.md](RELEASING.md).
