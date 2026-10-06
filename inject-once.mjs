// One-shot bridge: sends a command to an existing watcher's IPC dir,
// matching the file format from src/ipc.ts so the watcher (which has no
// idea this MCP server even exists) picks up and executes it.
// Used to verify a script change without restarting CODESYS / VSCode.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const IPC_DIR = process.argv[2];
const PROJECT_FILE_PATH = process.argv[3];
const SCRIPT_NAME = process.argv[4] || 'list_project_libraries';
const HELPERS = (process.argv[5] || 'ensure_project_open').split(',').filter(Boolean);
const TIMEOUT_MS = Number(process.argv[6] || '120000');

if (!IPC_DIR || !PROJECT_FILE_PATH) {
  console.error('usage: node inject-once.mjs <IPC_DIR> <PROJECT_FILE_PATH> [scriptName] [helpers,csv] [timeoutMs]');
  process.exit(2);
}

const SCRIPTS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), 'dist/scripts');

const helperBodies = HELPERS.map((h) =>
  fs.readFileSync(path.join(SCRIPTS_DIR, `${h}.py`), 'utf-8')
);
const mainBody = fs.readFileSync(path.join(SCRIPTS_DIR, `${SCRIPT_NAME}.py`), 'utf-8');
const combined = [...helperBodies, mainBody].join('\n\n');
const interpolated = combined.replace(/\{PROJECT_FILE_PATH\}/g, PROJECT_FILE_PATH);

const reqId = crypto.randomUUID();
const cmdsDir = path.join(IPC_DIR, 'commands');
const resDir = path.join(IPC_DIR, 'results');
const scriptPath = path.join(cmdsDir, `${reqId}.py`);
const cmdPath = path.join(cmdsDir, `${reqId}.command.json`);
const resPath = path.join(resDir, `${reqId}.result.json`);

function atomicWrite(p, content) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, p);
}

console.error(`[inject] reqId=${reqId} ipcDir=${IPC_DIR}`);
atomicWrite(scriptPath, interpolated);
atomicWrite(cmdPath, JSON.stringify({
  requestId: reqId,
  scriptPath: scriptPath,
  timestamp: Date.now(),
}));

const start = Date.now();
let pollMs = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

while (Date.now() - start < TIMEOUT_MS) {
  if (fs.existsSync(resPath)) {
    try {
      const result = JSON.parse(fs.readFileSync(resPath, 'utf-8'));
      console.log(JSON.stringify(result, null, 2));
      try { fs.unlinkSync(resPath); } catch { /* ignore */ }
      process.exit(result.success ? 0 : 1);
    } catch {
      // partial write, retry next tick
    }
  }
  await sleep(pollMs);
  pollMs = Math.min(pollMs * 2, 1000);
}
console.error(`[inject] timeout after ${TIMEOUT_MS}ms`);
process.exit(3);
