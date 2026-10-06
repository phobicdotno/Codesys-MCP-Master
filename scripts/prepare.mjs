// npm runs this on `npm install` in the repo and when it installs the package
// from git (`npm i -g github:phobicdotno/Codesys-MCP-Master`). dist/ is not in
// git, so it is built here. During a global install the npm_config_global /
// prefix / omit settings leak into this step, and `tsc` was then not found
// ('tsc' is not recognized, 2026-10-06). So: drop those settings, make sure
// the dev dependencies are installed in this folder, and call the TypeScript
// compiler by path instead of through node_modules/.bin.
import { execSync } from 'child_process';
import fs from 'fs';

const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (/^npm_config_(global|prefix|omit|production|location)$/i.test(k)) delete env[k];
}

const tsc = 'node_modules/typescript/bin/tsc';
if (!fs.existsSync(tsc) || !fs.existsSync('node_modules/@types/node')) {
  execSync('npm install --include=dev --no-save --ignore-scripts --no-audit --no-fund', { stdio: 'inherit', env });
}
execSync(`node ${tsc}`, { stdio: 'inherit', env });
fs.rmSync('dist/scripts', { recursive: true, force: true });
fs.cpSync('src/scripts', 'dist/scripts', { recursive: true });
console.log('prepare: dist/ built');
