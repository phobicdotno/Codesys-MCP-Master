import { spawn } from 'child_process';
import * as path from 'path';

/**
 * Message boxes open in CODESYS before an online call.
 *
 * A modal box blocks every script the MCP sends: the online layer then fails
 * with "Stack empty" or the call hangs until its timeout. Seen 2026-10-17 on
 * a PLC behind a tunnel: a "No device is responding to the scan request" box
 * (left by a network scan) made create_online_application fail, and later a
 * "No connection to the device" box sat in the IDE after the tunnel dropped.
 *
 * Only boxes that report something and offer nothing to decide are answered
 * automatically, and only with the button that changes nothing. Any other
 * box stops the call with its text, so the user decides.
 */

export interface IdeDialog {
  hwnd: number;
  title: string;
  text: string;
  buttons: string[];
}

export interface DialogRule {
  /** Matched against the dialog text. */
  match: RegExp;
  /** The button to press; it must be one that changes nothing. */
  button: string;
  why: string;
}

export const AUTO_ANSWER: DialogRule[] = [
  {
    match: /No device is responding to the scan request/i,
    button: 'OK',
    why: 'result of a network scan; OK only closes it',
  },
  {
    match: /No connection to the device\.?\s*Please rescan your network/i,
    button: 'OK',
    why: 'report of a lost connection; OK only closes it',
  },
  {
    match: /No active path defined\.\s*Do you want to set it\?/i,
    button: 'Cancel',
    why: "Cancel returns without action; Yes would start a scan that cannot see a PLC behind a tunnel",
  },
];

export interface DialogPlan {
  answer: Array<{ dialog: IdeDialog; rule: DialogRule }>;
  blocking: IdeDialog[];
}

export function planDialogs(dialogs: IdeDialog[], rules: DialogRule[] = AUTO_ANSWER): DialogPlan {
  const plan: DialogPlan = { answer: [], blocking: [] };
  for (const d of dialogs) {
    const rule = rules.find((r) => r.match.test(d.text) && d.buttons.includes(r.button));
    if (rule) plan.answer.push({ dialog: d, rule });
    else plan.blocking.push(d);
  }
  return plan;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the helper; injectable so tests never start PowerShell. */
export type DialogHelperRunner = (args: string[], timeoutMs: number) => Promise<RunResult>;

export function dialogHelperPath(): string {
  return path.join(__dirname, 'scripts', 'ide_dialogs.ps1');
}

export const defaultDialogRunner: DialogHelperRunner = (args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', dialogHelperPath(), ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      stderr += `\ndialog helper timed out after ${Math.round(timeoutMs / 1000)} s`;
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

function lastJsonLine(stdout: string): unknown {
  const line = stdout.trim().split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export async function listDialogs(pid: number, run: DialogHelperRunner = defaultDialogRunner): Promise<IdeDialog[] | null> {
  const r = await run(['-TargetPid', String(pid)], 15_000);
  const j = lastJsonLine(r.stdout) as { dialogs?: unknown } | null;
  if (!j || !Array.isArray(j.dialogs)) return null;
  return (j.dialogs as Array<Partial<IdeDialog>>).map((d) => ({
    hwnd: Number(d.hwnd),
    title: String(d.title ?? ''),
    text: String(d.text ?? ''),
    buttons: Array.isArray(d.buttons) ? d.buttons.map(String) : d.buttons ? [String(d.buttons)] : [],
  }));
}

export interface DialogCheck {
  /** Set when a box needs the user: the online call must not start. */
  block: string | null;
  /** What was answered automatically, for the reply. */
  answered: string[];
}

/**
 * Before an online call: answer the harmless boxes, refuse on any other.
 * A helper failure never blocks (the call then runs as before).
 */
export async function clearIdeDialogs(pid: number | null, run: DialogHelperRunner = defaultDialogRunner): Promise<DialogCheck> {
  if (pid === null || process.platform !== 'win32') return { block: null, answered: [] };
  const dialogs = await listDialogs(pid, run);
  if (!dialogs || dialogs.length === 0) return { block: null, answered: [] };
  const plan = planDialogs(dialogs);
  const answered: string[] = [];
  for (const { dialog, rule } of plan.answer) {
    const r = await run(['-TargetPid', String(pid), '-Hwnd', String(dialog.hwnd), '-Button', rule.button], 15_000);
    const j = lastJsonLine(r.stdout) as { ok?: boolean; message?: string } | null;
    if (j?.ok) answered.push(`Closed a CODESYS box with ${rule.button} (${rule.why}): "${oneLine(dialog.text)}"`);
    else plan.blocking.push(dialog);
  }
  if (plan.blocking.length === 0) return { block: null, answered };
  const list = plan.blocking
    .map((d) => `  - "${oneLine(d.text) || d.title}" [buttons: ${d.buttons.join(', ') || 'none'}]`)
    .join('\n');
  return {
    block: `CODESYS (PID ${pid}) has a dialog open that blocks every script, so the online call did not start:\n${list}\n` +
      `ASK THE USER which button to press (or to close it), then retry.`,
    answered,
  };
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
