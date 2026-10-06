# SP21 ScriptEngine Full Functional Coverage — Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement phase-by-phase. Each phase is independently shippable (version bump + npm publish per phase). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the functional gap between the 56 existing MCP tools and the CODESYS V3.5 SP21 ScriptEngine API — every practically usable area gets a tool; license-gated/addon surfaces (SVN, Application Composer, Automation Server/Cas*, dongle licensing) are explicitly out of scope.

**Architecture:** Each tool = one IronPython 2.7 template in `src/scripts/<tool>.py` (`{PLACEHOLDER}` interpolation, `SCRIPT_SUCCESS:`/`SCRIPT_ERROR:` protocol, helpers prepended via `prepareScriptWithHelpers`) + one `s.tool(...)` registration in `src/server.ts` (zod schema) + one e2e script-preparation test in `tests/integration/e2e.test.ts`. No TS-side caching; scripts re-read from disk per call.

**Tech Stack:** TypeScript (MCP SDK, zod, vitest), IronPython 2.7 ScriptEngine templates. API authority: `C:\Program Files\CODESYS 3.5.21.50\CODESYS\ScriptLib\Stubs\scriptengine\*.pyi` for signatures, helpme-codesys.com ScriptEngine reference for semantics (cite section in each commit).

---

## Invariants (every tool, every phase)

- IronPython 2.7: ASCII-only source, no f-strings, `%` formatting, `json` can't dump IronPython `long` (cast via `int()`/`str()`), KeyboardInterrupt is not `Exception`.
- Online tools: helpers `['register_device_credentials', 'ensure_project_open', 'ensure_online_connection']`, then `ensure_logged_in(online_app)` before any online call (idempotent in persistent mode).
- Offline project tools: helpers `['ensure_project_open']` (+ `'find_object_by_path'` when resolving a tree path).
- Output protocol: human-readable `key: value` lines, then `SCRIPT_SUCCESS: <msg>` + `sys.exit(0)`; on exception `traceback.format_exc()` + `SCRIPT_ERROR: <msg>` + `sys.exit(1)`.
- server.ts: `resolvePath()` + `uncPathError()` guard on every file-path arg; `formatModifyingResponse(...)` for project-mutating tools (drives mirror export), plain text response for read-only/online tools.
- Per tool: e2e preparation test asserting helper inclusion + placeholder interpolation + `SCRIPT_SUCCESS` marker.
- Per tool: `npm run typecheck && npm test` green, then commit (`feat: add <tool> tool (<API> — helpme-codesys.com <section>)`) and push immediately. No batching.
- Live verification at end of each phase against a real SP21 instance (X33 / TestN2k projects) where hardware-independent; tools needing a PLC verified against the Pi/PFC200 when available.

## Phase 1 — Online/runtime ops (12 tools) — v0.11.0

API: `ScriptOnline.pyi` (`IScriptOnlineApplication`, `IScriptOnlineDevice`, file-transfer members). Docs: helpme-codesys.com → ScriptEngine → ScriptOnline.

| Tool | scriptengine call(s) | Params (zod) |
|---|---|---|
| `reset_application` | `online_app.reset(warm\|cold)` / `online_app.reset_origin()` | projectFilePath, level: 'warm'\|'cold'\|'origin' |
| `read_variables` | `online_app.read_values([exprs])` | projectFilePath, expressions: string[] |
| `write_variables` | `set_prepared_value()` ×N + `write_prepared_values()` | projectFilePath, assignments: {expression,value}[] |
| `force_variables` | `set_prepared_value()` ×N + `force_prepared_values()` | projectFilePath, assignments: {expression,value}[] |
| `unforce_variables` | `set_unforce_value()` ×N + `force_prepared_values()` / `unforce_all_values()` | projectFilePath, expressions?: string[] (omit = all) |
| `list_forced_variables` | `get_forced_expressions()` | projectFilePath |
| `create_boot_application` | `online_app.create_boot_application()` (online) or `app.create_boot_application(path)` (offline) | projectFilePath, outputPath?, online? |
| `source_download` | `online_device.source_download(...)` | projectFilePath |
| `source_upload` | `online_device.upload_source(...)` | projectFilePath, destinationPath |
| `plc_file_list` | `get_file_list_of_directory(dir)` | projectFilePath, plcDirectory? |
| `plc_file_transfer` | `download_file(local→plc)` / `upload_file(plc→local)` | projectFilePath, direction: 'to_plc'\|'from_plc', localPath, plcPath |
| `plc_file_delete` | `delete_file(path)` / `delete_directory(path)` | projectFilePath, plcPath, isDirectory? |

## Phase 2 — Project lifecycle & interop (12 tools) — v0.12.0

API: `ScriptProject.pyi` / `ScriptProjects.pyi`. Docs: ScriptEngine → ScriptProjects.

| Tool | scriptengine call(s) |
|---|---|
| `close_project` | `project.close()` (primary; guard dirty → save first unless force) |
| `save_project_as` | `project.save_as(path)` |
| `save_project_archive` | `project.save_archive(path, comment?, extra files?)` |
| `save_as_compiled_library` | `project.save_as_compiled_library(path)` |
| `export_plcopen_xml` | `project.export_xml(objects, path)` — whole app or objectPath subset |
| `import_plcopen_xml` | `project.import_xml(path, import_folder?)` |
| `export_native` | `project.export_native(objects, path)` |
| `import_native` | `project.import_native(path, parentPath?)` |
| `get_project_info` | `project.get_project_info()` → all fields |
| `set_project_info` | project_info values (company/title/version/author/description…) |
| `get_compiler_version` / `set_compiler_version` | `get_compilerversion()` / `set_compilerversion(...)` + `set_compilerversion_to_newest()` |
| `clean_all` | `project.clean_all()` |

## Phase 3 — Application/build & object ops (7 tools) — v0.13.0

API: `ScriptApplication.pyi`, `ScriptObject.pyi`.

| Tool | scriptengine call(s) |
|---|---|
| `generate_code` | `app.generate_code()` |
| `rebuild_application` | `app.rebuild()` |
| `clean_application` | `app.clean()` |
| `check_online_change` | `app.is_online_change_possible()` |
| `move_object` | `obj.move(new_parent, index)` |
| `get_signature_crc` | `obj.get_signature_crc()` |
| `set_exclude_from_build` | `obj.exclude_from_build` setter |

## Phase 4 — Devices & task config (11 tools) — v0.14.0

API: `ScriptDeviceObject.pyi`, `ScriptDeviceParameters.pyi`, `ScriptTaskConfigObject.pyi`, `ScriptExplicitConnectorObjects.pyi`.

| Tool | scriptengine call(s) |
|---|---|
| `list_device_parameters` | `device.connectors[..].parameters` walk |
| `get_device_parameter` | parameter `.value` read |
| `set_device_parameter` | parameter `.value` write |
| `export_io_mappings_csv` | `device.export_io_mappings_as_csv(path)` |
| `import_io_mappings_csv` | `device.import_io_mappings_from_csv(path)` |
| `set_device_enabled` | `device.enable()` / `device.disable()` |
| `set_simulation_mode` | `device.set_simulation_mode(...)` |
| `get_device_identification` | `device.get_device_identification()` + communication settings |
| `plug_module` / `unplug_module` | `device.plug(...)` / `device.unplug(...)` |
| `create_task` | `task_config.create_task(name)` + property init |
| `configure_task` | task `.priority/.interval/.kind_of_task/.watchdog/.event` setters |

## Phase 5 — Users & misc objects (8 tools) — v0.15.0

API: `ScriptUserManagement.pyi`, `ScriptTextListObject.pyi`, `ScriptImagePoolObject.pyi`, `ScriptExternalFileObject.pyi`.

| Tool | scriptengine call(s) |
|---|---|
| `list_project_users` | `project.user_management` users+groups |
| `add_project_user` / `remove_project_user` | user mgmt add/remove |
| `create_text_list` | text list create |
| `set_text_list_entries` | row add/update |
| `create_image_pool` / `add_image_to_pool` | image pool ops |
| `add_external_file` | external file object create/extract |

## Out of scope (deliberate)

- SVN integration (`ScriptSubversion`/`ScriptSvn*`) — Professional Developer Edition gate, untestable here (same gate as Git, see memory `codesys_git_license`).
- Application Composer (`ScriptApplicationComposer`, 190 methods) — addon product.
- Automation Server / Cloud (`ScriptCas*`, `ScriptAutomationServer`).
- Trace family (`ScriptTrace*`) — revisit on demand.
- Dongle-licensing members on `ScriptObject`.

## Status (2026-06-12)

- [x] Phase 1 — 12 online/runtime tools — shipped in v0.11.0 (commit 3a012a7)
- [x] Phase 2 — 13 project lifecycle/interop tools (commit fb7d886; `get_compiler_version`/`set_compiler_version_to_newest` instead of arbitrary set — the SP21 API only exposes set-to-newest)
- [x] Phase 3 — 5 tools (commit 44a58ff; generate_code/rebuild/clean folded into one `application_build` tool)
- [x] Phase 4 — 9 tools (commit 0f3bebe; `plug_module`/`unplug_module` DEFERRED — needs a module-slot test device to verify the call shape; enable/disable/simulation folded into `set_device_state`)
- [x] Phase 5 — 7 tools (`set_text_list_entries` replaced by `import_text_list_file` — row-level editing is fragile across SPs, the import-file path matches the IDE dialog)

Total tool count after all phases: 102. All phases verified by script-preparation tests (205 vitest tests) + typecheck; LIVE verification against a real SP21 CODESYS + PLC still pending — run the smoke list in TEST_OVERVIEW.md when the Pi/PFC200 is reachable.

Deferred follow-ups: plug/unplug_module, trace tools (`ScriptTrace*`), project compare (`compare_to`), `save_archive` extra categories/files, gateway management on ScriptOnline.

## Live verification — 2026-06-12, CODESYS V3.5 SP21 Patch 5, MCPTest2 copy

Verified working end-to-end (26 tools): get/set_project_info, save_project_as,
save_project_archive (85 MB archive), save_as_compiled_library (after setting
project-info Version), export/import_plcopen_xml (round-trip via delete),
export/import_native (round-trip), application_build (generate_code),
check_online_change, clean_all, close_project, create_task + configure_task
(VerifyTask, priority=5/t#50ms — confirms str-typed setters), create_folder +
create_pou + move_object, set_exclude_from_build, create_text_list,
create_image_pool, add_external_file, list_project_users,
get_device_identification, list_device_parameters, get/set_device_parameter
(round-trip 80→75), set_device_state (simulation on/off),
export/import_io_mappings_csv (round-trip).

Bugs found live and fixed (all stub-vs-runtime drift on SP21):
1. `is_online_change_possible` is a property, not a method (52f8746).
2. `export_xml` runtime overload is reporter-first → silent export-to-string;
   all-keyword call + fail-loud file check (d777832).
3. `import_xml` same reporter-first drift (29736e2).
4. Compiled-library default extension is `.compiled-library`, hyphen (1342ead).
5. `exclude_from_build` lives on `build_properties`, not flat on ScriptObject (dbb0c2f).
6. Project user modification needs a user-management login; auto-login as
   Owner + adminUser/adminPassword args (80ba96a).

Graceful-unsupported on SP21.50 (runtime predates scripting API 4.2.0.0
despite shipped stubs): get_compiler_version, set_compiler_version_to_newest —
both fail with the designed actionable message.

Correctly blocked: get_signature_crc needs a successful build; MCPTest2 carries
compiler version 3.5.22.0 which SP21 lacks, engine error is accurate.

add/remove_project_user verified live after reconnect (create + list +
remove round-trip). SP21 caveat: IScriptUser.change_password is removed
('no longer supported') and no replacement password API exists — the tool
creates the user, probes change/set/reset_password, and warns when the
password could not be set (set it in the IDE in that case).

## Online verification — 2026-06-12, WAGO PFC200 750-8216 @ 192.0.2.202, TestN2k_v1

All 12 online tools verified against the live PLC: read_variables /
write_variables (write 12.5/TRUE, read-back, restore), force_variables +
list_forced_variables + unforce_variables (force/list/unforce-all/verify-
clean), plc_file_list (root + PlcLogic), plc_file_transfer (to_plc +
from_plc, byte-identical round-trip), plc_file_delete (own marker file),
source_download (full archive onto PLC), source_upload (5 MB .prj
recovered), create_boot_application (on-device AND offline .app),
reset_application warm (state preserved), with connect/disconnect around it.

Live-found fix #8: device-level download_source on SP21 writes its temp
into Program Files (access denied) and the failed attempt leaves a locked
Archive.prj that breaks the app-level fallback — script now cleans the
stale archive and prefers the app-level call unless compact is requested.

Operational gotchas recorded: large-project does not compile on this
workstation (IoDrvModbusTCPSlave 4.3.0.0 + device descriptions missing,
visu profile outdated) — TestN2k_v1 used instead; close_project with an
active online session pops a modal dialog that hangs the watcher until
clicked (the IDE-dialog rule applies to close too, not just
connect/download); long source downloads exceed the per-call IPC timeout
while still completing — check the watcher log before assuming failure.

Remaining untested live: import_text_list_file only (needs a text-list
export file in the IDE dialog format — single documented API call,
same plumbing as the verified tools).
