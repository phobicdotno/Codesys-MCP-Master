import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { IpcClient, DEFAULT_IPC_CONFIG } from '../../src/ipc';

const TEST_BASE = path.join(os.tmpdir(), 'codesys-mcp-test-ipc');

function createTestIpcDir(): string {
  const dir = path.join(TEST_BASE, `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function spawnMockWatcher(ipcDir: string): ChildProcess {
  const mockWatcherPath = path.join(__dirname, '..', 'mock_watcher.py');
  const child = spawn('python', [mockWatcherPath, '--ipc-dir', ipcDir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return child;
}

async function waitForReady(ipcDir: string, timeoutMs = 10_000): Promise<void> {
  const readyPath = path.join(ipcDir, 'ready.signal');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(readyPath)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Watcher did not become ready');
}

describe('IpcClient', () => {
  let ipcDir: string;
  let client: IpcClient;

  beforeEach(() => {
    ipcDir = createTestIpcDir();
    client = new IpcClient({
      baseDir: ipcDir,
      ...DEFAULT_IPC_CONFIG,
      commandTimeoutMs: 10_000,
    });
  });

  afterEach(async () => {
    try {
      fs.rmSync(ipcDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  it('ensureDirectories creates commands/ and results/ dirs', async () => {
    await client.ensureDirectories();
    expect(fs.existsSync(path.join(ipcDir, 'commands'))).toBe(true);
    expect(fs.existsSync(path.join(ipcDir, 'results'))).toBe(true);
  });

  it('isReady returns false before watcher, true after', async () => {
    expect(await client.isReady()).toBe(false);
    // Write ready signal manually
    fs.mkdirSync(ipcDir, { recursive: true });
    fs.writeFileSync(path.join(ipcDir, 'ready.signal'), '{}');
    expect(await client.isReady()).toBe(true);
  });

  it('sendTerminate writes terminate.signal', async () => {
    fs.mkdirSync(ipcDir, { recursive: true });
    await client.sendTerminate();
    expect(fs.existsSync(path.join(ipcDir, 'terminate.signal'))).toBe(true);
  });

  it('cleanup removes session directory', async () => {
    await client.ensureDirectories();
    expect(fs.existsSync(ipcDir)).toBe(true);
    await client.cleanup();
    expect(fs.existsSync(ipcDir)).toBe(false);
  });

  describe('with mock watcher', () => {
    let watcher: ChildProcess;

    beforeEach(async () => {
      await client.ensureDirectories();
      watcher = spawnMockWatcher(ipcDir);
      await waitForReady(ipcDir);
    });

    afterEach(async () => {
      // Send terminate signal and wait for watcher to exit
      try {
        await client.sendTerminate();
        await new Promise((r) => setTimeout(r, 500));
      } catch { /* ignore */ }
      try {
        watcher.kill();
      } catch { /* ignore */ }
    });

    it('sendCommand roundtrip - print Hello World', async () => {
      const result = await client.sendCommand('print("Hello World")');
      expect(result.success).toBe(true);
      expect(result.output).toContain('Hello World');
    });

    it('sendCommand handles script error', async () => {
      const result = await client.sendCommand('raise Exception("test error")');
      expect(result.success).toBe(false);
      expect(result.error).toContain('test error');
    });

    it('sendCommand handles SystemExit(0) as success', async () => {
      const result = await client.sendCommand('import sys; sys.exit(0)');
      expect(result.success).toBe(true);
    });

    it('sendCommand handles SystemExit(1) as failure', async () => {
      const result = await client.sendCommand('import sys; sys.exit(1)');
      expect(result.success).toBe(false);
    });

    it('namespace isolation between commands', async () => {
      const result1 = await client.sendCommand('x = 42\nprint("set x")');
      expect(result1.success).toBe(true);
      expect(result1.output).toContain('set x');

      const result2 = await client.sendCommand('print(x)');
      expect(result2.success).toBe(false); // x not defined in fresh namespace
    });

    it('large output - 100KB of text', async () => {
      const script = 'print("A" * 102400)';
      const result = await client.sendCommand(script);
      expect(result.success).toBe(true);
      expect(result.output.length).toBeGreaterThanOrEqual(102400);
    });

    it('serialization - concurrent commands execute sequentially', async () => {
      // Send two commands concurrently
      const p1 = client.sendCommand('import time; time.sleep(0.1); print("first")');
      const p2 = client.sendCommand('print("second")');

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(r1.output).toContain('first');
      expect(r2.output).toContain('second');
      // r1 should complete before r2 starts (due to mutex)
      expect(r1.timestamp).toBeLessThanOrEqual(r2.timestamp);
    });

    it('SCRIPT_SUCCESS marker in output', async () => {
      const result = await client.sendCommand('print("SCRIPT_SUCCESS: done")');
      expect(result.success).toBe(true);
      expect(result.output).toContain('SCRIPT_SUCCESS');
    });

    it('SCRIPT_ERROR marker in output', async () => {
      const result = await client.sendCommand('print("SCRIPT_ERROR: something went wrong")');
      expect(result.success).toBe(false);
    });
  });

  it('sendCommand timeout - no watcher', async () => {
    await client.ensureDirectories();
    const shortTimeoutClient = new IpcClient({
      baseDir: ipcDir,
      ...DEFAULT_IPC_CONFIG,
      commandTimeoutMs: 500,
    });

    await expect(
      shortTimeoutClient.sendCommand('print("hello")')
    ).rejects.toThrow(/timed out/);
  });
});
