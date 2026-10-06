import { describe, it, expect } from 'vitest';
import { parseSshOutput } from '../../src/ssh-version';

describe('parseSshOutput', () => {
  it('extracts a single project version and filters out the 3.5.x runtime version', () => {
    const r = parseSshOutput('1.5.0.0\n3.5.22.0\n');
    expect(r.projectVersion).toBe('1.5.0.0');
    expect(r.candidates).toEqual(['1.5.0.0']);
    expect(r.runtimeVersionLiterals).toEqual(['3.5.22.0']);
  });

  it('returns null projectVersion when only 3.5.* runtime literals are present', () => {
    const r = parseSshOutput('3.5.22.0\n3.5.22.10\n');
    expect(r.projectVersion).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.runtimeVersionLiterals).toEqual(['3.5.22.0', '3.5.22.10']);
  });

  it('returns null projectVersion when multiple project candidates remain after filtering', () => {
    const r = parseSshOutput('1.0.0.0\n2.3.4.5\n3.5.22.0\n');
    expect(r.projectVersion).toBeNull();
    expect(r.candidates).toEqual(['1.0.0.0', '2.3.4.5']);
    expect(r.runtimeVersionLiterals).toEqual(['3.5.22.0']);
  });

  it('returns all-empty/null on empty input', () => {
    const r = parseSshOutput('');
    expect(r.projectVersion).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.runtimeVersionLiterals).toEqual([]);
  });

  it('tolerates leading/trailing whitespace and blank lines', () => {
    const r = parseSshOutput('\n  1.5.0.0  \n\n   3.5.22.0\n   \n');
    expect(r.projectVersion).toBe('1.5.0.0');
    expect(r.candidates).toEqual(['1.5.0.0']);
    expect(r.runtimeVersionLiterals).toEqual(['3.5.22.0']);
  });

  it('ignores non-X.Y.Z.W tokens (3-part versions, words, partial numbers)', () => {
    const r = parseSshOutput(
      [
        '1.5.0.0',
        '1.2.3', // 3-part, not X.Y.Z.W
        'hello world',
        'v1.5.0.0', // prefix
        '3.5.22.0',
        '1.5.0.0.1', // 5-part
      ].join('\n')
    );
    expect(r.projectVersion).toBe('1.5.0.0');
    expect(r.candidates).toEqual(['1.5.0.0']);
    expect(r.runtimeVersionLiterals).toEqual(['3.5.22.0']);
  });

  it('handles CRLF line endings (Windows-style stdout)', () => {
    const r = parseSshOutput('1.5.0.0\r\n3.5.22.0\r\n');
    expect(r.projectVersion).toBe('1.5.0.0');
    expect(r.candidates).toEqual(['1.5.0.0']);
    expect(r.runtimeVersionLiterals).toEqual(['3.5.22.0']);
  });
});
