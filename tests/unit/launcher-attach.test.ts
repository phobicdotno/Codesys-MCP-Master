import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { CodesysLauncher } from '../../src/launcher';
import { buildAttachScript } from '../../src/attach';

// A CODESYS the user opened by hand and ran the attach script in. A dummy
// process plays that CODESYS (its PID goes into ready.signal), the mock
// watcher plays the watcher the attach script installed.

const children: ChildProcess[] = [];
const dirs: string[] = [];

function sessionBase(): string {
  const d = path.join(os.tmpdir(), `attach-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(d, { recursive: true });
  dirs.push(d);
  return d;
}

function dummyCodesys(): number {
  const p = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  children.push(p);
  return p.pid as number;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A session dir whose watcher (mock) answers and whose ready.signal names codesysPid. */
async function startSession(base: string, name: string, codesysPid: number): Promise<void> {
  const ipcDir = path.join(base, name);
  fs.mkdirSync(ipcDir, { recursive: true });
  const w = spawn('python', [path.join(__dirname, '..', 'mock_watcher.py'), '--ipc-dir', ipcDir], { stdio: 'ignore' });
  children.push(w);
  const ready = path.join(ipcDir, 'ready.signal');
  const t0 = Date.now();
  while (!fs.existsSync(ready)) {
    if (Date.now() - t0 > 10_000) throw new Error('mock watcher not ready');
    await new Promise((r) => setTimeout(r, 100));
  }
  const info = JSON.parse(fs.readFileSync(ready, 'utf-8'));
  fs.writeFileSync(ready, JSON.stringify({ ...info, pid: codesysPid, version: '0.6.0' }));
}

afterEach(() => {
  for (const c of children.splice(0)) {
    try { c.kill(); } catch { /* ignore */ }
  }
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const exe = process.execPath;
const cfg = { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir() };

describe('attach to a CODESYS opened by hand', () => {
  it('attach() takes over the attach session and runs commands in it', async () => {
    const base = sessionBase();
    const pid = dummyCodesys();
    await startSession(base, `attach-${pid}-1`, pid);
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base });
    expect(await launcher.attach(0)).toBe(pid);
    expect(launcher.attached).toBe(true);
    const r = await launcher.executeScript('print("SCRIPT_SUCCESS: in the user CODESYS")');
    expect(r.success).toBe(true);
  }, 30_000);

  it('attach() ignores ordinary MCP sessions and returns null when nothing ran the script', async () => {
    const base = sessionBase();
    const pid = dummyCodesys();
    await startSession(base, 'old-session', pid);
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base });
    expect(await launcher.attach(0)).toBeNull();
    expect(launcher.attached).toBe(false);
  }, 30_000);

  it('shutdown() only detaches: the user CODESYS stays alive', async () => {
    const base = sessionBase();
    const pid = dummyCodesys();
    await startSession(base, `attach-${pid}-1`, pid);
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base });
    await launcher.attach(0);
    await launcher.shutdown();
    expect(launcher.getStatus().state).toBe('stopped');
    expect(launcher.attached).toBe(false);
    expect(alive(pid)).toBe(true);
    // The dir keeps its terminate signal for the watcher; pruned later.
    expect(fs.existsSync(path.join(base, `attach-${pid}-1`, 'terminate.signal'))).toBe(true);
    // A detached CODESYS is still not killable.
    expect(launcher.killConflictingInstances()).toEqual([]);
    expect(alive(pid)).toBe(true);
  }, 60_000);

  it('killExisting never kills a CODESYS opened by hand (no session dir)', async () => {
    const base = sessionBase();
    const handOpened = dummyCodesys();
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid: handOpened, exePath: exe }], sessionBaseDir: base });
    expect(launcher.killConflictingInstances()).toEqual([]);
    expect(alive(handOpened)).toBe(true);
  }, 30_000);

  it('a launch takes an attach session over by itself', async () => {
    const base = sessionBase();
    const pid = dummyCodesys();
    await startSession(base, `attach-${pid}-1`, pid);
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base });
    await launcher.launch();
    expect(launcher.lastLaunchAdopted).toBe(true);
    expect(launcher.attached).toBe(true);
  }, 30_000);

  it('killExisting never kills an attached CODESYS', async () => {
    const base = sessionBase();
    const pid = dummyCodesys();
    await startSession(base, `attach-${pid}-1`, pid);
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base });
    expect(launcher.killConflictingInstances()).toEqual([]);
    expect(alive(pid)).toBe(true);
  }, 30_000);
});

describe('shutdown without a tracked CODESYS kills only real orphans', () => {
  it('kills an MCP-started orphan, spares a hand-opened and an attached CODESYS', async () => {
    const base = sessionBase();
    const orphan = dummyCodesys();
    const handOpened = dummyCodesys();
    const attachedPid = dummyCodesys();
    // Orphan: a plain MCP session dir names it, no owner alive.
    fs.mkdirSync(path.join(base, 'old-session'), { recursive: true });
    fs.writeFileSync(path.join(base, 'old-session', 'ready.signal'), JSON.stringify({ pid: orphan, version: '0.6.0' }));
    // Attached: an attach dir names it.
    fs.mkdirSync(path.join(base, `attach-${attachedPid}-1`), { recursive: true });
    fs.writeFileSync(path.join(base, `attach-${attachedPid}-1`, 'ready.signal'), JSON.stringify({ pid: attachedPid, version: '0.6.0' }));
    const running = [orphan, handOpened, attachedPid].map((pid) => ({ pid, exePath: exe }));
    const launcher = new CodesysLauncher(cfg, { findRunning: () => running, sessionBaseDir: base, windowTitle: () => 'Old.project - CODESYS' });
    await launcher.shutdown();
    const t0 = Date.now();
    while (alive(orphan) && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 200));
    expect(alive(orphan)).toBe(false);
    expect(alive(handOpened)).toBe(true);
    expect(alive(attachedPid)).toBe(true);
  }, 60_000);
});

describe('buildAttachScript', () => {
  it('is the watcher with the session dir made at runtime under the MCP session folder', () => {
    const s = buildAttachScript('codesys-mcp-sp21-plus');
    expect(s).not.toContain('IPC_BASE_DIR = r"{IPC_BASE_DIR}"');
    expect(s).toContain('os.environ.get("TEMP")');
    expect(s).toContain('os.path.join(_attach_tmp, "codesys-mcp-sp21-plus")');
    expect(s).toContain('"attach-%d-" % os.getpid()');
    expect(s).toContain('"terminate.signal"');
    expect(s).toContain('WATCHER_VERSION');
    // The dir is created before the watcher writes into it.
    expect(s.indexOf('os.makedirs(IPC_BASE_DIR)')).toBeLessThan(s.indexOf('_ERROR_FILE ='));
  });
});
