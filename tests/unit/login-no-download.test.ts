import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { ScriptManager } from '../../src/script-manager';
import { plcVersionWarnings } from '../../src/login-warnings';

// A connect, read, write or start/stop must never change the program on the PLC.
// 2026-11: connect_to_device logged in with OnlineChangeOption.Try ("online change
// if possible, else a full download") and, with a project that differed from the
// running application, ran a full download at login and left the application in
// STOP without a boot application. Only Keep ("login without any change") is
// allowed outside download_to_device.

const SCRIPTS = path.join(__dirname, '..', '..', 'src', 'scripts');
const helperSrc = fs.readFileSync(path.join(SCRIPTS, 'ensure_online_connection.py'), 'utf-8');

function pythonCmd(): string | null {
  for (const c of ['python', 'python3']) {
    const r = spawnSync(c, ['--version'], { encoding: 'utf-8' });
    if (r.status === 0) return c;
  }
  return null;
}

// Runs login_without_download from the real helper file in CPython with a fake
// scriptengine module and a fake online application; prints the login() calls.
function runLogin(members: string[], typeErrorOnTwoArgs: boolean): { ok: boolean; out: string } {
  const py = pythonCmd();
  if (!py) return { ok: true, out: 'SKIP' };
  const prog = `
import sys, types
src = open(sys.argv[1], encoding='utf-8').read()
class OC: pass
for m in ${JSON.stringify(members)}:
    setattr(OC, m, 'OC.' + m)
se = types.ModuleType('scriptengine')
se.OnlineChangeOption = OC
sys.modules['scriptengine'] = se
calls = []
class App:
    def login(self, *args):
        calls.append(args)
        if ${typeErrorOnTwoArgs ? 'True' : 'False'} and len(args) == 2:
            raise TypeError('takes 1 argument')
ns = {}
exec(compile(src, 'ensure_online_connection.py', 'exec'), ns)
try:
    ns['login_without_download'](App(), 'test')
    print('RESULT ok ' + repr(calls))
except RuntimeError as e:
    print('RESULT refused ' + repr(calls) + ' ' + str(e))
`;
  const r = spawnSync(py, ['-c', prog, path.join(SCRIPTS, 'ensure_online_connection.py')], { encoding: 'utf-8' });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

describe('logins outside download_to_device never download', () => {
  const mgr = new ScriptManager(SCRIPTS);

  it('allows only the Keep login mode', () => {
    expect(helperSrc).toContain("NO_DOWNLOAD_LOGIN_MODES = ('Keep',)");
  });

  it('connect_to_device logs in through login_without_download and has no download modes left', () => {
    const s = mgr.prepareScriptWithHelpers(
      'connect_to_device',
      { PROJECT_FILE_PATH: 'C:\\proj\\P.project', APPLICATION_PATH: 'None', LOGIN_WAIT_SECONDS: '5', DEVICE_USER: 'None', DEVICE_PASSWORD: 'None' },
      ['register_device_credentials', 'ensure_project_open', 'select_application', 'ensure_online_connection']
    );
    const body = s.slice(s.indexOf("print(\"DEBUG: connect_to_device script"));
    expect(body).toContain('login_without_download(online_app, "connect_to_device")');
    expect(body).toContain('warn_if_plc_runs_other_version(');
    for (const banned of ["'TryOnlineChange'", "'WithDownload'", "'ForceDownload'", 'login(True)', 'online_app.login(*args)']) {
      expect(body).not.toContain(banned);
    }
  });

  it('ensure_logged_in (read, write, start/stop) uses login_without_download only', () => {
    const fn = helperSrc.slice(helperSrc.indexOf('def ensure_logged_in('), helperSrc.indexOf('# --- End of ensure_logged_in function ---'));
    expect(fn).toContain('login_without_download(online_app, "ensure_logged_in")');
    expect(fn).not.toContain('online_app.login(');
    expect(fn).not.toContain("'Try'");
  });

  it('calls login(Keep, False) and nothing else when Keep exists', () => {
    const r = runLogin(['Force', 'Keep', 'Never', 'Try'], false);
    if (r.out === 'SKIP') return;
    expect(r.out).toContain("RESULT ok [('OC.Keep', False)]");
  });

  it('falls back to login(Keep) on an SP whose login() takes one argument', () => {
    const r = runLogin(['Force', 'Keep', 'Never', 'Try'], true);
    if (r.out === 'SKIP') return;
    expect(r.out).toContain("RESULT ok [('OC.Keep', False), ('OC.Keep',)]");
  });

  it('refuses without calling login() when there is no Keep mode', () => {
    const r = runLogin(['Force', 'Never', 'Try'], false);
    if (r.out === 'SKIP') return;
    expect(r.out).toContain('RESULT refused []');
    expect(r.out).toContain("no 'Keep' login mode");
  });

  it('passes the version warning of the script into the tool reply', () => {
    const out = [
      'DEBUG: connect_to_device: login(Keep, False) succeeded (no download, the PLC keeps its program)',
      'WARNING: the PLC runs version 1.2.3.4, this project is 1.2.3.5. Logged in WITHOUT download (Keep): x',
      'Connected to device for application: Application',
      'WARNING: the PLC runs version 1.2.3.4, this project is 1.2.3.5. Logged in WITHOUT download (Keep): x',
    ].join('\r\n');
    expect(plcVersionWarnings(out)).toEqual([
      'WARNING: the PLC runs version 1.2.3.4, this project is 1.2.3.5. Logged in WITHOUT download (Keep): x',
    ]);
    expect(plcVersionWarnings('')).toEqual([]);
    expect(plcVersionWarnings(undefined)).toEqual([]);
  });
});
