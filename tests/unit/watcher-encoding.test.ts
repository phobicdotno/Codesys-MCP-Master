import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: spawnMock };
});

import { HeadlessExecutor } from '../../src/headless';

// IronPython 2.7's text-mode file read decodes a UTF-8 file byte-by-byte as
// latin-1. A script that embeds a non-ASCII project path (for example a
// Chinese "programs" folder) therefore reached exec as mojibake and
// projects.open failed with "file does not exist" although the file was
// there (2026-11-26). Both sides must use UTF-8.
describe('watcher: command and script files are read as UTF-8', () => {
  const w = fs.readFileSync(
    path.join(__dirname, '..', '..', 'src', 'scripts', 'watcher.py'),
    'utf-8'
  );

  it('reads the command JSON and the command script as UTF-8', () => {
    expect(w).toContain('codecs.open(command_path, "r", "utf-8")');
    expect(w.match(/codecs\.open\(script_path, "r", "utf-8"\)/g)).toHaveLength(2);
  });

  it('keeps no bare text-mode reads of the command or script files', () => {
    expect(w).not.toMatch(/with open\((command_path|script_path), "r"\)/);
    expect(w).not.toMatch(
      /with open\(os\.path\.join\(COMMANDS_DIR, command_file\), "r"\)/
    );
  });

  it('normalizes CRLF, which codecs.open does not translate', () => {
    expect(w).toContain('script_code.replace("\\r\\n", "\\n")');
  });
});

describe('headless: the temp script is written as UTF-8', () => {
  it('keeps non-ASCII paths intact in the file CODESYS runs', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-headless-encoding-'));
    const exe = path.join(dir, 'CODESYS.exe');
    fs.writeFileSync(exe, '');

    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    spawnMock.mockReturnValue(child);

    try {
      const executor = new HeadlessExecutor({
        codesysPath: exe,
        profileName: 'CODESYS V3.5 SP21 Patch 6',
        timeoutMs: 5_000,
      } as any);

      const chinese = '\u7a0b\u5e8f'; // "programs"
      const content = 'PROJECT = "E:\\\\Codesys' + chinese + '\\\\Demo.project"\n';
      const run = executor.executeScript(content, 5_000);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const command = String(spawnMock.mock.calls[0][0]);
      const match = command.match(/--runscript="([^"]+)"/);
      expect(match).not.toBeNull();

      const bytes = fs.readFileSync(match![1]);
      expect(bytes).toEqual(Buffer.from(content.replace(/\r\n/g, '\n'), 'utf-8'));
      expect(bytes.includes(Buffer.from(chinese, 'utf-8'))).toBe(true);

      child.emit('close', 0);
      await run;
    } finally {
      spawnMock.mockReset();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
