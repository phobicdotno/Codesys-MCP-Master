import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AttachAutomationResult,
  attachHelperPath,
  autoAttach,
  describeAutomation,
  formatCandidates,
  parseHelperOutput,
  runAttachAutomation,
  HelperRunner,
} from '../../src/attach-uia';
import { CodesysLauncher } from '../../src/launcher';

const okResult: AttachAutomationResult = {
  ok: true,
  stage: 'done',
  message: 'Ran the attach script in CODESYS PID 4242',
  title: 'CODESYS  [MCP]',
  matchedBy: ['tools:name', 'press:direct'],
  menu: ['File', 'Tools'],
};

describe('attach helper output', () => {
  it('parses the JSON result line, ignoring other output', () => {
    const r = parseHelperOutput({
      code: 0,
      stdout: 'WARNING: something\r\n{"ok":true,"stage":"done","message":"m","title":"X - CODESYS [MCP]","matchedBy":["tools:name"],"menu":["File","Tools"]}\r\n',
      stderr: '',
    });
    expect(r).toEqual({ ok: true, stage: 'done', message: 'm', title: 'X - CODESYS [MCP]', matchedBy: ['tools:name'], menu: ['File', 'Tools'] });
  });

  it('a failure line keeps its stage', () => {
    const r = parseHelperOutput({ code: 2, stdout: '{"ok":false,"stage":"modal","message":"dialog open"}', stderr: '' });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('modal');
    expect(r.matchedBy).toEqual([]);
  });

  it('no JSON: a helper failure with the raw output', () => {
    const r = parseHelperOutput({ code: 1, stdout: 'garbage', stderr: 'Add-Type failed' });
    expect(r.ok).toBe(false);
    expect(r.stage).toBe('helper');
    expect(r.message).toContain('exit 1');
    expect(r.message).toContain('Add-Type failed');
  });
});

describe('runAttachAutomation', () => {
  it('passes the PID, script and timeout to the helper', async () => {
    let seen: string[] = [];
    let seenTimeout = 0;
    const runner: HelperRunner = async (args, timeoutMs) => {
      seen = args;
      seenTimeout = timeoutMs;
      return { code: 0, stdout: JSON.stringify(okResult), stderr: '' };
    };
    const r = await runAttachAutomation(4242, 'C:\\x\\attach.py', { runner, platform: 'win32', timeoutSeconds: 30 });
    expect(r.ok).toBe(true);
    expect(seen).toEqual(['-TargetPid', '4242', '-TimeoutSeconds', '30', '-ScriptPath', 'C:\\x\\attach.py']);
    expect(seenTimeout).toBe(90_000);
  });

  it('probe only sends no script path', async () => {
    let seen: string[] = [];
    const runner: HelperRunner = async (args) => {
      seen = args;
      return { code: 0, stdout: '{"ok":true,"stage":"probe","message":"found"}', stderr: '' };
    };
    await runAttachAutomation(7, '', { runner, platform: 'win32', probeOnly: true });
    expect(seen).toContain('-ProbeOnly');
    expect(seen).not.toContain('-ScriptPath');
  });

  it('refuses off Windows and bad PIDs without starting the helper', async () => {
    let called = false;
    const runner: HelperRunner = async () => {
      called = true;
      return { code: 0, stdout: '', stderr: '' };
    };
    expect((await runAttachAutomation(5, 'a', { runner, platform: 'linux' })).stage).toBe('platform');
    expect((await runAttachAutomation(0, 'a', { runner, platform: 'win32' })).stage).toBe('process');
    expect(called).toBe(false);
  });

  it('describeAutomation names the failing step', () => {
    expect(describeAutomation({ ...okResult, ok: false, stage: 'modal', message: 'a dialog' })).toBe("automatic attach failed at step 'modal': a dialog");
    expect(describeAutomation(okResult)).toBe(okResult.message);
  });
});

describe('autoAttach', () => {
  const a = { pid: 100, label: 'SP21 Patch 5', title: 'A.project - CODESYS' };
  const b = { pid: 200, label: 'SP18 Patch 5', title: 'CODESYS' };

  it('one candidate: automates that PID and picks the session up', async () => {
    const automated: number[] = [];
    const out = await autoAttach({
      candidates: [a],
      automate: async (pid) => (automated.push(pid), okResult),
      pickUp: async (c) => c.pid,
    });
    expect(automated).toEqual([100]);
    expect(out).toMatchObject({ kind: 'attached', pid: 100, label: 'SP21 Patch 5' });
  });

  it('several candidates and no pid: asks, touches none', async () => {
    let touched = false;
    const out = await autoAttach({
      candidates: [a, b],
      automate: async () => ((touched = true), okResult),
      pickUp: async () => 1,
    });
    expect(out.kind).toBe('choose');
    expect(touched).toBe(false);
  });

  it('pid picks one of several; never another', async () => {
    const automated: number[] = [];
    const out = await autoAttach({
      candidates: [a, b],
      pid: 200,
      automate: async (pid) => (automated.push(pid), okResult),
      pickUp: async (c) => c.pid,
    });
    expect(automated).toEqual([200]);
    expect(out).toMatchObject({ kind: 'attached', pid: 200 });
  });

  it('a pid that is no candidate is refused without automation', async () => {
    let touched = false;
    const out = await autoAttach({
      candidates: [a],
      pid: 999,
      automate: async () => ((touched = true), okResult),
      pickUp: async () => 1,
    });
    expect(out).toMatchObject({ kind: 'not-candidate', pid: 999 });
    expect(touched).toBe(false);
  });

  it('no candidates: none', async () => {
    const out = await autoAttach({ candidates: [], automate: async () => okResult, pickUp: async () => 1 });
    expect(out.kind).toBe('none');
  });

  it('automation failure is reported, no pickup', async () => {
    let picked = false;
    const out = await autoAttach({
      candidates: [a],
      automate: async () => ({ ...okResult, ok: false, stage: 'modal', message: 'License dialog open' }),
      pickUp: async () => ((picked = true), 1),
    });
    expect(out).toMatchObject({ kind: 'failed', pid: 100 });
    expect(picked).toBe(false);
    if (out.kind === 'failed') expect(out.automation.stage).toBe('modal');
  });

  it('script ran but no session answered: failed at pickup', async () => {
    const out = await autoAttach({ candidates: [a], automate: async () => okResult, pickUp: async () => null });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.automation.stage).toBe('pickup');
      expect(out.automation.ok).toBe(false);
    }
  });

  it("a watcher the helper found already running but this server cannot take over is explained", async () => {
    const out = await autoAttach({
      candidates: [a],
      automate: async () => ({ ...okResult, stage: 'already', message: 'already runs an MCP watcher' }),
      pickUp: async () => null,
    });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') expect(out.automation.message).toContain('another live MCP session');
  });

  it('formatCandidates lists PID, install and title', () => {
    expect(formatCandidates([a])).toBe('  - PID 100 (SP21 Patch 5): A.project - CODESYS');
  });
});

describe('the helper script', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'attach_uia.ps1'), 'utf-8');

  it('is ASCII only (PowerShell 5.1 reads a .ps1 without BOM as ANSI)', () => {
    expect(/[^\x00-\x7f]/.test(src)).toBe(false);
  });

  it('never takes the foreground, the mouse or the keyboard', () => {
    for (const banned of ['SetForegroundWindow', 'SetCursorPos', 'SendInput', 'mouse_event', 'keybd_event', 'SendKeys', 'SetActiveWindow', 'SetFocus(']) {
      expect(src).not.toContain(banned);
    }
  });

  it('targets the window by process id', () => {
    expect(src).toContain('GetWindowThreadProcessId');
    expect(src).toContain('[Parameter(Mandatory = $true)][int]$TargetPid');
  });

  it('is found next to the compiled module', () => {
    expect(path.basename(attachHelperPath())).toBe('attach_uia.ps1');
  });
});

// ---- launcher: which CODESYS the automation may target ----

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function base(): string {
  const d = path.join(os.tmpdir(), `attach-cand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(d, { recursive: true });
  dirs.push(d);
  return d;
}

function session(b: string, name: string, pid: number, opts: { terminated?: boolean; owner?: number } = {}): void {
  const dir = path.join(b, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ready.signal'), JSON.stringify({ pid, version: '0.7.1', timestamp: Date.now() / 1000 }));
  if (opts.terminated) fs.writeFileSync(path.join(dir, 'terminate.signal'), '');
  if (opts.owner) fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ serverPid: opts.owner }));
}

describe('CodesysLauncher.attachCandidates', () => {
  const exe = 'C:\\Program Files\\CODESYS 3.5.21.50\\CODESYS\\Common\\CODESYS.exe';
  const other = 'C:\\Program Files\\CODESYS 3.5.18.50\\CODESYS\\Common\\CODESYS.exe';
  const cfg = { codesysPath: exe, profileName: 'CODESYS V3.5 SP21 Patch 5', workspaceDir: os.tmpdir() };

  it('opened by hand and detached ones are candidates; MCP sessions, live attach sessions and other installs are not', () => {
    const b = base();
    session(b, 'attach-11-1', 11, { terminated: true }); // attached, then detached
    session(b, 'attach-12-1', 12); // live attach session: attach() takes it
    session(b, 'session-13', 13); // left by an ended MCP session
    session(b, 'session-14', 14, { owner: process.ppid }); // another live MCP server
    const launcher = new CodesysLauncher(cfg, {
      sessionBaseDir: b,
      findRunning: () => [
        { pid: 10, exePath: exe }, // opened by hand
        { pid: 11, exePath: exe },
        { pid: 12, exePath: exe },
        { pid: 13, exePath: exe },
        { pid: 14, exePath: exe },
        { pid: 15, exePath: other }, // another install
      ],
      windowTitle: (pid) => `T${pid}`,
    });
    expect(launcher.attachCandidates().map((c) => c.pid)).toEqual([10, 11]);
    expect(launcher.titleOf(10)).toBe('T10');
  });
});
