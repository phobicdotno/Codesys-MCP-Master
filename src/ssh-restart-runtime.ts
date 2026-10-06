import { spawn } from 'child_process';
import { Client } from 'ssh2';

/**
 * Restart the CODESYS Control runtime on a Linux PLC over SSH.
 *
 * WHY THIS EXISTS: an unlicensed CODESYS Control runtime (Raspberry Pi
 * etc.) drops out of demo mode every 2 hours - systemctl still reports
 * the service as "active" even though the binary has died, so a port
 * check on 11740 is the real liveness signal. This tool gives the MCP a
 * one-call path to bring it back without dropping into a terminal.
 *
 * TWO WAYS IN:
 *   - Password auth (ssh2, pure JS): the Pi, whose sshd 10.x rejects
 *     pubkey signatures from this environment in practice; the sudo
 *     password is fed to `sudo -S`. Used when a password is given, and
 *     for the default host.
 *   - Key auth (the system `ssh`): any other host given without a
 *     password. Host may be an ~/.ssh/config alias, so a ProxyJump route
 *     works (PLCs behind a jump host); sudo runs as `sudo -n`.
 *
 * HOW THE RUNTIME IS RESTARTED, in order: the systemd unit `service` if
 * systemd knows it; else `/etc/init.d/<service>` stop + start; else, with
 * the default service name only, WAGO's `/etc/init.d/runtime` stop + start
 * (PFC200/CC100 have no systemd, and their init script has no `restart`;
 * verified on a lab PFC200 2026-10-06). As root no sudo is used.
 */

export interface RestartRuntimeOptions {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  sudoPassword?: string;
  service?: string;
  /** 'password' (ssh2) or 'key' (system ssh). Default: password when a password is given or the host is the default Pi, else key. */
  auth?: 'password' | 'key';
  /** Seconds to wait for socket-listening on portCheck after restart. 0 = skip liveness check. */
  livenessWaitSeconds?: number;
  /** TCP port to probe for liveness after restart. Defaults to 11740 (CODESYS gateway). */
  livenessPort?: number;
  /** Connection timeout for the SSH handshake itself, ms. */
  connectTimeoutMs?: number;
}

export interface RestartRuntimeResult {
  host: string;
  user: string;
  service: string;
  auth: 'password' | 'key';
  /** What was run on the PLC, e.g. "systemctl restart codesyscontrol" or "/etc/init.d/runtime stop+start". Empty if nothing matched. */
  method: string;
  /** Exit code of the restart. 0 = restart issued cleanly. */
  restartExitCode: number;
  restartStdout: string;
  restartStderr: string;
  /** True if the runtime was confirmed listening on livenessPort after restart. null if liveness skipped. */
  listening: boolean | null;
  /** Seconds we waited before the liveness probe succeeded (or gave up). */
  livenessElapsedSeconds: number;
  /** Output of the post-restart listen probe (empty if not listening). */
  livenessProbeOutput: string;
}

const DEFAULTS = {
  host: 'codesys-pi.local',
  port: 22,
  user: 'karstein',
  password: 'codesys123',
  sudoPassword: 'codesys123',
  service: 'codesyscontrol',
  livenessWaitSeconds: 30,
  livenessPort: 11740,
  connectTimeoutMs: 15000,
};

const METHOD_MARKER = 'MCP_RESTART=';

type RunResult = { stdout: string; stderr: string; code: number | null };

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The remote shell command. The restart script runs as root: directly
 * when the login is root, else under sudo (`-S` reads the password from
 * stdin, `-n` fails at once instead of prompting). It names the method it
 * picked on stderr, and exits 4 when no way to restart `service` exists.
 */
export function buildRestartCommand(
  service: string,
  opts: { wagoFallback: boolean; sudo: 'stdin' | 'noninteractive' }
): string {
  const svc = shQuote(service);
  const branches = [
    `if command -v systemctl >/dev/null 2>&1 && systemctl cat ${svc} >/dev/null 2>&1; then ` +
      `echo "${METHOD_MARKER}systemctl restart "${svc} >&2; systemctl restart ${svc}; ` +
      `elif [ -x /etc/init.d/${svc} ]; then ` +
      `echo "${METHOD_MARKER}/etc/init.d/"${svc}" stop+start" >&2; /etc/init.d/${svc} stop; /etc/init.d/${svc} start; `,
  ];
  if (opts.wagoFallback) {
    branches.push(
      `elif [ -x /etc/init.d/runtime ]; then ` +
        `echo "${METHOD_MARKER}/etc/init.d/runtime stop+start" >&2; /etc/init.d/runtime stop; /etc/init.d/runtime start; `
    );
  }
  branches.push(
    `else echo "${METHOD_MARKER}" >&2; echo "No systemd unit or /etc/init.d script for "${svc} >&2; exit 4; fi`
  );
  const script = branches.join('');
  const sudo = opts.sudo === 'stdin' ? "sudo -S -p ''" : 'sudo -n';
  return `if [ "$(id -u)" = 0 ]; then sh -c ${shQuote(script)}; else ${sudo} sh -c ${shQuote(script)}; fi`;
}

/** Port probe that works with iproute2 (`ss`) and with BusyBox/net-tools (`netstat`). */
export function buildListenProbe(port: number): string {
  return `(ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | grep -E ':${port}[[:space:]]' || true`;
}

/**
 * Run a single SSH command using password auth. Returns stdout/stderr/exit code.
 * If `stdinPayload` is provided, it's written to the remote stdin (used for `sudo -S`).
 */
function runPassword(
  opts: {
    host: string;
    port: number;
    user: string;
    password: string;
    command: string;
    stdinPayload?: string;
    connectTimeoutMs: number;
  }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        conn.end();
      } catch {
        // ignore
      }
      reject(
        new Error(
          `SSH connect/exec timed out after ${opts.connectTimeoutMs}ms ` +
            `(${opts.user}@${opts.host}:${opts.port})`
        )
      );
    }, opts.connectTimeoutMs);

    conn.on('ready', () => {
      conn.exec(opts.command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }
        stream
          .on('close', (code: number | null) => {
            clearTimeout(timer);
            conn.end();
            resolve({ stdout, stderr, code });
          })
          .on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf8');
          });
        stream.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        if (opts.stdinPayload !== undefined) {
          stream.stdin.write(opts.stdinPayload);
          stream.stdin.end();
        } else {
          stream.stdin.end();
        }
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    conn.connect({
      host: opts.host,
      port: opts.port,
      username: opts.user,
      password: opts.password,
      readyTimeout: opts.connectTimeoutMs,
      // The Pi's sshd 10.x advertises pubkey but rejects signatures from
      // this client in practice. Forcing password auth avoids a slow
      // failed-pubkey roundtrip on every connect.
      authHandler: ['password'],
    } as never);
  });
}

/**
 * Run a single command through the system `ssh` with key auth. The host
 * may be an ~/.ssh/config alias (ProxyJump and all). The timeout covers
 * the whole command, so it must allow for a runtime stop+start.
 */
function runKey(opts: {
  host: string;
  port: number;
  user: string;
  command: string;
  timeoutMs: number;
}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${Math.max(5, Math.round(opts.timeoutMs / 1000))}`,
      '-o', 'StrictHostKeyChecking=accept-new',
      ...(opts.port !== DEFAULTS.port ? ['-p', String(opts.port)] : []),
      `${opts.user}@${opts.host}`,
      opts.command,
    ];
    let child;
    try {
      child = spawn('ssh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ssh to ${opts.user}@${opts.host} timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export async function restartCodesysRuntime(
  options: RestartRuntimeOptions = {}
): Promise<RestartRuntimeResult> {
  const host = options.host ?? DEFAULTS.host;
  const port = options.port ?? DEFAULTS.port;
  const user = options.user ?? DEFAULTS.user;
  const auth =
    options.auth ?? (options.password !== undefined || host === DEFAULTS.host ? 'password' : 'key');
  const password = options.password ?? DEFAULTS.password;
  const sudoPassword = options.sudoPassword ?? options.password ?? DEFAULTS.sudoPassword;
  const service = options.service ?? DEFAULTS.service;
  const livenessWaitSeconds = options.livenessWaitSeconds ?? DEFAULTS.livenessWaitSeconds;
  const livenessPort = options.livenessPort ?? DEFAULTS.livenessPort;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;

  const restartCmd = buildRestartCommand(service, {
    wagoFallback: options.service === undefined,
    sudo: auth === 'password' ? 'stdin' : 'noninteractive',
  });
  // A stop+start takes a few seconds; give the restart call more room
  // than a bare connect.
  const run = (command: string, timeoutMs: number, stdinPayload?: string): Promise<RunResult> =>
    auth === 'password'
      ? runPassword({ host, port, user, password, command, stdinPayload, connectTimeoutMs: timeoutMs })
      : runKey({ host, port, user, command, timeoutMs });

  const restartRes = await run(restartCmd, connectTimeoutMs + 60000, `${sudoPassword}\n`);
  const methodLine = restartRes.stderr.split(/\r?\n/).find((l) => l.startsWith(METHOD_MARKER));
  const method = methodLine ? methodLine.slice(METHOD_MARKER.length).trim() : '';
  const restartStderr = restartRes.stderr
    .split(/\r?\n/)
    .filter((l) => !l.startsWith(METHOD_MARKER))
    .join('\n');

  if (auth === 'key' && /permission denied \(publickey/i.test(restartRes.stderr)) {
    throw new Error(
      `SSH key auth failed for ${user}@${host}. Install your key on the PLC, or pass ` +
        `password (and sudoPassword) to use password auth.`
    );
  }
  if (auth === 'key' && /a password is required|a terminal is required/i.test(restartRes.stderr)) {
    throw new Error(
      `sudo on ${host} needs a password and key auth runs sudo non-interactively. ` +
        `Pass password/sudoPassword (password auth), log in as root, or allow ` +
        `${user} NOPASSWD sudo for the restart.`
    );
  }

  // `systemctl is-active` lies on the Pi - it reports "active" even
  // after the binary has died from license expiry. The real liveness
  // signal is whether port 11740 is listening, so probe that until it
  // comes up or we time out. Skipped when the restart itself failed.
  let listening: boolean | null = null;
  let livenessElapsedSeconds = 0;
  let livenessProbeOutput = '';
  if (livenessWaitSeconds > 0 && restartRes.code === 0) {
    const started = Date.now();
    const deadline = started + livenessWaitSeconds * 1000;
    const probeCmd = buildListenProbe(livenessPort);
    while (Date.now() < deadline) {
      // A transient SSH/ProxyJump error in one probe must not discard the
      // restart result: count it as "not up yet" and probe again.
      let probe: RunResult;
      try {
        probe = await run(probeCmd, connectTimeoutMs);
      } catch (err) {
        livenessProbeOutput = `probe failed: ${err instanceof Error ? err.message : String(err)}`;
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (probe.code === 0 && probe.stdout.includes(`:${livenessPort}`)) {
        listening = true;
        livenessProbeOutput = probe.stdout.trim();
        break;
      }
      livenessProbeOutput = probe.stdout.trim();
      await new Promise((r) => setTimeout(r, 1000));
    }
    livenessElapsedSeconds = Math.round((Date.now() - started) / 1000);
    if (listening === null) {
      listening = false;
    }
  }

  return {
    host,
    user,
    service,
    auth,
    method,
    restartExitCode: restartRes.code ?? -1,
    restartStdout: restartRes.stdout,
    restartStderr,
    listening,
    livenessElapsedSeconds,
    livenessProbeOutput,
  };
}

export function formatRestartRuntimeResult(res: RestartRuntimeResult): string {
  const lines: string[] = [];
  lines.push(`Host: ${res.host} (${res.user}@, ${res.auth} auth)`);
  lines.push(`Service: ${res.service}`);
  lines.push(`Restarted with: ${res.method || '(nothing: no systemd unit or init script found)'}`);
  lines.push(
    `Restart exit code: ${res.restartExitCode}` +
      (res.restartExitCode === 0 ? ' (clean)' : ' (FAILED)')
  );
  if (res.restartStderr.trim().length > 0) {
    // sudo banners and init-script chatter land on stderr - include
    // them so the user can spot real errors vs. cosmetic noise.
    lines.push(`  stderr: ${res.restartStderr.trim()}`);
  }
  if (res.listening === null) {
    lines.push(res.restartExitCode === 0 ? 'Liveness probe: skipped' : 'Liveness probe: not run (restart failed)');
  } else if (res.listening) {
    lines.push(`Listening on the runtime port: YES (after ~${res.livenessElapsedSeconds}s)`);
    if (res.livenessProbeOutput) {
      lines.push(`  ${res.livenessProbeOutput}`);
    }
  } else {
    lines.push(
      `Listening on the runtime port: NO after ${res.livenessElapsedSeconds}s - ` +
        `the runtime did NOT come back up. Check the runtime log on the PLC.`
    );
  }
  return lines.join('\n');
}
