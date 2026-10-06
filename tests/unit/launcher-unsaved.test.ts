import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { CodesysLauncher, parseProjectList, titleShowsUnsaved } from '../../src/launcher';

// Unsaved work is never thrown away unasked. A dummy process plays CODESYS,
// the mock watcher plays its watcher, and a fake `scriptengine` module on
// the mock's PYTHONPATH plays an open project with unsaved changes.

const children: ChildProcess[] = [];
const dirs: string[] = [];

function tempDir(prefix: string): string {
  const d = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
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

/** A fake scriptengine: one project, unsaved; save() records itself in savedMark. */
function fakeScriptEngine(savedMark: string): string {
  const dir = tempDir('fake-se');
  fs.writeFileSync(
    path.join(dir, 'scriptengine.py'),
    [
      'class _P(object):',
      '    def __init__(self, path):',
      '        self.path = path',
      '        self.dirty = True',
      '    def save(self):',
      '        self.dirty = False',
      `        open(r"${savedMark}", "w").close()`,
      '    def close(self):',
      '        pass',
      'class _Projects(object):',
      '    def __init__(self):',
      '        self.all = [_P(r"C:\\plant\\Plant.project")]',
      '        self.primary = self.all[0]',
      'projects = _Projects()',
      'class _Sys(object):',
      '    def exit(self):',
      '        pass',
      'system = _Sys()',
    ].join('\n')
  );
  return dir;
}

async function startSession(base: string, name: string, codesysPid: number, pythonPath: string): Promise<void> {
  const ipcDir = path.join(base, name);
  fs.mkdirSync(ipcDir, { recursive: true });
  const w = spawn('python', [path.join(__dirname, '..', 'mock_watcher.py'), '--ipc-dir', ipcDir], {
    stdio: 'ignore',
    env: { ...process.env, PYTHONPATH: pythonPath },
  });
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

describe('shutdown with unsaved projects', () => {
  it('refuses and asks, keep-open leaves CODESYS for the next launch, save saves first', async () => {
    const base = tempDir('unsaved-test');
    const savedMark = path.join(base, 'saved.mark');
    const pid = dummyCodesys();
    await startSession(base, 'old-session', pid, fakeScriptEngine(savedMark));
    const deps = { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base, windowTitle: () => '' };

    const a = new CodesysLauncher(cfg, deps);
    await a.launch(); // takes the session over
    const err = await a.shutdown().catch((e) => e);
    expect(err?.code).toBe('CODESYS_DECISION_NEEDED');
    expect(String(err.message)).toMatch(/Plant\.project/);
    expect(String(err.message)).toMatch(/ASK THE USER/);
    expect(a.getStatus().state).toBe('ready');

    await a.shutdown({ unsaved: 'keep-open' });
    expect(a.getStatus().state).toBe('stopped');
    expect(alive(pid)).toBe(true);
    expect(fs.existsSync(path.join(base, 'old-session', 'terminate.signal'))).toBe(false);

    const b = new CodesysLauncher(cfg, deps);
    await b.launch(); // the kept-open CODESYS is taken over again
    expect(b.getStatus().pid).toBe(pid);
    await b.shutdown({ unsaved: 'save' });
    expect(fs.existsSync(savedMark)).toBe(true);
    expect(b.getStatus().state).toBe('stopped');
  }, 90_000);

  it('the orphan sweep asks before killing an orphan with unsaved work', async () => {
    const base = tempDir('unsaved-test');
    const pid = dummyCodesys();
    await startSession(base, 'old-session', pid, fakeScriptEngine(path.join(base, 'saved.mark')));
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base, windowTitle: () => '' });
    const err = await launcher.shutdown().catch((e) => e);
    expect(err?.code).toBe('CODESYS_DECISION_NEEDED');
    expect(alive(pid)).toBe(true);
    await launcher.shutdown({ unsaved: 'keep-open' });
    expect(alive(pid)).toBe(true);
  }, 60_000);
});

describe('killExisting with unsaved work', () => {
  it('asks instead of killing', async () => {
    const base = tempDir('unsaved-test');
    const pid = dummyCodesys();
    await startSession(base, 'old-session', pid, fakeScriptEngine(path.join(base, 'saved.mark')));
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base, windowTitle: () => '' });
    const err = await launcher.launch({ killExisting: true }).catch((e) => e);
    expect(err?.code).toBe('CODESYS_DECISION_NEEDED');
    expect(String(err.message)).toMatch(/unsaved changes/);
    expect(alive(pid)).toBe(true);
  }, 60_000);
});

describe('unknown unsaved state counts as unsaved', () => {
  it('the orphan sweep asks about an orphan whose projects cannot be read', async () => {
    const base = tempDir('unsaved-test');
    const pid = dummyCodesys();
    // No fake scriptengine: the project list fails, and there is no title.
    await startSession(base, 'old-session', pid, tempDir('empty-pythonpath'));
    const launcher = new CodesysLauncher(cfg, { findRunning: () => [{ pid, exePath: exe }], sessionBaseDir: base, windowTitle: () => '' });
    const err = await launcher.shutdown().catch((e) => e);
    expect(err?.code).toBe('CODESYS_DECISION_NEEDED');
    expect(String(err.message)).toMatch(/unsaved state unknown/);
    expect(alive(pid)).toBe(true);
  }, 60_000);
});

describe('killExisting does not skip the question', () => {
  it('asks about a CODESYS opened by hand that killExisting spares', async () => {
    const base = tempDir('unsaved-test');
    const handOpened = dummyCodesys();
    const launcher = new CodesysLauncher(cfg, {
      findRunning: () => [{ pid: handOpened, exePath: exe }],
      sessionBaseDir: base,
      windowTitle: () => 'Plant.project - CODESYS',
    });
    const err = await launcher.launch({ killExisting: true }).catch((e) => e);
    expect(err?.code).toBe('CODESYS_DECISION_NEEDED');
    expect(String(err.message)).toMatch(/opened by hand/);
    expect(String(err.message)).toMatch(/install 'CODESYS V3\.5 SP21 Patch 5'/);
    expect(alive(handOpened)).toBe(true);
  }, 60_000);
});

describe('unsaved helpers', () => {
  it('reads the project list and the window title marker', () => {
    expect(parseProjectList('### PROJ|1|C:\\a\\A.project\n### PROJ|0|C:\\b\\B.project\nSCRIPT_SUCCESS')).toEqual([
      { path: 'C:\\a\\A.project', dirty: true },
      { path: 'C:\\b\\B.project', dirty: false },
    ]);
    expect(titleShowsUnsaved('TitleProbe.project* - CODESYS')).toBe(true);
    expect(titleShowsUnsaved('TitleProbe.project - CODESYS')).toBe(false);
    expect(titleShowsUnsaved('CODESYS')).toBe(false);
  });
});
