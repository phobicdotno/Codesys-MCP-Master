# Codesys-MCP-Master

One MCP server for every installed CODESYS 3.5 version (SP18, SP19, SP21, SP22; every offline tool live-tested on all four, online tools against a local soft PLC on SP18, SP19 and SP21). Each tool call picks the install from the project file's saved version. It launches CODESYS with its UI visible, keeps it running, and drives it through **127 tools**: project and POU authoring, compile, online/runtime, devices and tasks, symbol configuration, multi-device projects, and a version + git release pipeline. The CODESYS menus stay usable while it is connected, and on SP22 the CODESYS-shipped MCP server's tools are available alongside (`ide_` prefix).

A fork of [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP), which stopped working on SP21+. Why and what changed: [docs/whats-new.md](docs/whats-new.md).

## Quick start

```bash
npm install -g codesys-mcp-master
codesys-mcp-master --print-config      # one MCP config entry for all installed CODESYS versions
```

Paste the entry into `.mcp.json` (or `claude mcp add ...`) and restart Claude Code. Details, install from source and config options: [docs/installation.md](docs/installation.md).

## Documentation

| Doc | Contents |
|---|---|
| [docs/installation.md](docs/installation.md) | npm and source install, MCP config, several installs |
| [docs/tools.md](docs/tools.md) | All 127 tools and the resources, per category |
| [docs/cli-reference.md](docs/cli-reference.md) | CLI flags, env vars, `--detect`, `--ssh-version` |
| [docs/installs-and-profiles.md](docs/installs-and-profiles.md) | How one server picks the install per call, additional folders, version pin |
| [docs/auto-mirror.md](docs/auto-mirror.md) | Live source-control diff via `--auto-mirror` |
| [docs/codex-cli.md](docs/codex-cli.md) | Using the server from OpenAI Codex CLI |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Execution modes and troubleshooting |
| [docs/vs-codesys-sp22-mcp.md](docs/vs-codesys-sp22-mcp.md) | Quick comparison with the MCP server CODESYS ships in SP22 |
| [CHANGELOG.md](CHANGELOG.md) | Changes per version |
| [docs/whats-new.md](docs/whats-new.md) | What this fork adds and fixes, with rationale |
| [docs/development.md](docs/development.md) | Build, test, source layout |
| [ARCHITECTURE.md](ARCHITECTURE.md) | IPC protocol, watcher, lifecycle |
| [docs/RELEASING.md](docs/RELEASING.md) | npm release procedure |

## Credits and license

Upstream architecture and the original tool set: [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP). This fork: [phobicdotno/Codesys-MCP-Master](https://github.com/phobicdotno/Codesys-MCP-Master), Karstein Kvistad. MIT.
