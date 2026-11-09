#!/usr/bin/env node
/**
 * Live repro: does connect_to_device (login with OnlineChangeOption.Keep) download
 * when the project differs from the application on the PLC?
 *
 * Seen on a vessel PFC200 with SP19 (2026-11-09): connect_to_device logged
 * "login(Keep, False) succeeded (no download)", while the PLC log showed a full
 * download inside that login call and the application was left in STOP.
 *
 *   node tests/live/keep-login.mjs --exe "C:\Program Files\CODESYS 3.5.19.20\CODESYS\Common\CODESYS.exe" \
 *        --profile "CODESYS V3.5 SP19 Patch 2" --work C:\t\keep\sp19 --plc-log <soft PLC PlcLog.csv>
 *
 * Runs against the local soft PLC only (matched by this PC's name). Steps:
 *   A  create project, download, start         (baseline, the PLC runs version A)
 *   B  change PLC_PRG, save, NO download       (the project now differs)
 *   C  disconnect, connect_to_device (Keep)    (must not download)
 * Then reports the soft PLC log lines written during C and the application state.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
const plcLog = arg('plc-log');
if (!exe || !profile || !work || !plcLog) {
  console.error('usage: --exe <CODESYS.exe> --profile <profile> --work <dir> --plc-log <file>');
  process.exit(2);
}
const P = path.join(work, 'proj', 'Keep.project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.dirname(P), { recursive: true });
const ver = (exe.match(/CODESYS (\d+\.\d+\.\d+\.\d+)/) ?? [])[1];
if (ver) fs.writeFileSync(path.join(path.dirname(P), '.codesys-version'), `${ver}\n`);

const serverArgs = [path.join(repo, 'dist', 'bin.js'), '--codesys-path', exe, '--codesys-profile', profile,
  '--mode', 'persistent', '--no-auto-launch', '--no-keep-alive', '--ide-bridge', 'off', '--workspace', work];
const transport = new StdioClientTransport({ command: process.execPath, args: serverArgs, env: { ...process.env }, stderr: 'ignore' });
const client = new Client({ name: 'keep-login', version: '1.0.0' });
const pp = { projectFilePath: P };
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 900_000 });
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (r.isError) throw new Error(`${name} failed:\n${text.slice(-2500)}`);
  return text;
}
const logLen = () => fs.statSync(plcLog).size;
const logSince = (pos) => {
  const b = fs.readFileSync(plcLog);
  return b.subarray(pos).toString('utf8');
};
const debugLines = (t) => t.split(/\r?\n/).filter((l) => /login|Keep|download|state|WARN|prompt/i.test(l)).join('\n');

try {
  await client.connect(transport);
  log(`server up: ${exe}`);
  await call('create_project', { filePath: P, deviceName: 'CODESYS Control Win V3 x64' });
  await call('set_pou_code', { ...pp, pouPath: 'Application/PLC_PRG',
    declarationCode: 'PROGRAM PLC_PRG\nVAR\n\tnA : INT;\nEND_VAR', implementationCode: 'nA := nA + 1;' });
  await call('save_project', pp);
  const rb = await call('rebind_device_to_scan_result', { ...pp, matchName: arg('plc-name', os.hostname()) });
  if (!/"rebound": true/.test(rb)) throw new Error(`not rebound: ${rb.slice(-600)}`);

  log('--- A: download version A and start');
  await call('download_to_device', pp);
  await call('start_stop_application', { ...pp, action: 'start' });
  log('state after A:', (await call('get_application_state', pp)).split('\n')[0]);
  await call('disconnect_from_device', pp);

  log('--- B: change the code, save, no download');
  await call('set_pou_code', { ...pp, pouPath: 'Application/PLC_PRG',
    declarationCode: 'PROGRAM PLC_PRG\nVAR\n\tnA : INT;\n\tnB : INT;\nEND_VAR', implementationCode: 'nA := nA + 1;\nnB := nA * 2;' });
  await call('save_project', pp);

  log('--- C: connect_to_device (Keep)');
  const mark = logLen();
  const t = await call('connect_to_device', pp);
  log(debugLines(t) || t.slice(0, 3000));
  const during = logSince(mark);
  const dl = during.split(/\r?\n/).filter((l) => /download|online ?change|loaded via|stop|reset|bootproject/i.test(l));
  log(`soft PLC log during C: ${dl.length} download/stop lines`);
  log(dl.slice(0, 15).join('\n'));
  log('state after C:', (await call('get_application_state', pp)).split('\n')[0]);
  log(dl.some((l) => /download|online ?change/i.test(l)) ? 'RESULT: Keep login CHANGED THE PLC' : 'RESULT: Keep login did not download');
} catch (e) {
  log('FAIL', e.message);
} finally {
  try { await call('disconnect_from_device', pp); } catch { /* ignore */ }
  try { await call('shutdown_codesys'); } catch { /* ignore */ }
  await client.close().catch(() => {});
}
