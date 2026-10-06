import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IpcClient, DEFAULT_IPC_CONFIG } from '../../src/ipc';

// No watcher answers here: the command can only end by its timeout (180 s
// floor) or by abortWhen. A quit script whose CODESYS has exited used to sit
// out the whole floor (seen 2026-10-06: 3 minutes per shutdown).

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('IpcClient abortWhen', () => {
  it('stops waiting as soon as abortWhen turns true', async () => {
    const dir = path.join(os.tmpdir(), `ipc-abort-${Date.now()}`);
    dirs.push(dir);
    const c = new IpcClient({ baseDir: dir, ...DEFAULT_IPC_CONFIG, commandTimeoutMs: 180_000 });
    await c.ensureDirectories();
    const t0 = Date.now();
    const gone = () => Date.now() - t0 > 300;
    await expect(c.sendCommand('print("x")', 180_000, { abortWhen: gone })).rejects.toThrow(/process is gone/);
    expect(Date.now() - t0).toBeLessThan(10_000);
    // The command files are cleaned up.
    expect(fs.readdirSync(path.join(dir, 'commands'))).toEqual([]);
  }, 20_000);
});
