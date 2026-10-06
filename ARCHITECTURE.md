# Architecture

## Problem Statement

The original `@codesys/mcp-toolkit` spawns a new headless CODESYS process (`--noUI`) for every MCP tool call. This has two limitations:

1. **No UI visibility** — the user cannot see what the AI is doing to their project
2. **Project locking** — if the user opens CODESYS manually, the project file is locked and MCP tools fail

The desired workflow: a single CODESYS instance with its UI open, where MCP tool commands execute in the same process and changes appear in real-time.

## Architecture Overview

```
+-------------------------------------+
|      MCP Client (Claude Code)       |
+------------------+------------------+
                   | MCP Protocol (stdio)
+------------------v------------------+
|    Node.js MCP Server               |
|                                     |
|  bin.ts  -> CLI entry point         |
|  server.ts -> MCP tools/resources   |
|  launcher.ts -> Process management  |
|  ipc.ts -> File-based IPC           |
|  headless.ts -> Fallback mode       |
|  script-manager.ts -> Templates     |
+------------------+------------------+
                   | File-based IPC (persistent)
                   | OR spawn-per-command (headless)
+------------------v------------------+
|    CODESYS.exe                      |
|  watcher.py running inside via      |
|  --runscript (persistent mode)      |
+-------------------------------------+
```

## IPC Protocol

### Directory Layout

Each session creates a unique directory under `os.tmpdir()`:

```
%TEMP%/codesys-mcp-sp21-plus/<sessionId>/
  commands/           Node.js writes here
    <requestId>.py              Script to execute
    <requestId>.command.json    Command trigger file
  results/            Watcher writes here
    <requestId>.result.json     Execution result
  watcher.py          Interpolated watcher script
  ready.signal        Written by watcher on startup
  terminate.signal    Written by Node.js for shutdown
```

### Command File Format

`<requestId>.command.json`:
```json
{
  "requestId": "uuid-v4",
  "scriptPath": "/path/to/commands/<requestId>.py",
  "timestamp": 1700000000000
}
```

### Result File Format

`<requestId>.result.json`:
```json
{
  "requestId": "uuid-v4",
  "success": true,
  "output": "captured stdout from script execution",
  "error": "",
  "timestamp": 1700000000.123
}
```

### Write Ordering (Atomicity)

All files use atomic writes: write to `.tmp`, `fsync`, then `rename`.

Command submission order:
1. Write `<requestId>.py` (script content) -> fsync -> rename
2. Write `<requestId>.command.json.tmp` -> fsync -> rename to `.command.json`

The watcher triggers on `.command.json` appearance. Since the `.py` file is written and renamed first, it is guaranteed to exist when the watcher reads the command.

### Progressive Polling

Node.js polls for result files with exponential backoff:
- Initial interval: 100ms
- Doubles each poll: 100, 200, 400, 800, 1000ms
- Capped at 1000ms
- Timeout: at least 180s (`--timeout`); tools with a longer timeout of their own keep it

## Watcher Script

The watcher (`src/scripts/watcher.py`) runs inside CODESYS via `--runscript` and provides the bridge between Node.js IPC and the CODESYS scripting API.

### Timer, not a loop

```python
timer = System.Windows.Forms.Timer()   # ticks on the UI thread
timer.Interval = 50
timer.Tick += tick                     # tick: terminate check, then one command
AppDomain.CurrentDomain.SetData(slot, timer)   # keeps it alive
timer.Start()
# ...and the --runscript returns here
```

Each tick checks `terminate.signal`, then processes at most one command; a busy flag skips a tick while a command is still running. Because the startup script returns, CODESYS does not treat the IDE as busy, so its menus stay enabled (before 0.18.0 the watcher was a `while True` loop with a 50 ms yield that never returned, and the menus were greyed out the whole session).

### Script Execution via exec()

Each command script is executed with `exec(script_code, exec_globals)` where `exec_globals` is a fresh dictionary:

```python
exec_globals = {
    '__builtins__': __builtins__,
    'sys': sys,
    'os': os,
    'time': time,
    'traceback': traceback,
    'shutil': __import__('shutil'),
}
```

This provides:
- **Namespace isolation** — variables from script A are not visible to script B
- **CODESYS API access** — `scriptengine` is available via `import scriptengine` because the watcher runs within the CODESYS scripting context (it's already in `sys.modules`)
- **Standard library access** — common modules pre-loaded in globals

### SystemExit Handling

CODESYS scripts use `sys.exit(0)` for success and `sys.exit(1)` for failure. The watcher catches `SystemExit` to prevent CODESYS from closing:

| Exit code | Mapping |
|-----------|---------|
| `None` or `0` | Success |
| Non-zero int | Failure |
| String | Failure (string is the error message) |

Output markers (`SCRIPT_SUCCESS` / `SCRIPT_ERROR`) take priority over exit codes when both are present.

### Output Capture

The `OutputCapture` class redirects `sys.stdout` and `sys.stderr` during script execution:

```python
class OutputCapture:
    def __init__(self):
        self._buffer = []
    def write(self, s):
        self._buffer.append(str(s))
    def getvalue(self):
        return ''.join(self._buffer)
```

Original stdout/stderr are saved and restored in a `try/finally` block, guaranteeing restoration even on unexpected exceptions. This class works across CPython and IronPython (CODESYS uses IronPython).

## Script Template System

Python scripts are stored as templates in `src/scripts/` with `{PLACEHOLDER}` tokens. The `ScriptManager` handles:

1. **Loading** — reads `.py` files from disk with caching
2. **Interpolation** — replaces `{KEY}` with escaped values
3. **Escaping** — backslashes doubled for Python string embedding (`C:\Users` -> `C:\\Users`)
4. **Triple-quote escaping** — `"""` in values escaped to `\"\"\"` for Python triple-quoted strings
5. **Helper prepending** — shared functions (`ensure_project_open`, `find_object_by_path`) prepended before the main script

### Helper Scripts

Two helper scripts are prepended to most tool scripts:

- **`ensure_project_open.py`** — opens a project file if not already open, with retry logic (3 attempts, 2s delay)
- **`find_object_by_path.py`** — navigates the CODESYS project tree to find objects by path (e.g., `Application/MyPOU`)

## Lifecycle Management

### Launch Sequence

1. Validate CODESYS executable exists
2. Generate session UUID
3. Create IPC directory with `commands/` and `results/` subdirectories
4. Load `watcher.py` template, interpolate `{IPC_BASE_DIR}`
5. Write interpolated watcher to session directory
6. Spawn: `CODESYS.exe --profile="..." --runscript="watcher.py"` (detached, UI visible)
7. `process.unref()` so Node.js doesn't wait for CODESYS
8. Poll for `ready.signal` (max 150s, every 500ms); then switch to the CODESYS PID the watcher wrote into it (the spawn PID is the cmd.exe shell)
9. Start health monitor (5s interval PID check)

### Taking over a running CODESYS

When `launch()` finds a CODESYS of the same install already running, it first looks for an earlier session dir (under `%TEMP%/codesys-mcp-sp21-plus/`) whose `ready.signal` names that PID and has no `terminate.signal`, and pings its watcher. If the watcher answers, the launcher reuses that IPC dir and PID instead of spawning. Every session writes `owner.json` (its server PID); a session whose owner server is still alive is never taken over, so two live servers never share one CODESYS. Every launch also deletes session dirs nothing can use any more: their CODESYS is gone, or a launch never wrote `ready.signal` and the dir is older than a day (dirs of a running CODESYS of any install, or of a live owner, are kept). When no watcher answers (a CODESYS opened by hand, a busy one, or one still owned by a live server) it starts another instance next to it, each instance with its own session dir; `--single-instance` makes it refuse instead, and `killExisting=true` skips the takeover and kills only orphans: same-install instances an MCP server started (a plain session dir names the PID) that no live server owns. A CODESYS opened by hand is never killed. `shutdown_codesys` without a CODESYS of its own kills the same orphans and nothing else.

### Asking before closing or starting CODESYS

The MCP never throws away unsaved work and never starts a CODESYS next to others without the user's answer; it cannot ask the user itself, so it refuses with a `DecisionNeededError` that lists what it found and the options, and the agent asks and calls again. Before a new launch with other CODESYS of the install running (not adoptable), `describeInstances` reports who runs each (opened by hand, attached, another live session, an ended session), the open projects and unsaved flags through the watcher where one answers (`projects.all`; `ScriptProjects` itself is not iterable), else the window title (`Name.project*`), and `launch({ otherInstances })` carries the answer (`leave` is remembered). `closeInstances` uses a normal window close (taskkill without /F) so CODESYS asks about unsaved changes itself, and never touches another live session's CODESYS. `shutdown({ unsaved })` refuses on unsaved projects unless told `save`, `discard` or `keep-open`; an unreadable unsaved state counts as unsaved. Every launch path asks: the lazy executor's (the question reaches the tool reply), the one at server start (the server stays connected), a `killExisting` launch for the instances it spares, and `launch_codesys_with_project`. A `close` answer acts only on the PIDs the question named. IPC commands stop waiting once their CODESYS process has exited.

### Attaching a CODESYS opened by hand (`attach_codesys`)

`src/attach.ts` builds the attach script: `watcher.py` whose session dir is made at runtime inside that CODESYS, `attach-<pid>-<time>` under the same session folder (TEMP first, as Node's `os.tmpdir()`). The user runs it once (Tools > Scripting > Execute Script File...); it installs the UI-thread timer and returns, and a second run stops the first watcher. `launcher.attach()` (and any launch) adopts that session like one an ended session left. An attach session is the user's CODESYS: `shutdown()` only writes `terminate.signal` (detach; the dir is pruned a minute later), `killExisting` and the orphan sweep never touch its PID, and a project with unsaved changes is never closed by `ensure_project_open`. One `.project` must not be open in two instances: `ensure_project_open` reads the project's `<name>.~u` lock (user, PC, CODESYS PID) before `projects.open`, refuses a live owner and removes a stale lock. Concurrent launch calls share one attempt. When the server stops, CODESYS stays open unless `--no-keep-alive` is given, so the next session can take it over.

### Shutdown Sequence (`shutdown_codesys`, or server stop with `--no-keep-alive`)

1. Write `terminate.signal`
2. Wait up to 5s for process exit (poll every 500ms)
3. If still alive: `SIGTERM`, wait 2s, then `SIGKILL`
4. Clean up IPC directory

### Health Monitoring

A `setInterval` runs every 5 seconds checking if the CODESYS process is still alive (`process.kill(pid, 0)`). On process death:
- State transitions to `error`
- `lastError` is set with a descriptive message
- Registered `onStateChange` callbacks are invoked
- Monitor stops itself

## Concurrency Model

### Async Mutex

The `IpcClient` uses an async mutex to serialize commands. Only one command can be in-flight at a time. This prevents:
- Race conditions in the CODESYS scripting API (not thread-safe)
- File system conflicts in the IPC directory
- Interleaved script output

When multiple tool calls arrive concurrently, they queue and execute sequentially.

### Watcher Timer Processing

The watcher installs a WinForms timer on the UI thread (50 ms) and the `--runscript` returns, so CODESYS keeps its menus enabled. Each tick processes one command; a busy flag stops a tick from starting while a command is still running (a command that opens a dialog or pumps messages lets the timer fire again). If multiple `.command.json` files exist, they're sorted alphabetically and processed in order. Commands that call `create_online_application` or `create_online_device` need a running-script context (from a timer tick CODESYS raises "Stack empty"): the watcher runs them through the IDE's "Execute Script File" (`CommandHelper.ExecuteScript`, synchronous) with a fixed `runner.py` that hands its own `exec` back to the watcher, so the command is compiled in the runner's context. About 0.9 s extra per such command; every other command keeps the direct path.

## Headless Fallback

When persistent mode is unavailable, the `HeadlessExecutor` provides the same `ScriptExecutor` interface using spawn-per-command:

1. Write script to temp file
2. Spawn `CODESYS.exe --profile="..." --noUI --runscript="script.py"` with `windowsHide: true`
3. Capture stdout/stderr
4. Parse `SCRIPT_SUCCESS` / `SCRIPT_ERROR` markers
5. Return `IpcResult`

Fallback activates when:
- `--mode headless` is specified
- Persistent launch fails and `--fallback-headless` is explicitly opted in (off by default)
- Server starts with `--no-auto-launch` before `launch_codesys` is called

## Differences from Original Toolkit

| Aspect | @codesys/mcp-toolkit | codesys-mcp-master |
|--------|---------------------|----------------------|
| CODESYS UI | Hidden (`--noUI`) | Visible (persistent) or hidden (headless) |
| Process lifetime | New process per command | Single long-running process |
| IPC mechanism | Spawn + stdout | File-based polling |
| Project locking | Blocks if user opens CODESYS | Shares the same instance |
| Real-time feedback | None | Changes visible in UI |
| Startup overhead | ~10-30s per command | ~10-30s once, then <100ms per command |
| Management tools | None | `launch_codesys`, `shutdown_codesys`, `get_codesys_status` |

## Security Considerations

- **Temp directory** - IPC files are created in the user's temp directory with default permissions. A script for an online tool carries the PLC device user and password (from the tool arguments, credentials given earlier in the session, or `CODESYS_DEVICE_USER`/`CODESYS_DEVICE_PASSWORD`) in plain text in `commands/<id>.py`; the watcher deletes it after the run. Output prints the user name only.
- **Script injection** — tool parameters are escaped for Python string embedding (backslashes doubled, triple quotes escaped). The `exec()` context has access to the full CODESYS scripting API, which is the intended design.
- **Localhost only** — IPC is file-based with no network exposure. The MCP server communicates via stdio only.
- **Process isolation** — CODESYS is spawned as a detached process. The Node.js server can crash and restart without affecting CODESYS (though a new session would be created).
