/**
 * CODESYS launcher — spawns CODESYS with UI and watcher script,
 * tracks process lifecycle, delegates to IPC for command execution.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { LauncherConfig, LauncherStatus, CodesysState, IpcResult, ScriptExecutor } from './types';
import { IpcClient, DEFAULT_IPC_CONFIG } from './ipc';
import { ScriptManager } from './script-manager';
import { launcherLog } from './logger';

// Temp session dir prefix. Was 'codesys-mcp-persistent' under the
// pre-rename project name; kept stable as the new project name to keep
// runtime behaviour identical (per-session subdirs are ephemeral, so
// orphaned ones from the prior name -- if any -- are harmless and clean
// themselves up when the OS sweeps %TEMP%).
export const SESSION_DIR_PREFIX = 'codesys-mcp-sp21-plus';

export interface RunningCodesys {
  pid: number;
  exePath: string;
}

/**
 * Returns every CODESYS.exe currently running on this Windows machine, with
 * the absolute path of its image file alongside the PID.
 *
 * Used by the launcher's pre-spawn guard and the shutdown_codesys orphan
 * killer. Both filter the list by the configured --codesys-path so that:
 *
 *   - Multiple CODESYS installs (e.g. SP21 + SP22) can run side-by-side.
 *     CODESYS supports parallel instances of *different* installs; only
 *     two instances of the *same* install on the *same* project trigger
 *     the "project is currently in use" file-lock modal.
 *   - shutdown_codesys never accidentally kills a CODESYS instance the
 *     user owns (different install) or that belongs to a different MCP
 *     server entry pointed at a different exe.
 *
 * Implementation: PowerShell Get-Process gives us {Id, Path} reliably.
 * tasklist doesn't expose ExecutablePath; WMIC is deprecated on modern
 * Windows. PowerShell's ~200ms cold start is fine at launch time.
 *
 * Returns an empty list on non-Windows or if PowerShell fails (we treat
 * that as "can't tell" rather than blocking the spawn; the user retains
 * the option to close manually if there really is a conflict).
 */
function findRunningCodesys(): RunningCodesys[] {
  if (process.platform !== 'win32') return [];
  try {
    // ConvertTo-Json emits a single object when the collection has one
    // element, an array otherwise. -AsArray would normalise but isn't
    // available in PS5.1, so we coerce on the JS side.
    const ps =
      'Get-Process -Name CODESYS -ErrorAction SilentlyContinue ' +
      '| Select-Object -Property Id,Path ' +
      '| ConvertTo-Json -Compress';
    const out = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }
    );
    const trimmed = out.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    const result: RunningCodesys[] = [];
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as { Id?: unknown; Path?: unknown };
      if (typeof e.Id !== 'number') continue;
      if (typeof e.Path !== 'string') continue;
      result.push({ pid: e.Id, exePath: e.Path });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Compare two Windows paths for equality. Case-insensitive; normalises
 * forward and back slashes; trims trailing separators.
 *
 * Exported so the launcher unit test can pin the matching behaviour.
 */
export function pathsEqual(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '').trim();
  return norm(a) === norm(b);
}
// A bare CODESYS install signals ready in ~15-25s. An install launched with
// --additionalfolder that registers a large add-on set (e.g. SP19 P2 with the
// 161-plugin large add-on folder incl. the Script Engine) takes ~70s to boot --
// measured 2026-07-27: spawned 07:14:53, ready.signal at 07:16:03. 60s cut it
// off just before ready, then the refuse-on-duplicate guard blocked the retry
// against the very instance that had just come up. 150s covers the slow-plugin
// case with headroom without hanging a genuinely dead launch too long.
const READY_TIMEOUT_MS = 150_000;
const READY_POLL_MS = 500;
const SHUTDOWN_WAIT_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 5_000;

/** Injectable for tests: how running CODESYS processes and old sessions are found. */
export interface LauncherDeps {
  findRunning?: () => RunningCodesys[];
  /** Folder holding the per-session IPC dirs (default %TEMP%/codesys-mcp-sp21-plus). */
  sessionBaseDir?: string;
  /** Main window title of a PID (default: tasklist). */
  windowTitle?: (pid: number) => string;
}

const OWNER_FILE = 'owner.json';

/** Oldest watcher a takeover accepts: 0.6.0 gives online commands a script context. */
const MIN_ADOPT_WATCHER = '0.6.0';

function watcherAtLeast(version: unknown, min: string): boolean {
  if (typeof version !== 'string') return false;
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but we may not signal it (on Windows, an
    // elevated process seen from a non-elevated server). Only ESRCH is dead.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** A session dir without ready.signal this old is a launch that never came up. */
const FAILED_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** How long a closed-on-request CODESYS gets to exit (it may sit on its own save prompt). */
const CLOSE_WAIT_MS = 20_000;

/** Reading another CODESYS's open projects through its watcher. */
const LIST_PROBE_TIMEOUT_MS = 4_000;

/** Saving projects through another instance's watcher. */
const PROJECT_SAVE_TIMEOUT_MS = 120_000;

/** A session dir with a terminate signal this old has been seen by its watcher. */
const TERMINATED_SESSION_MAX_AGE_MS = 60 * 1000;

/** How long an old session's watcher gets to answer the adoption ping. */
const ADOPT_PING_TIMEOUT_MS = 8_000;

/**
 * Session dirs the attach script makes inside a CODESYS the user opened by
 * hand ("attach-<CODESYS pid>-<time>"). Such a CODESYS is the user's: the
 * MCP never closes or kills it, it only stops its watcher (detach).
 */
export const ATTACH_SESSION_PREFIX = 'attach-';

interface SessionCandidate {
  dir: string;
  pid: number;
  ts: number;
  mtimeMs: number;
}

/**
 * What to do with other CODESYS of the install before a new one starts
 * (the user's answer, asked through the agent): leave them and start next
 * to them, close them (a normal window close, so CODESYS itself asks about
 * unsaved changes), or save their projects first (only where a watcher
 * runs in them) and then close them.
 */
export type OtherInstancesChoice = 'leave' | 'close' | 'save-and-close';

/** What shutdown does with unsaved projects: ask (refuse), save first, discard, or leave CODESYS open. */
export type UnsavedChoice = 'ask' | 'save' | 'discard' | 'keep-open';

/**
 * The launch or shutdown needs the user's answer first. The message lists
 * what was found and the options; the agent asks the user and calls again
 * with the chosen option.
 */
export class DecisionNeededError extends Error {
  code = 'CODESYS_DECISION_NEEDED';
}

export interface LaunchOptions {
  killExisting?: boolean;
  otherInstances?: OtherInstancesChoice;
}

export function buildLaunchQuestion(
  profileName: string,
  infos: InstanceInfo[],
  answerWith = `call launch_codesys with install '${profileName}' and otherInstances set to the answer, and retry`
): string {
  return (
    `Before starting another CODESYS (${profileName}): these CODESYS of the same install are running and cannot be taken over:\n` +
    `${formatInstances(infos)}\n` +
    `ASK THE USER what to do with them, then ${answerWith}:\n` +
    `  'leave'          - leave them as they are and start a new CODESYS next to them (remembered for this session)\n` +
    `  'close'          - close them like the window's X; CODESYS asks about unsaved changes itself\n` +
    `  'save-and-close' - save their unsaved projects first (where the MCP can reach them), then close them\n` +
    `A CODESYS another live MCP session uses is always left alone. To work in one opened by hand instead, use attach_codesys.`
  );
}

export interface InstanceInfo {
  pid: number;
  kind: 'opened by hand' | 'attached' | 'used by another live MCP session' | 'left by an ended MCP session';
  title: string;
  /** Open projects with their unsaved flag, read through the instance's watcher; null without one. */
  projects: Array<{ path: string; dirty: boolean }> | null;
  /** Unsaved changes: from the projects, else from the window title ("Name.project*"); null when unknown. */
  unsaved: boolean | null;
  /** Session dir of its watcher, if one answers for it. */
  dir: string | null;
}

const LIST_PROJECTS_SCRIPT = `
import scriptengine as se
def _open_projects():
    # ScriptProjects is not iterable ("iteration over non-sequence", SP21
    # 2026-10-06): the open projects are in .all.
    try:
        return list(se.projects.all)
    except Exception:
        p = se.projects.primary
        return [p] if p is not None else []
for p in _open_projects():
    try:
        print("### PROJ|%s|%s" % ("1" if p.dirty else "0", p.path))
    except Exception as e:
        print("### PROJ|?|%s" % e)
print("SCRIPT_SUCCESS: projects listed")
`;

const SAVE_PROJECTS_SCRIPT = `
import scriptengine as se
def _open_projects():
    # ScriptProjects is not iterable ("iteration over non-sequence", SP21
    # 2026-10-06): the open projects are in .all.
    try:
        return list(se.projects.all)
    except Exception:
        p = se.projects.primary
        return [p] if p is not None else []
failed = []
for p in _open_projects():
    try:
        if p.dirty:
            p.save()
            print("### SAVED|%s" % p.path)
    except Exception as e:
        failed.append("%s: %s" % (p.path, e))
if failed:
    print("SCRIPT_ERROR: could not save " + "; ".join(failed))
else:
    print("SCRIPT_SUCCESS: unsaved projects saved")
`;

export function parseProjectList(output: string): Array<{ path: string; dirty: boolean }> {
  const out: Array<{ path: string; dirty: boolean }> = [];
  for (const line of output.split(/\r?\n/)) {
    // '?': the flag could not be read; that counts as unsaved, never as clean.
    const m = /^### PROJ\|([01?])\|(.+)$/.exec(line.trim());
    if (m) out.push({ path: m[2], dirty: m[1] !== '0' });
  }
  return out;
}

/** CODESYS marks unsaved changes in its title: "Name.project* - CODESYS" (verified SP21 2026-10-06). */
export function titleShowsUnsaved(title: string): boolean {
  return /\.(project|library)\*/i.test(title);
}

/** The main window title of a process, from tasklist ('' when it has none or the call fails). */
function windowTitleOf(pid: number): string {
  try {
    const out = execSync(`tasklist /v /fo csv /nh /fi "PID eq ${pid}"`, { encoding: 'utf-8', timeout: 10_000 });
    const line = out.trim().split(/\r?\n/)[0] ?? '';
    const cells = line.split('","');
    const t = (cells[cells.length - 1] ?? '').replace(/"\s*$/, '').trim();
    // Not a CODESYS title (e.g. a localised "N/A" for no window): unknown.
    return /CODESYS/i.test(t) ? t : '';
  } catch {
    return '';
  }
}

export function formatInstances(infos: InstanceInfo[]): string {
  return infos
    .map((i) => {
      const unsaved =
        i.unsaved === true ? 'UNSAVED CHANGES' : i.unsaved === false ? 'no unsaved changes' : 'unsaved state unknown';
      const projects =
        i.projects && i.projects.length > 0
          ? i.projects.map((p) => `${p.path}${p.dirty ? ' (unsaved)' : ''}`).join(', ')
          : i.title || '(no project open)';
      return `  - PID ${i.pid}, ${i.kind}: ${projects}; ${unsaved}`;
    })
    .join('\n');
}

export class CodesysLauncher implements ScriptExecutor {
  private config: LauncherConfig;
  private deps: LauncherDeps;
  /** True when the last launch() took over a running CODESYS instead of starting one. */
  lastLaunchAdopted = false;
  /** What happened to other CODESYS the user asked to close in the last launch. */
  lastCloseReport: string[] = [];
  /** What the last shutdown did with orphans it was asked about. */
  lastShutdownReport: string[] = [];
  private launchInFlight: Promise<void> | null = null;
  /** The user chose to leave other CODESYS of the install running and start next to them. */
  private otherInstancesChoice: OtherInstancesChoice | null = null;
  /** PIDs the last launch question named: a 'close' answer acts on these only. */
  private askedPids = new Set<number>();
  private state: CodesysState = 'stopped';
  private pid: number | null = null;
  private sessionId: string | null = null;
  private ipcDir: string | null = null;
  private ipcClient: IpcClient | null = null;
  private process: ChildProcess | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private stateChangeCallbacks: Array<(state: CodesysState) => void> = [];

  constructor(config: LauncherConfig, deps: LauncherDeps = {}) {
    this.config = config;
    this.deps = deps;
  }

  /** Whether a process still runs (EPERM counts as running). */
  isPidAlive(pid: number): boolean {
    return pidAlive(pid);
  }

  /** True when the current session is an attach session in a CODESYS the user opened. */
  get attached(): boolean {
    return this.sessionId !== null && this.sessionId.startsWith(ATTACH_SESSION_PREFIX);
  }

  /** Mark this server as the session's owner, so a second live server never takes it over. */
  private writeOwner(dir: string): void {
    try {
      fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ serverPid: process.pid, at: Date.now() }));
    } catch {
      // best effort; a session without an owner file can be taken over
    }
  }

  /** PID of the MCP server that owns a session dir, if it is still alive and not us. */
  private liveForeignOwner(dir: string): number | null {
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf-8'));
      const pid = o?.serverPid;
      if (typeof pid !== 'number' || pid === process.pid) return null;
      return pidAlive(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  /**
   * Delete session dirs nothing can use any more, on every launch: the
   * CODESYS named in ready.signal is gone (or the dir has a terminate signal
   * and its CODESYS is gone), or a launch never wrote ready.signal and the
   * dir is older than a day. Dirs of a running CODESYS (any install) and of
   * a live foreign owner are kept.
   */
  private pruneSessionDirs(): void {
    const base = this.sessionBaseDir();
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      return;
    }
    for (const name of entries) {
      const dir = path.join(base, name);
      if (dir === this.ipcDir) continue;
      try {
        if (!fs.statSync(dir).isDirectory() || this.liveForeignOwner(dir) !== null) continue;
        const ready = path.join(dir, 'ready.signal');
        const terminate = path.join(dir, 'terminate.signal');
        let dead = false;
        if (fs.existsSync(terminate) && Date.now() - fs.statSync(terminate).mtimeMs > TERMINATED_SESSION_MAX_AGE_MS) {
          // A detached session: its watcher has long seen the signal.
          dead = true;
        } else if (fs.existsSync(ready)) {
          const pid = JSON.parse(fs.readFileSync(ready, 'utf-8'))?.pid;
          dead = typeof pid === 'number' && !pidAlive(pid);
        } else {
          dead = Date.now() - fs.statSync(dir).mtimeMs > FAILED_SESSION_MAX_AGE_MS;
        }
        if (dead) fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // unreadable or busy: leave it for a later launch
      }
    }
  }

  private sessionBaseDir(): string {
    return this.deps.sessionBaseDir ?? path.join(os.tmpdir(), SESSION_DIR_PREFIX);
  }

  /**
   * Take over a CODESYS of this install that an earlier MCP session started
   * and left running. Its watcher (a UI-thread timer since 0.18.0) keeps
   * polling that session's IPC dir, so a new server can reuse the dir: find
   * the session whose ready.signal names one of the running PIDs, ping its
   * watcher, and adopt it if the ping comes back. Returns false when none
   * answers (a CODESYS opened by hand has no watcher and is adopted only after the user ran the attach script in it).
   */
  private async tryAdopt(running: RunningCodesys[]): Promise<boolean> {
    for (const c of this.adoptableSessions(running)) {
      if (await this.adoptSession(c)) return true;
    }
    return false;
  }

  /**
   * Take over the watcher the attach script started in a CODESYS of this
   * install that the user opened by hand. Waits up to maxWaitMs for the
   * script to be run (Tools > Scripting > Execute Script File...). A session
   * this launcher already drives is left running: a CODESYS it started stays
   * open (a later launch can take it over again), an earlier attach session
   * is detached. Returns the CODESYS PID, or null when none turned up.
   */
  async attach(maxWaitMs: number): Promise<number | null> {
    // Never adopt in the middle of a launch: its ready poll would pick up
    // the attach session and leave the CODESYS it spawned orphaned.
    if (this.launchInFlight) await this.launchInFlight.catch(() => undefined);
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const sessions = this.adoptableSessions(this.findConflictingInstances()).filter(
        (c) => path.basename(c.dir).startsWith(ATTACH_SESSION_PREFIX) && c.dir !== this.ipcDir
      );
      for (const c of sessions) {
        const previous = { attached: this.attached, client: this.ipcClient, dir: this.ipcDir };
        if (this.state === 'ready') this.stopHealthMonitor();
        if (await this.adoptSession(c)) {
          if (previous.attached && previous.client && previous.dir !== c.dir) {
            await this.detachSession(previous.client);
          }
          return c.pid;
        }
        if (this.state === 'ready') this.startHealthMonitor();
      }
      if (Date.now() >= deadline) return null;
      await this.sleep(1_000);
    }
  }

  /** Session dirs of running CODESYS (from `running`) that this launcher may take over, newest first. */
  private adoptableSessions(running: RunningCodesys[]): SessionCandidate[] {
    const pids = new Set(running.map((r) => r.pid));
    const base = this.sessionBaseDir();
    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      return [];
    }
    const candidates: SessionCandidate[] = [];
    for (const name of entries) {
      const dir = path.join(base, name);
      const ready = path.join(dir, 'ready.signal');
      if (!fs.existsSync(ready) || fs.existsSync(path.join(dir, 'terminate.signal'))) continue;
      try {
        const info = JSON.parse(fs.readFileSync(ready, 'utf-8'));
        if (typeof info?.pid !== 'number') continue;
        if (!pids.has(info.pid)) continue;
        // A watcher before 0.6.0 runs online commands without a script
        // context ('Stack empty'): taking it over would leave every online
        // tool broken. Start a fresh CODESYS next to it instead.
        if (!watcherAtLeast(info.version, MIN_ADOPT_WATCHER)) {
          launcherLog.info(`Session ${name} (CODESYS PID ${info.pid}) runs watcher ${info.version ?? '?'}, older than ${MIN_ADOPT_WATCHER}; not taking it over`);
          continue;
        }
        const owner = this.liveForeignOwner(dir);
        if (owner !== null) {
          launcherLog.info(`Session ${name} (CODESYS PID ${info.pid}) is still used by MCP server PID ${owner}; not taking it over`);
          continue;
        }
        candidates.push({
          dir,
          pid: info.pid,
          ts: typeof info.timestamp === 'number' ? info.timestamp * 1000 : Date.now(),
          mtimeMs: fs.statSync(ready).mtimeMs,
        });
      } catch {
        continue;
      }
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates;
  }

  /** Ping a session's watcher and, when it answers, make it this launcher's session. */
  private async adoptSession(c: SessionCandidate): Promise<boolean> {
    const probe = new IpcClient({ baseDir: c.dir, ...DEFAULT_IPC_CONFIG, commandTimeoutMs: ADOPT_PING_TIMEOUT_MS });
    try {
      const r = await probe.sendCommand('print("SCRIPT_SUCCESS: adopt ping")', ADOPT_PING_TIMEOUT_MS);
      if (!r.success) return false;
    } catch {
      launcherLog.info(`Session ${path.basename(c.dir)} (PID ${c.pid}) did not answer the adoption ping`);
      return false;
    }
    this.ipcDir = c.dir;
    this.sessionId = path.basename(c.dir);
    this.ipcClient = new IpcClient({
      baseDir: c.dir,
      ...DEFAULT_IPC_CONFIG,
      ...(this.config.timeoutMs ? { commandTimeoutMs: this.config.timeoutMs } : {}),
    });
    this.writeOwner(c.dir);
    this.pid = c.pid;
    this.process = null;
    this.startedAt = c.ts;
    this.lastError = null;
    this.lastLaunchAdopted = true;
    this.setState('ready');
    this.startHealthMonitor();
    launcherLog.info(
      this.attached
        ? `Attached to CODESYS PID ${c.pid}, opened by the user (session ${this.sessionId})`
        : `Took over running CODESYS PID ${c.pid} (session ${this.sessionId})`
    );
    return true;
  }

  /**
   * Stop an attach session's watcher. The CODESYS (and any project open in
   * it) is the user's and stays as it is. The dir keeps its terminate signal
   * until pruneSessionDirs removes it later: deleting it at once could beat
   * a watcher still busy with a command to the signal, and its timer would
   * then poll a missing dir forever.
   */
  private async detachSession(client: IpcClient): Promise<void> {
    try {
      await client.sendTerminate();
    } catch {
      launcherLog.warn('Failed to send terminate signal to the attach session');
    }
  }

  /** Open projects of a CODESYS through a watcher's session dir; null when it does not answer. */
  private async listProjectsVia(dir: string, timeoutMs = LIST_PROBE_TIMEOUT_MS): Promise<Array<{ path: string; dirty: boolean }> | null> {
    try {
      // Own client, own short timeout: the shared one has a 180 s floor.
      const c = new IpcClient({ baseDir: dir, ...DEFAULT_IPC_CONFIG, commandTimeoutMs: timeoutMs });
      const r = await c.sendCommand(LIST_PROJECTS_SCRIPT, timeoutMs);
      return r.success ? parseProjectList(r.output) : null;
    } catch {
      return null;
    }
  }

  /**
   * Ask the user (through the agent) what happens to other CODESYS of the
   * install before one more starts, or act on their answer. Throws the
   * question when there is no answer yet. 'close' / 'save-and-close' act
   * only on the CODESYS the question named (one opened since then was never
   * shown to the user); 'leave' holds for the rest of this server's life.
   * Returns the CODESYS of the install still running.
   */
  private async decideAboutOthers(conflicting: RunningCodesys[], opts: LaunchOptions): Promise<RunningCodesys[]> {
    const choice = opts.otherInstances ?? this.otherInstancesChoice;
    if (!choice) {
      const infos = await this.describeInstances(conflicting);
      this.askedPids = new Set(infos.map((i) => i.pid));
      const msg = buildLaunchQuestion(this.config.profileName, infos);
      this.lastError = msg;
      launcherLog.info(`Launch waits for the user's answer about ${infos.length} other CODESYS`);
      throw new DecisionNeededError(msg);
    }
    if (choice === 'leave') {
      this.otherInstancesChoice = 'leave';
      return conflicting;
    }
    const asked = this.askedPids;
    const targets = asked.size > 0 ? conflicting.filter((p) => asked.has(p.pid)) : conflicting;
    const infos = await this.describeInstances(targets);
    this.lastCloseReport = await this.closeInstances(infos, choice === 'save-and-close');
    this.askedPids = new Set();
    launcherLog.info(`Other CODESYS, user's answer '${choice}':\n${this.lastCloseReport.join('\n')}`);
    return this.findConflictingInstances();
  }

  /**
   * Who runs each CODESYS and whether it holds unsaved work: through its
   * watcher where one answers (left by an ended session, or attached), else
   * from the window title. Another live session's watcher is not used.
   */
  async describeInstances(running: RunningCodesys[]): Promise<InstanceInfo[]> {
    const sessions = this.sessionsByPid();
    const titleOf = this.deps.windowTitle ?? windowTitleOf;
    const out: InstanceInfo[] = [];
    for (const p of running) {
      const s = sessions.get(p.pid);
      const kind: InstanceInfo['kind'] = !s
        ? 'opened by hand'
        : s.foreignOwner
          ? 'used by another live MCP session'
          : s.attach
            ? 'attached'
            : 'left by an ended MCP session';
      const dir = s && !s.foreignOwner && s.dir ? s.dir : null;
      const projects = dir ? await this.listProjectsVia(dir) : null;
      const title = titleOf(p.pid);
      const unsaved = projects ? projects.some((x) => x.dirty) : title ? titleShowsUnsaved(title) : null;
      out.push({ pid: p.pid, kind, title, projects, unsaved, dir: projects ? dir : null });
    }
    return out;
  }

  /**
   * Close other CODESYS on the user's answer. Never one another live MCP
   * session drives. A normal window close (taskkill without /F): CODESYS
   * asks about unsaved changes itself and stays open until answered; it is
   * never forced. With save, unsaved projects are saved first through the
   * instance's watcher; one without a watcher cannot be saved from here.
   */
  async closeInstances(infos: InstanceInfo[], save: boolean): Promise<string[]> {
    const report: string[] = [];
    for (const i of infos) {
      if (i.kind === 'used by another live MCP session') {
        report.push(`PID ${i.pid}: left open, another live MCP session uses it`);
        continue;
      }
      if (save && i.unsaved && i.dir) {
        try {
          const c = new IpcClient({ baseDir: i.dir, ...DEFAULT_IPC_CONFIG, commandTimeoutMs: PROJECT_SAVE_TIMEOUT_MS });
          const r = await c.sendCommand(SAVE_PROJECTS_SCRIPT, PROJECT_SAVE_TIMEOUT_MS);
          if (!r.success) {
            report.push(`PID ${i.pid}: NOT closed, saving failed: ${(r.error || r.output).trim().slice(-300)}`);
            continue;
          }
          report.push(`PID ${i.pid}: unsaved projects saved`);
        } catch (e) {
          report.push(`PID ${i.pid}: NOT closed, saving failed: ${(e as Error).message}`);
          continue;
        }
      } else if (save && i.unsaved) {
        report.push(`PID ${i.pid}: no watcher to save through; CODESYS will ask about its unsaved changes in its window`);
      }
      try {
        execSync(`taskkill /PID ${i.pid}`, { timeout: 5000, stdio: 'ignore' });
      } catch {
        // already gone, or it refused; checked below
      }
      const deadline = Date.now() + CLOSE_WAIT_MS;
      while (pidAlive(i.pid) && Date.now() < deadline) await this.sleep(500);
      report.push(
        pidAlive(i.pid)
          ? `PID ${i.pid}: still open, CODESYS is probably asking about unsaved changes in its window; answer it there`
          : `PID ${i.pid}: closed`
      );
    }
    return report;
  }

  /**
   * Find CODESYS.exe instances using the same install path as our config.
   * Public so the server can decide whether to soft-fail vs. propagate.
   */
  findConflictingInstances(): RunningCodesys[] {
    return (this.deps.findRunning ?? findRunningCodesys)().filter((p) =>
      pathsEqual(p.exePath, this.config.codesysPath)
    );
  }

  /**
   * Taskkill conflicting same-install CODESYS.exe processes. Returns the
   * PIDs that were killed. Used by launch({ killExisting: true }) and by
   * the launch_codesys MCP tool to resolve a conflict from chat.
   */
  /**
   * CODESYS PIDs a live MCP server other than this one is using: their
   * session dir's ready.signal names the PID and owner.json a live server.
   * killExisting never kills those; with several instances per install
   * allowed, another session's CODESYS is not an orphan.
   */
  private pidsOwnedByOtherServers(): Set<number> {
    const owned = new Set<number>();
    for (const [pid, s] of this.sessionsByPid()) if (s.foreignOwner) owned.add(pid);
    return owned;
  }

  /**
   * CODESYS PIDs named by a session dir's ready.signal: whether an MCP
   * server started that CODESYS (a plain session dir) or the user opened it
   * and ran the attach script (attach-*), and whether another live server
   * uses it.
   */
  private sessionsByPid(): Map<number, { attach: boolean; foreignOwner: boolean; dir?: string }> {
    const out = new Map<number, { attach: boolean; foreignOwner: boolean; dir?: string }>();
    let entries: string[];
    try {
      entries = fs.readdirSync(this.sessionBaseDir());
    } catch {
      return out;
    }
    for (const name of entries) {
      const dir = path.join(this.sessionBaseDir(), name);
      try {
        const info = JSON.parse(fs.readFileSync(path.join(dir, 'ready.signal'), 'utf-8'));
        if (typeof info?.pid !== 'number') continue;
        const prev = out.get(info.pid);
        const live = !fs.existsSync(path.join(dir, 'terminate.signal'));
        out.set(info.pid, {
          attach: (prev?.attach ?? false) || name.startsWith(ATTACH_SESSION_PREFIX),
          foreignOwner: (prev?.foreignOwner ?? false) || this.liveForeignOwner(dir) !== null,
          // A dir whose watcher may still answer (no terminate signal).
          dir: live ? dir : prev?.dir,
        });
      } catch {
        // no ready.signal or unreadable: not a live session
      }
    }
    return out;
  }

  /**
   * Same-install instances killExisting may kill: not used by another live
   * server, and not a CODESYS the user opened and attached (that one holds
   * the user's own work).
   */
  private findKillableInstances(exclude: Set<number> = new Set()): RunningCodesys[] {
    const sessions = this.sessionsByPid();
    return this.findConflictingInstances().filter((p) => !exclude.has(p.pid) && this.isOrphan(p.pid, sessions));
  }

  /**
   * A CODESYS the MCP may kill: an MCP server started it (a plain session
   * dir names its PID) and no live server uses it. Never one the user opened
   * by hand (no session dir, or an attach session, also after a detach),
   * nor one another live session drives.
   */
  private isOrphan(pid: number, sessions: Map<number, { attach: boolean; foreignOwner: boolean; dir?: string }>): boolean {
    const s = sessions.get(pid);
    return s !== undefined && !s.attach && !s.foreignOwner;
  }

  killConflictingInstances(exclude: Set<number> = new Set()): number[] {
    const killed: number[] = [];
    for (const p of this.findKillableInstances(exclude)) {
      try {
        execSync(`taskkill /PID ${p.pid}`, { timeout: 5000, stdio: 'ignore' });
        killed.push(p.pid);
      } catch {
        try {
          execSync(`taskkill /F /PID ${p.pid}`, { timeout: 5000, stdio: 'ignore' });
          killed.push(p.pid);
        } catch {
          // ignore -- caller will see the survivor in a follow-up scan
        }
      }
    }
    return killed;
  }

  /** Launch CODESYS with UI and watcher script */
  /**
   * Launch, or take over a running CODESYS. Concurrent calls share one
   * attempt: the takeover ping runs before the state turns 'launching', so
   * without this two tool calls could both adopt (double health monitor) or
   * one could fail after the other succeeded.
   */
  async launch(opts: LaunchOptions = {}): Promise<void> {
    if (this.launchInFlight) {
      if (!opts.killExisting && !opts.otherInstances) return this.launchInFlight;
      // killExisting asks for a fresh instance: let the running attempt
      // finish, then run our own instead of quietly dropping the option.
      await this.launchInFlight.catch(() => undefined);
    }
    this.launchInFlight = this.doLaunch(opts).finally(() => {
      this.launchInFlight = null;
    });
    return this.launchInFlight;
  }

  private async doLaunch(opts: LaunchOptions = {}): Promise<void> {
    this.pruneSessionDirs();
    this.lastCloseReport = [];
    if (this.state === 'ready' || this.state === 'launching') {
      launcherLog.warn(`Cannot launch: state is ${this.state}`);
      return;
    }

    this.lastError = null;

    // Validate CODESYS exe exists
    if (!fs.existsSync(this.config.codesysPath)) {
      const err = `CODESYS executable not found: ${this.config.codesysPath}`;
      this.setState('error');
      this.lastError = err;
      throw new Error(err);
    }

    // Other CODESYS instances of this install. One left running by an earlier
    // session is taken over. Any other one (opened by hand, or owned by
    // another live MCP server) no longer blocks the launch: a second instance
    // of the same install runs fine next to it, each with its own watcher dir
    // (verified 2026-10-05: three SP21 instances started together, each
    // driven independently). The comment that stood here assumed CODESYS
    // enforces one instance per install; it does not. What does conflict is
    // one .project in two instances (modal read-only prompt), and
    // ensure_project_open refuses that from the project's .~u lock file.
    // --single-instance restores the old refusal.
    let conflicting = this.findConflictingInstances();
    this.lastLaunchAdopted = false;
    // A CODESYS of this install left running by an earlier session: take it
    // over instead of refusing (killExisting asks for a fresh instance).
    if (conflicting.length > 0 && !opts.killExisting && (await this.tryAdopt(conflicting))) {
      return;
    }
    // Other CODESYS of the install that cannot be taken over (opened by
    // hand, busy, or another live session's): ask the user, through the
    // agent, before starting one more. Their answer comes back as
    // otherInstances; 'leave' holds for the rest of this server's life.
    if (conflicting.length > 0 && !opts.killExisting && !this.config.singleInstance) {
      conflicting = await this.decideAboutOthers(conflicting, opts);
    }
    // killExisting never force-kills unsaved work: such an orphan needs the
    // user's answer, and is then saved and/or closed normally, or left.
    let keepAlive = new Set<number>();
    if (conflicting.length > 0 && opts.killExisting) {
      // Unknown counts as unsaved: never force-killed unasked.
      const unsaved = (await this.describeInstances(this.findKillableInstances())).filter((i) => i.unsaved !== false);
      if (unsaved.length > 0) {
        if (!opts.otherInstances) {
          const msg =
            `killExisting would kill CODESYS with unsaved changes:\n${formatInstances(unsaved)}\n` +
            `ASK THE USER, then call launch_codesys with killExisting=true and otherInstances: ` +
            `'save-and-close' (save, then close), 'close' (close normally; CODESYS asks about the changes itself) ` +
            `or 'leave' (kill only the others).`;
          this.lastError = msg;
          throw new DecisionNeededError(msg);
        }
        if (opts.otherInstances !== 'leave') {
          this.lastCloseReport = await this.closeInstances(unsaved, opts.otherInstances === 'save-and-close');
        }
        keepAlive = new Set(unsaved.map((i) => i.pid));
      }
    }
    if (conflicting.length > 0 && opts.killExisting) {
      const spared = this.pidsOwnedByOtherServers();
      const sparedHere = conflicting.filter((p) => spared.has(p.pid)).map((p) => p.pid);
      if (sparedHere.length > 0) {
        launcherLog.info(`killExisting spares CODESYS PID(s) ${sparedHere.join(', ')}: another live MCP session uses them`);
      }
      conflicting = conflicting.filter((p) => !spared.has(p.pid));
      const killed = this.killConflictingInstances(keepAlive);
      launcherLog.info(`Killed ${killed.length} conflicting CODESYS PID(s): ${killed.join(', ')}`);
      // taskkill returns synchronously but Windows can take a tick longer
      // to actually evict the PID from the process table. If we re-scan
      // too eagerly we still see the corpse and falsely throw a conflict.
      // Poll until the killed PIDs are all gone (or 2s timeout).
      const killedSet = new Set(killed);
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const stillAlive = this.findKillableInstances(keepAlive);
        const ghosts = stillAlive.filter((p) => killedSet.has(p.pid));
        if (ghosts.length === 0) {
          conflicting = stillAlive;
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
        conflicting = stillAlive; // ensures `conflicting` reflects last scan on timeout
      }
      // A plain taskkill only asks CODESYS to close; it can take longer than
      // 2s or sit on a "save changes?" dialog. killExisting means kill, so
      // force the survivors and give Windows a few more seconds.
      if (conflicting.length > 0) {
        for (const p of conflicting) {
          try {
            execSync(`taskkill /F /PID ${p.pid}`, { timeout: 5000, stdio: 'ignore' });
          } catch {
            // re-scan below decides
          }
        }
        const forceDeadline = Date.now() + 5000;
        while (Date.now() < forceDeadline) {
          conflicting = this.findKillableInstances(keepAlive);
          if (conflicting.length === 0) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      // Instances spared above still run (opened by hand, attached, another
      // live session's): starting ours next to them needs the user's answer
      // as well, killExisting or not.
      conflicting = this.findConflictingInstances();
      if (conflicting.length > 0 && !this.config.singleInstance) {
        conflicting = await this.decideAboutOthers(conflicting, opts);
      }
    }

    if (conflicting.length > 0 && !this.config.singleInstance) {
      launcherLog.info(
        `Starting another CODESYS next to running PID(s) ${conflicting.map((p) => p.pid).join(', ')} ` +
        `of the same install (none could be taken over)`
      );
      conflicting = [];
    }
    if (conflicting.length > 0) {
      const pids = conflicting.map((p) => p.pid).join(', ');
      const msg =
        `Refusing to launch: ${conflicting.length} CODESYS.exe instance(s) ` +
        `of the same install already running (PID(s): ${pids}, exe: ` +
        `${this.config.codesysPath}) without a watcher that answers, so it ` +
        `cannot be taken over (a CODESYS opened by hand, or a busy one), and --single-instance is set. Close the existing window(s) ` +
        `(the MCP never kills a CODESYS opened by hand; attach_codesys works in it instead). ` +
        `A CODESYS an ended MCP session left behind can be cleared with launch_codesys killExisting=true. ` +
        `Other CODESYS installs are unaffected and may keep running.`;
      launcherLog.warn(msg);
      this.lastError = msg;
      this.setState('error');
      const err = new Error(msg) as Error & { code?: string; conflictingPids?: number[] };
      err.code = 'CODESYS_LAUNCH_CONFLICT';
      err.conflictingPids = conflicting.map((p) => p.pid);
      throw err;
    }

    this.setState('launching');
    this.sessionId = uuidv4();
    this.ipcDir = path.join(os.tmpdir(), SESSION_DIR_PREFIX, this.sessionId);

    launcherLog.info(`Session ${this.sessionId} — IPC dir: ${this.ipcDir}`);

    // Create IPC client and directories
    this.ipcClient = new IpcClient({
      baseDir: this.ipcDir,
      ...DEFAULT_IPC_CONFIG,
      ...(this.config.timeoutMs ? { commandTimeoutMs: this.config.timeoutMs } : {}),
    });
    await this.ipcClient.ensureDirectories();
    this.writeOwner(this.ipcDir);

    // Prepare watcher script with interpolated IPC path
    const scriptManager = new ScriptManager();
    const watcherTemplate = scriptManager.loadTemplate('watcher');
    const ipcPathEscaped = this.ipcDir.replace(/\\/g, '\\\\');
    const watcherContent = scriptManager.interpolate(watcherTemplate, {
      IPC_BASE_DIR: ipcPathEscaped,
    });

    // Write interpolated watcher to IPC directory
    const watcherPath = path.join(this.ipcDir, 'watcher.py');
    fs.writeFileSync(watcherPath, watcherContent, 'utf-8');

    // Build CODESYS command
    const quotedExe = `"${this.config.codesysPath}"`;
    const profileArg = `--profile="${this.config.profileName}"`;
    // Add-on packages (Script Engine included) live in a per-installation
    // AdditionalFolders subdir with its own profile.xml under the SAME profile
    // name. Omit this and CODESYS boots the bare base profile with zero plugins.
    const folderArg = this.config.additionalFolder
      ? ` --additionalfolder="${this.config.additionalFolder}"`
      : '';
    const scriptArg = `--runscript="${watcherPath}"`;
    const fullCommand = `${quotedExe} ${profileArg}${folderArg} ${scriptArg}`;

    launcherLog.info(`Spawning: ${fullCommand}`);

    // Spawn CODESYS detached with UI visible
    const codesysDir = path.dirname(this.config.codesysPath);
    this.process = spawn(fullCommand, [], {
      detached: true,
      shell: true,
      windowsHide: false,
      stdio: 'ignore',
      cwd: codesysDir,
    });

    this.pid = this.process.pid ?? null;
    this.process.unref();

    launcherLog.info(`CODESYS spawned with PID ${this.pid}`);

    // Handle process exit
    const child = this.process;
    this.process.on('exit', (code) => {
      launcherLog.warn(`CODESYS process exited with code ${code}`);
      // Since adopted or attached elsewhere: this exit is no longer ours.
      if (this.process !== child) return;
      if (this.state !== 'stopping') {
        this.lastError = `CODESYS exited unexpectedly (code ${code})`;
        this.setState('error');
      }
      this.pid = null;
      this.process = null;
    });

    // Poll for ready.signal
    const readyStart = Date.now();
    while (Date.now() - readyStart < READY_TIMEOUT_MS) {
      if (await this.ipcClient.isReady()) {
        this.adoptCodesysPid();
        this.setState('ready');
        this.startedAt = Date.now();
        this.lastError = null;
        launcherLog.info('CODESYS watcher is ready');
        this.startHealthMonitor();
        return;
      }
      await this.sleep(READY_POLL_MS);
    }

    // Timeout — watcher never signaled ready
    this.lastError = `Watcher did not signal ready within ${READY_TIMEOUT_MS}ms`;
    this.setState('error');
    throw new Error(this.lastError);
  }

  /** Graceful shutdown */
  /**
   * Shut CODESYS down. Unsaved projects are never thrown away unasked:
   * unsaved 'ask' (the default) refuses with a DecisionNeededError listing
   * them, 'save' saves them first, 'keep-open' leaves CODESYS open with them
   * (a later launch takes it over), 'discard' closes without saving.
   */
  async shutdown(opts: { unsaved?: UnsavedChoice } = {}): Promise<void> {
    const unsavedChoice: UnsavedChoice = opts.unsaved ?? 'ask';
    this.lastShutdownReport = [];
    // Orphan-killing fallback: if the launcher itself has no tracked PID
    // (state stopped/error after a fresh MCP server start) but a CODESYS.exe
    // is alive on the box from a previous session, the previous early-return
    // would say "shutdown_codesys success" and do nothing. This left the
    // launcher's refuse-on-duplicate guard permanently blocking new spawns.
    // Now we taskkill any orphans we can find before the early-return so the
    // tool actually does something useful in this state.
    if (this.state === 'stopped' || this.state === 'stopping') {
      if (this.pid === null) {
        // Only kill orphans: a CODESYS of OUR configured exe that an MCP
        // server started (its session dir names the PID) and no live server
        // uses. Never one the user opened by hand (no session dir, or an
        // attach session), nor another session's (several instances per
        // install run side by side since 9131b4b), nor another install's.
        const sessions = this.sessionsByPid();
        const orphans = (this.deps.findRunning ?? findRunningCodesys)().filter(
          (p) => pathsEqual(p.exePath, this.config.codesysPath) && this.isOrphan(p.pid, sessions)
        );
        // An orphan with unsaved work is not killed unasked.
        const unsavedOrphans = (await this.describeInstances(orphans)).filter((i) => i.unsaved !== false);
        if (unsavedOrphans.length > 0 && unsavedChoice === 'ask') {
          throw new DecisionNeededError(
            `CODESYS left by an ended MCP session has unsaved changes:\n${formatInstances(unsavedOrphans)}\n` +
              `ASK THE USER, then call shutdown_codesys with unsavedChanges: 'save' (save, then close), ` +
              `'discard' (close without saving) or 'keep-open' (leave it open).`
          );
        }
        const skip = new Set<number>();
        for (const i of unsavedOrphans) {
          if (unsavedChoice === 'keep-open') {
            skip.add(i.pid);
            this.lastShutdownReport.push(`PID ${i.pid}: left open with its unsaved changes`);
          } else if (unsavedChoice === 'save') {
            const report = await this.closeInstances([i], true);
            this.lastShutdownReport.push(...report);
            skip.add(i.pid); // closed normally, or left on CODESYS's own prompt
            if (report.some((l) => l.includes('NOT closed'))) {
              throw new Error(`Not shut down:\n${this.lastShutdownReport.map((l) => `  - ${l}`).join('\n')}`);
            }
          }
        }
        const toKill = orphans.filter((p) => !skip.has(p.pid));
        if (toKill.length > 0) {
          const orphanPids = toKill.map((p) => p.pid);
          launcherLog.info(`shutdown_codesys: launcher has no tracked PID but found ${orphanPids.length} orphan CODESYS.exe of the configured install (PIDs: ${orphanPids.join(', ')}). Force-killing.`);
          for (const pid of orphanPids) {
            try {
              execSync(`taskkill /PID ${pid}`, { timeout: 5000, stdio: 'ignore' });
            } catch { /* ignore graceful failures, force-kill below */ }
          }
          // Give them a moment to close gracefully
          await this.sleep(2_000);
          const stillAlive = orphanPids.filter((pid) => pidAlive(pid));
          for (const pid of stillAlive) {
            try {
              execSync(`taskkill /F /PID ${pid}`, { timeout: 5000, stdio: 'ignore' });
            } catch { /* nothing else to try */ }
          }
        }
      }
      return;
    }

    // Unsaved projects in our own CODESYS: never closed without an answer.
    if (!this.attached && this.ipcClient && this.state === 'ready' && unsavedChoice !== 'discard') {
      let projects: Array<{ path: string; dirty: boolean }> | null = null;
      try {
        projects = this.ipcDir ? await this.listProjectsVia(this.ipcDir, ADOPT_PING_TIMEOUT_MS) : null;
      } catch {
        projects = null; // no answer: CODESYS is hung or gone; shut down as before
      }
      let dirty = (projects ?? []).filter((p) => p.dirty);
      if (projects === null && this.pid !== null) {
        // No list: judge by the window title ("Name.project*"); a title
        // that cannot be read counts as unsaved, never as clean.
        const title = (this.deps.windowTitle ?? windowTitleOf)(this.pid);
        if (!title || titleShowsUnsaved(title)) {
          dirty = [{ path: title ? `(from the window title) ${title}` : '(unsaved state could not be read)', dirty: true }];
        }
      }
      if (dirty.length > 0) {
        const list = dirty.map((p) => `  - ${p.path}`).join('\n');
        if (unsavedChoice === 'ask') {
          throw new DecisionNeededError(
            `CODESYS (PID ${this.pid}) has unsaved changes in:\n${list}\n` +
              `ASK THE USER, then call shutdown_codesys with unsavedChanges: 'save' (save, then close), ` +
              `'discard' (close without saving) or 'keep-open' (leave CODESYS open; the next launch takes it over).`
          );
        }
        if (unsavedChoice === 'keep-open') {
          // Leave CODESYS and its watcher as they are: no terminate signal,
          // so a later launch (this server or the next) takes it over.
          this.stopHealthMonitor();
          const pid = this.pid;
          this.pid = null;
          this.process = null;
          this.ipcClient = null;
          this.ipcDir = null;
          this.sessionId = null;
          this.setState('stopped');
          launcherLog.info(`Left CODESYS PID ${pid} open with unsaved changes, on the user's answer`);
          return;
        }
        // save
        const r = await this.ipcClient.sendCommand(SAVE_PROJECTS_SCRIPT, PROJECT_SAVE_TIMEOUT_MS, { abortWhen: this.goneCheck() });
        if (!r.success) {
          throw new Error(`Not shut down: saving failed: ${(r.error || r.output).trim().slice(-400)}`);
        }
        launcherLog.info(`Saved before shutdown: ${dirty.map((p) => p.path).join(', ')}`);
      }
    }

    this.setState('stopping');
    this.stopHealthMonitor();

    // A CODESYS the user opened and attached is theirs: detach (stop the
    // watcher) and leave it and its projects open.
    if (this.attached && this.ipcClient) {
      const pid = this.pid;
      await this.detachSession(this.ipcClient);
      this.pid = null;
      this.process = null;
      this.ipcClient = null;
      this.ipcDir = null;
      this.sessionId = null;
      this.setState('stopped');
      launcherLog.info(`Detached from CODESYS PID ${pid}; it stays open (opened by the user)`);
      return;
    }

    // Try to close projects and quit CODESYS gracefully via script
    if (this.ipcClient && this.state !== 'error') {
      try {
        launcherLog.info('Sending quit script to close projects and exit CODESYS...');
        await this.ipcClient.sendCommand(`
import sys
try:
    import scriptengine as se
    # Close all open projects without saving (unsaved ones were asked about
    # before this). ScriptProjects is not iterable: its list is .all.
    try:
        _open = list(se.projects.all)
    except Exception:
        _open = [se.projects.primary] if se.projects.primary is not None else []
    for p in _open:
        try:
            p.close()
        except:
            pass
    print("Projects closed")
except:
    pass
# Request CODESYS to quit
try:
    import scriptengine as se
    se.system.exit()
except:
    pass
print("SCRIPT_SUCCESS")
sys.exit(0)
`, 10_000, { abortWhen: this.goneCheck() });
      } catch {
        launcherLog.debug('Quit script timed out or failed (expected if CODESYS exits)');
      }
    }

    // Send terminate signal to watcher
    if (this.ipcClient) {
      try {
        await this.ipcClient.sendTerminate();
      } catch {
        launcherLog.warn('Failed to send terminate signal');
      }
    }

    // Wait for process exit
    if (this.pid !== null) {
      const waitStart = Date.now();
      while (Date.now() - waitStart < SHUTDOWN_WAIT_MS) {
        if (!this.isRunning()) break;
        await this.sleep(500);
      }

      // Force kill if still alive
      if (this.isRunning() && this.pid !== null) {
        launcherLog.warn('Force-killing CODESYS process');
        try {
          // On Windows, use taskkill for reliable process termination
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try {
              // First try graceful close (WM_CLOSE)
              execSync(`taskkill /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
              await this.sleep(3_000);
            } catch { /* ignore */ }
            if (this.isRunning()) {
              // Force kill
              try {
                execSync(`taskkill /F /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
              } catch { /* ignore */ }
            }
          } else if (this.process) {
            this.process.kill('SIGTERM');
            await this.sleep(2_000);
            if (this.isRunning() && this.process) {
              this.process.kill('SIGKILL');
            }
          }
        } catch {
          launcherLog.warn('Failed to kill CODESYS process');
        }
      }
    }

    // Clean up IPC directory
    if (this.ipcClient) {
      await this.ipcClient.cleanup();
    }

    this.pid = null;
    this.process = null;
    this.ipcClient = null;
    this.setState('stopped');
    launcherLog.info('Shutdown complete');
  }

  /** Execute a script through the IPC channel */
  async executeScript(content: string, timeoutMs?: number): Promise<IpcResult> {
    if (this.state !== 'ready' || !this.ipcClient) {
      throw new Error(`Cannot execute script: launcher state is '${this.state}'`);
    }
    return this.ipcClient.sendCommand(content, timeoutMs, { abortWhen: this.goneCheck() });
  }

  /**
   * A check that turns true once the CODESYS tracked now has exited: no
   * result can come any more. It holds on to the PID, because the exit
   * handler clears this.pid the moment CODESYS goes.
   */
  private goneCheck(): () => boolean {
    const pid = this.pid;
    return () => pid !== null && !pidAlive(pid);
  }

  /** Get current launcher status */
  getStatus(): LauncherStatus {
    this.revalidateLaunchRefusal();
    return {
      state: this.state,
      pid: this.pid,
      sessionId: this.sessionId,
      ipcDir: this.ipcDir,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  /**
   * If the launcher is parked in 'error' state because a previous launch
   * refused due to a foreign CODESYS, re-probe the process table. If those
   * conflicting PIDs are now gone, transition back to 'stopped' and clear
   * lastError so the next status call / launch attempt sees a fresh state.
   *
   * Without this, getStatus() returned a frozen snapshot of state+lastError,
   * so once "Refusing to launch" was cached, even closing the foreign
   * CODESYS wouldn't update the status -- only an MCP restart would.
   * Distinct from the launch()-time guard at line ~145 (which already
   * re-probes) because users hit `get_codesys_status` first to figure out
   * what's wrong, and a stale "Refusing to launch" is misleading.
   */
  private revalidateLaunchRefusal(): void {
    if (this.state !== 'error') return;
    if (!this.lastError?.startsWith('Refusing to launch:')) return;
    if (this.findConflictingInstances().length === 0) {
      launcherLog.info(
        'revalidateLaunchRefusal: cached "Refusing to launch" cleared -- ' +
        'no same-install CODESYS.exe currently in process table'
      );
      this.lastError = null;
      this.setState('stopped');
    }
  }

  /** Check if the CODESYS process is still alive */
  isRunning(): boolean {
    if (this.pid === null) return false;
    try {
      process.kill(this.pid, 0); // Signal 0 = test if process exists
      return true;
    } catch (e) {
      // EPERM: it exists but runs elevated (a CODESYS started as admin).
      return (e as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  /**
   * The spawn goes through a shell, so the PID we got back is cmd.exe, not
   * CODESYS. The watcher writes os.getpid() of CODESYS into ready.signal;
   * switch to that PID once it is confirmed to be a CODESYS.exe of our
   * install, so status, the health monitor and shutdown act on CODESYS itself.
   */
  private adoptCodesysPid(): void {
    if (!this.ipcDir) return;
    try {
      const info = JSON.parse(fs.readFileSync(path.join(this.ipcDir, 'ready.signal'), 'utf-8'));
      const pid = info?.pid;
      if (typeof pid !== 'number' || pid === this.pid) return;
      const ours = this.findConflictingInstances().some((p) => p.pid === pid);
      if (ours) {
        launcherLog.info(`CODESYS PID is ${pid} (spawned via shell PID ${this.pid})`);
        this.pid = pid;
      }
    } catch {
      // keep the shell PID; status is less precise but nothing breaks
    }
  }

  /** Register callback for state changes */
  onStateChange(callback: (state: CodesysState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  private setState(state: CodesysState): void {
    const prev = this.state;
    this.state = state;
    if (prev !== state) {
      launcherLog.info(`State: ${prev} -> ${state}`);
      for (const cb of this.stateChangeCallbacks) {
        try { cb(state); } catch { /* ignore callback errors */ }
      }
    }
  }

  private startHealthMonitor(): void {
    this.stopHealthMonitor();
    this.healthInterval = setInterval(() => {
      if (this.state === 'ready' && !this.isRunning()) {
        launcherLog.error('Health check: CODESYS process died');
        this.lastError = 'CODESYS process died unexpectedly';
        this.pid = null;
        this.process = null;
        this.setState('error');
        this.stopHealthMonitor();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthMonitor(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
