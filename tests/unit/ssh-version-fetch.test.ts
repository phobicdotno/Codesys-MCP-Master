import { describe, it, expect } from 'vitest';
import { extractPrintableStrings, buildRemoteCommand } from '../../src/ssh-version';

describe('extractPrintableStrings', () => {
  it('keeps printable runs of 4 or more and splits on binary bytes', () => {
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x01]),
      Buffer.from('1.2.0.0'),
      Buffer.from([0x00]),
      Buffer.from('ab'),
      Buffer.from([0xff]),
      Buffer.from('3.5.19.40'),
    ]);
    expect(extractPrintableStrings(buf).split('\n')).toEqual(['1.2.0.0', '3.5.19.40']);
  });

  it('does not join a version onto neighbouring text across a binary byte', () => {
    const buf = Buffer.concat([Buffer.from('CODESYS'), Buffer.from([0x00]), Buffer.from('1.0.0.7')]);
    expect(extractPrintableStrings(buf).split('\n')).toContain('1.0.0.7');
  });

  it('returns an empty string for a buffer without printable runs', () => {
    expect(extractPrintableStrings(Buffer.from([0, 1, 2, 0xff]))).toBe('');
  });
});

describe('buildRemoteCommand', () => {
  it('searches the Linux SL path, then the WAGO path, when no path is given', () => {
    const cmd = buildRemoteCommand(undefined);
    expect(cmd).toContain("'/var/opt/codesys/PlcLogic/Application/Application.app'");
    expect(cmd).toContain("'/home/codesys_root/PlcLogic/Application/Application.app'");
    expect(cmd.indexOf('/var/opt')).toBeLessThan(cmd.indexOf('/home/codesys_root'));
  });

  it('uses only the given path, and needs no strings/tr on the PLC', () => {
    const cmd = buildRemoteCommand('/data/app/Application.app');
    expect(cmd).toContain("'/data/app/Application.app'");
    expect(cmd).not.toContain('/var/opt');
    expect(cmd).not.toMatch(/\bstrings\b|\btr\b/);
    expect(cmd).toContain('exec cat "$p"');
    expect(cmd).toContain('exec sudo -n cat "$p"');
  });

  it('quotes a path with a single quote safely', () => {
    expect(buildRemoteCommand("/a/it's.app")).toContain(`'/a/it'\\''s.app'`);
  });
});
