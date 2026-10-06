#!/usr/bin/env node
/**
 * Live end-to-end test of the v0.20.0 scripting-API gap tools against a real
 * CODESYS, through the real MCP server (dist/bin.js) over stdio.
 *
 *   node tests/live/api-gaps-live.mjs --exe "C:\Program Files\CODESYS 3.5.22.10\CODESYS\Common\CODESYS.exe" \
 *        --profile "CODESYS V3.5 SP22 Patch 1" --work C:\t\apitest\sp22 [--source some.project] \
 *        [--device-name "CODESYS Control Win V3 x64"] [--additional-folder <dir>] [--devdesc-dir <dir>]
 *
 * --source copies an existing project to <work>/A and <work>/B (must be saved
 * in this --exe's version); without it a new project is created by
 * create_project with --device-name. All edits happen on those copies.
 * --devdesc-dir (default tests/live/devdesc) holds the throwaway
 * ApiTest*.devdesc.xml descriptions; they are installed and removed again.
 * The device repository (C:\ProgramData\CODESYS\Devices) is shared by every
 * install: never run two of these suites at once, or anything else that
 * imports/removes devices.
 *
 * The server launches its own CODESYS (another one of the same install may
 * run next to it, but on SP22 only one instance holds the compile licence); CODESYS_EDITOR_FLUSH_THRESHOLD=0 so editor views are NOT flushed,
 * which is what the editor-view measurement needs). Closes CODESYS at the end.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const exe = arg('exe');
const profile = arg('profile');
const work = arg('work');
const source = arg('source');
const deviceName = arg('device-name', 'CODESYS Control Win V3 x64');
const addFolder = arg('additional-folder');
const devdescDir = arg('devdesc-dir', path.join(here, 'devdesc'));
if (!exe || !profile || !work) {
  console.error('usage: --exe <CODESYS.exe> --profile <profile> --work <dir> [--source <project>]');
  process.exit(2);
}

const A = path.join(work, 'A', 'APITest.project');
const B = path.join(work, 'B', 'APITest.project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.dirname(A), { recursive: true });
fs.mkdirSync(path.dirname(B), { recursive: true });

const results = [];
const log = (...a) => console.log(...a);
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note: note ?? '' });
    log(`PASS ${name}${note ? ' - ' + note : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e.message });
    log(`FAIL ${name} - ${e.message}`);
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

const serverArgs = [path.join(repo, 'dist', 'bin.js'), '--codesys-path', exe, '--codesys-profile', profile,
  '--mode', 'persistent', '--no-auto-launch', '--no-keep-alive', '--workspace', work];
if (addFolder) serverArgs.push('--codesys-additional-folder', addFolder);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: serverArgs,
  env: { ...process.env, CODESYS_EDITOR_FLUSH_THRESHOLD: '0' },
  stderr: 'ignore',
});
const client = new Client({ name: 'api-gaps-live', version: '1.0.0' });

async function call(name, args = {}, { expectError = false } = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 900_000 });
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (expectError) {
    if (!r.isError) throw new Error(`${name}: expected an error, got success:\n${text.slice(0, 600)}`);
  } else if (r.isError) {
    throw new Error(`${name} failed:\n${text.slice(0, 1500)}`);
  }
  return text;
}

function guiResources(pid) {
  const ps = `Add-Type @"
using System; using System.Runtime.InteropServices;
public class GR { [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr h, uint f); }
"@
$p = Get-Process -Id ${pid}; "{0} {1}" -f [GR]::GetGuiResources($p.Handle,0), [GR]::GetGuiResources($p.Handle,1)`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf-8' }).trim().split(/\s+/);
  return { gdi: Number(out[0]), user: Number(out[1]) };
}

function windowShot(pid, file) {
  const ps = `Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr d, uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); public struct R { public int L, T, Ri, B; } }
"@
$h = (Get-Process -Id ${pid}).MainWindowHandle; $r = New-Object W+R; [void][W]::GetWindowRect($h, [ref]$r)
$b = New-Object System.Drawing.Bitmap ($r.Ri - $r.L), ($r.B - $r.T); $g = [System.Drawing.Graphics]::FromImage($b)
$d = $g.GetHdc(); [void][W]::PrintWindow($h, $d, 2); $g.ReleaseHdc($d); $b.Save('${file}')`;
  execFileSync('powershell', ['-NoProfile', '-Command', ps]);
}

// Build A. CODESYS's own license check sometimes fails the first build of a
// Control Win project ("No active license has been found") and passes the
// next one; retry once for that and only that.
async function compileOk() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await client.callTool({ name: 'compile_project', arguments: { projectFilePath: A } }, undefined, { timeout: 900_000 });
    const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
    if (/\b0 error/.test(text)) return;
    const errs = text.split('\n').filter((l) => l.startsWith('ERROR:'));
    const licenseOnly = errs.length > 0 && errs.every((l) => /licen[cs]e/i.test(l));
    if (!(licenseOnly && attempt === 1)) throw new Error(`${licenseOnly ? 'ENV (CODESYS license): ' : ''}compile failed:\n${text.slice(0, 1200)}`);
  }
}

const LINES_IMPL = ['nA := 1;', 'nB := 2;', 'nC := 3;', 'nD := 4;', 'nE := 5;'];
const LINES_DECL = 'FUNCTION_BLOCK ZZLines\nVAR\n\tnA : INT;\n\tnB : INT;\n\tnC : INT;\n\tnD : INT;\n\tnE : INT;\n\tnF : INT;\nEND_VAR';
const numbered = (text) => text.split('\n').filter((l) => /^\s*\d+\|/.test(l)).map((l) => l.replace(/^\s*\d+\| ?/, ''));

let pid = 0;
let plcPath = '';
let sp = 0;
try {
  await client.connect(transport);
  log(`server up: ${exe} (${profile})`);

  await step('setup projects A and B', async () => {
    // The copies are this install's version: pin it so saving tools may save.
    const ver = (exe.match(/CODESYS (\d+\.\d+\.\d+\.\d+)/) ?? [])[1];
    must(ver, `cannot read the CODESYS version from ${exe}`);
    for (const p of [A, B]) fs.writeFileSync(path.join(path.dirname(p), '.codesys-version'), `${ver}\n`);
    if (source) {
      fs.copyFileSync(source, A);
      fs.copyFileSync(source, B);
      await call('open_project', { filePath: A });
    } else {
      await call('create_project', { filePath: A, deviceName });
      await call('save_project', { projectFilePath: A });
      fs.copyFileSync(A, B);
    }
    const st = await call('get_codesys_status');
    pid = Number((st.match(/PID:\s*(\d+)/) ?? [])[1] ?? 0);
    sp = Number((profile.match(/SP(\d+)/) ?? [])[1] ?? 0);
    const plc = await call('get_plc_settings', { projectFilePath: A });
    plcPath = (plc.match(/Device:\s*(.+)/) ?? [])[1]?.trim() ?? '';
    must(plcPath, 'no PLC device name');
    return `CODESYS PID ${pid}, PLC device '${plcPath}'`;
  });

  await step('create test POU ZZLines', async () => {
    await call('create_pou', {
      projectFilePath: A, name: 'ZZLines', type: 'FunctionBlock', language: 'ST', parentPath: 'Application',
      declarationCode: LINES_DECL, implementationCode: LINES_IMPL.join('\n'),
    });
  });

  // ── PLC settings ──
  await step('get_plc_settings', async () => {
    const t = await call('get_plc_settings', { projectFilePath: A });
    must(/Behaviour for outputs on stop: \w+/.test(t), t);
    return t.split('\n').find((l) => l.startsWith('Behaviour')) ?? '';
  });
  await step('set_plc_settings round trip', async () => {
    const before = await call('get_plc_settings', { projectFilePath: A });
    const upd0 = /Update IOs while in stop: True/.test(before);
    const diag0 = /Enable diagnosis for devices: True/.test(before);
    const t = await call('set_plc_settings', { projectFilePath: A, updateIosWhileInStop: !upd0, enableDiagnosis: !diag0, alwaysUpdateVariables: 'only_if_unused' });
    must(t.includes(`Update IOs while in stop: ${!upd0 ? 'True' : 'False'}`), t);
    must(t.includes('Always update variables: OnlyIfUnused'), t);
    const back = await call('get_plc_settings', { projectFilePath: A });
    must(back.includes(`Enable diagnosis for devices: ${!diag0 ? 'True' : 'False'}`), back);
    await call('set_plc_settings', { projectFilePath: A, updateIosWhileInStop: upd0, enableDiagnosis: diag0, alwaysUpdateVariables: 'disabled' });
    const restored = await call('get_plc_settings', { projectFilePath: A });
    must(restored.includes(`Update IOs while in stop: ${upd0 ? 'True' : 'False'}`), restored);
    return 'changed, read back, restored';
  });
  await step('set_plc_settings refuses program without stopResetProgram', async () => {
    const before = await call('get_plc_settings', { projectFilePath: A });
    await call('set_plc_settings', { projectFilePath: A, outputsOnStop: 'program' }, { expectError: true });
    const after = await call('get_plc_settings', { projectFilePath: A });
    must(before === after, 'settings changed despite refusal');
  });

  // ── text lines ──
  await step('get_text_lines', async () => {
    const t = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    const got = numbered(t);
    must(JSON.stringify(got) === JSON.stringify(LINES_IMPL), `got ${JSON.stringify(got)}`);
    const part = numbered(await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines', startLine: 2, lineCount: 2 }));
    must(JSON.stringify(part) === JSON.stringify(['nB := 2;', 'nC := 3;']), `range got ${JSON.stringify(part)}`);
  });
  await step('edit_text_lines insert/replace/delete/append', async () => {
    await call('edit_text_lines', {
      projectFilePath: A, objectPath: 'Application/ZZLines', operations: [
        { op: 'insert', line: 1, text: '// top 1\n// top 2' },
        { op: 'replace', line: 3, text: 'nC := 30;', expect: 'nC := 3;' },
        { op: 'delete', line: 5, expect: 'nE := 5;' },
        { op: 'insert', line: 6, text: 'nF := 6;' },
      ],
    });
    const got = numbered(await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' }));
    const want = ['// top 1', '// top 2', 'nA := 1;', 'nB := 2;', 'nC := 30;', 'nD := 4;', 'nF := 6;'];
    must(JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
  });
  await step('edit_text_lines expect mismatch writes nothing', async () => {
    const before = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    await call('edit_text_lines', {
      projectFilePath: A, objectPath: 'Application/ZZLines', operations: [
        { op: 'insert', line: 1, text: '// must not appear' },
        { op: 'replace', line: 3, text: 'x;', expect: 'not the current text' },
      ],
    }, { expectError: true });
    const after = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    must(before === after, 'text changed despite expect mismatch');
  });
  await step('edit_text_lines refuses overlapping ops', async () => {
    await call('edit_text_lines', {
      projectFilePath: A, objectPath: 'Application/ZZLines', operations: [
        { op: 'replace', line: 2, count: 2, text: 'x;' }, { op: 'delete', line: 3 },
      ],
    }, { expectError: true });
  });
  await step('edit_text_lines on the declaration + compile', async () => {
    await call('edit_text_lines', {
      projectFilePath: A, objectPath: 'Application/ZZLines', part: 'declaration',
      operations: [{ op: 'replace', line: 8, text: '\tnF : INT := 6;', expect: '\tnF : INT;' }],
    });
    const d = numbered(await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines', part: 'declaration' }));
    must(d[7] === '\tnF : INT := 6;', `decl line 8 = ${JSON.stringify(d[7])}`);
    await compileOk();
  });

  // ── task watchdog ──
  await step('configure_task watchdog + list_tasks', async () => {
    const tl = await call('list_tasks', { projectFilePath: A });
    const task = (tl.match(/Task:\s*(\S+)/) ?? [])[1];
    must(task, 'no task found');
    await call('configure_task', { projectFilePath: A, taskName: task, watchdogEnabled: true, watchdogTime: '100', watchdogTimeUnit: 'ms', watchdogSensitivity: '2' });
    const on = await call('list_tasks', { projectFilePath: A });
    must(on.includes('watchdog=on, 100 ms, sensitivity 2'), on);
    await call('configure_task', { projectFilePath: A, taskName: task, watchdogEnabled: false });
    const off = await call('list_tasks', { projectFilePath: A });
    must(new RegExp(`Task: ${task}[\\s\\S]*?watchdog=off`).test(off), off);
    return `task ${task}`;
  });

  // ── build properties ──
  await step('build properties link always round trip', async () => {
    const g = await call('get_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    must(/link_always: False/.test(g), g);
    const s = await call('set_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines', linkAlways: true });
    must(/link_always: True/.test(s), s);
    await call('set_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines', linkAlways: false });
    const back = await call('get_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    must(/link_always: False/.test(back), back);
    return 'set, read back, restored';
  });
  await step('set_build_properties refuses a property that does not apply', async () => {
    const g = await call('get_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    const na = ['compiler_defines', 'external', 'enable_system_call'].find((p) => new RegExp(`${p}: n/a`).test(g));
    if (!na) return 'skipped: every property applies to a POU on this version';
    const argName = { compiler_defines: 'compilerDefines', external: 'external', enable_system_call: 'enableSystemCall' }[na];
    await call('set_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines', [argName]: na === 'compiler_defines' ? 'X' : true }, { expectError: true });
    return `${na} refused`;
  });
  await step('settings persist across close + reopen', async () => {
    // A setter can read back fine in memory and still not be stored
    // (project_defines on SP21/SP22 did exactly that), so check the file.
    const plc0 = await call('get_plc_settings', { projectFilePath: A });
    const upd0 = /Update IOs while in stop: True/.test(plc0);
    const task = ((await call('list_tasks', { projectFilePath: A })).match(/Task:\s*(\S+)/) ?? [])[1];
    const libs = (await call('get_library_reference', { projectFilePath: A })).split(/\n(?=Library: )/).filter((b) => b.startsWith('Library: '));
    const lib = libs.find((b) => /placeholder=False managed=True system=False/.test(b)) ?? libs[0];
    const libName = lib.match(/Library: (.+)/)[1].trim();
    const q0 = /qualified_only=True/.test(lib);
    await call('set_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines', linkAlways: true });
    await call('set_plc_settings', { projectFilePath: A, updateIosWhileInStop: !upd0 });
    await call('configure_task', { projectFilePath: A, taskName: task, watchdogEnabled: true, watchdogTime: '150', watchdogTimeUnit: 'ms', watchdogSensitivity: '3' });
    await call('set_library_reference', { projectFilePath: A, libraryName: libName, qualifiedOnly: !q0 });
    const text0 = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    await call('close_project', { projectFilePath: A, saveFirst: false });
    await call('open_project', { filePath: A });
    const text1 = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    must(text0 === text1, `edited text differs after reopen:\n${text0}\n---\n${text1}`);
    const bp = await call('get_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    must(/link_always: True/.test(bp), `link_always lost after reopen:\n${bp}`);
    const plc = await call('get_plc_settings', { projectFilePath: A });
    must(plc.includes(`Update IOs while in stop: ${!upd0 ? 'True' : 'False'}`), `PLC setting lost after reopen:\n${plc}`);
    const tl = await call('list_tasks', { projectFilePath: A });
    must(tl.includes('watchdog=on, 150 ms, sensitivity 3'), `watchdog lost after reopen:\n${tl}`);
    const lr = await call('get_library_reference', { projectFilePath: A, libraryName: libName });
    must(lr.includes(`qualified_only=${!q0 ? 'True' : 'False'}`), `library option lost after reopen:\n${lr}`);
    await call('set_build_properties', { projectFilePath: A, objectPath: 'Application/ZZLines', linkAlways: false });
    await call('set_plc_settings', { projectFilePath: A, updateIosWhileInStop: upd0 });
    await call('configure_task', { projectFilePath: A, taskName: task, watchdogEnabled: false });
    await call('set_library_reference', { projectFilePath: A, libraryName: libName, qualifiedOnly: q0 });
    return 'link always, PLC setting, watchdog and library option all survived close + reopen';
  });

  // ── IEC objects ──
  await step('create_interface + create_action + compile', async () => {
    await call('create_interface', { projectFilePath: A, name: 'I_ZZTest', parentPath: 'Application' });
    await call('create_action', { projectFilePath: A, pouPath: 'Application/ZZLines', name: 'ZZAct', implementationCode: 'nA := nA + 1;' });
    const lines = numbered(await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines/ZZAct' }));
    must(lines[0] === 'nA := nA + 1;', `action body ${JSON.stringify(lines)}`);
    await compileOk();
  });
  await step('create_persistent_vars', async () => {
    const decl = 'VAR_GLOBAL PERSISTENT RETAIN\n\tzzCounter : UDINT;\nEND_VAR';
    const r = await client.callTool({ name: 'create_persistent_vars', arguments: { projectFilePath: A, name: 'ZZPersist', declarationCode: decl } }, undefined, { timeout: 900_000 });
    const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
    if (r.isError) {
      must(/not available/.test(text), text.slice(0, 800));
      return 'not available on this version, refused cleanly';
    }
    await compileOk();
    return 'created, compiles';
  });

  // ── libraries ──
  await step('library reference options + parameters', async () => {
    const all = await call('get_library_reference', { projectFilePath: A });
    const blocks = all.split(/\n(?=Library: )/).filter((b) => b.startsWith('Library: '));
    must(blocks.length > 0, all);
    const target = blocks.find((b) => /placeholder=False managed=True system=False/.test(b)) ?? blocks[0];
    const name = target.match(/Library: (.+)/)[1].trim();
    const q0 = /qualified_only=True/.test(target);
    const s = await call('set_library_reference', { projectFilePath: A, libraryName: name, qualifiedOnly: !q0 });
    must(s.includes(`qualified_only=${!q0 ? 'True' : 'False'}`), s);
    await call('set_library_reference', { projectFilePath: A, libraryName: name, qualifiedOnly: q0 });
    let note = `qualifiedOnly toggled on '${name}'`;
    const withParams = blocks.find((b) => /parameters: [1-9]/.test(b));
    if (withParams) {
      const ln = withParams.match(/Library: (.+)/)[1].trim();
      const pm = withParams.match(/\n {4}(\S+) = (.*)/);
      const r = await call('set_library_reference', { projectFilePath: A, libraryName: ln, paramName: pm[1], paramValue: pm[2].trim() });
      must(r.includes(`${pm[1]} = ${pm[2].trim()}`), r);
      note += `; parameter ${pm[1]} of '${ln}' written`;
    } else {
      await call('set_library_reference', { projectFilePath: A, libraryName: name, paramName: 'NoSuchParam', paramValue: '1' }, { expectError: true });
      note += '; no library with parameters here, unknown parameter refused';
    }
    return note;
  });
  await step('download_missing_libraries', async () => {
    const r = await client.callTool({ name: 'download_missing_libraries', arguments: { projectFilePath: A } }, undefined, { timeout: 900_000 });
    const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
    if (r.isError) {
      must(/not available/.test(text), text.slice(0, 800));
      return 'not available on this version, refused cleanly';
    }
    return text.split('\n')[0];
  });

  // ── compare ──
  await step('compare_projects A vs B', async () => {
    await call('create_pou', { projectFilePath: B, name: 'ZZCompareAdded', type: 'Program', language: 'ST', parentPath: 'Application' });
    const t = await call('compare_projects', { projectFilePath: A, otherProjectFilePath: B });
    must(t.includes('ZZCompareAdded'), t);
    must(t.includes('ZZLines'), t);
    must(/Changed objects: \d+/.test(t), t);
    const st = await call('get_project_info', { projectFilePath: A });
    must(st.length > 0, 'A not usable after compare');
    return (t.match(/Summary: (.+)/) ?? [])[1] ?? '';
  });

  // ── archive ──
  await step('open_project_archive round trip', async () => {
    const arch = path.join(work, 'arch', 'APITest.projectarchive');
    fs.mkdirSync(path.dirname(arch), { recursive: true });
    await call('save_project', { projectFilePath: A });
    await call('save_project_archive', { projectFilePath: A, archivePath: arch });
    must(fs.existsSync(arch), 'archive not written');
    const ext = path.join(work, 'ext');
    const o = await call('open_project_archive', { archiveFilePath: arch, targetDirectory: ext });
    const extProj = path.join(ext, 'APITest.project');
    must(fs.existsSync(extProj), `extracted project missing:\n${o}`);
    await call('open_project_archive', { archiveFilePath: arch, targetDirectory: ext }, { expectError: true });
    const cmp = await call('compare_projects', { projectFilePath: extProj, otherProjectFilePath: A });
    const n = Number((cmp.match(/Changed objects: (\d+)/) ?? [])[1] ?? -1);
    must(n >= 0, `no compare result:\n${cmp}`);
    // Code must be identical. Seen on SP18: Project Information and the
    // Task Configuration object report CONTENT_CHANGED after extraction
    // (SP19: 0 changes); reported, not failed.
    const rows = cmp.split('\n').filter((l) => /^(ADDED|DELETED|CONTENT_CHANGED|RENAMED|FOLDER_CHANGED|PROPERTIES_CHANGED|ACCESS_RIGHTS_CHANGED)/.test(l));
    const tolerated = /(Project Information|TaskConfiguration|Task Configuration)$/;
    const bad = rows.filter((l) => !tolerated.test(l.trim()));
    must(bad.length === 0, `archive copy differs from A:\n${cmp}`);
    await call('open_project', { filePath: A });
    return rows.length === 0 ? 'extracted copy identical to A; existing target refused'
      : `extracted copy has no code differences (only: ${rows.map((l) => l.trim().replace(/\s+/g, ' ')).join('; ')}); existing target refused`;
  });

  // ── device descriptions + plug/unplug ──
  const RACK = { deviceType: 8000, deviceId: '0000 4D52-A918', deviceVersion: '1.0.0.0' };
  const MOD = { deviceType: 8000, deviceId: '0000 4D52-A919', deviceVersion: '1.0.0.0' };
  const ONE = { deviceType: 8000, deviceId: '0000 4D52-A917', deviceVersion: '1.0.0.0' };
  await step('install + find device descriptions', async () => {
    for (const f of ['ApiTest', 'ApiTestRack', 'ApiTestModule']) {
      const t = await call('install_device_description', { filePath: path.join(devdescDir, `${f}.devdesc.xml`) });
      must(/Device: API test/.test(t), t);
    }
    for (const d of [ONE, RACK, MOD]) {
      const t = await call('find_device_description', d);
      must(/Installed: True/.test(t), t);
    }
  });
  await step('plug_device / unplug_device', async () => {
    // A WAGO PFC200 only accepts WAGO's own children (AllowOnly in its
    // device description), so the test rack goes under a CODESYS Control Win
    // PLC in a separate project C.
    const C = path.join(work, 'C', 'APITest.project');
    fs.mkdirSync(path.dirname(C), { recursive: true });
    const ver = (exe.match(/CODESYS (\d+\.\d+\.\d+\.\d+)/) ?? [])[1];
    fs.writeFileSync(path.join(path.dirname(C), '.codesys-version'), `${ver}\n`);
    await call('save_project', { projectFilePath: A });
    await call('create_project', { filePath: C });
    try {
      const cplc = ((await call('get_plc_settings', { projectFilePath: C })).match(/Device:\s*(.+)/) ?? [])[1]?.trim();
      must(cplc, 'no PLC device in project C');
      await call('add_device', { projectFilePath: C, parentPath: cplc, deviceName: 'TestRack', targetDeviceName: 'API test rack' });
      const p = await call('plug_device', { projectFilePath: C, parentPath: `${cplc}/TestRack`, slotIndex: 1, name: 'TestMod1', ...MOD });
      must(/TestMod1 \(type 8000 id 0000 4D52-A919 version 1\.0\.0\.0\)/.test(p), p);
      await call('plug_device', { projectFilePath: C, parentPath: `${cplc}/TestRack`, slotIndex: 9, name: 'X', ...MOD }, { expectError: true });
      const u = await call('unplug_device', { projectFilePath: C, devicePath: `${cplc}/TestRack/TestMod1` });
      must(/Unplugged/.test(u) && /slot #1 is <Empty>/.test(u), u);
      await call('delete_object', { projectFilePath: C, objectPath: `${cplc}/TestRack` });
      return `under '${cplc}': plugged into slot 1, bad slot refused, unplugged, rack removed`;
    } finally {
      try { await call('close_project', { projectFilePath: C, saveFirst: false }); } catch { /* not open */ }
      await call('open_project', { filePath: A });
    }
  });
  await step('remove device descriptions', async () => {
    for (const d of [MOD, RACK, ONE]) {
      await call('remove_device_description', d);
      const t = await call('find_device_description', d);
      must(/Installed: False/.test(t), t);
    }
    await call('remove_device_description', ONE, { expectError: true });
  });

  // ── editor views (flush disabled) ──
  await step('editor views: 80 line edits + 20 set_pou_code + 10 create/delete, flush disabled', async () => {
    const text0 = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    await compileOk();
    const before = guiResources(pid);
    for (let i = 0; i < 40; i++) {
      await call('edit_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines', operations: [{ op: 'insert', line: 1, text: `// tmp ${i}` }] });
      await call('edit_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines', operations: [{ op: 'delete', line: 1, expect: `// tmp ${i}` }] });
    }
    // The tools the flush_editor_views workaround was built for: whole-text
    // set_pou_code and object creation.
    const impl0 = numbered(await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' })).join('\n');
    for (let i = 0; i < 20; i++) {
      await call('set_pou_code', { projectFilePath: A, pouPath: 'Application/ZZLines', implementationCode: i % 2 === 0 ? `${impl0}\n// set ${i}` : impl0 });
    }
    for (let i = 0; i < 10; i++) {
      await call('create_pou', { projectFilePath: A, name: `ZZTmp${i}`, type: 'FunctionBlock', language: 'ST', parentPath: 'Application', implementationCode: '// tmp' });
      await call('delete_object', { projectFilePath: A, objectPath: `Application/ZZTmp${i}` });
    }
    const after = guiResources(pid);
    const shot = path.join(work, 'editor-views.png');
    try { windowShot(pid, shot); } catch { /* minimised window: numbers still count */ }
    const grew = { gdi: after.gdi - before.gdi, user: after.user - before.user };
    must(grew.gdi < 200 && grew.user < 100, `GUI resources grew: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    const text1 = await call('get_text_lines', { projectFilePath: A, objectPath: 'Application/ZZLines' });
    must(text0 === text1, `text not back to the start after 40 insert+delete pairs:\n${text0}\n---\n${text1}`);
    await compileOk();
    return `GDI ${before.gdi}->${after.gdi}, USER ${before.user}->${after.user}; text unchanged and builds; window shot ${shot}`;
  });
} catch (e) {
  log(`HARNESS ERROR: ${e.stack ?? e}`);
} finally {
  try { await call('shutdown_codesys'); } catch { /* ignore */ }
  try { await client.close(); } catch { /* ignore */ }
  const passed = results.filter((r) => r.ok).length;
  log(`\n${passed}/${results.length} passed (${profile})`);
  fs.writeFileSync(path.join(work, 'results.json'), JSON.stringify({ exe, profile, sp, results }, null, 2));
  process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}
