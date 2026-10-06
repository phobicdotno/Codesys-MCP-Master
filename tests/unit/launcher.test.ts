import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { CodesysLauncher, pathsEqual } from '../../src/launcher';

// These tests use the mock watcher directly (not CODESYS)
// They validate the launcher's IPC integration behavior

describe('CodesysLauncher', () => {
  it('rejects launch when CODESYS exe not found', async () => {
    const launcher = new CodesysLauncher({
      codesysPath: 'C:\\nonexistent\\CODESYS.exe',
      profileName: 'Test Profile',
      workspaceDir: os.tmpdir(),
    });

    await expect(launcher.launch()).rejects.toThrow(/not found/);
    const status = launcher.getStatus();
    expect(status.state).toBe('error');
  });

  it('getStatus reports stopped initially', () => {
    const launcher = new CodesysLauncher({
      codesysPath: 'C:\\nonexistent\\CODESYS.exe',
      profileName: 'Test Profile',
      workspaceDir: os.tmpdir(),
    });

    const status = launcher.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.pid).toBeNull();
    expect(status.sessionId).toBeNull();
  });

  it('isRunning returns false when not launched', () => {
    const launcher = new CodesysLauncher({
      codesysPath: 'C:\\nonexistent\\CODESYS.exe',
      profileName: 'Test Profile',
      workspaceDir: os.tmpdir(),
    });

    expect(launcher.isRunning()).toBe(false);
  });

  it('executeScript rejects when not ready', async () => {
    const launcher = new CodesysLauncher({
      codesysPath: 'C:\\nonexistent\\CODESYS.exe',
      profileName: 'Test Profile',
      workspaceDir: os.tmpdir(),
    });

    await expect(launcher.executeScript('print("hi")')).rejects.toThrow(/state is 'stopped'/);
  });

  it('getStatus auto-clears stale "Refusing to launch" when foreign CODESYS is gone', () => {
    const launcher = new CodesysLauncher({
      codesysPath: 'C:\\nonexistent\\CODESYS.exe',
      profileName: 'Test Profile',
      workspaceDir: os.tmpdir(),
    });

    // Simulate: a prior launch attempt refused because PID 25792 was alive,
    // and that error was cached. The PID is now gone (no CODESYS.exe at the
    // configured path is currently running -- the test process certainly
    // isn't running C:\nonexistent\CODESYS.exe).
    type Internal = {
      state: string;
      lastError: string | null;
    };
    const inner = launcher as unknown as Internal;
    inner.state = 'error';
    inner.lastError =
      'Refusing to launch: 1 CODESYS.exe instance(s) of the same install ' +
      'already running (PID(s): 25792, exe: C:\\nonexistent\\CODESYS.exe). ' +
      'This MCP server cannot share IPC with an instance it didn\'t spawn.';

    const status = launcher.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.lastError).toBeNull();
  });

  it('getStatus does NOT auto-clear unrelated error states', () => {
    const launcher = new CodesysLauncher({
      codesysPath: 'C:\\nonexistent\\CODESYS.exe',
      profileName: 'Test Profile',
      workspaceDir: os.tmpdir(),
    });

    type Internal = {
      state: string;
      lastError: string | null;
    };
    const inner = launcher as unknown as Internal;
    inner.state = 'error';
    inner.lastError = 'CODESYS exited unexpectedly (code 1)';

    const status = launcher.getStatus();
    // Unchanged -- only "Refusing to launch:" prefixed errors auto-clear
    expect(status.state).toBe('error');
    expect(status.lastError).toBe('CODESYS exited unexpectedly (code 1)');
  });
});

describe('pathsEqual', () => {
  it('matches identical paths', () => {
    expect(pathsEqual(
      'C:\\Program Files\\CODESYS 3.5.21.50\\CODESYS\\Common\\CODESYS.exe',
      'C:\\Program Files\\CODESYS 3.5.21.50\\CODESYS\\Common\\CODESYS.exe'
    )).toBe(true);
  });

  it('is case-insensitive (Windows semantics)', () => {
    expect(pathsEqual(
      'C:\\Program Files\\CODESYS 3.5.22.10\\CODESYS\\Common\\CODESYS.exe',
      'c:\\program files\\codesys 3.5.22.10\\codesys\\common\\codesys.exe'
    )).toBe(true);
  });

  it('normalises forward and back slashes', () => {
    expect(pathsEqual(
      'C:\\Program Files\\CODESYS 3.5.22.10\\CODESYS\\Common\\CODESYS.exe',
      'C:/Program Files/CODESYS 3.5.22.10/CODESYS/Common/CODESYS.exe'
    )).toBe(true);
  });

  it('trims trailing separators', () => {
    expect(pathsEqual(
      'C:\\Program Files\\CODESYS\\',
      'C:\\Program Files\\CODESYS'
    )).toBe(true);
  });

  it('distinguishes different installs', () => {
    expect(pathsEqual(
      'C:\\Program Files\\CODESYS 3.5.21.50\\CODESYS\\Common\\CODESYS.exe',
      'C:\\Program Files\\CODESYS 3.5.22.10\\CODESYS\\Common\\CODESYS.exe'
    )).toBe(false);
  });

  it('distinguishes different drives', () => {
    expect(pathsEqual(
      'C:\\Program Files\\CODESYS\\Common\\CODESYS.exe',
      'D:\\Program Files\\CODESYS\\Common\\CODESYS.exe'
    )).toBe(false);
  });
});
