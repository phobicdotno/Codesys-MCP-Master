# This MCP vs the CODESYS SP22 MCP server

CODESYS 3.5 SP22 Patch 1 ships its own MCP server (an IDE plugin plus `CodesysMCPBridge.exe`). Quick comparison, as tested on 2026-10-05:

| | **This MCP** | **CODESYS SP22 MCP server** |
|---|---|---|
| CODESYS versions | SP18, SP19, SP21, SP22 (all installs from one server since 0.19.0) | SP22 Patch 1 and newer only |
| Tools | 127 | 19 |
| Scope | Whole workflow: project, code, build, online, download, release, git | Code assistant for the project that is already open |
| Open / save / create project | Yes | No |
| Online (login, download, variables, boot app) | Yes | No |
| Edits show live in the open editor | No | Yes |
| Starts CODESYS | Yes | No, CODESYS must be running |
| Needs to be switched on | No | Tools > Enable MCP Server, again after every CODESYS restart (in our test) |
| License | None | Separate CODESYS license ("CODESYS Development System MCP Server") |

**Its 19 tools:** read (project tree, ST content, regex and glob search, current selection, device and I/O configuration), write (create or replace ST objects, replace text, folder, remove object, add program call to task), check (pre-compile or full compile), libraries (add, list, documentation, find a type).

**Together:** with `--ide-bridge auto` (default) this server also publishes those 19 tools with an `ide_` prefix. Since the timer watcher (0.18.0) the CODESYS menus stay usable while this MCP is connected, so the CODESYS server can be switched on in the same IDE. The `ide_` tools have no project parameter and act on whatever project is open; this MCP's own tools check the project first.

**Do you need it?** No. This MCP covers everything it does. Its extras are the live editor view and the library documentation lookups.
