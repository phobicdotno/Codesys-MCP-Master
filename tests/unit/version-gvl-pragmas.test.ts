import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as path from 'path';

// bump_project_version.py imports scriptengine, so only its pure helpers are
// pulled out (by AST) and run under CPython.
const script = path.join(__dirname, '..', '..', 'src', 'scripts', 'bump_project_version.py');
const loader = [
  'import ast, json, re, sys',
  'src = open(sys.argv[1], encoding="utf-8").read()',
  'keep = ("attached_pragmas", "build_version_gvl_declaration")',
  'mod = ast.Module(body=[n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name in keep], type_ignores=[])',
  'exec(compile(mod, "bump", "exec"))',
].join('\n');

function build(existing: string): string {
  const code = `${loader}\nprint(json.dumps(build_version_gvl_declaration('1.2.3.5', [('Util', '3.5.17.0')], 'P_002', ${JSON.stringify(existing)})))`;
  const r = spawnSync('python', ['-c', code, script], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

const PLAIN = build('');

describe('bump_project_version GVL regeneration', () => {
  it('keeps attribute pragmas that sat directly above sVersion and sDriveFile', () => {
    const existing = [
      "{attribute 'qualified_only'}",
      'VAR_GLOBAL',
      "    {attribute 'init_on_onlchange'}",
      "    sVersion : STRING := '1.2.3.4';",
      '    // Drive export name for THIS build.',
      "    {attribute 'init_on_onlchange'}",
      "    sDriveFile : STRING := 'P_001';",
      '    uiLibraryCount : UINT := 0;',
      'END_VAR',
    ].join('\r\n');
    const out = build(existing).split('\n');
    const v = out.indexOf("    sVersion : STRING := '1.2.3.5';");
    const d = out.indexOf("    sDriveFile : STRING := 'P_002';");
    expect(out[v - 1]).toBe("    {attribute 'init_on_onlchange'}");
    expect(out[d - 1]).toBe("    {attribute 'init_on_onlchange'}");
    // Nothing else changes: removing the two kept lines gives the plain template.
    expect(out.filter((l) => l !== "    {attribute 'init_on_onlchange'}").join('\n')).toBe(PLAIN);
  });

  it('produces the plain template when the existing GVL has no attached pragmas', () => {
    expect(PLAIN).not.toContain('init_on_onlchange');
    expect(PLAIN.split('\n').slice(0, 3)).toEqual(["{attribute 'qualified_only'}", 'VAR_GLOBAL', "    sVersion : STRING := '1.2.3.5';"]);
  });
});
