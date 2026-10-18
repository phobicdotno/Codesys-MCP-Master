import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  cmpVersion, nextBuild, nextDriveFile, parseVersionGvl, readMirrorVersion,
  isPreparedAhead, withoutVersionGvl,
} from '../../src/next-version';

describe('version-ahead helpers', () => {
  it('compares versions numerically', () => {
    expect(cmpVersion('1.1.4.10', '1.1.4.9')).toBeGreaterThan(0);
    expect(cmpVersion('1.1.4', '1.1.4.0')).toBe(0);
    expect(cmpVersion('1.0.9.9', '1.1.0.0')).toBeLessThan(0);
  });

  it('steps the build part', () => {
    expect(nextBuild('1.1.4.1')).toBe('1.1.4.2');
    expect(nextBuild('2.0')).toBe('2.0.0.1');
  });

  it('steps the Drive file number and keeps its width', () => {
    expect(nextDriveFile('Vessel_PLC_001')).toBe('Vessel_PLC_002');
    expect(nextDriveFile('Vessel_PLC_099')).toBe('Vessel_PLC_100');
    expect(nextDriveFile('NoNumber')).toBeUndefined();
    expect(nextDriveFile(undefined)).toBeUndefined();
  });

  it('parses the version GVL', () => {
    const decl = "VAR_GLOBAL\n    sVersion : STRING := '1.1.4.2';\n    sDriveFile : STRING := 'P_002';\nEND_VAR";
    expect(parseVersionGvl(decl)).toEqual({ version: '1.1.4.2', driveFile: 'P_002' });
    expect(parseVersionGvl('nothing')).toEqual({ version: undefined, driveFile: undefined });
  });

  it('reads the version from a mirror tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-'));
    const app = path.join(dir, 'Dev', 'Plc Logic', 'Application');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, '_MCP_PROJECT_VERSION.st'), "sVersion : STRING := '3.0.0.7';");
    expect(readMirrorVersion(dir).version).toBe('3.0.0.7');
    expect(readMirrorVersion(path.join(dir, 'missing'))).toEqual({});
  });

  it('detects a working copy prepared ahead of the tag', () => {
    expect(isPreparedAhead('1.1.4.2', 'v1.1.4.1')).toBe(true);
    expect(isPreparedAhead('1.1.4.1', 'v1.1.4.1')).toBe(false);
    expect(isPreparedAhead(undefined, 'v1.1.4.1')).toBe(false);
    expect(isPreparedAhead('1.1.4.2', '')).toBe(false);
  });

  it('ignores the version GVL when classifying a prepared copy', () => {
    const only = withoutVersionGvl({
      kind: 'bump', level: 'revision',
      evidence: ['baseline: tag v1.1.4.1', 'modified: mcp-mirror/Dev/Application/_MCP_PROJECT_VERSION.st',
        'modified: mcp-mirror/Project Information/GetVersion.st',
        'modified: mcp-mirror/Project Information/GetVersionProperty.st'],
    });
    expect(only.kind).toBe('no-changes');

    const real = withoutVersionGvl({
      kind: 'bump', level: 'revision',
      evidence: ['modified: mcp-mirror/A/_MCP_PROJECT_VERSION.st', 'added (untracked): mcp-mirror/A/FB_New.st'],
    });
    expect(real).toEqual({ kind: 'bump', level: 'minor', evidence: ['added (untracked): mcp-mirror/A/FB_New.st'] });
  });
});
