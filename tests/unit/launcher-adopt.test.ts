import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { CodesysLauncher } from '../../src/launcher';

// Taking over a CODESYS left running by an earlier session: the mock watcher
// plays the old session's watcher, `findRunning` plays the process table.

const children: ChildProcess[] = [];
const dirs: string[] = [];

function sessionBase(): string {
  const d = path.join(os.tmpdir(), `adopt-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(d, { recursive: true });
  dirs.push(d);
  return d;
}

async function startOldSession(base: string, name: string): Promise<number> {
  const ipcDir = path.join(base, name);
  fs.mkdirSync(ipcDir, { recursive: true });
  const child = spawn('python', [path.join(__dirname, '..', 'mock_watcher.py'), '--ipc-dir', ipcDir], { stdio: 'ignore' });
  children.push(child);
  const ready = path.join(ipcDir, 'ready.signal');
  const t0 = Date.now();
  while (!fs.existsSync(ready)) {
    if (Date.now() - t0 > 10_000) throw new Error('mock watcher not ready');
    await new Promise((r) => setTimeout(r, 100));
  }
  return JSON.parse(fs.readFileSync(ready, 'utf-8')).pid as number;
}

afterEach(() => {
  for (const c of children.splice(0)) {
    try { c.kill(); } catch { /* ignore */ }
  }
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Any existing file works as the "CODESYS.exe" path: launch() only checks it exists.
const exe = process.execPath;

// A stand-in CODESYS.exe: a .cmd that starts the mock watcher in the IPC dir
// named by --runscript, the way the real watcher.py is started.
function fakeCodesys(dir: string): string {
  const js = path.join(dir, 'fake-codesys.js');
  fs.writeFileSync(js, [
    "const path = require('path'); const { spawn } = require('child_process');",
    "const arg = process.argv.find((a) => a.startsWith('--runscript='));",
    "const ipc = path.dirname(arg.slice('--runscript='.length).replace(/\"/g, ''));",
    `spawn('python', [${JSON.stringify(path.join(__dirname, '..', 'mock_watcher.py'))}, '--ipc-dir', ipc], { stdio: 'ignore', detached: true }).unref();`,
  ].join('\n'));
  const cmd = path.join(dir, 'CODESYS.cmd');
  fs.writeFileSync(cmd, `@"${process.execPath}" "${js}" %*\r\n`);
  return cmd;
}

// The fake CODESYS starts its mock watcher detached, so shutdown() alone
// leaves it running (52 had piled up after a day of test runs). Kill it by
// the PID it wrote to ready.signal.
async function stopFake(launcher: CodesysLauncher): Promise<void> {
  const pid = launcher.getStatus().pid;
  await launcher.shutdown().catch(() => undefined);
  if (pid) {
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
}

describe('CodesysLauncher adoption', () => {
  it('takes over a running instance whose old session watcher answers', async () => {
    const base = sessionBase();
    const pid = await startOldSession(base, 'old-session');
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir() },
      { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base }
    );
    await launcher.launch();
    expect(launcher.lastLaunchAdopted).toBe(true);
    const st = launcher.getStatus();
    expect(st.state).toBe('ready');
    expect(st.pid).toBe(pid);
    expect(st.sessionId).toBe('old-session');
    const r = await launcher.executeScript('print("SCRIPT_SUCCESS: hello from the new server")');
    expect(r.success).toBe(true);
    expect(r.output).toContain('hello from the new server');
  }, 30_000);

  it('refuses when the running instance has no watcher session (e.g. opened by hand)', async () => {
    const base = sessionBase();
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir(), singleInstance: true },
      { findRunning: () => [{ pid: 999_999, exePath: exe }], sessionBaseDir: base }
    );
    await expect(launcher.launch()).rejects.toThrow(/Refusing to launch/);
    expect(launcher.lastLaunchAdopted).toBe(false);
  }, 30_000);

  it('does not take over a session whose owner server is still alive', async () => {
    const base = sessionBase();
    const pid = await startOldSession(base, 'busy-session');
    // A live process standing in for the other MCP server that still owns it.
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    children.push(owner);
    fs.writeFileSync(path.join(base, 'busy-session', 'owner.json'), JSON.stringify({ serverPid: owner.pid }));
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir(), singleInstance: true },
      { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base }
    );
    await expect(launcher.launch()).rejects.toThrow(/Refusing to launch/);
  }, 30_000);

  it('shares one attempt between concurrent launch calls', async () => {
    const base = sessionBase();
    const pid = await startOldSession(base, 'old-session');
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir() },
      { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base }
    );
    await Promise.all([launcher.launch(), launcher.launch(), launcher.launch()]);
    expect(launcher.getStatus().state).toBe('ready');
    expect(launcher.getStatus().pid).toBe(pid);
    // The takeover stamped this server as the owner.
    const o = JSON.parse(fs.readFileSync(path.join(base, 'old-session', 'owner.json'), 'utf-8'));
    expect(o.serverPid).toBe(process.pid);
  }, 30_000);

  it('prunes dead and failed session dirs on every launch, keeps live ones', async () => {
    const base = sessionBase();
    const failed = path.join(base, 'failed-launch');
    fs.mkdirSync(failed, { recursive: true });
    const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(failed, old, old);
    const recentFailed = path.join(base, 'recent-launch');
    fs.mkdirSync(recentFailed, { recursive: true });
    const live = path.join(base, 'live-other-install');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, 'ready.signal'), JSON.stringify({ pid: process.pid, timestamp: 1 }));
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir(), singleInstance: true },
      { findRunning: () => [{ pid: 999_997, exePath: exe }], sessionBaseDir: base }
    );
    await expect(launcher.launch()).rejects.toThrow(/Refusing to launch/);
    expect(fs.existsSync(failed)).toBe(false);
    expect(fs.existsSync(recentFailed)).toBe(true);
    expect(fs.existsSync(live)).toBe(true);
  }, 30_000);

  it('removes a session dir whose CODESYS is gone', async () => {
    const base = sessionBase();
    const dead = path.join(base, 'dead-session');
    fs.mkdirSync(dead, { recursive: true });
    fs.writeFileSync(path.join(dead, 'ready.signal'), JSON.stringify({ pid: 999_998, timestamp: 1 }));
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir(), singleInstance: true },
      { findRunning: () => [{ pid: 999_997, exePath: exe }], sessionBaseDir: base }
    );
    await expect(launcher.launch()).rejects.toThrow(/Refusing to launch/);
    expect(fs.existsSync(dead)).toBe(false);
  }, 30_000);

  it('asks first, then starts a second instance next to one it cannot take over on "leave"', async () => {
    const base = sessionBase();
    const fake = fakeCodesys(base);
    const launcher = new CodesysLauncher(
      { codesysPath: fake, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir() },
      { findRunning: () => [{ pid: 999_999, exePath: fake }], sessionBaseDir: base, windowTitle: () => 'Plant.project* - CODESYS' }
    );
    // The question names the other CODESYS, its unsaved state and the options.
    const err = await launcher.launch().catch((e) => e);
    expect(err?.code).toBe('CODESYS_DECISION_NEEDED');
    expect(String(err.message)).toMatch(/PID 999999, opened by hand: Plant\.project\* - CODESYS; UNSAVED CHANGES/);
    expect(String(err.message)).toMatch(/ASK THE USER/);
    expect(launcher.getStatus().state).toBe('stopped');
    await launcher.launch({ otherInstances: 'leave' });
    try {
      expect(launcher.lastLaunchAdopted).toBe(false);
      expect(launcher.getStatus().state).toBe('ready');
      const r = await launcher.executeScript('print("SCRIPT_SUCCESS: second instance")');
      expect(r.output).toContain('second instance');
    } finally {
      await stopFake(launcher);
    }
  }, 60_000);

  it('killExisting spares an instance another live server uses', async () => {
    const base = sessionBase();
    const pid = await startOldSession(base, 'other-server-session');
    const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    children.push(owner);
    fs.writeFileSync(path.join(base, 'other-server-session', 'owner.json'), JSON.stringify({ serverPid: owner.pid }));
    const fake = fakeCodesys(base);
    const launcher = new CodesysLauncher(
      { codesysPath: fake, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir() },
      { findRunning: () => [{ pid, exePath: fake }], sessionBaseDir: base }
    );
    await launcher.launch({ killExisting: true, otherInstances: 'leave' });
    try {
      expect(launcher.getStatus().state).toBe('ready');
      expect(launcher.getStatus().pid).not.toBe(pid);
      // The other server's "CODESYS" (the mock watcher) is still alive.
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      await stopFake(launcher);
    }
  }, 60_000);

  it('does not take over a CODESYS whose watcher is older than 0.6.0', async () => {
    const base = sessionBase();
    const pid = await startOldSession(base, 'old-watcher');
    // Pre-0.6.0 watchers run online commands without a script context.
    const ready = path.join(base, 'old-watcher', 'ready.signal');
    const info = JSON.parse(fs.readFileSync(ready, 'utf-8'));
    fs.writeFileSync(ready, JSON.stringify({ ...info, version: '0.5.0' }));
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir(), singleInstance: true },
      { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base }
    );
    await expect(launcher.launch()).rejects.toThrow(/Refusing to launch/);
    expect(launcher.lastLaunchAdopted).toBe(false);
  }, 30_000);

  it('skips a session that has a terminate signal', async () => {
    const base = sessionBase();
    const pid = await startOldSession(base, 'stopping-session');
    fs.writeFileSync(path.join(base, 'stopping-session', 'terminate.signal'), '{}');
    const launcher = new CodesysLauncher(
      { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir(), singleInstance: true },
      { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base }
    );
    await expect(launcher.launch()).rejects.toThrow(/Refusing to launch/);
  }, 30_000);
});
