#!/usr/bin/env node
/**
 * Live probe: do scripted edits pile up editor views / GUI handles when the
 * flush_editor_views workaround is off? Runs only the edit loop, logs GDI and
 * USER handles of the CODESYS process every N calls, and on a hang takes a
 * screenshot of every visible window of that process.
 *
 *   node tests/live/editor-views-live.mjs --exe <CODESYS.exe> --profile <profile> --work <dir> [--rounds 3]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const exe = arg('exe'); const profile = arg('profile'); const work = arg('work');
const rounds = Number(arg('rounds', '3'));
const A = path.join(work, 'E', 'Edit.project');
fs.rmSync(path.dirname(A), { recursive: true, force: true });
fs.mkdirSync(path.dirname(A), { recursive: true });
const ver = (exe.match(/CODESYS (\d+\.\d+\.\d+\.\d+)/) ?? [])[1];
fs.writeFileSync(path.join(path.dirname(A), '.codesys-version'), `${ver}\n`);

const client = new Client({ name: 'editor-views-live', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(repo, 'dist', 'bin.js'), '--codesys-path', exe, '--codesys-profile', profile, '--mode', 'persistent', '--no-auto-launch', '--no-keep-alive', '--workspace', work],
  env: { ...process.env, CODESYS_EDITOR_FLUSH_THRESHOLD: '0' },
  stderr: 'ignore',
});
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 900_000 });
  const t = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (r.isError) throw new Error(`${name}: ${t.slice(0, 800)}`);
  return t;
};
const ps = (script) => execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8' }).trim();
const gui = (pid) => {
  const o = ps(`Add-Type @"
using System; using System.Runtime.InteropServices;
public class GR { [DllImport("user32.dll")] public static extern uint GetGuiResources(IntPtr h, uint f); }
"@
$p = Get-Process -Id ${pid}; "{0} {1}" -f [GR]::GetGuiResources($p.Handle,0), [GR]::GetGuiResources($p.Handle,1)`).split(/\s+/);
  return `GDI ${o[0]} USER ${o[1]}`;
};
const shots = (pid, tag) => {
  try {
    return ps(`& '${path.join(here, 'winshot.ps1')}' -procId ${pid} -out '${path.join(work, tag)}'`);
  } catch (e) { return `screenshot failed: ${e.message}`; }
};

let pid = 0;
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
try {
  await client.connect(transport);
  await call('create_project', { filePath: A });
  pid = Number(((await call('get_codesys_status')).match(/PID:\s*(\d+)/) ?? [])[1]);
  await call('create_pou', { projectFilePath: A, name: 'ZZEdit', type: 'FunctionBlock', language: 'ST', parentPath: 'Application', declarationCode: 'FUNCTION_BLOCK ZZEdit\nVAR\n\tnA : INT;\nEND_VAR', implementationCode: 'nA := 1;' });
  log(`CODESYS PID ${pid}, start ${gui(pid)}`);
  let n = 0;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < 40; i++, n++) {
      const t0 = Date.now();
      await call('edit_text_lines', { projectFilePath: A, objectPath: 'Application/ZZEdit', operations: [{ op: 'insert', line: 1, text: `// tmp ${n}` }] });
      await call('edit_text_lines', { projectFilePath: A, objectPath: 'Application/ZZEdit', operations: [{ op: 'delete', line: 1, expect: `// tmp ${n}` }] });
      if (n % 10 === 0) log(`line edits ${2 * n}: ${gui(pid)} (${Date.now() - t0} ms per pair)`);
    }
    for (let i = 0; i < 20; i++) {
      await call('set_pou_code', { projectFilePath: A, pouPath: 'Application/ZZEdit', implementationCode: i % 2 ? 'nA := 1;' : 'nA := 2;' });
    }
    log(`round ${r + 1} after 20 set_pou_code: ${gui(pid)}`);
    for (let i = 0; i < 10; i++) {
      await call('create_pou', { projectFilePath: A, name: `ZZTmp${i}`, type: 'FunctionBlock', language: 'ST', parentPath: 'Application', implementationCode: '// tmp' });
      await call('delete_object', { projectFilePath: A, objectPath: `Application/ZZTmp${i}` });
    }
    log(`round ${r + 1} after 10 create/delete: ${gui(pid)}`);
  }
  log(`DONE: ${rounds * 130} scripted edits without a hang; end ${gui(pid)}`);
} catch (e) {
  log(`HANG/ERROR: ${e.message.split('\n')[0]}`);
  if (pid) log(`at failure: ${gui(pid)}\n${shots(pid, 'hang')}`);
  process.exitCode = 1;
} finally {
  try { await call('shutdown_codesys'); } catch { /* ignore */ }
  await client.close().catch(() => {});
}
