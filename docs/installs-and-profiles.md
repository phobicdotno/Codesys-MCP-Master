# CODESYS Installs, Profiles and Version Pinning

## Multiple CODESYS installations

Since 0.19.0 **one server drives every installed CODESYS**. Register it without `--codesys-path`:

```json
{
  "mcpServers": {
    "codesys-master": {
      "command": "codesys-mcp-master",
      "args": ["--mode", "persistent", "--no-auto-launch"]
    }
  }
}
```

At startup it detects every `C:\Program Files\CODESYS 3.5.x.y` install (the same list `--detect` prints). Each tool call then picks one:

1. the install matching the **project file's saved version** (`projectFilePath` / `filePath`): the exact SP and patch, else the highest patch of the same SP. **Never another SP**: opening an SP21 project in SP22 converts it, so the call is refused, also when an `install` argument names another SP; a deliberate conversion is done by hand in the IDE. An `install` of the same SP picks that patch;
2. for calls without a project: the tool's optional **`install`** argument (`"SP21"`, `"21"`, `"SP21 Patch 5"`, `"3.5.21.50"` or the profile name), else
3. the install used by the previous call, else `--default-install`, else the newest install.

The saved version is read from the `.project` file when it is a ZIP. CODESYS also saves projects in a binary format with no readable version (many real projects, and everything `create_project` / `projects.create` writes). For those the version comes from a `.codesys-version` file next to the project, else library.md's version row. If neither exists and several installs are present, CODESYS reads it: the server copies the project to a temp folder, opens the copy as a non-primary project without updates in a running CODESYS (else the newest install), asks it for the saved profile, closes it and deletes the copy. The project you have open is not touched, and the answer is cached for the session until the file changes. Only when that fails too (a password-protected project, say) is the call refused and asks for `install`; guessing could open an SP19 project in SP22 and convert it on the next save. The install given is remembered for that project for the session. `create_project` writes a `.codesys-version` next to a new project.

Each install gets its own CODESYS process on first use; several run side by side. `get_codesys_status` lists all of them. The CODESYS SP22 MCP server's tools (`ide_*`) attach to the newest install that ships it.

Options:

- `--installs "19,21,22"` limits the server to these detected installs.
- `--additional-folder "SP19=<dir>"` sets the AdditionalFolders installation for one version (repeatable); see below for why it matters.
- `--default-install SP21` picks the install for calls that neither name one nor point at a project.

Notes:

- The version numbers (`3.5.21.50`, `3.5.22.10`) are the install directory names under `C:\Program Files\`; the marketing name is the profile (`CODESYS V3.5 SP21 Patch 5`).
- Never open the same `.project` from two CODESYS instances: the file lock pops a "project is currently in use" modal that blocks every script.
- **One server per install still works**: pass `--codesys-path` (and `--codesys-profile`) and the server is bound to that install only, exactly as before 0.19.0. `--print-config --sp <n>` prints such an entry.

If you have a specific `.project` file in mind and don't want to eyeball which install opens it, point `--for-project` at the file and `--print-config` will narrow the snippet to just the matching install (or warn and fall back to same-SP-different-patch if no exact match exists). The match is driven by the project's saved `projectinspectiondata.auxiliary` profile, so it works without launching CODESYS:

```bash
codesys-mcp-master --print-config --for-project "C:\path\to\MyMachine.project"
```

> **Caveat:** `--for-project` reads `projectinspectiondata.auxiliary` out of the project ZIP.
> That entry exists in `.projectarchive` files, but a plain **`.project` is not a ZIP** - it is a
> compressed CODESYS container (magic `23 89 ED 33`) with no readable profile string. On a plain
> `.project`, `--for-project` finds nothing and falls back to the default install. Use the version
> pin below to protect real projects.

## `--codesys-additional-folder`: where the add-on packages actually live

If launching produces *"The command line option 'runscript' has been set. However, there is no
script engine implementation available"*, or a load dialog that appears to contradict itself -

> The project file has been created with CODESYS V3.5 SP19 Patch 2 and contains data that cannot
> be loaded by CODESYS V3.5 SP19 Patch 2.

- the install has **multiple profiles sharing one name**.

The CODESYS Installer registers add-on packages (Script Engine, device support, ...) into a
per-installation directory:

```
<install>\CODESYS\AdditionalFolders\<InstallationName>\Profiles\<ProfileName>.profile.xml
```

Every one of those carries the *same* `<ProfileName>` as the bare base profile in
`<install>\CODESYS\Profiles\`, but a different set of registered plugins. So `--profile` alone is
ambiguous: CODESYS resolves it to the base profile, which on an installer-managed box can have
**zero** plugins. That's both symptoms above - no Script Engine, and "missing packages" phrased in
terms of a profile name that matches.

The shortcut the installer drops in the Start Menu passes the disambiguator; so must this server:

```jsonc
"--codesys-profile", "CODESYS V3.5 SP19 Patch 2",
"--codesys-additional-folder", "C:\\Program Files\\CODESYS 3.5.19.20\\CODESYS\\AdditionalFolders\\MyInstallation",
```

`--detect` / `--print-config` find this for you: they rank every `AdditionalFolders\*` by how many
plugins its profile registers and emit the fullest one. Installs with no `AdditionalFolders` (the stock
case - everything is in the base profile) get no flag, which is correct.

To check by hand, compare plugin counts across the same-named profiles:

```powershell
Get-ChildItem "C:\Program Files\CODESYS 3.5.19.20\CODESYS" -Recurse -Filter "*.profile.xml" |
  ForEach-Object { "{0,-4} {1}" -f (Select-String $_ -Pattern '<Hint>' -AllMatches).Matches.Count, $_.FullName }
```

## Version pin: never silently convert a project

Opening a project in a CODESYS **newer** than the one that authored it converts it on save. The
`.project` on disk is then no longer the software running on the device - and if that save happened
inside `release_project_version`, the wrong binary is already committed, tagged and pushed.

Because the authored version can't be read out of a `.project` (see the caveat above), it is pinned
in the repo instead. Two sources, most specific first:

1. **`.codesys-version`** next to the `.project` - one line, either `3.5.19.20` or
   `CODESYS V3.5 SP19`. `#` comments and blank lines are skipped. This is the only option when
   seeding a project that has no release history yet.
2. **`library.md`** - the `CODESYS Development System` row of a previously generated inventory.
   Every project gets a pin for free after its first release.

```bash
echo 3.5.19.20 > "C:\plc\MyVessel\.codesys-version"
```

The guard is deliberately asymmetric, so it protects the dangerous path without getting in the way:

| Tool | Pin matches | Pin differs | No pin |
|---|---|---|---|
| `bump_project_version`, `release_project_version` (**save** the project) | proceed | **refuse** | **refuse** |
| `get_project_info`, `mirror_export`, `list_project_libraries` (read only) | proceed | warn | proceed |

Both saving tools take `allowVersionUpgrade: true` to override when the conversion is deliberate.
Read-only tools never refuse - a warning is enough to stop a human before they run the release, and
refusing every read would break existing unpinned repos.

Note this is a *different* mechanism from the `open_project` pre-flight in `src/preflight.ts`, which
compares the ZIP-derived profile and therefore no-ops on plain `.project` files.
