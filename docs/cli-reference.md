# CLI Reference

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --codesys-path <path>` | Bind the server to ONE CODESYS executable. Omit it to drive every detected install from one server | `$CODESYS_PATH`, else all installs |
| `-f, --codesys-profile <name>` | Profile for `--codesys-path` | `$CODESYS_PROFILE`, else the detected profile of that install |
| `--installs <list>` | Without `--codesys-path`: only these installs, comma-separated (`19,21,22`) | all detected |
| `--additional-folder <sp=dir...>` | Without `--codesys-path`: AdditionalFolders installation per version (`SP19=C:\...\<YourAddOn>`), repeatable | the detected one with the most plugins |
| `--default-install <install>` | Install for calls that name none and point at no project | newest |
| `--codesys-additional-folder <dir>` | Installer-managed AdditionalFolders dir that disambiguates same-named profiles (see [installs-and-profiles.md](installs-and-profiles.md)) | auto-detected by `--print-config` |
| `-w, --workspace <dir>` | Workspace directory for relative paths | Current directory |
| `-m, --mode <mode>` | `persistent` (UI) or `headless` (--noUI) | `persistent` |
| `--no-auto-launch` | Don't launch CODESYS on startup | Auto-launch enabled |
| `--fallback-headless` | Fall back to headless (`--noUI`) if persistent launch fails | `false` |
| `--no-keep-alive` | Close CODESYS when the server stops. By default it stays open and the next session takes it over | keep alive |
| `--single-instance` | Refuse to start a second CODESYS of the same install when one is running that cannot be taken over (the behaviour before 0.20.0). By default another instance starts next to it | off |
| `--auto-mirror` | Refresh the textual mirror after every modifying tool call (see [auto-mirror.md](auto-mirror.md)) | off |
| `--timeout <ms>` | Minimum command timeout (tools with a longer one keep theirs) | `180000` |
| `--detect` | List installed CODESYS versions and exit | - |
| `--print-config` | Print a ready-to-paste `.mcp.json` entry that drives every detected install, and exit (with `--sp`/`--for-project`/`--name`: per-install entries) | - |
| `--sp <number>` | With `--print-config`: emit only the entry for CODESYS V3.5 SP`<n>` | - |
| `--for-project <path>` | With `--print-config`: pick only the install(s) matching the `.project` file at `<path>` (exact SP+patch, or fall back to same-SP-different-patch). Mutually exclusive with `--sp`. | - |
| `--name <name>` | With `--print-config --sp <n>`: override the MCP server entry name | - |
| `--inspect <path>` | Read a CODESYS `.project` offline (no CODESYS needed) and print its profile name/version + mandatory libraries; uses the `unzip` CLI from Git for Windows / Linux+Mac | - |
| `--ssh-version <host>` | SSH to a CODESYS Control Linux PLC and print the running project version (extracted from the boot-application binary). Bypasses CODESYS entirely. Requires SSH key auth, and passwordless sudo for `cat` unless the user is root. | - |
| `--ssh-user <name>` | With `--ssh-version`: SSH user | `karstein` |
| `--ssh-boot-app <path>` | With `--ssh-version`: path to the boot application on the PLC | `/var/opt/codesys/PlcLogic/Application/Application.app`, else WAGO `/home/codesys_root/PlcLogic/Application/Application.app` |
| `--verbose` | Enable verbose logging | - |
| `--debug` | Enable debug logging | - |
| `-V, --version` | Show version number | - |
| `-h, --help` | Show help | - |

Environment variables `CODESYS_PATH` and `CODESYS_PROFILE` are used as defaults when the corresponding flags are not provided. `CODESYS_DEVICE_USER` / `CODESYS_DEVICE_PASSWORD` pre-register PLC credentials so the "Device User Login" dialog is suppressed on `connect_to_device` / `download_to_device`.

## Run without `.mcp.json`

The binary can be invoked directly from a shell (useful for one-off testing or wrapping in another launcher):

```bash
codesys-mcp-master \
  --codesys-path "C:\Program Files\CODESYS 3.5.22.10\CODESYS\Common\CODESYS.exe" \
  --codesys-profile "CODESYS V3.5 SP22 Patch 1"
```

## Detect installed versions

```bash
codesys-mcp-master --detect
```

Scans `Program Files` and `Program Files (x86)` for CODESYS installations and prints each install's path and profile name.

## `--ssh-version` - read the running PLC's project version over SSH

For CODESYS Control Linux PLCs (Raspberry Pi, IPC, etc.) the running project version can be read straight off the boot-application binary, without CODESYS being installed or the `.project` file being unlocked:

```bash
codesys-mcp-master --ssh-version 192.168.1.83
codesys-mcp-master --ssh-version myplc.lan --ssh-user pi
```

The boot app is fetched with `cat` and its strings are picked locally, so the PLC needs no `strings` (WAGO's BusyBox has none). Without `--ssh-boot-app` the standard Linux path is tried, then WAGO's `/home/codesys_root/PlcLogic/Application/Application.app`. The host can be an `~/.ssh/config` alias, so a ProxyJump route works (`--ssh-version plc-b --ssh-user root`). Requires SSH key auth, and unless you log in as root, passwordless sudo for `cat` on the PLC. If your key isn't installed yet, the error message includes a one-line PowerShell recipe.
