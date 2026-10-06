# Installation

`codesys-mcp-master` is a Node.js MCP server. It was called `codesys-mcp-sp21-plus` before 0.19.0 (that command name still works). It is a fork, not the upstream `luke-harriman/Codesys-MCP`, and not a Python package: there is no `pip install`. The `.py` files under `src/scripts/` are CODESYS IronPython templates bundled inside the npm package.

**Requirements:** Windows, Node.js 18+, CODESYS 3.5 SP19, SP21 (3.5.21.x) or SP22 (3.5.22.x).

## From npm

Package: [`codesys-mcp-master`](https://www.npmjs.com/package/codesys-mcp-master).

```bash
npm install -g codesys-mcp-master
codesys-mcp-master --version
codesys-mcp-master --detect       # lists installed CODESYS versions
```

Upgrade later with `npm install -g codesys-mcp-master@latest`.

> As of 2026-10-05 npm serves 0.12.1 (June). Everything newer (timer watcher, multi-device projects, 180 s timeouts) is on GitHub `main` until the next release is published. Install from source to get it now.

## From source (unreleased changes)

```bash
git clone https://github.com/phobicdotno/Codesys-MCP-Master.git
cd Codesys-MCP-Master
npm install
npm run build
npm link
```

`npm link` registers `dist/bin.js` as the global `codesys-mcp-master` binary, so the same MCP config works. Edits to `src/*.ts` take effect after `npm run build` and an MCP reconnect. The Python scripts are read from `dist/scripts/` on every call, so an edited tool script works on the next call without a reconnect (`npm run build` copies it there); `watcher.py` is read at the next CODESYS launch. Update with `git pull && npm install && npm run build`.

To leave the global node_modules alone, skip `npm link` and point the MCP config at the checkout: `"command": "node", "args": ["C:\\Users\\<you>\\Codesys-MCP-Master\\dist\\bin.js", "--codesys-path", ...]`.

## MCP config

One entry drives every installed CODESYS version. `--print-config` prints it, with the detected installs as comments:

```bash
codesys-mcp-master --print-config           # one entry for all installs
codesys-mcp-master --print-config --sp 21   # an entry bound to the SP21 install only
```

```jsonc
{
  "mcpServers": {
    "codesys-master": {
      "command": "codesys-mcp-master",
      "args": ["--mode", "persistent", "--no-auto-launch"]
    }
  }
}
```

Each tool call picks the install from the project file's saved version, or from its `install` argument. Details and options (`--installs`, `--additional-folder`, `--default-install`): [installs-and-profiles.md](installs-and-profiles.md).

Where to put it:

- **Project-scoped** (shareable via git): `<project-root>/.mcp.json`. Create it if missing, or merge into its `mcpServers` object.
- **User-scoped** (every Claude Code session, stored in `%USERPROFILE%\.claude.json`): `claude mcp add codesys-master -s user -- codesys-mcp-master --mode persistent --no-auto-launch`.
- **OpenAI Codex:** same stdio server, see [codex-cli.md](codex-cli.md).

Restart Claude Code (or `/mcp` reconnect) after changing the config.

Only rule with several installs: never open the SAME `.project` from two CODESYS instances.
