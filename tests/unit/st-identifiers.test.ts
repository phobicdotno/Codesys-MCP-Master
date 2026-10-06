import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// The Structured Text lexer behind find_references / rename_symbol is plain
// Python (no scriptengine), so it runs here under CPython.
const helper = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'scripts', 'st_identifiers.py'), 'utf-8');

function py(code: string): unknown {
  const r = spawnSync('python', ['-c', helper + '\nimport json\n' + code], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const SRC = [
  "x := 1; // x in a line comment",
  "(* x in a block (* nested x *) comment *)",
  "s := 'x in a string $' still x';",
  "{attribute 'x'} y := X + PLC_PRG.x + xy;",
  "t := T#1s; m := E_Mode#Run; n := 16#FF;",
].join('\n');

describe('st_identifiers', () => {
  it('finds whole identifiers outside comments, strings, pragmas and literals, case-insensitively', () => {
    const hits = py(`print(json.dumps(st_find_identifier(${JSON.stringify(SRC)}, "x")))`) as Array<{ line: number; column: number; qualifier: string }>;
    expect(hits.map((h) => [h.line, h.column])).toEqual([[1, 1], [4, 22], [4, 34]]);
    expect(hits[2].qualifier).toBe('PLC_PRG.');
    expect(hits[1].qualifier).toBe('');
  });

  it('does not match typed-literal values, but does match an enum type name', () => {
    expect(py(`print(json.dumps(len(st_find_identifier(${JSON.stringify(SRC)}, "Run"))))`)).toBe(0);
    expect(py(`print(json.dumps(len(st_find_identifier(${JSON.stringify(SRC)}, "s"))))`)).toBe(1);
    expect(py(`print(json.dumps(len(st_find_identifier(${JSON.stringify(SRC)}, "E_Mode"))))`)).toBe(1);
    expect(py(`print(json.dumps(len(st_find_identifier(${JSON.stringify(SRC)}, "FF"))))`)).toBe(0);
  });

  it('renames only real uses and keeps comments, strings and longer names', () => {
    const [text, n] = py(`print(json.dumps(st_replace_identifier(${JSON.stringify(SRC)}, "x", "nCount")))`) as [string, number];
    expect(n).toBe(3);
    expect(text).toContain('nCount := 1; // x in a line comment');
    expect(text).toContain("(* x in a block (* nested x *) comment *)");
    expect(text).toContain("'x in a string $' still x'");
    expect(text).toContain("{attribute 'x'} y := nCount + PLC_PRG.nCount + xy;");
  });
});
