import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { buildRestartCommand, buildListenProbe } from '../../src/ssh-restart-runtime';

function shSyntaxOk(cmd: string): boolean {
  const r = spawnSync('sh', ['-n', '-c', cmd]);
  return r.status === 0;
}

describe('buildRestartCommand', () => {
  it('tries systemd, then the named init script, then WAGO runtime for the default service', () => {
    const cmd = buildRestartCommand('codesyscontrol', { wagoFallback: true, sudo: 'stdin' });
    const iSystemd = cmd.indexOf('systemctl restart');
    const iInit = cmd.indexOf('/etc/init.d/');
    const iWago = cmd.indexOf('/etc/init.d/runtime start');
    expect(iSystemd).toBeGreaterThan(-1);
    expect(iInit).toBeGreaterThan(iSystemd);
    expect(iWago).toBeGreaterThan(iInit);
    // WAGO's init script has no "restart" verb.
    expect(cmd).not.toContain('/etc/init.d/runtime restart');
  });

  it('leaves the WAGO fallback out when a service is named', () => {
    const cmd = buildRestartCommand('mycodesys', { wagoFallback: false, sudo: 'stdin' });
    expect(cmd).not.toContain('/etc/init.d/runtime');
    expect(cmd).toContain('mycodesys');
  });

  it('runs as root without sudo, else with sudo -S (password) or sudo -n (key)', () => {
    const pw = buildRestartCommand('codesyscontrol', { wagoFallback: true, sudo: 'stdin' });
    const key = buildRestartCommand('codesyscontrol', { wagoFallback: true, sudo: 'noninteractive' });
    expect(pw).toContain('[ "$(id -u)" = 0 ]');
    expect(pw).toContain('sudo -S');
    expect(key).toContain('sudo -n');
    expect(key).not.toContain('sudo -S');
  });

  it('produces valid shell, also for a service name with a quote', () => {
    for (const svc of ['codesyscontrol', "odd'name"]) {
      for (const sudo of ['stdin', 'noninteractive'] as const) {
        expect(shSyntaxOk(buildRestartCommand(svc, { wagoFallback: true, sudo }))).toBe(true);
      }
    }
  });
});

describe('buildListenProbe', () => {
  it('falls back from ss to netstat and matches the exact port', () => {
    const p = buildListenProbe(11740);
    expect(p).toContain('ss -tln');
    expect(p).toContain('netstat -tln');
    expect(p).toContain(':11740[[:space:]]');
    expect(shSyntaxOk(p)).toBe(true);
  });
});
