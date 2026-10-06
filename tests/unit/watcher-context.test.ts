import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// From the UI-thread timer no script is executing, and CODESYS's online
// layer then fails with "Stack empty" (create_online_application). Commands
// that use it run through CommandHelper.ExecuteScript and a runner script
// whose own exec compiles the command (2026-10-05).
describe('watcher: online commands get a script context', () => {
  const w = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'watcher.py'), 'utf-8');

  it('routes create_online_application commands through CommandHelper.ExecuteScript', () => {
    expect(w).toContain('"create_online_application(" in code or "create_online_device(" in code');
    expect(w).toContain('_3S.CoDeSys.ScriptEngine.CommandHelper');
    expect(w).toContain('GetMethod("ExecuteScript")');
  });

  it('runs the command with the runner\'s exec and captures its output there', () => {
    expect(w).toContain('def _exec_here(code, g):');
    expect(w).toContain("'__mcp_capture__': capture");
    expect(w).toContain('exec_fn(script_code, exec_globals)');
  });

  it('falls back to running the command directly when the runner did not', () => {
    expect(w).toContain('Runner did not process %s; running it directly');
  });

  it('is ASCII only (IronPython 2.7)', () => {
    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7f]/.test(w)).toBe(false);
  });
});
