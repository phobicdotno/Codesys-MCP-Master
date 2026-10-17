import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Automatic attach: run the attach script in a CODESYS the user opened, with
 * no one at the keyboard.
 *
 * scripts/attach_uia.ps1 presses Tools > Scripting > Execute Script File...
 * of the CODESYS with the given PID through the accessibility interface of
 * its WinForms menu (MSAA, the provider UI Automation wraps), puts the
 * script path into the Open dialog's file name box with WM_SETTEXT and
 * posts IDOK to the dialog. It never uses the foreground window, never moves
 * the mouse, never types into the desktop, and reports success only when the
 * window title shows the watcher's " [MCP]" marker. Verified on SP18 P5
 * 2026-10-17: the hidden menu item runs without any menu opening on screen.
 */

export interface AttachAutomationResult {
  ok: boolean;
  /** Where it ended: done, already, probe, or the failing step (modal, menu-tools, file-dialog, ...). */
  stage: string;
  message: string;
  /** CODESYS main window title at the end. */
  title: string;
  /** How each menu step was matched (tools:name, execute:position, press:direct, ...). */
  matchedBy: string[];
  /** Top-level menu names found. */
  menu: string[];
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the helper; injectable so tests never start PowerShell. */
export type HelperRunner = (args: string[], timeoutMs: number) => Promise<RunResult>;

export function attachHelperPath(): string {
  return path.join(__dirname, 'scripts', 'attach_uia.ps1');
}

export const defaultHelperRunner: HelperRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', attachHelperPath(), ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      stderr += `\nattach helper timed out after ${Math.round(timeoutMs / 1000)} s`;
      child.kill();
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

/** The helper prints one JSON line; anything else is a failure with the raw output in the message. */
export function parseHelperOutput(run: RunResult): AttachAutomationResult {
  const lines = run.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (typeof o?.ok === 'boolean' && typeof o?.stage === 'string') {
        return {
          ok: o.ok,
          stage: o.stage,
          message: typeof o.message === 'string' ? o.message : '',
          title: typeof o.title === 'string' ? o.title : '',
          matchedBy: Array.isArray(o.matchedBy) ? o.matchedBy.map(String) : [],
          menu: Array.isArray(o.menu) ? o.menu.map(String) : [],
        };
      }
    } catch {
      // not the result line
    }
  }
  const raw = `${run.stdout}\n${run.stderr}`.trim().slice(-500);
  return {
    ok: false,
    stage: 'helper',
    message: `The attach helper gave no result (exit ${run.code ?? 'none'})${raw ? `: ${raw}` : ''}`,
    title: '',
    matchedBy: [],
    menu: [],
  };
}

export interface AttachAutomationOptions {
  /** How long the helper waits for the [MCP] title marker after the script ran. Default 60 s. */
  timeoutSeconds?: number;
  /** Only find the menu path; run nothing. */
  probeOnly?: boolean;
  runner?: HelperRunner;
  platform?: NodeJS.Platform;
}

/** Run the attach script in the CODESYS with this PID (and no other). */
export async function runAttachAutomation(
  pid: number,
  scriptPath: string,
  opts: AttachAutomationOptions = {}
): Promise<AttachAutomationResult> {
  const fail = (stage: string, message: string): AttachAutomationResult => ({ ok: false, stage, message, title: '', matchedBy: [], menu: [] });
  if ((opts.platform ?? process.platform) !== 'win32') return fail('platform', 'Automatic attach needs Windows.');
  if (!Number.isInteger(pid) || pid <= 0) return fail('process', `Invalid CODESYS PID ${pid}.`);
  const timeoutSeconds = Math.max(5, Math.round(opts.timeoutSeconds ?? 60));
  const args = ['-TargetPid', String(pid), '-TimeoutSeconds', String(timeoutSeconds)];
  if (opts.probeOnly) args.push('-ProbeOnly');
  else args.push('-ScriptPath', scriptPath);
  // Helper start (C# compile ~2 s) + menu + dialog (up to ~35 s) + the title wait.
  const run = await (opts.runner ?? defaultHelperRunner)(args, (timeoutSeconds + 60) * 1000);
  return parseHelperOutput(run);
}

/** One line for a tool reply. */
export function describeAutomation(r: AttachAutomationResult): string {
  return r.ok ? r.message : `automatic attach failed at step '${r.stage}': ${r.message}`;
}

/** A CODESYS the automation may target: opened by hand, of an installed version. */
export interface AttachCandidate {
  pid: number;
  /** Install label (e.g. "SP21 Patch 5"). */
  label: string;
  title: string;
}

export type AutoAttachOutcome =
  | { kind: 'attached'; pid: number; label: string; automation: AttachAutomationResult }
  | { kind: 'failed'; pid: number; label: string; automation: AttachAutomationResult }
  | { kind: 'choose'; candidates: AttachCandidate[] }
  | { kind: 'not-candidate'; pid: number; candidates: AttachCandidate[] }
  | { kind: 'none' };

export interface AutoAttachDeps {
  candidates: AttachCandidate[];
  /** Only this CODESYS; required when there are several candidates. */
  pid?: number;
  /** Runs the helper against one PID. */
  automate: (pid: number) => Promise<AttachAutomationResult>;
  /** Takes over the attach session the script made; returns the CODESYS PID or null. */
  pickUp: (c: AttachCandidate) => Promise<number | null>;
}

/**
 * Decide which CODESYS to attach automatically, run the helper on that one
 * only, and take over the session it made. Never guesses between several
 * CODESYS: the user picks (pid).
 */
export async function autoAttach(d: AutoAttachDeps): Promise<AutoAttachOutcome> {
  let target: AttachCandidate | undefined;
  if (d.pid !== undefined) {
    target = d.candidates.find((c) => c.pid === d.pid);
    if (!target) return { kind: 'not-candidate', pid: d.pid, candidates: d.candidates };
  } else if (d.candidates.length === 1) {
    target = d.candidates[0];
  } else if (d.candidates.length > 1) {
    return { kind: 'choose', candidates: d.candidates };
  } else {
    return { kind: 'none' };
  }
  const automation = await d.automate(target.pid);
  if (!automation.ok) return { kind: 'failed', pid: target.pid, label: target.label, automation };
  const pid = await d.pickUp(target);
  if (pid === null) {
    return {
      kind: 'failed',
      pid: target.pid,
      label: target.label,
      automation: {
        ...automation,
        ok: false,
        stage: 'pickup',
        message:
          automation.stage === 'already'
            ? `${automation.message} Its watcher is not one this server may take over (another live MCP session drives it, or it is still starting).`
            : `${automation.message} But no attach session of CODESYS PID ${target.pid} answered the MCP afterwards.`,
      },
    };
  }
  return { kind: 'attached', pid, label: target.label, automation };
}

export function formatCandidates(cs: AttachCandidate[]): string {
  return cs.map((c) => `  - PID ${c.pid} (${c.label}): ${c.title || '(no title)'}`).join('\n');
}
