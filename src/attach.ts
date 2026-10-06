import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ScriptManager } from './script-manager';
import { ATTACH_SESSION_PREFIX } from './launcher';

/**
 * The attach script: the MCP watcher, for a CODESYS the user opened by hand.
 *
 * A CODESYS the MCP did not start has no watcher, so the MCP cannot drive
 * it. Running this script once in it (Tools > Scripting > Execute Script
 * File...) installs the same UI-thread timer the launcher's --runscript
 * installs, in a new session dir "attach-<pid>-<time>" under the MCP's
 * session folder; the script returns and the timer keeps polling. The MCP
 * then takes that session over like one an ended session left (verified on
 * SP21 2026-10-06: run through CommandHelper.ExecuteScript, the call behind
 * Execute Script File, the attach session answered after the script had
 * returned).
 *
 * The session folder comes from the TEMP path CODESYS sees, which is the
 * one the MCP server uses (same user).
 */
export function buildAttachScript(sessionFolderName: string): string {
  const template = new ScriptManager().loadTemplate('watcher');
  const line = 'IPC_BASE_DIR = r"{IPC_BASE_DIR}"';
  if (!template.includes(line)) {
    throw new Error('watcher.py no longer has the IPC_BASE_DIR line the attach script replaces');
  }
  const replacement = [
    '# Attach script: this session dir is made here, inside the CODESYS the',
    '# user opened, under the MCP server\'s session folder. TEMP first, the',
    '# way Node\'s os.tmpdir() reads it (.NET GetTempPath reads TMP first).',
    'import System as _AttachSystem',
    '_attach_tmp = os.environ.get("TEMP") or os.environ.get("TMP") or _AttachSystem.IO.Path.GetTempPath()',
    `_attach_base = os.path.join(_attach_tmp, "${sessionFolderName}")`,
    `_attach_prefix = "${ATTACH_SESSION_PREFIX}%d-" % os.getpid()`,
    '# Run twice in one CODESYS: stop the earlier attach watcher first.',
    'if os.path.isdir(_attach_base):',
    '    for _old in os.listdir(_attach_base):',
    '        if _old.startswith(_attach_prefix):',
    '            try:',
    '                open(os.path.join(_attach_base, _old, "terminate.signal"), "w").close()',
    '            except Exception:',
    '                pass',
    'IPC_BASE_DIR = os.path.join(_attach_base, _attach_prefix + str(int(time.time())))',
    'if not os.path.isdir(IPC_BASE_DIR):',
    '    os.makedirs(IPC_BASE_DIR)',
  ].join('\n');
  return template.replace(line, replacement);
}

/** Where attach_codesys writes the script: a fixed path the user can pick in the file dialog. */
export function defaultAttachScriptPath(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Codesys-MCP-Master', 'attach-codesys-mcp.py');
}

export function writeAttachScript(sessionFolderName: string, target = defaultAttachScriptPath()): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, buildAttachScript(sessionFolderName), 'utf-8');
  return target;
}
