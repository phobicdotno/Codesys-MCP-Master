# Changelog

All notable changes, newest first. Versions match `package.json` and the `v*` git tags. The rationale behind the bigger changes is in [docs/whats-new.md](docs/whats-new.md).

Until v0.19.0 the project was called Codesys-MCP-SP21+ (npm package `codesys-mcp-sp21-plus`).

## Unreleased

- **Five new tools and library checking** (written for this project; the ideas, not code, come from later versions of the upstream project):
  - `find_references` and `rename_symbol`: CODESYS's scripting API has no cross-reference or refactoring call, so both read the textual code with their own Structured Text lexer (comments, strings, pragmas and typed literals skipped, identifiers matched case-insensitively). `rename_symbol` is a dry run by default and refuses invalid names, reserved words and names already in use.
  - `monitor_variables`: samples variables over a time window and summarises them (first, last, min, max, changes, optional series).
  - `set_simulation_mode`: reads or sets a device's simulation mode, so the application runs in CODESYS's simulator without a PLC.
  - `list_device_repository`: lists installed device descriptions, filtered.
  - `compile_project` checks a library project (no application) with "Check all Pool Objects".
  - Verified on SP21: references and a rename across two POUs (comment and string text untouched, 0 compile errors after), the simulator running with `nCycles` sampled rising, a library with a deliberate error reporting it. The library and simulation calls exist on SP18, SP21 and SP22.
- README: a section on working in natural language, and how much upstream code remains (about 13%).
- Compared with the upstream "Stack empty" fix for online commands: no change needed. Ours runs online commands through the IDE's own Execute Script File (watcher 0.6.0), which passed the full tool matrix on SP18, SP19 and SP21, and the login already tries `login(OnlineChangeOption, False)` first with fallbacks for other call shapes.
- Review fixes for the new tools: the lexer no longer swallows names in array ranges (`ARRAY[1..nMax]`) or treats the type prefix of a typed literal (`T#1s`) as a name; the qualifier shows the full access path (`arr[i].`, `p^.`, `fb.out.`). `rename_symbol` knows all reserved words and the Standard library blocks, checks clashes in the whole project, refuses a scoped object rename that would break uses outside the scope, and restores the text if applying fails. `monitor_variables` reports when it hit its sample cap; `list_device_repository` sorts before it cuts; `set_simulation_mode` refuses when the project has other unsaved changes.
- **Watcher 0.7.1: non-ASCII results and no endless re-runs** (ported from PR #25 by Andrei-Errapart). CODESYS's own json library raised on any character in U+0080..U+00FF, so localized output (a German install's compiler messages) was never written and the call timed out although it had run; results are now written as UTF-8 with `ensure_ascii=False`, with an ASCII fallback report. And when a result write failed, the command file stayed, so the next tick ran the same command again every 50 ms forever (a download would repeat); the command file is now always removed. Verified on SP21: umlauts, a dash and CJK text came through byte-exact on the output and the error path.
- Installs straight from GitHub while the npm package waits: `npm i -g github:phobicdotno/Codesys-MCP-Master` (a `prepare` script builds `dist/`, which is not in git).
- Release text written into vessel repos no longer contains " -- ": the classifier evidence lines (commit message and the auto-appended Changelog entry) use ";" or ":". Seen on a sha-fallback release ("touch -- classifying as build bump", a vessel project v1.1.1.1). A unit test keeps it out.
- **The window title shows when the MCP can drive a CODESYS:** `Project.project - CODESYS [MCP]` (watcher 0.7.0). CODESYS rewrites its title on every project change, so the watcher re-applies the marker about once a second; a detach removes it. There is no script API for an extra menu.
- The attach script is rewritten on every server start, so a desktop shortcut that starts CODESYS with `--runscript=<attach script>` always runs the current watcher. Such a CODESYS is ready for the MCP without the menu step (verified on SP21: started from the shortcut, used by the MCP at once).
- **Unsaved work is never thrown away unasked.** `shutdown_codesys` refuses when a project has unsaved changes and asks (through the agent): `unsavedChanges` `save`, `discard` or `keep-open`; the server stopping with `--no-keep-alive` keeps such a CODESYS open. `killExisting` and the orphan sweep ask before touching an orphan with unsaved work. Found on the way: the quit script's `list(se.projects)` never worked (`ScriptProjects` is not iterable, the list is `projects.all`), so it never closed a project; CODESYS just exited.
- **A new CODESYS is not started next to others unasked.** When other CODESYS of the install run that cannot be taken over, the launch lists them (who runs them, open project, unsaved changes from the watcher or the window title `Name.project*`) and asks: `otherInstances` `leave`, `close` (normal window close, CODESYS asks about unsaved changes) or `save-and-close`. This holds for every launch: the automatic one on a tool call, the one at server start (the server stays connected and asks on the first call instead of exiting), a `killExisting` launch (for what it does not kill) and `launch_codesys_with_project`. `close` acts only on the CODESYS the question named. An unsaved state that cannot be read counts as unsaved everywhere (also when `ensure_project_open` / `create_project` switch projects). Another live session's CODESYS is always left alone. Verified on SP21: a CODESYS without a watcher was listed and closed on `close`, another session's was left running.
- Shutdown took 3 minutes: the quit command waited out the 180 s command floor after CODESYS had already exited. Commands now stop waiting once their CODESYS process is gone (205 s to 5 s).
- **`attach_codesys`: work in a CODESYS opened by hand.** The tool writes an attach script; the user runs it once in that CODESYS (Tools > Scripting > Execute Script File...). It installs the MCP watcher in a session dir `attach-<pid>-<time>` and returns, and the MCP takes that session over (a launch also does so by itself). An attached CODESYS is the user's: `shutdown_codesys` (and the server stopping with `--no-keep-alive`) only detach, `killExisting` spares it; with the default keep-alive the next session takes it over. Verified on SP21: attached, `create_project` and `get_project_info` ran in it, `shutdown_codesys` left it running.
- `shutdown_codesys` with no tracked CODESYS killed every CODESYS of the install as an "orphan", also one opened by hand or used by another live session. It now kills only CODESYS an MCP server started (named by a session dir) that no live server uses. `launch_codesys killExisting=true` follows the same rule: it no longer kills a CODESYS opened by hand.
- **Online tools work again (watcher 0.6.0).** Since the timer watcher (0.18.0) every online tool failed: from a timer tick no script is executing, and CODESYS's online layer then raises "Stack empty" in `create_online_application` / `create_online_device`. Offline tools were unaffected, so it went unnoticed. Such commands now run through the IDE's own "Execute Script File" (`CommandHelper.ExecuteScript`) via a runner script; the rest keep the fast path. Verified against a local soft PLC: connect, download, start/stop, application state, running version, online boot application.
- Routing never guesses the install for a project whose saved version cannot be read. CODESYS also saves projects in a binary format that is not a ZIP (many real projects, and everything `projects.create` writes); the version then comes from `.codesys-version` or library.md, else CODESYS reads it from a throwaway copy (opened non-primary without updates, saved profile asked from the object manager; works across SPs, e.g. SP22 reads an SP19 project), and only when that fails the call asks for `install`. `create_project` writes a `.codesys-version` pin next to a new project.
- `read_running_version_ssh` / `restart_runtime_ssh` work on WAGO PFC200/CC100 and through `~/.ssh/config` aliases (ProxyJump to PLCs behind a jump host). The version read fetches the boot app with `cat` and picks its strings locally (WAGO BusyBox has no `strings`) and finds the WAGO boot-app path by itself. The restart uses key auth through the system ssh when no password is given, and restarts the systemd unit, else the `/etc/init.d` script (stop+start), else WAGO's `/etc/init.d/runtime`; the liveness probe falls back from `ss` to `netstat`. Verified on two lab WAGO PFC200s.
- `launch_codesys_with_project` opens the project in the install it was saved with (it used the default install, so an SP21 project opened in SP22).
- `rebind_device_to_scan_result`: a `matchName`/`matchDeviceId` that matches nothing never binds to "the only scan candidate" (on the office network that was the lab VM's Virtual Control, not the PLC asked for). Scan and rebind work on a never-connected project (local gateway); online tools accept a device bound by IP (no node address).
- `verify_device_reachable` re-scans before calling a PLC unreachable (UDP scans are lossy); `download_to_device`'s pre-flight refused a reachable PLC.
- Device credentials reach every online tool: `ensure_online_connection` registers them before login, from the tool's `deviceUser`/`devicePassword`, else the credentials given earlier in the session for that project, else `CODESYS_DEVICE_USER`/`CODESYS_DEVICE_PASSWORD`. Before, a PLC with user management popped "Device User Logon" for every online tool but connect/download and the call hung. `add_device_user` takes `deviceUser`/`devicePassword` and explains a password-policy refusal.
- `rebind_device_to_scan_result` and `verify_device_reachable` re-scan before giving up (UDP scans are lossy). Rebind never binds to "the only scan result": without criteria it uses the PLC the device was bound to before, else refuses.
- `update_device_type` / `add_device` without a version pick the device description that fits the running CODESYS, not the newest (the device repository is shared by every install; an SP18 project switched to 3.5.22.10 no longer logged in to a 3.5.18 PLC).
- `verify_device_reachable` reports a device bound by IP as reachable-unconfirmed instead of unreachable (no node address to find in a scan), so `download_to_device` no longer refuses it.
- Online tools report the real login refusal (credentials, version mismatch) instead of a TypeError from an unsupported call shape.
- Takeover skips a CODESYS whose watcher is older than 0.6.0 (its online tools would fail) and starts a fresh one next to it.
- `source_download` refuses unsaved changes instead of hanging on CODESYS's save prompt; `start_stop_application` reports an application already in the asked state as success.
- Several CODESYS of the same install: a running instance that cannot be taken over no longer blocks the launch, another one starts next to it (verified with three SP21 instances). `--single-instance` restores the refusal.
- `launch_codesys killExisting=true` no longer kills a CODESYS another live MCP session uses.
- `create_project` builds the project by script in the current storage format instead of copying `Templates/Standard.project`. Those templates are stored in an old format (SP18/SP19: CoDeSys V3.1 with a PLCWinNT device, SP21/SP22: SP19 Patch 4), and CODESYS popped a storage-upgrade prompt that hung the call (and on SP21/SP22 later tools such as `create_redundancy_config`). The prompt bypasses the script prompt handler. Default device CODESYS Control Win V3 x64, in the version of the running CODESYS when installed.
- SP22 compiles in only one CODESYS at a time (one licence seat per PC): a second instance gets "No active license has been found". Compile results now say which other PID holds the seat.
- Live tool matrix (`tests/live/tool-matrix.mjs`): every offline tool against a fresh project on one install, `--online` adds the online tools against a local soft PLC. Run on SP18, SP19, SP21 and SP22; the fixes below came out of it.
- `get_compiler_version` / `set_compiler_version_to_newest` call `project.project_settings`, where the API is (SP21+); they always answered "not available" before, and `list_project_libraries` never recorded the compiler version. SP18 and SP19 have no such call; there all three use CODESYS's internal compiler-version manager.
- `get_signature_crc` passes the application the API requires (it failed on every SP).
- `add_library` accepts a bare title (`Util`): `find_library` only takes `Title, version (Company)` on every SP, not only SP22.
- `set_symbol_access` / `set_signature_access_bulk` accept `Application.X` and `X`; the symbol configuration lists the application's own POUs without the prefix.
- `grant_object_access` uses the shared path resolver (`Application/PLC_PRG` failed at the root).
- `import_text_list_file` names the expected file layout when CODESYS cannot read it.
- `import_plcopen_xml` has `parentObjectPath` to import under an object (e.g. back into `Application`).
- `set_nvl_sender`, `create_nvl_receiver`, `create_redundancy_config` work on SP18: when the script engine refuses importing CODESYS assemblies, the new `net_access` helper uses .NET reflection.
- Device lookup (`add_device`, `update_device_type`, `create_project`): an exact name match wins over newer substring matches (`Ethernet` picked an EtherNet/IP device).
- Project lock guard: a project another CODESYS has open (its `<name>.~u` lock) is refused with the owner named instead of hanging on CODESYS's modal read-only prompt; a stale lock from a killed CODESYS is removed.
- **19 new tools from the scripting API**, found by diffing the live SP19 `system.dump_scripting_api()` against the existing tools (126 tools now): `compare_projects`, `get_plc_settings` / `set_plc_settings`, `get_text_lines` / `edit_text_lines`, `get_build_properties` / `set_build_properties`, `open_project_archive`, `install_device_description` / `find_device_description` / `remove_device_description`, `plug_device` / `unplug_device`, `get_library_reference` / `set_library_reference`, `download_missing_libraries`, `create_persistent_vars`, `create_interface`, `create_action`. Details in [docs/tools.md](docs/tools.md).
- `configure_task` sets the task watchdog (enabled, time + unit, sensitivity) and core binding; `list_tasks` shows the watchdog and reads the task properties that exist (`kind_of_task`, `interval_unit`, `event`, `core_binding` instead of `cycle_time`, `task_type`, `watchdog_enabled`).
- The API dump lists interfaces that not every SP implements: SP19 has no `create_persistentvars` or `download_missing_libraries`; those tools answer "not available on this CODESYS version". Project-wide defines are left out on purpose: on SP21/SP22 the scripting setter reads back but does not survive save + reopen.
- `edit_text_lines` checks every `expect` guard and overlap before writing anything and rewrites only the touched lines; `compare_projects` and `open_project_archive` always open with NoUpdates and never save the other project.
- **Editor-view flush off by default.** The close + reopen of the project before every 20th edit (added 2026-07-22 against editor views piling up) is no longer needed with the timer watcher: 130-390 scripted edits per install (line edits, `set_pou_code`, create/delete) on SP18, SP19, SP21 and SP22 opened no editor tabs and kept GDI/USER handles flat. `CODESYS_EDITOR_FLUSH_THRESHOLD=N` turns it back on. Probe: `tests/live/editor-views-live.mjs`.
- Live test `tests/live/api-gaps-live.mjs`: drives the built server over MCP against a real CODESYS on scratch copies.

## 0.19.0 - 2026-10-05

- **Codesys-MCP-Master: one server for every installed CODESYS.** Without `--codesys-path` the server detects all installs, and each tool call picks one: the project file's saved version (never another SP, not even when the `install` argument names one), else the `install` argument, else the install used last. A machine with SP19, SP21 and SP22 needs one MCP entry instead of three.
- New options `--installs`, `--additional-folder SP<n>=<dir>` and `--default-install`. `--print-config` prints the single entry, and `get_codesys_status` lists every install. `--codesys-path` still binds a server to one install.
- Renamed to `codesys-mcp-master` (npm package, command and GitHub repo). The `codesys-mcp-sp21-plus` command still works. The suggested MCP entry name is `codesys-master` (tools show as `mcp__codesys-master__*`).
- **CODESYS stays open between sessions and is taken over.** When the MCP stops, its CODESYS windows stay open (`--no-keep-alive` closes them as before). The next session's launch finds the old session whose watcher still answers and takes that CODESYS over instead of refusing to start a second one: live, a new session took over a running SP21 in 2 s instead of a 124 s fresh start. A CODESYS opened by hand has no watcher and is never taken over. `shutdown_codesys` still closes it.
- Every command waits at least the timeout floor, headless mode included.
- Release workflow publishes with npm 11 (trusted publishing needs 11.5.1 or newer).
- Docs: README cut down to the essentials, install and development details moved to `docs/installation.md` and `docs/development.md`, new comparison with the CODESYS SP22 MCP server in `docs/vs-codesys-sp22-mcp.md`.

## 0.18.0 - 2026-10-05

- **Timer watcher.** The watcher is a WinForms timer on the UI thread instead of a `--runscript` loop that never returned. The CODESYS menus stay usable while the MCP is connected, and on SP22 the CODESYS-shipped MCP server can be switched on in the same IDE. Verified on SP19, SP21 and SP22.
- `get_codesys_status` reports the real CODESYS PID, not the cmd.exe it is spawned through. `shutdown_codesys` closes CODESYS itself.
- `launch_codesys killExisting=true` force-kills a CODESYS that does not close within 2 s.
- `create_project` closes an open clean project first instead of failing, and refuses when it has unsaved changes.
- Timeouts: every command waits at least 180 s (was 60 s), `--timeout` is now applied, `open_project` and `create_project` get 180 s.
- `rebind_device_to_scan_result` falls back to the local gateway when the project carries a gateway Guid from another machine.
- New tool `create_redundancy_config` (Redundancy Configuration without the GUI editor).
- `release_project_version`: real line breaks and the full file list in release commits.
- `remove_pou_from_task` removes the call as a task child object first.
- `create_symbol_config` passes the application path as a Python literal.
- Login-dialog prompts removed from tool output and descriptions (injected device credentials suppress the dialog).
- `package.json` no longer has a UTF-8 BOM, which broke vitest config loading.

## 0.17.1 - 2026-09-08

- Struct device parameters, and a sturdier watcher: an outer guard catches a CODESYS Cancel that lands between the per-iteration handlers, which used to leave every later call timing out.
- CODESYS compiler operator names (SIN, DIV, MIN, ...) are blocked as identifiers.
- README slimmed to a landing page, reference content moved to `docs/`. Tool count corrected to 106.

## 0.17.0 - 2026-09-03

- New tools `set_nvl_sender` and `create_nvl_receiver`, proven live on a two-device project.
- `ensure_project_open` refuses to switch away from a project with unsaved changes instead of silently saving it.
- `mirror_export` prunes stale `.st` files and empty directories.
- `remove_pou_from_task` verifies the removal on a freshly read task.
- `set_device_parameter` writes array and struct parameters via `elementIndex` or a whole-array literal.

## 0.16.1 - 2026-09-01

- Multi-device projects, round 2: `applicationPath` on the task, library, symbol, `create_*` and device tools; discovery looks in the active application first.
- `set_symbol_access` / `set_signature_access_bulk` resolve SymbolAccess by member name on the real enum type (SP19 rejects the integer form).

## 0.16.0 - 2026-09-01

- Multi-device projects: new tools `list_applications` and `set_active_application`, and `applicationPath` on all application-scoped tools.

## 0.15.0 - 0.15.4 - 2026-07-24 to 2026-09-01

- 0.15.0: `--codesys-additional-folder`, so installs managed by CODESYS Installer get their plugins.
- 0.15.1: `pou-dump.md` no longer goes missing when a POU contains non-ASCII text.
- 0.15.2: watcher ready timeout raised from 60 s to 150 s for installs with slow plugins.
- 0.15.3: `release_project_version` keeps hand-maintained `library.md` sections when it regenerates the file.
- 0.15.4: generated docs use a single hyphen in headings; npm trusted-publishing release workflow (tag-triggered).

## 0.14.0 - 2026-07-24

- **Version pin:** refuses to save a project on a mismatched CODESYS install.
- `bump_project_version` writes a library manifest and `sDriveFile` into the `_MCP_PROJECT_VERSION` GVL.
- `release_project_version` no longer corrupts the README or silently skips the Changelog.
- Device parameter tools reach host-side connector parameters.
- The editor-view flush logs off the device before closing, so it also works online.
- `create_pou` passes the return type for FUNCTIONs; `remove_pou_from_task` verifies the removal.

## 0.13.0 - 0.13.2 - 2026-07-17 to 2026-07-22

- 0.13.0: `create_pou` / `create_method` accept `declarationCode` / `implementationCode`; full IEC keyword guard.
- 0.13.1: editor-view pressure guard (closes and reopens the project every N edits).
- 0.13.2: `import_native` takes an optional `parentObjectPath`; the per-user `.opt` file is removed between close and reopen.

## 0.12.0 - 0.12.5 - 2026-06-12 to 2026-07-16

- 0.12.0: 34 new tools for SP21 ScriptEngine coverage (project lifecycle and interop, application build, device and task configuration, project users).
- 0.12.1: build cleans `dist/scripts`; code-review fixes for path names and Python string-literal injection.
- 0.12.2: SP21 API drift fixes found in live verification (online change check, XML import/export, compiled-library extension, exclude-from-build, project users).
- 0.12.3: `source_download` fixes; online verification done on a PFC200 750-8216.
- 0.12.4: `bump_project_version` never overwrites a hand-maintained changelog and seeds from the latest `v*` tag.
- 0.12.5: `rebind_device_to_scan_result` accepts an IP-form `matchAddress`.

## 0.11.0 - 2026-06-12

- 12 online/runtime tools (SP21 ScriptOnline coverage).
- Parameter values containing `$` sequences are no longer mangled.

## 0.10.0 - 0.10.3 - 2026-05-18 to 2026-06-11

- 0.10.0: phobiCS-tui front end removed.
- 0.10.1: approve-gate removed; new tool `add_device`; UNC project paths rejected with a clear error.
- 0.10.2: the CODESYS MCP bridge process is cleaned up so it never orphans.
- 0.10.3: never falls back to headless `--noUI` in persistent mode; OpenAI Codex CLI setup documented.

## 0.9.0 - 0.9.14 - 2026-04-29 to 2026-05-15

- New tools: `remove_library`, network scan / verify / rebind with a download pre-flight, `add_device_user`, `grant_object_access`, `launch_codesys_with_project`, `update_device_type`, and a passthrough to the CODESYS-shipped MCP bridge (SP22.10+).
- `create_project` takes an optional `deviceName` and swaps the template's device.
- Symbol configuration: access values converted to the real enum type, auto-compile after symbol-modifying tools.
- Launcher: soft-fails on a same-install conflict, `killExisting` option, waits for killed processes, revalidates a stale refusal.
- No headless fallback by default; the project opens visibly in the IDE.

## 0.4.1 - 0.8.0 - 2026-04-26 to 2026-04-29

- **SP21+/SP22 compatibility:** the watcher no longer uses a background thread with `system.execute_on_primary_thread()`, which SP21 removed. This is why the fork exists.
- Watcher survives the CODESYS "Cancel" link (KeyboardInterrupt is caught).
- Fixes to upstream tools: `create_folder`, `compile_project` / `get_compile_messages`, `connect_to_device`, `ensure_project_open`, `set_pou_code`, `add_library`, `list_project_libraries`, `write_variable`, `download_to_device`.
- IEC reserved identifiers in declarations are refused.
- Version and release pipeline: `bump_project_version`, `read_running_version_online`, `release_project_version`, `mirror_export`.
- 10 Symbol Configuration tools; SSH tools `read_running_version_ssh` and `restart_runtime_ssh`.
- CLI: `--print-config`, `--inspect`, `--for-project`; `open_project` checks the project's profile before opening; launcher allows several different installs side by side.
- Device User credentials are pre-registered so the login dialog does not appear.
- phobiCS-tui terminal front end with an approve gate and inline live values (removed again in 0.10).

## 0.4.0 and earlier

- Upstream [luke-harriman/Codesys-MCP](https://github.com/luke-harriman/Codesys-MCP). 0.4.0 added 17 tools for compiler diagnostics, project authoring, runtime monitoring and library management.
