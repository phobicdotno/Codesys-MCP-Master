import { describe, it, expect } from 'vitest';
import { isUncPath, uncPathError } from '../../src/path-guard';

describe('isUncPath', () => {
  it('flags plain UNC paths (backslash)', () => {
    expect(isUncPath('\\\\fileserver\\user\\Documents\\MyPLC.project')).toBe(true);
    expect(isUncPath('\\\\server\\share')).toBe(true);
  });

  it('flags plain UNC paths (forward slash)', () => {
    expect(isUncPath('//fileserver/user/MyPLC.project')).toBe(true);
  });

  it('flags extended-length UNC (\\\\?\\UNC\\...)', () => {
    expect(isUncPath('\\\\?\\UNC\\server\\share\\x.project')).toBe(true);
    expect(isUncPath('\\\\.\\UNC\\server\\share')).toBe(true);
  });

  it('does NOT flag local drive paths', () => {
    expect(isUncPath('C:\\Projects\\MyPLC.project')).toBe(false);
    expect(isUncPath('H:\\Documents\\X33\\plc.project')).toBe(false);
    expect(isUncPath('c:/projects/my.project')).toBe(false);
  });

  it('does NOT flag mapped drive letters', () => {
    // A mapped network drive presents as a drive letter, which works fine.
    expect(isUncPath('Z:\\share\\MyPLC.project')).toBe(false);
  });

  it('does NOT flag extended-length local drive (\\\\?\\C:\\...)', () => {
    expect(isUncPath('\\\\?\\C:\\Projects\\MyPLC.project')).toBe(false);
  });

  it('does NOT flag relative paths or empty input', () => {
    expect(isUncPath('MyPLC.project')).toBe(false);
    expect(isUncPath('sub\\dir\\MyPLC.project')).toBe(false);
    expect(isUncPath('')).toBe(false);
  });
});

describe('uncPathError', () => {
  it('returns null for local paths', () => {
    expect(uncPathError('C:\\Projects\\MyPLC.project')).toBeNull();
  });

  it('returns an actionable message for UNC paths', () => {
    const msg = uncPathError('\\\\fileserver\\user\\MyPLC.project');
    expect(msg).toBeTruthy();
    expect(msg).toContain('UNC');
    expect(msg).toContain('\\\\fileserver\\user\\MyPLC.project');
    expect(msg).toContain('net use'); // suggests the drive-mapping fix
  });

  it('uses the supplied label', () => {
    const msg = uncPathError('\\\\server\\share\\x.project', 'project file to save');
    expect(msg).toContain('project file to save');
  });
});
