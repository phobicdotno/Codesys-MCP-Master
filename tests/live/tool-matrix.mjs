#!/usr/bin/env node
/**
 * Live test of every offline tool against a real CODESYS, through the real
 * MCP server (dist/bin.js) over stdio. One run = one CODESYS install.
 *
 *   node tests/live/tool-matrix.mjs --exe "C:\Program Files\CODESYS 3.5.18.50\CODESYS\Common\CODESYS.exe" \
 *        --profile "CODESYS V3.5 SP18 Patch 5" --work C:\t\matrix\sp18 [--additional-folder <dir>] \
 *        [--online]   also run the online tools against the local soft PLC (CODESYS Control Win V3)
 *
 * The project is created fresh by create_project (device "CODESYS Control
 * Win V3 x64"), so nothing outside --work is touched. The server
 * starts its own CODESYS (several instances per install are allowed) and
 * closes it at the end. Results: <work>/results.json and a PASS/FAIL line per
 * step on stdout.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const exe = arg('exe');
const profile = arg('profile');
const work = arg('work');
const addFolder = arg('additional-folder');
const deviceName = arg('device-name', 'CODESYS Control Win V3 x64');
const online = process.argv.includes('--online');
const only = arg('only'); // comma-separated step-name prefixes, for reruns
if (!exe || !profile || !work) {
  console.error('usage: --exe <CODESYS.exe> --profile <profile> --work <dir> [--online]');
  process.exit(2);
}

const P = path.join(work, 'proj', 'Matrix.project');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.dirname(P), { recursive: true });
const out = (f) => path.join(work, f);
const ver = (exe.match(/CODESYS (\d+\.\d+\.\d+\.\d+)/) ?? [])[1];
if (ver) fs.writeFileSync(path.join(path.dirname(P), '.codesys-version'), `${ver}\n`);

const results = [];
const log = (...a) => console.log(...a);
async function step(name, fn) {
  if (only && !only.split(',').some((o) => name.startsWith(o))) return;
  const t0 = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, note: note ?? '' });
    log(`PASS ${name}${note ? ' - ' + String(note).slice(0, 160) : ''}`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, note: e.message });
    log(`FAIL ${name} - ${e.message.replace(/\s+/g, ' ').slice(0, 600)}`);
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

const serverArgs = [path.join(repo, 'dist', 'bin.js'), '--codesys-path', exe, '--codesys-profile', profile,
  '--mode', 'persistent', '--no-auto-launch', '--no-keep-alive', '--ide-bridge', 'off', '--workspace', work];
if (addFolder) serverArgs.push('--codesys-additional-folder', addFolder);
// The SDK passes only a minimal default environment; CODESYS_DEVICE_USER/PASSWORD
// must reach the server for the online steps.
const transport = new StdioClientTransport({ command: process.execPath, args: serverArgs, env: { ...process.env }, stderr: 'ignore' });
const client = new Client({ name: 'tool-matrix', version: '1.0.0' });

async function call(name, args = {}, { expectError = false } = {}) {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 900_000 });
  const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
  if (expectError) {
    if (!r.isError) throw new Error(`${name}: expected an error, got success:\n${text.slice(0, 600)}`);
  } else if (r.isError) {
    // The useful part is the error, not the DEBUG preamble.
    const errs = text.split(/\r?\n/).filter((l) => /ERROR|Error|Exception|Traceback|refus|not found|failed/i.test(l));
    throw new Error(`${name} failed: ${errs.slice(0, 8).join(' | ').slice(0, 900)} || tail: ${text.slice(-400)}`);
  }
  return text;
}
const pp = { projectFilePath: P };
const APP = 'Application';

try {
  await client.connect(transport);
  log(`server up: ${exe} (${profile})`);

  // --- project lifecycle -------------------------------------------------
  await step('create_project', async () => {
    const t = await call('create_project', { filePath: P, deviceName });
    must(fs.existsSync(P), 'project file missing after create_project');
    return t.split('\n')[0];
  });
  await step('get_codesys_status', async () => {
    const t = await call('get_codesys_status');
    must(/ready/i.test(t), 'status is not ready');
    return (t.match(/PID:\s*\d+/) ?? [''])[0];
  });
  await step('get_project_info', async () => call('get_project_info', pp).then((t) => t.split('\n').slice(0, 2).join(' ')));
  await step('set_project_info', async () => {
    await call('set_project_info', { ...pp, company: 'MatrixCo', title: 'Matrix', version: '1.2.3.4', author: 'matrix' });
    const t = await call('get_project_info', pp);
    must(/MatrixCo/.test(t) && /1\.2\.3\.4/.test(t), `info not set: ${t.slice(0, 300)}`);
  });
  await step('list_applications', async () => {
    const t = await call('list_applications', pp);
    must(/Application/.test(t), 'no Application listed');
  });
  await step('set_active_application', async () => call('set_active_application', { ...pp, applicationPath: APP }).then(() => ''));
  await step('get_compiler_version', async () => call('get_compiler_version', pp).then((t) => t.split('\n')[0]));
  await step('set_compiler_version_to_newest', async () => call('set_compiler_version_to_newest', pp).then((t) => t.split('\n')[0]));

  // --- objects -----------------------------------------------------------
  await step('create_folder', async () => call('create_folder', { ...pp, folderName: 'MxFolder', parentPath: APP }).then(() => ''));
  await step('create_dut', async () => call('create_dut', { ...pp, name: 'ST_Mx', dutType: 'Structure', parentPath: APP }).then(() => ''));
  await step('create_gvl', async () => call('create_gvl', { ...pp, name: 'GVL_Mx', parentPath: APP,
    declarationCode: 'VAR_GLOBAL\n\tgnMx : INT;\n\tgbMx : BOOL;\nEND_VAR' }).then(() => ''));
  await step('create_pou FB', async () => call('create_pou', { ...pp, name: 'FB_Mx', type: 'FunctionBlock', language: 'ST', parentPath: APP,
    declarationCode: 'FUNCTION_BLOCK FB_Mx\nVAR_INPUT\n\tnIn : INT;\nEND_VAR\nVAR_OUTPUT\n\tnOut : INT;\nEND_VAR',
    implementationCode: 'nOut := nIn * 2;' }).then(() => ''));
  await step('create_pou PRG', async () => call('create_pou', { ...pp, name: 'PRG_Mx', type: 'Program', language: 'ST', parentPath: APP,
    declarationCode: 'PROGRAM PRG_Mx\nVAR\n\tfb : FB_Mx;\n\tnCount : INT;\nEND_VAR', implementationCode: 'nCount := nCount + 1;\nfb(nIn := nCount);\nGVL_Mx.gnMx := fb.nOut;' }).then(() => ''));
  await step('set_pou_code', async () => {
    await call('set_pou_code', { ...pp, pouPath: 'Application/PRG_Mx', implementationCode: 'nCount := nCount + 1;\nfb(nIn := nCount);\nGVL_Mx.gnMx := fb.nOut;\nGVL_Mx.gbMx := TRUE;' });
  });
  await step('create_method', async () => call('create_method', { ...pp, parentPouPath: 'Application/FB_Mx', methodName: 'MDouble', returnType: 'INT',
    declarationCode: 'METHOD MDouble : INT\nVAR_INPUT\n\tx : INT;\nEND_VAR', implementationCode: 'MDouble := x * 2;' }).then(() => ''));
  await step('create_property', async () => call('create_property', { ...pp, parentPouPath: 'Application/FB_Mx', propertyName: 'PValue', propertyType: 'INT' }).then(() => ''));
  await step('get_all_pou_code', async () => {
    const t = await call('get_all_pou_code', pp);
    must(/FB_Mx/.test(t) && /gbMx := TRUE/.test(t), 'new code not in get_all_pou_code');
  });
  await step('rename_object', async () => {
    await call('create_pou', { ...pp, name: 'FB_Tmp', type: 'FunctionBlock', language: 'ST', parentPath: APP });
    await call('rename_object', { ...pp, objectPath: 'Application/FB_Tmp', newName: 'FB_Tmp2' });
  });
  await step('move_object', async () => call('move_object', { ...pp, objectPath: 'Application/FB_Tmp2', newParentPath: 'Application/MxFolder' }).then(() => ''));
  await step('set_exclude_from_build', async () => {
    await call('set_exclude_from_build', { ...pp, objectPath: 'Application/MxFolder/FB_Tmp2', exclude: true });
    await call('set_exclude_from_build', { ...pp, objectPath: 'Application/MxFolder/FB_Tmp2', exclude: false });
  });
  await step('delete_object', async () => call('delete_object', { ...pp, objectPath: 'Application/MxFolder/FB_Tmp2' }).then(() => ''));

  // --- tasks -------------------------------------------------------------
  await step('list_tasks', async () => {
    const t = await call('list_tasks', pp);
    must(/MainTask/.test(t), 'MainTask not listed');
  });
  await step('create_task', async () => call('create_task', { ...pp, taskName: 'MxTask' }).then(() => ''));
  await step('configure_task', async () => call('configure_task', { ...pp, taskName: 'MxTask', kind: 'cyclic', priority: '5', interval: '50', intervalUnit: 'ms' }).then(() => ''));
  await step('add_pou_to_task', async () => call('add_pou_to_task', { ...pp, taskName: 'MainTask', pouName: 'PRG_Mx' }).then(() => ''));
  await step('remove_pou_from_task', async () => {
    await call('add_pou_to_task', { ...pp, taskName: 'MxTask', pouName: 'PRG_Mx' });
    await call('remove_pou_from_task', { ...pp, taskName: 'MxTask', pouName: 'PRG_Mx' });
    const t = await call('list_tasks', pp);
    must(/MainTask[\s\S]*PRG_Mx/.test(t), 'PRG_Mx no longer in MainTask');
  });

  // --- libraries ---------------------------------------------------------
  await step('list_project_libraries', async () => {
    const t = await call('list_project_libraries', pp);
    must(/Standard/i.test(t), 'Standard library not listed');
  });
  await step('add_library', async () => call('add_library', { ...pp, libraryName: 'Util' }).then((t) => t.split('\n')[0]));
  await step('remove_library', async () => call('remove_library', { ...pp, libraryName: 'Util' }).then((t) => t.split('\n')[0]));

  // --- build -------------------------------------------------------------
  await step('compile_project', async () => {
    const t = await call('compile_project', pp);
    must(!/[1-9]\d* error/i.test(t) || /0 error/i.test(t), `compile errors: ${t.slice(0, 800)}`);
    return (t.match(/\d+ error\(s\)?[^\n]*/i) ?? [t.split('\n')[0]])[0];
  });
  await step('get_signature_crc', async () => call('get_signature_crc', { ...pp, objectPath: 'Application/FB_Mx' }).then((t) => t.split('\n')[0]));
  await step('get_compile_messages', async () => call('get_compile_messages', pp).then((t) => t.split('\n')[0]));
  await step('application_build generate_code', async () => call('application_build', { ...pp, action: 'generate_code' }).then((t) => t.split('\n')[0]));
  await step('clean_all', async () => call('clean_all', pp).then(() => ''));
  await step('check_online_change', async () => call('check_online_change', pp).then((t) => t.split('\n')[0]));
  await step('create_boot_application offline', async () => {
    const t = await call('create_boot_application', { ...pp, outputPath: out('boot') });
    return t.split('\n')[0];
  });

  // --- NVL, redundancy, symbols ------------------------------------------
  await step('set_nvl_sender', async () => {
    await call('create_gvl', { ...pp, name: 'GVL_NvlTx', parentPath: APP, declarationCode: 'VAR_GLOBAL\n\tnTx : INT;\nEND_VAR' });
    await call('set_nvl_sender', { ...pp, gvlPath: 'Application/GVL_NvlTx', listIdentifier: 7, taskName: 'MainTask' });
  });
  await step('create_nvl_receiver', async () => {
    await call('create_nvl_receiver', { ...pp, receiverName: 'GVL_NvlRx', parentPath: APP,
      senderGvlPath: 'Application/GVL_NvlTx', taskName: 'MainTask', listIdentifier: 8 });
    // A receiver of a list the same application sends clashes on the list id
    // at compile time; it only proves the tool, so remove it again.
    await call('delete_object', { ...pp, objectPath: 'Application/GVL_NvlRx' });
  });
  await step('create_redundancy_config', async () => call('create_redundancy_config', { ...pp, parentPath: APP, taskName: 'MainTask' }).then((t) => t.split('\n')[0]));
  await step('find_symbol_config (none)', async () => call('find_symbol_config', pp).then((t) => t.split('\n')[0]));
  await step('create_symbol_config', async () => call('create_symbol_config', { ...pp, supportOpcUa: true }).then(() => ''));
  await step('get_symbol_config_settings', async () => call('get_symbol_config_settings', pp).then((t) => t.split('\n')[0]));
  await step('set_symbol_config_settings', async () => call('set_symbol_config_settings', { ...pp, contentFeatureFlags: ['SupportOPCUA', 'IncludeComments'] }).then(() => ''));
  await step('list_all_signatures', async () => {
    const t = await call('list_all_signatures', { ...pp, compile: true });
    must(/PRG_Mx/.test(t), 'PRG_Mx not among signatures');
  });
  await step('list_all_datatypes', async () => call('list_all_datatypes', { ...pp, compile: false }).then((t) => t.split('\n')[0]));
  await step('set_signature_access_bulk', async () => call('set_signature_access_bulk', { ...pp, signatureFqn: 'Application.PRG_Mx', access: 'ReadWrite' }).then(() => ''));
  await step('set_symbol_access', async () => call('set_symbol_access', { ...pp, signatureFqn: 'Application.PRG_Mx', variableName: 'nCount', access: 'ReadOnly' }).then(() => ''));
  await step('list_configured_symbols', async () => {
    const t = await call('list_configured_symbols', pp);
    must(/nCount/.test(t), 'nCount not configured');
  });
  await step('export_symbol_xsd', async () => {
    await call('export_symbol_xsd', { ...pp, outputFilePath: out('symbols.xsd') });
    must(fs.existsSync(out('symbols.xsd')), 'xsd not written');
  });

  // --- devices -----------------------------------------------------------
  await step('list_device_parameters', async () => call('list_device_parameters', pp).then((t) => t.split('\n')[0]));
  await step('get_device_identification', async () => call('get_device_identification', pp).then((t) => t.split('\n').slice(0, 2).join(' ')));
  await step('set_device_state simulation', async () => {
    await call('set_device_state', { ...pp, action: 'simulation_on' });
    await call('set_device_state', { ...pp, action: 'simulation_off' });
  });
  await step('add_device', async () => call('add_device', { ...pp, parentPath: 'Device', deviceName: 'Ethernet', targetDeviceName: 'Ethernet' }).then((t) => t.split('\n')[0]));
  // The Ethernet adapter has parameters (the Control Win device itself has
  // none): list, read one, write the same value back, read it again.
  await step('get/set_device_parameter', async () => {
    const dev = { ...pp, devicePath: 'Device/Ethernet' };
    const list = await call('list_device_parameters', dev);
    // Rows: "<scope> <id> <name> <value> [unit]", e.g.
    // "connector[1]:Common.Ethernet:host 0 IPAddress [192, 168, 0, 1]".
    const ip = list.match(/^\S+\s+\d+\s+IPAddress\s+(\[[^\]]*\])/m);
    must(ip, `no IPAddress parameter on Device/Ethernet: ${list.slice(0, 300)}`);
    const value = ip[1];
    const before = await call('get_device_parameter', { ...dev, parameterName: 'IPAddress' });
    await call('set_device_parameter', { ...dev, parameterName: 'IPAddress', value });
    const after = await call('get_device_parameter', { ...dev, parameterName: 'IPAddress' });
    const digits = (t) => (t.match(/\d+/g) ?? []).join('.');
    must(digits(after).includes(digits(value)), `value changed: before ${before.slice(0, 160)} after ${after.slice(0, 160)}`);
    return `IPAddress = ${value}`;
  });
  await step('export_io_mappings_csv', async () => {
    await call('export_io_mappings_csv', { ...pp, csvPath: out('io.csv') });
    must(fs.existsSync(out('io.csv')), 'csv not written');
  });
  await step('import_io_mappings_csv', async () => call('import_io_mappings_csv', { ...pp, csvPath: out('io.csv') }).then(() => ''));

  // --- users, text lists, image pools, external files ---------------------
  await step('list_project_users', async () => call('list_project_users', pp).then((t) => t.split('\n')[0]));
  await step('add_project_user', async () => call('add_project_user', { ...pp, userName: 'mxuser', password: 'mxpass' }).then(() => ''));
  await step('grant_object_access', async () => call('grant_object_access', { ...pp, objectPath: 'Application/PRG_Mx', groupName: 'Everyone' }).then((t) => t.split('\n')[0]));
  await step('remove_project_user', async () => call('remove_project_user', { ...pp, userName: 'mxuser' }).then(() => ''));
  await step('create_text_list', async () => call('create_text_list', { ...pp, name: 'TL_Mx' }).then(() => ''));
  await step('import_text_list_file', async () => {
    fs.writeFileSync(out('tl.txt'), 'ID\tDefault\ten\r\nT1\tHello\tHello\r\n');
    return call('import_text_list_file', { ...pp, textListPath: 'TL_Mx', importFile: out('tl.txt') }).then((t) => t.split('\n')[0]);
  });
  await step('create_image_pool', async () => call('create_image_pool', { ...pp, name: 'IP_Mx' }).then(() => ''));
  await step('add_external_file', async () => {
    fs.writeFileSync(out('ext.txt'), 'external\n');
    await call('add_external_file', { ...pp, filePath: out('ext.txt') });
  });

  // --- export / import ---------------------------------------------------
  await step('export_plcopen_xml', async () => {
    await call('export_plcopen_xml', { ...pp, exportPath: out('fb.xml'), objectPath: 'Application/FB_Mx' });
    must(fs.existsSync(out('fb.xml')), 'xml not written');
  });
  await step('import_plcopen_xml', async () => {
    await call('delete_object', { ...pp, objectPath: 'Application/FB_Mx' });
    await call('import_plcopen_xml', { ...pp, importPath: out('fb.xml'), parentObjectPath: 'Application' });
    const t = await call('get_all_pou_code', pp);
    must(/FB_Mx/.test(t), 'FB_Mx not back after import');
  });
  await step('export_native', async () => {
    await call('export_native', { ...pp, destination: out('fb.export'), objectPath: 'Application/FB_Mx' });
    must(fs.existsSync(out('fb.export')), 'native export not written');
  });
  await step('mirror_export', async () => {
    await call('mirror_export', { ...pp, mirrorRoot: out('mirror') });
    must(fs.existsSync(out('mirror')), 'mirror dir missing');
  });

  // --- versions ----------------------------------------------------------
  await step('bump_project_version', async () => {
    const t = await call('bump_project_version', { ...pp, level: 'build' });
    return t.split('\n')[0];
  });
  await step('save_project', async () => call('save_project', pp).then(() => ''));
  await step('save_project_archive', async () => {
    await call('save_project_archive', { ...pp, archivePath: out('Matrix.projectarchive') });
    must(fs.existsSync(out('Matrix.projectarchive')), 'archive missing');
  });
  await step('save_as_compiled_library', async () => {
    const t = await call('save_as_compiled_library', { ...pp, destination: out('Matrix.compiled-library') });
    return t.split('\n')[0];
  });
  await step('save_project_as', async () => {
    const p2 = path.join(work, 'proj2', 'Matrix2.project');
    fs.mkdirSync(path.dirname(p2), { recursive: true });
    if (ver) fs.writeFileSync(path.join(path.dirname(p2), '.codesys-version'), `${ver}\n`);
    await call('save_project_as', { ...pp, newPath: p2 });
    must(fs.existsSync(p2), 'save_project_as file missing');
    await call('close_project', { projectFilePath: p2, saveFirst: false });
  });
  await step('open_project', async () => call('open_project', { filePath: P }).then(() => ''));
  await step('update_device_type', async () => {
    const t = await call('update_device_type', { ...pp, targetDeviceName: deviceName });
    return t.split('\n')[0];
  });
  await step('import_native', async () => {
    await call('delete_object', { ...pp, objectPath: 'Application/FB_Mx' });
    await call('import_native', { ...pp, importPath: out('fb.export'), parentObjectPath: 'Application' });
  });

  // --- online (local soft PLC) -------------------------------------------
  if (online) {
    await step('scan_network_devices', async () => call('scan_network_devices', pp).then((t) => t.split('\n')[0]));
    // Always the local soft PLC by address: a scan on an office network also
    // finds other PLCs (the lab VM, PLCs on the bench), and the test must
    // never bind to one.
    await step('rebind_device_to_scan_result', async () => {
      // Exact name of the local soft PLC (it reports this PC's name); an
      // unmatched name never binds, so another PLC is never picked.
      const plcAddress = arg('plc-address');
      const t = await call('rebind_device_to_scan_result', plcAddress ? { ...pp, matchAddress: plcAddress } : { ...pp, matchName: arg('plc-name', os.hostname()) });
      must(/"rebound": true/.test(t), `not rebound: ${t.slice(-400)}`);
    });
    await step('verify_device_reachable', async () => call('verify_device_reachable', pp).then((t) => t.split('\n')[0]));
    await step('connect_to_device', async () => call('connect_to_device', pp).then((t) => t.split('\n')[0]));
    await step('download_to_device', async () => call('download_to_device', pp).then((t) => t.split('\n')[0]));
    await step('get_application_state', async () => call('get_application_state', pp).then((t) => t.split('\n')[0]));
    await step('start_stop_application start', async () => call('start_stop_application', { ...pp, action: 'start' }).then((t) => t.split('\n')[0]));
    await step('read_variable', async () => call('read_variable', { ...pp, variablePath: 'PRG_Mx.nCount' }).then((t) => t.split('\n')[0]));
    await step('read_variables', async () => {
      const t = await call('read_variables', { ...pp, expressions: ['GVL_Mx.gnMx', 'GVL_Mx.gbMx'] });
      must(!/read failed/i.test(t), `a value did not read: ${t.slice(0, 300)}`);
      return t.split('\n')[0];
    });
    await step('write_variable', async () => call('write_variable', { ...pp, variablePath: 'GVL_Mx.gbMx', value: 'FALSE' }).then((t) => t.split('\n')[0]));
    await step('write_variables', async () => call('write_variables', { ...pp, assignments: [{ expression: 'GVL_Mx.gbMx', value: 'TRUE' }] }).then((t) => t.split('\n')[0]));
    await step('force_variables', async () => call('force_variables', { ...pp, assignments: [{ expression: 'GVL_Mx.gnMx', value: '42' }] }).then((t) => t.split('\n')[0]));
    await step('list_forced_variables', async () => call('list_forced_variables', pp).then((t) => t.split('\n')[0]));
    await step('unforce_variables', async () => call('unforce_variables', pp).then((t) => t.split('\n')[0]));
    await step('read_running_version_online', async () => call('read_running_version_online', pp).then((t) => t.split('\n')[0]));
    await step('create_boot_application online', async () => call('create_boot_application', { ...pp, online: true }).then((t) => t.split('\n')[0]));
    await step('source_download', async () => {
      await call('save_project', pp); // it refuses unsaved changes
      return call('source_download', pp).then((t) => t.split('\n')[0]);
    });
    await step('source_upload', async () => call('source_upload', { ...pp, archivePath: out('upload.projectarchive') }).then((t) => t.split('\n')[0]));
    await step('plc_file_list', async () => call('plc_file_list', pp).then((t) => t.split('\n')[0]));
    await step('plc_file_transfer', async () => {
      fs.writeFileSync(out('up.txt'), 'matrix\n');
      await call('plc_file_transfer', { ...pp, direction: 'to_plc', localPath: out('up.txt'), plcPath: 'matrix_up.txt', forceOverwrite: true });
      await call('plc_file_transfer', { ...pp, direction: 'from_plc', localPath: out('down.txt'), plcPath: 'matrix_up.txt', forceOverwrite: true });
      must(fs.existsSync(out('down.txt')), 'file not downloaded back');
    });
    await step('plc_file_delete', async () => call('plc_file_delete', { ...pp, plcPath: 'matrix_up.txt' }).then((t) => t.split('\n')[0]));
    await step('reset_application warm', async () => call('reset_application', { ...pp, level: 'warm' }).then((t) => t.split('\n')[0]));
    await step('start_stop_application stop', async () => call('start_stop_application', { ...pp, action: 'stop' }).then((t) => t.split('\n')[0]));
    await step('disconnect_from_device', async () => call('disconnect_from_device', pp).then((t) => t.split('\n')[0]));
    // Last: on a fresh runtime the first device user switches user
    // management on, and every later login needs that user. A new user each
    // run, because setting a user's current password again is refused by the
    // runtime's password policy (PasswordPolicyError).
    await step('add_device_user', async () => call('add_device_user', { ...pp, userName: `mxu${Date.now() % 100000}`, userPassword: `Mx-${Date.now()}-a` }).then((t) => t.split('\n')[0]));
  }

  await step('get_user_selection', async () => call('get_user_selection').then((t) => t.split('\n')[0]));
  await step('launch_codesys (already running)', async () => call('launch_codesys').then((t) => t.split('\n')[0]));
  await step('release_project_version', async () => {
    // A local repo with no remote: push=false, so nothing leaves this PC.
    const dir = path.dirname(P);
    const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf-8' });
    git('init', '-q');
    git('config', 'user.name', 'matrix');
    git('config', 'user.email', 'matrix@example.invalid');
    git('add', '.codesys-version');
    git('commit', '-q', '-m', 'init');
    const t = await call('release_project_version', { ...pp, push: false });
    const tags = git('tag').trim();
    must(/^v/m.test(tags), `no v* tag after release: ${t.slice(0, 300)}`);
    return `tags: ${tags.replace(/\s+/g, ' ')}`;
  });
  await step('close_project', async () => call('close_project', { ...pp, saveFirst: true }).then(() => ''));
} finally {
  try { await call('shutdown_codesys'); } catch { /* ignore */ }
  try { await client.close(); } catch { /* ignore */ }
  const passed = results.filter((r) => r.ok).length;
  log(`\n${passed}/${results.length} passed (${profile})`);
  fs.writeFileSync(out('results.json'), JSON.stringify({ exe, profile, online, results }, null, 2));
  process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}
