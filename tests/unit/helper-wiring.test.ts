import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// A script that calls a net_access function only works when server.ts
// prepends that helper. A missing entry is a NameError on a real CODESYS only
// (create_redundancy_config shipped without it once, and application_build
// got it instead).
const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
const server = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'server.ts'), 'utf-8');

/** Source text of every prepareScriptWithHelpers('<script>', ...) call, up to its matching ')'. */
function callsFor(script: string): string[] {
  const calls: string[] = [];
  const re = new RegExp(`prepareScriptWithHelpers\\(\\s*'${script}'`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(server)) !== null) {
    // Match parentheses rather than look for an indented ');': a call at
    // another indent ran on into the next call and borrowed its helpers.
    let depth = 0;
    let end = m.index;
    for (let i = server.indexOf('(', m.index); i < server.length; i++) {
      if (server[i] === '(') depth++;
      else if (server[i] === ')' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    calls.push(server.substring(m.index, end));
  }
  return calls;
}

const usesNetAccess = (src: string) =>
  src.split('\n').some((l) => /\bnet_(system_instances|assembly)\(/.test(l) && !/^\s*#/.test(l) && !/^def /.test(l.trim()));

describe('net_access helper wiring', () => {
  const scripts = fs.readdirSync(scriptsDir).filter((f) => f.endsWith('.py') && f !== 'net_access.py');
  for (const file of scripts) {
    const name = file.replace(/\.py$/, '');
    const src = fs.readFileSync(path.join(scriptsDir, file), 'utf-8');
    const calls = callsFor(name);
    if (usesNetAccess(src)) {
      it(`${name} is prepared with net_access`, () => {
        expect(calls.length, `${name} is never prepared with helpers`).toBeGreaterThan(0);
        for (const c of calls) expect(c).toContain("'net_access'");
      });
    } else if (calls.some((c) => c.includes("'net_access'"))) {
      it(`${name} does not need net_access`, () => {
        expect(calls.every((c) => !c.includes("'net_access'"))).toBe(true);
      });
    }
  }
});
