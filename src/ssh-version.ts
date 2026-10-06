import { spawn } from 'child_process';

/**
 * Read the running PLC's project version over SSH, bypassing the CODESYS
 * IDE entirely.
 *
 * WHY: read_running_version_online needs CODESYS open + the .project file
 * unlocked + the device-online protocol reachable. When any of those is
 * absent (project file held by another CODESYS instance, no CODESYS
 * install on this machine, online protocol blocked), the only remaining
 * path to the running version is the boot-application binary on disk on
 * the PLC itself. The X.Y.Z.W literal of `_MCP_PROJECT_VERSION.sVersion`
 * is baked into that binary by the compiler; its printable strings
 * carry it.
 *
 * The CODESYS V3.5 SP-runtime version (e.g. 3.5.22.0) is also baked in
 * by the same toolchain; we filter `3.5.*` out so the caller gets just
 * the project-version literal.
 *
 * Implementation choices:
 *   - Spawn the system `ssh` binary instead of pulling in `ssh2` /
 *     `node-ssh` - zero new npm deps and the user already has ssh
 *     keys configured for the PLC anyway.
 *   - `BatchMode=yes` so the call fails fast when keys aren't installed
 *     instead of hanging on a password prompt.
 *   - `sudo -n` for the same reason - non-interactive; clear failure
 *     when NOPASSWD sudo isn't configured for `cat`. As root (WAGO
 *     PFC200/CC100) no sudo is used.
 *   - The boot app is fetched and its strings picked here, so the PLC
 *     needs nothing beyond `cat` (WAGO BusyBox has no `strings`).
 */

export interface SshVersionResult {
  host: string;
  user: string;
  bootAppPath: string;
  projectVersion: string | null;
  candidates: string[];
  runtimeVersionLiterals: string[];
}

export interface SshVersionOptions {
  host: string;
  user?: string;
  bootAppPath?: string;
}

const DEFAULT_USER = 'karstein';
const DEFAULT_BOOT_APP_PATH = '/var/opt/codesys/PlcLogic/Application/Application.app';
// Where the boot app lives when no path is given: CODESYS Control for
// Linux SL first, then WAGO PFC200/CC100 firmware (verified on a lab PFC200,
// 2026-10-06).
const BOOT_APP_SEARCH = [
  DEFAULT_BOOT_APP_PATH,
  '/home/codesys_root/PlcLogic/Application/Application.app',
];
const BOOT_APP_MARKER = 'MCP_BOOT_APP=';

const VERSION_LITERAL_RE = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Pure parser, factored out so unit tests can exercise the filter logic
 * without spawning ssh. Splits stdout on newlines, trims, drops blanks
 * and non-X.Y.Z.W tokens, separates 3.5.* (CODESYS SP-runtime) from
 * everything else, and decides whether a unique project-version
 * candidate emerged.
 */
export function parseSshOutput(stdout: string): {
  candidates: string[];
  projectVersion: string | null;
  runtimeVersionLiterals: string[];
} {
  const literals = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => VERSION_LITERAL_RE.test(l));

  const runtimeVersionLiterals: string[] = [];
  const candidates: string[] = [];
  for (const lit of literals) {
    if (lit.startsWith('3.5.')) {
      runtimeVersionLiterals.push(lit);
    } else {
      candidates.push(lit);
    }
  }

  let projectVersion: string | null = null;
  if (candidates.length === 1) {
    projectVersion = candidates[0];
  }
  return { candidates, projectVersion, runtimeVersionLiterals };
}

/**
 * The printable runs of a binary, one per line, the way `strings` prints
 * them (runs of at least 4 printable ASCII characters). Done here rather
 * than on the PLC because PLC firmware often lacks `strings`: WAGO's
 * BusyBox has neither it nor a `tr` that understands [:print:].
 */
export function extractPrintableStrings(buf: Buffer, minLength = 4): string {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? buf[i] : 0;
    const printable = (b >= 0x20 && b <= 0x7e) || b === 0x09;
    if (printable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= minLength) out.push(buf.toString('latin1', start, i));
      start = -1;
    }
  }
  return out.join('\n');
}

/**
 * The remote shell command: pick the boot app (the given path, or the
 * first of BOOT_APP_SEARCH that exists), name it on stderr and stream it
 * to stdout, as root directly or through non-interactive sudo.
 */
export function buildRemoteCommand(bootAppPath: string | undefined): string {
  const paths = bootAppPath ? [bootAppPath] : BOOT_APP_SEARCH;
  const list = paths.map((p) => `'${p.replace(/'/g, `'\\''`)}'`).join(' ');
  return (
    `for p in ${list}; do if [ -f "$p" ]; then echo "${BOOT_APP_MARKER}$p" >&2; ` +
    `if [ "$(id -u)" = 0 ]; then exec cat "$p"; else exec sudo -n cat "$p"; fi; fi; done; ` +
    `echo "${BOOT_APP_MARKER}" >&2; exit 3`
  );
}

/**
 * Spawn `ssh` and run a command; capture stdout/stderr/exit-code.
 * Wrapped in a Promise so the caller can await it.
 */
function runSsh(
  user: string,
  host: string,
  remoteCommand: string
): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new',
      `${user}@${host}`,
      remoteCommand,
    ];
    let child;
    try {
      child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(chunks), stderr, code });
    });
  });
}

function buildKeyAuthErrorMessage(user: string, host: string): string {
  return (
    `SSH key auth failed for ${user}@${host}.\n\n` +
    `This tool requires SSH key authentication (no password support).\n\n` +
    `To install your key (one-time setup, paste in PowerShell):\n\n` +
    `  Get-Content $env:USERPROFILE\\.ssh\\id_ed25519.pub | ssh -o StrictHostKeyChecking=accept-new ${user}@${host} "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'KEY INSTALLED'"\n\n` +
    `If the host key changed (e.g., the device was reflashed), wipe the stale entry first:\n\n` +
    `  ssh-keygen -R ${host}\n\n` +
    `Verify with:\n\n` +
    `  ssh ${user}@${host} "echo OK"`
  );
}

function buildSudoErrorMessage(user: string, host: string): string {
  return (
    `sudo on ${host} requires a password (we run with sudo -n / non-interactive).\n\n` +
    `Configure passwordless sudo for the boot-app read by adding this line via 'sudo visudo' on the PLC:\n\n` +
    `  ${user} ALL=(ALL) NOPASSWD: /usr/bin/cat, /bin/cat\n\n` +
    `Or, less restrictive but simpler:\n\n` +
    `  ${user} ALL=(ALL) NOPASSWD: ALL`
  );
}

function buildEmptyOutputErrorMessage(
  user: string,
  host: string,
  bootAppPath: string
): string {
  return (
    `No version literals found in ${bootAppPath} on ${host}.\n\n` +
    `Either:\n` +
    `- No project has been downloaded to this PLC yet, or\n` +
    `- The boot application is at a non-standard path. Confirm with:\n` +
    `  ssh ${user}@${host} "sudo find / -maxdepth 6 -name '*.app' 2>/dev/null"`
  );
}

export async function readRunningVersionSsh(
  opts: SshVersionOptions
): Promise<SshVersionResult> {
  const host = opts.host;
  const user = opts.user ?? DEFAULT_USER;
  const requestedPath = opts.bootAppPath;
  const shownPath = requestedPath ?? BOOT_APP_SEARCH.join(' or ');

  if (!host || !host.trim()) {
    throw new Error('readRunningVersionSsh: host is required');
  }

  // Fetch the boot app itself and pick its strings here: PLC firmware
  // often has no `strings` (WAGO BusyBox), and a boot app is small
  // (about 150 KB on a PFC200). The host can be an ~/.ssh/config alias,
  // so a ProxyJump route (PLCs behind a jump host) works as is.
  const { stdout, stderr, code } = await runSsh(user, host, buildRemoteCommand(requestedPath));

  const stderrLower = stderr.toLowerCase();

  // Order matters: check the named failure modes first so the caller gets
  // the exact-instructions message, then fall back to raw-stderr for any
  // other non-zero exit.
  if (
    stderrLower.includes('permission denied (publickey)') ||
    stderrLower.includes('permission denied (publickey,')
  ) {
    throw new Error(buildKeyAuthErrorMessage(user, host));
  }
  if (
    stderrLower.includes('a password is required') ||
    stderrLower.includes('a terminal is required') ||
    stderrLower.includes('no tty present and no askpass program specified')
  ) {
    throw new Error(buildSudoErrorMessage(user, host));
  }

  const marker = stderr.split(/\r?\n/).find((l) => l.startsWith(BOOT_APP_MARKER));
  const foundPath = marker ? marker.slice(BOOT_APP_MARKER.length).trim() : '';
  if (code === 3 && !foundPath) {
    throw new Error(
      `No boot application on ${host} (looked for ${shownPath}).\n\n` +
        `Either no project has been downloaded with a boot application, or it is at a ` +
        `non-standard path: pass bootAppPath. Find it with:\n` +
        `  ssh ${user}@${host} "find / -xdev -name '*.app' 2>/dev/null; find /home -name '*.app' 2>/dev/null"`
    );
  }
  if (code !== 0) {
    const rest = stderr
      .split(/\r?\n/)
      .filter((l) => !l.startsWith(BOOT_APP_MARKER))
      .join('\n')
      .trim();
    throw new Error(rest.length > 0 ? rest : `ssh exited with code ${code} (no stderr)`);
  }

  const bootAppPath = foundPath || requestedPath || DEFAULT_BOOT_APP_PATH;
  const literals = Array.from(
    new Set(
      extractPrintableStrings(stdout)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => VERSION_LITERAL_RE.test(l))
    )
  ).sort();
  if (literals.length === 0) {
    throw new Error(buildEmptyOutputErrorMessage(user, host, bootAppPath));
  }

  const parsed = parseSshOutput(literals.join('\n'));
  return {
    host,
    user,
    bootAppPath,
    projectVersion: parsed.projectVersion,
    candidates: parsed.candidates,
    runtimeVersionLiterals: parsed.runtimeVersionLiterals,
  };
}

/**
 * Format a SshVersionResult for human-readable output (CLI + MCP tool).
 * Shared so both surfaces emit identical text.
 */
export function formatSshVersionResult(res: SshVersionResult): string {
  const lines: string[] = [];
  lines.push(`Host: ${res.host} (${res.user}@)`);
  lines.push(`Boot app: ${res.bootAppPath}`);
  lines.push(`Project version: ${res.projectVersion ?? '(not found)'}`);
  if (res.candidates.length > 1) {
    lines.push(`Ambiguous candidates: ${res.candidates.join(', ')}`);
  }
  lines.push(
    `CODESYS runtime literals filtered: ${
      res.runtimeVersionLiterals.length > 0
        ? res.runtimeVersionLiterals.join(', ')
        : '(none)'
    }`
  );
  return lines.join('\n');
}
