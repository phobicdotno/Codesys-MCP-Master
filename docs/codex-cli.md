# Use with OpenAI Codex CLI

`codesys-mcp-master` is a standard **stdio** MCP server, so any MCP-capable client can drive it - not just Claude Code. OpenAI's Codex CLI stores MCP servers in a TOML file rather than a JSON `.mcp.json`.

**Config file location:**

- Global: `~/.codex/config.toml` (Windows: `%USERPROFILE%\.codex\config.toml`)
- Per-project (trusted projects only): `.codex/config.toml` in the repo root

**One table drives every installed CODESYS** (0.19.0+): leave out `--codesys-path` and each tool call picks the install from the project file, see [installs-and-profiles.md](installs-and-profiles.md).

```toml
[mcp_servers.codesys-master]
command = "codesys-mcp-master"
args = ["--mode", "persistent", "--no-auto-launch"]
# CODESYS's first launch / a full compile can take 60s+. Codex defaults are
# startup_timeout_sec = 10 and tool_timeout_sec = 60 - raise the per-tool one.
tool_timeout_sec = 240   # above the MCP's own 180 s minimum per command

# Optional: pre-register PLC credentials so the "Device User Login" modal is
# suppressed on connect_to_device / download_to_device.
[mcp_servers.codesys-master.env]
CODESYS_DEVICE_USER = "<user>"
CODESYS_DEVICE_PASSWORD = "<password>"
```

To bind a table to one install instead, add `"--codesys-path", "<...CODESYS.exe>"` (and `"--codesys-profile"`) to `args`.

Or let Codex write the entry for you:

```bash
codex mcp add codesys-master   --env CODESYS_DEVICE_USER=<user> --env CODESYS_DEVICE_PASSWORD=<password>   -- codesys-mcp-master --mode persistent --no-auto-launch
```

Notes:

- **Differences from Claude Code's config:** a TOML `[mcp_servers.<name>]` table (note the underscore) instead of the JSON `mcpServers` object; `env` is a TOML table (or inline `env = { KEY = "val" }`); there's no outer wrapper object.
- **`--no-auto-launch` is recommended here too** so CODESYS opens on the first tool call rather than when Codex spawns the server (otherwise the launch runs during startup and can exceed `startup_timeout_sec`).
- **Restart Codex after editing `config.toml`** - the MCP client only reads it at startup.
- Everything else is identical because it's the same binary: one CODESYS process per install, the `install` argument, `--auto-mirror`, etc.
