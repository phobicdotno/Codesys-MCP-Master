#!/usr/bin/env node
/**
 * CLI entry point for codesys-mcp-master (Codesys-MCP-Master).
 */

import { program } from 'commander';
import { startMcpServer } from './server';
import { ServerConfig, ExecutionMode } from './types';
import { detectInstalls, printConfig, printMultiConfig } from './detect';
import { InstallSpec, specFromInstall, specFromExplicit, matchInstall } from './installs';
import { inspectProjectFile, suggestedServerName } from './inspect';
import { readRunningVersionSsh, formatSshVersionResult } from './ssh-version';

let version = '0.1.0';
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../package.json');
  version = pkg.version;
} catch {
  // ignore
}

const LIVE_VALUES_INTERVAL_MIN_MS = 100;
const LIVE_VALUES_INTERVAL_MAX_MS = 60_000;
const LIVE_VALUES_INTERVAL_DEFAULT_MS = 500;

function clampInterval(raw: string | undefined): number {
  const parsed = parseInt(raw ?? String(LIVE_VALUES_INTERVAL_DEFAULT_MS), 10);
  if (!Number.isFinite(parsed)) return LIVE_VALUES_INTERVAL_DEFAULT_MS;
  return Math.max(LIVE_VALUES_INTERVAL_MIN_MS, Math.min(parsed, LIVE_VALUES_INTERVAL_MAX_MS));
}

function normaliseIdeBridge(raw: string | undefined): 'auto' | 'on' | 'off' {
  const v = (raw ?? 'auto').toLowerCase();
  if (v === 'on' || v === 'off' || v === 'auto') return v;
  return 'auto';
}

program
  .name('codesys-mcp-master')
  .description('MCP server for CODESYS with persistent UI instance')
  .version(version)
  .option(
    '-p, --codesys-path <path>',
    'Bind this server to ONE CODESYS executable. Omit it to drive every installed CODESYS version from one server (each tool call picks the install from the project file, or its `install` argument).',
    process.env.CODESYS_PATH
  )
  .option(
    '-f, --codesys-profile <profile>',
    'Profile name for --codesys-path (default: the profile detected for that install)',
    process.env.CODESYS_PROFILE
  )
  .option(
    '--installs <list>',
    'Without --codesys-path: only these detected installs, comma-separated (e.g. "19,21,22" or "SP21 Patch 5,SP22")'
  )
  .option(
    '--additional-folder <sp=dir...>',
    'Without --codesys-path: AdditionalFolders installation per version, e.g. "SP19=C:\\Program Files\\CODESYS 3.5.19.20\\CODESYS\\AdditionalFolders\\<YourAddOn>". Default: the detected one with the most plugins.'
  )
  .option(
    '--default-install <install>',
    'Install used when neither the project file nor an `install` argument decides (default: the newest)'
  )
  .option(
    '--codesys-additional-folder <dir>',
    'Path to the installation folder under <install>\\CODESYS\\AdditionalFolders\\ that holds the add-on packages (Script Engine, device support, ...). Passed through as --additionalfolder=. Without it CODESYS boots the bare base profile, which has no plugins registered -- scripting fails with "no script engine implementation available". Copy the value from the Start Menu shortcut the CODESYS Installer generated.',
    process.env.CODESYS_ADDITIONAL_FOLDER
  )
  .option(
    '-w, --workspace <dir>',
    'Workspace directory for relative project paths',
    process.cwd()
  )
  .option(
    '-m, --mode <mode>',
    'Execution mode: persistent (UI) or headless (--noUI)',
    'persistent'
  )
  .option('--no-auto-launch', 'Do not auto-launch CODESYS on startup')
  .option('--fallback-headless', 'Fall back to headless (--noUI) if persistent launch fails. Off by default — opt in only if you genuinely want silent --noUI processes.', false)
  .option('--single-instance', 'Refuse to start a second CODESYS of the same install when one is running that cannot be taken over. Default: start another instance next to it')
  .option('--no-keep-alive', 'Close CODESYS when the server stops. Default: leave it running; the next session takes the running instance over')
  .option('--auto-mirror', 'Re-run mirror_export after every modifying tool so an external editor watching <projectDir>/mcp-mirror/ sees changes live', false)
  .option('--live-values', 'Pump runtime values for the selected POU into tui-live-values.json so phobiCS-tui can overlay them inline. Requires the runtime to be online; failures are silent.', false)
  .option('--live-values-interval <ms>', 'Poll interval for --live-values in ms. Default 500. Clamped to [100, 60000].', '500')
  .option('--timeout <ms>', 'Minimum command timeout in ms; tools with a longer timeout of their own keep it', '180000')
  .option('--verbose', 'Enable verbose logging')
  .option('--debug', 'Enable debug logging (more verbose)')
  .option('--detect', 'Detect installed CODESYS versions and exit')
  .option('--print-config', 'Print a ready-to-paste .mcp.json entry that drives every detected install, and exit (with --sp / --for-project / --name: per-install entries)')
  .option('--sp <number>', 'With --print-config: emit only the entry for CODESYS V3.5 SP<number>')
  .option('--for-project <path>', 'With --print-config: pick only the install(s) matching the .project file at <path>. Mutually exclusive with --sp.')
  .option('--name <name>', 'With --print-config --sp <n>: override the MCP server entry name')
  .option('--inspect <path>', 'Read a CODESYS .project offline and print profile + mandatory libraries, then exit (no CODESYS needed)')
  .option('--ssh-version <host>', 'SSH to a CODESYS Control Linux PLC and print the running project version (extracted from the boot-application binary), then exit. Bypasses CODESYS entirely.')
  .option('--ssh-user <name>', 'With --ssh-version: SSH user (default "karstein")')
  .option('--ssh-boot-app <path>', 'With --ssh-version: path to the boot application on the PLC (default: /var/opt/codesys/PlcLogic/Application/Application.app, else the WAGO /home/codesys_root/PlcLogic/Application/Application.app)')
  .option('--ide-bridge <mode>', 'Attach to the CODESYS-shipped MCP bridge plugin via its named pipe and republish its tools with an `ide_` prefix. Modes: auto (default; try to attach, skip if absent), on (fail loudly if attach fails), off (disable).', 'auto')
  .parse(process.argv);

const opts = program.opts();

if (opts.sshVersion) {
  // --ssh-version emits to stdout (pipe-friendly); errors go to stderr with exit 1.
  readRunningVersionSsh({
    host: opts.sshVersion,
    user: opts.sshUser,
    bootAppPath: opts.sshBootApp,
  })
    .then((res) => {
      process.stdout.write(formatSshVersionResult(res) + '\n');
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    });
} else if (opts.inspect) {
  // --inspect emits to stdout (pipe-friendly); errors go to stderr with exit 1.
  inspectProjectFile(opts.inspect)
    .then((res) => {
      const lines: string[] = [];
      lines.push(`Project:         ${res.filePath}`);
      lines.push(`Profile name:    ${res.profileName}`);
      lines.push(`Profile version: ${res.profileVersion}`);
      const patchSuffix = res.patch === 0 ? ' Patch 0' : ` Patch ${res.patch}`;
      lines.push(`SP:              ${res.sp}${patchSuffix}`);
      lines.push(`Suggested entry: ${suggestedServerName(res.sp, res.patch)}`);
      lines.push('');
      lines.push(`Mandatory libraries (${res.mandatoryLibraries.length}):`);
      for (const lib of res.mandatoryLibraries) {
        const title = lib.title ?? '(unnamed)';
        const version = lib.version ?? '?';
        const guid = lib.typeGuid ? ` [TypeGuid: ${lib.typeGuid}]` : '';
        lines.push(`  - ${title} (${version})${guid}`);
      }
      process.stdout.write(lines.join('\n') + '\n');
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    });
} else if (opts.detect) {
  const installs = detectInstalls();
  process.stderr.write('Scanning for CODESYS installations...\n\n');
  if (installs.length === 0) {
    process.stderr.write('  (no installations matching "CODESYS X.Y.Z.W" found)\n');
  } else {
    for (const i of installs) {
      process.stderr.write(`  [OK] ${i.installDir}\n`);
      process.stderr.write(`        Exe:     ${i.exePath}\n`);
      process.stderr.write(`        Profile: ${i.profileName}\n`);
      process.stderr.write(`        Suggested entry name: ${i.serverName}\n`);
    }
  }
  process.stderr.write(`\nFound ${installs.length} CODESYS installation(s).\n`);
  process.exit(0);
} else if (opts.printConfig) {
  if (opts.forProject !== undefined && opts.sp !== undefined) {
    process.stderr.write(`--for-project and --sp are mutually exclusive\n`);
    process.exit(1);
  }
  const installs = detectInstalls();
  let sp: number | undefined;
  if (opts.sp !== undefined) {
    sp = parseInt(opts.sp, 10);
    if (Number.isNaN(sp)) {
      process.stderr.write(`--sp must be a number (e.g. --sp 21). Got "${opts.sp}".\n`);
      process.exit(1);
    }
  }
  if (opts.forProject !== undefined) {
    inspectProjectFile(opts.forProject)
      .then((res) => {
        const exact = installs.filter((i) => i.sp === res.sp && i.patch === res.patch);
        let filtered: typeof installs;
        let matchKind: 'exact' | 'sp-only-fallback';
        if (exact.length > 0) {
          filtered = exact;
          matchKind = 'exact';
        } else {
          const spOnly = installs.filter((i) => i.sp === res.sp);
          if (spOnly.length === 0) {
            process.stderr.write(
              `No installed CODESYS matches the project's required SP (${res.profileName}, version ${res.profileVersion}).\nRun --detect to see what's installed.\n`
            );
            process.exit(1);
          }
          filtered = spOnly;
          matchKind = 'sp-only-fallback';
        }
        try {
          process.stdout.write(
            printConfig(filtered, {
              name: opts.name,
              forProjectHint: {
                profileName: res.profileName,
                profileVersion: res.profileVersion,
                matchKind,
              },
            }) + '\n'
          );
          process.exit(0);
        } catch (err) {
          process.stderr.write(`${(err as Error).message}\n`);
          process.exit(1);
        }
      })
      .catch((err) => {
        process.stderr.write(`${(err as Error).message}\n`);
        process.exit(1);
      });
  } else {
    try {
      process.stdout.write(
        (sp === undefined && opts.name === undefined
          ? printMultiConfig(installs)
          : printConfig(installs, { sp, name: opts.name })) + '\n'
      );
      process.exit(0);
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`);
      process.exit(1);
    }
  }
} else {
  // Which installs this server drives: one explicit install, or every detected one.
  const detected = detectInstalls();
  let installs: InstallSpec[];
  if (opts.codesysPath) {
    const exe = String(opts.codesysPath).trim();
    const det = detected.find((d) => d.exePath.toLowerCase() === exe.toLowerCase());
    const profile = (opts.codesysProfile ? String(opts.codesysProfile).trim() : '') || det?.profileName;
    if (!profile) {
      process.stderr.write(`--codesys-profile is required for ${exe} (no install detected at that path).\n`);
      process.exit(1);
    }
    installs = [specFromExplicit(exe, profile, opts.codesysAdditionalFolder?.trim() || det?.additionalFolder)];
  } else {
    installs = detected.map(specFromInstall);
    if (opts.codesysAdditionalFolder) {
      process.stderr.write('--codesys-additional-folder only applies with --codesys-path; use --additional-folder SP<n>=<dir>.\n');
      process.exit(1);
    }
    if (opts.installs) {
      const wanted = String(opts.installs).split(',').map((x: string) => x.trim()).filter(Boolean);
      const picked: InstallSpec[] = [];
      for (const w of wanted) {
        const m = matchInstall(installs, w);
        if (!m) {
          process.stderr.write(`--installs: no detected install matches '${w}'. Run --detect.\n`);
          process.exit(1);
        }
        if (!picked.includes(m)) picked.push(m);
      }
      installs = picked;
    }
    for (const entry of (opts.additionalFolder ?? []) as string[]) {
      const eq = entry.indexOf('=');
      const m = eq > 0 ? matchInstall(installs, entry.slice(0, eq)) : undefined;
      if (!m) {
        process.stderr.write(`--additional-folder: expected SP<n>=<dir> matching an install, got '${entry}'.\n`);
        process.exit(1);
      }
      m.additionalFolder = entry.slice(eq + 1).trim();
    }
    if (installs.length === 0) {
      process.stderr.write('No CODESYS installation detected. Pass --codesys-path, or run --detect.\n');
      process.exit(1);
    }
  }
  const primary =
    (opts.defaultInstall && matchInstall(installs, String(opts.defaultInstall))) ||
    [...installs].sort((a, b) => b.sp - a.sp || b.patch - a.patch)[0];

  // Build server config
  const config: ServerConfig = {
    codesysPath: primary.exePath,
    profileName: primary.profileName,
    additionalFolder: primary.additionalFolder,
    installs,
    defaultInstall: opts.defaultInstall ? String(opts.defaultInstall) : undefined,
    workspaceDir: opts.workspace.trim(),
    autoLaunch: opts.autoLaunch !== false,
    keepAlive: opts.keepAlive !== false,
    singleInstance: opts.singleInstance === true,
    timeoutMs: parseInt(opts.timeout, 10) || 180000,
    fallbackHeadless: opts.fallbackHeadless !== false,
    verbose: opts.verbose || false,
    debug: opts.debug || false,
    mode: (opts.mode === 'headless' ? 'headless' : 'persistent') as ExecutionMode,
    autoMirror: opts.autoMirror || false,
    liveValues: opts.liveValues || false,
    liveValuesIntervalMs: clampInterval(opts.liveValuesInterval),
    ideBridge: normaliseIdeBridge(opts.ideBridge),
  };

  process.stderr.write(`Starting CODESYS MCP Server v${version}\n`);
  for (const i of installs) {
    process.stderr.write(`  CODESYS ${i.label}: ${i.exePath}${i.additionalFolder ? ` (+ ${i.additionalFolder})` : ''}\n`);
  }
  process.stderr.write(`  Mode: ${config.mode}\n`);
  process.stderr.write(`  Auto-launch: ${config.autoLaunch}\n`);
  if (config.autoMirror) {
    process.stderr.write(`  Auto-mirror: ENABLED (mirror_export runs after every edit)\n`);
  }
  if (config.liveValues) {
    process.stderr.write(`  Live values: ENABLED (poll ${config.liveValuesIntervalMs ?? 500}ms; writes tui-live-values.json)\n`);
  }

  startMcpServer(config).catch((err) => {
    process.stderr.write(`FATAL: ${err.message}\n`);
    process.exit(1);
  });
}
