import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  parseIpAddress, probeRuntime, probeVerdict, loginFailureHint,
  rememberIpBinding, ipBindingFor, preLoginProbe, withNote,
} from '../../src/online-diagnose';

const servers: net.Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

/** A local server that either keeps connections open or closes them at once. */
function server(mode: 'hold' | 'drop'): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer((c) => {
      if (mode === 'drop') c.destroy();
      else c.on('error', () => undefined);
    });
    servers.push(s);
    s.listen(0, '127.0.0.1', () => resolve((s.address() as net.AddressInfo).port));
  });
}

/** A port nothing listens on: bind, read the port, close. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ipbind-')), 'ip-bindings.json');
}

describe('parseIpAddress', () => {
  it('reads host:port and defaults the port to 11740', () => {
    expect(parseIpAddress('127.0.0.1:11740')).toEqual({ host: '127.0.0.1', port: 11740 });
    expect(parseIpAddress('192.0.2.10')).toEqual({ host: '192.0.2.10', port: 11740 });
  });
  it('rejects router addresses and junk', () => {
    expect(parseIpAddress('0301.3053')).toBeNull();
    expect(parseIpAddress('')).toBeNull();
    expect(parseIpAddress('127.0.0.1:99999')).toBeNull();
  });
});

describe('probeRuntime', () => {
  it('reports open for a runtime that keeps the connection', async () => {
    const port = await server('hold');
    const r = await probeRuntime('127.0.0.1', port, 300);
    expect(r.state).toBe('open');
    expect(probeVerdict(r)).toBeNull();
  });

  it('reports closed for a runtime that accepts and drops at once', async () => {
    const port = await server('drop');
    const r = await probeRuntime('127.0.0.1', port, 1000);
    expect(r.state).toBe('closed');
    expect(r.closedAfterMs).toBeLessThan(1000);
    // A busy runtime drops a second connection too: never a reason to block.
    expect(probeVerdict(r)).toBeNull();
  });

  it('reports refused when nothing listens', async () => {
    const port = await freePort();
    const r = await probeRuntime('127.0.0.1', port, 300);
    expect(r.state).toBe('refused');
    expect(probeVerdict(r)).toMatch(/Nothing listens/);
  });
});

describe('loginFailureHint', () => {
  it('names the stuck online session', () => {
    expect(loginFailureHint('Login failed: Exception was raised: An item with the same key has already been added.'))
      .toMatch(/fresh one/);
  });
  it('explains the gateway message', () => {
    expect(loginFailureHint("Gateway not configured properlyDo you want to continue with the items?"))
      .toMatch(/rebind_device_to_scan_result/);
  });
  it('points at a modal dialog for Stack empty', () => {
    expect(loginFailureHint('create_online_application() failed: Stack empty.')).toMatch(/modal dialog/);
  });
  it('points at rebinding for No active path', () => {
    expect(loginFailureHint('No active path defined')).toMatch(/rebind_device_to_scan_result/);
  });
  it('stays quiet for unknown output', () => {
    expect(loginFailureHint('Invalid user authentication on the target')).toBeNull();
  });
});

describe('IP bindings and the pre-login probe', () => {
  it('remembers an IP binding per project, case and slash insensitive, and drops it on a scan binding', () => {
    const f = tmpFile();
    rememberIpBinding('C:/plc/A/A.project', '127.0.0.1:11740', f);
    expect(ipBindingFor('c:\\plc\\a\\a.project', f)).toBe('127.0.0.1:11740');
    rememberIpBinding('C:/plc/A/A.project', '', f);
    expect(ipBindingFor('C:/plc/A/A.project', f)).toBeNull();
  });

  it('does not block without a known binding', async () => {
    expect(await preLoginProbe('C:/plc/none.project', tmpFile())).toEqual({ block: null, note: null });
  });

  it('blocks only when nothing listens; a dropped probe becomes a note', async () => {
    const f = tmpFile();
    const gone = await freePort();
    rememberIpBinding('C:/plc/B.project', `127.0.0.1:${gone}`, f);
    const refused = await preLoginProbe('C:/plc/B.project', f);
    expect(refused.block).toMatch(/^Pre-login check FAILED/);
    expect(refused.block).toMatch(/rebind it and this record follows/);

    const drop = await server('drop');
    rememberIpBinding('C:/plc/B.project', `127.0.0.1:${drop}`, f);
    const busy = await preLoginProbe('C:/plc/B.project', f);
    expect(busy.block).toBeNull();
    expect(busy.note).toMatch(/one gateway connection at a time/);
    expect(withNote('Operation failed.', busy)).toMatch(/^Runtime check:.*\n\nOperation failed\.$/s);
    expect(withNote('Operation failed.', { block: null, note: null })).toBe('Operation failed.');

    const hold = await server('hold');
    rememberIpBinding('C:/plc/B.project', `127.0.0.1:${hold}`, f);
    expect(await preLoginProbe('C:/plc/B.project', f)).toEqual({ block: null, note: null });
  });
});

describe('stale session and gateway link', () => {
  it('recognises the stale online session error', async () => {
    const { isStaleOnlineSession, isGatewayNotConfigured } = await import('../../src/online-diagnose');
    expect(isStaleOnlineSession('Exception was raised: An item with the same key has already been added.')).toBe(true);
    expect(isStaleOnlineSession('Login failed')).toBe(false);
    expect(isGatewayNotConfigured('Gateway not configured properlyDo you want to continue')).toBe(true);
  });

  it('tells whether CODESYS has its own gateway connection', async () => {
    const { gatewayLinkNote } = await import('../../src/online-diagnose');
    const linked = await gatewayLinkNote(7, async () => [{ remotePort: 1217, state: 'Established' }]);
    expect(linked).toMatch(/is connected to its gateway/);
    const lost = await gatewayLinkNote(7, async () => [{ remotePort: 443, state: 'Established' }, { remotePort: 1217, state: 'TimeWait' }]);
    expect(lost).toMatch(/has no connection to its gateway.*press Enter/s);
    expect(await gatewayLinkNote(7, async () => null)).toBeNull();
    expect(await gatewayLinkNote(null)).toBeNull();
  });
});

describe('runWithRecovery', () => {
  const ok = { success: true, output: 'SCRIPT_SUCCESS: done' };
  const stale = { success: false, output: 'Login failed: An item with the same key has already been added.' };
  const gw = { success: false, output: 'Gateway not configured properlyDo you want to continue with the items?' };

  async function setup(results: Array<typeof ok>, o: { attached?: boolean | null; linked?: boolean | null; shutdownThrows?: string; secondRunThrows?: string } = {}) {
    const { runWithRecovery } = await import('../../src/online-diagnose');
    const calls = { run: 0, shutdown: 0 };
    const r = await runWithRecovery({
      run: async () => {
        calls.run++;
        if (calls.run === 2 && o.secondRunThrows) throw new Error(o.secondRunThrows);
        return results[Math.min(calls.run, results.length) - 1];
      },
      attached: () => (o.attached === undefined ? false : o.attached),
      shutdown: async () => { calls.shutdown++; if (o.shutdownThrows) throw new Error(o.shutdownThrows); },
      gatewayLinked: async () => (o.linked === undefined ? true : o.linked),
    });
    return { r, calls };
  }

  it('leaves a success alone', async () => {
    const { r, calls } = await setup([ok]);
    expect(r.recovery).toBeNull();
    expect(calls).toEqual({ run: 1, shutdown: 0 });
  });

  it('restarts its own CODESYS once on a stale session and returns the retry', async () => {
    const { r, calls } = await setup([stale, ok]);
    expect(calls).toEqual({ run: 2, shutdown: 1 });
    expect(r.result).toBe(ok);
    expect(r.recovery).toMatch(/ran once more in a fresh one/);
  });

  it('retries exactly once even if the retry fails the same way', async () => {
    const { calls } = await setup([stale, stale]);
    expect(calls).toEqual({ run: 2, shutdown: 1 });
  });

  it('never closes a CODESYS the user opened', async () => {
    const { r, calls } = await setup([stale], { attached: true });
    expect(calls.shutdown).toBe(0);
    expect(r.recovery).toMatch(/opened by the user.*ASK THE USER/);
  });

  it('does nothing without a CODESYS of its own', async () => {
    const { r, calls } = await setup([stale], { attached: null });
    expect(calls.shutdown).toBe(0);
    expect(r.recovery).toBeNull();
  });

  it('stops on unsaved projects and keeps the question', async () => {
    const { r, calls } = await setup([stale], { shutdownThrows: 'unsaved changes: ASK THE USER' });
    expect(calls.run).toBe(1);
    expect(r.recovery).toMatch(/not restarted: unsaved changes: ASK THE USER/);
  });

  it('restarts on a gateway failure only when the IDE lost its gateway link', async () => {
    expect((await setup([gw, ok], { linked: false })).calls).toEqual({ run: 2, shutdown: 1 });
    expect((await setup([gw], { linked: true })).calls).toEqual({ run: 1, shutdown: 0 });
    expect((await setup([gw], { linked: null })).calls).toEqual({ run: 1, shutdown: 0 });
  });

  it('keeps the note when the fresh CODESYS fails to start', async () => {
    const { r } = await setup([stale], { secondRunThrows: 'launch refused' });
    expect(r.result).toBe(stale);
    expect(r.recovery).toMatch(/was closed, but starting a fresh one failed: launch refused/);
  });
});
