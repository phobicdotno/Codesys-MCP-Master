import { describe, it, expect } from 'vitest';
import {
  InstallSpec,
  labelFor,
  matchInstall,
  pickInstallForProject,
  newestInstall,
  specFromExplicit,
  ProjectProfileCache,
} from '../../src/installs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mk = (sp: number, patch: number, extra: Partial<InstallSpec> = {}): InstallSpec => ({
  exePath: `C:\\Program Files\\CODESYS 3.5.${sp}.${patch}0\\CODESYS\\Common\\CODESYS.exe`,
  profileName: patch === 0 ? `CODESYS V3.5 SP${sp}` : `CODESYS V3.5 SP${sp} Patch ${patch}`,
  sp,
  patch,
  label: labelFor(sp, patch),
  ...extra,
});

const installs = [mk(18, 5), mk(19, 2), mk(21, 3), mk(21, 5), mk(22, 1)];

describe('matchInstall', () => {
  it('matches SP numbers in several spellings, highest patch for a bare SP', () => {
    expect(matchInstall(installs, '21')?.patch).toBe(5);
    expect(matchInstall(installs, 'SP21')?.patch).toBe(5);
    expect(matchInstall(installs, 'sp 22')?.sp).toBe(22);
    expect(matchInstall(installs, 'CODESYS V3.5 SP19')?.sp).toBe(19);
  });

  it('matches an explicit patch', () => {
    expect(matchInstall(installs, 'SP21 Patch 3')?.patch).toBe(3);
    expect(matchInstall(installs, 'sp21p3')?.patch).toBe(3);
    expect(matchInstall(installs, '3.5.21.30')?.patch).toBe(3);
    expect(matchInstall(installs, 'SP21 Patch 9')).toBeUndefined();
  });

  it('matches the full profile name and the exe path, case-insensitive', () => {
    expect(matchInstall(installs, 'codesys v3.5 sp22 patch 1')?.sp).toBe(22);
    expect(matchInstall(installs, installs[1].exePath.toLowerCase().replace(/\\/g, '/'))?.sp).toBe(19);
  });

  it('returns undefined for unknown or empty queries', () => {
    expect(matchInstall(installs, 'SP20')).toBeUndefined();
    expect(matchInstall(installs, '')).toBeUndefined();
    expect(matchInstall(installs, 'banana')).toBeUndefined();
  });
});

describe('pickInstallForProject', () => {
  it('prefers the exact SP and patch', () => {
    const r = pickInstallForProject(installs, 21, 3);
    expect(r.kind).toBe('exact');
    if (r.kind !== 'none') expect(r.install.patch).toBe(3);
  });

  it('falls back to the highest patch of the same SP', () => {
    const r = pickInstallForProject(installs, 21, 4);
    expect(r.kind).toBe('same-sp');
    if (r.kind !== 'none') expect(r.install.patch).toBe(5);
  });

  it('never picks another SP', () => {
    expect(pickInstallForProject(installs, 20, 0).kind).toBe('none');
    expect(pickInstallForProject([mk(22, 1)], 21, 5).kind).toBe('none');
  });
});

describe('newestInstall / specFromExplicit', () => {
  it('newest is the highest SP, then patch', () => {
    expect(newestInstall(installs).sp).toBe(22);
    expect(newestInstall([mk(21, 3), mk(21, 5)]).patch).toBe(5);
  });

  it('parses SP and patch from an explicit profile name', () => {
    const s = specFromExplicit('C:\\x\\CODESYS.exe', 'CODESYS V3.5 SP21 Patch 5', 'C:\\af');
    expect([s.sp, s.patch, s.label, s.additionalFolder]).toEqual([21, 5, 'SP21 Patch 5', 'C:\\af']);
    expect(specFromExplicit('C:\\x\\CODESYS.exe', 'My Custom Profile').sp).toBe(0);
  });
});

describe('ProjectProfileCache with a binary-format project', () => {
  // CODESYS also saves projects in a binary format that is not a ZIP (many real
  // projects, and everything projects.create writes). The version then comes
  // from the .codesys-version pin next to it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-'));
  const proj = path.join(dir, 'Bin.project');
  fs.writeFileSync(proj, Buffer.from([0x23, 0x89, 0xed, 0x33, 1, 2, 3, 4]));

  it('falls back to the .codesys-version pin', async () => {
    fs.writeFileSync(path.join(dir, '.codesys-version'), '3.5.19.20\n');
    expect(await new ProjectProfileCache().get(proj)).toEqual({ sp: 19, patch: 2 });
  });

  it('returns null when nothing tells the version', async () => {
    fs.rmSync(path.join(dir, '.codesys-version'));
    expect(await new ProjectProfileCache().get(proj)).toBeNull();
  });
});
