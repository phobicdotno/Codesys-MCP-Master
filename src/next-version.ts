/**
 * Version-ahead release flow.
 *
 * The old flow bumped the version at release time. The user downloads to the
 * PLC first and asks for the release afterwards, so the PLC always ran the
 * build under the PREVIOUS version number, and the next download, done after
 * the next release, lagged again. Every release left the PLC one number
 * behind.
 *
 * The fix: right after a release, the working copy is moved to the next
 * build number (and, for projects that keep a Drive archive, the next Drive
 * file name). Whatever is downloaded from then on already carries the number
 * the next release gives it. At release time a working copy that is ahead of
 * the latest v* tag is released under its own number, without a second bump.
 */
import * as fs from 'fs';
import * as path from 'path';

export const VERSION_GVL_FILE = '_MCP_PROJECT_VERSION.st';

/** Compare two dotted versions numerically (missing parts count as 0). */
export function cmpVersion(a: string, b: string): number {
  const A = a.split('.').map((n) => parseInt(n, 10) || 0);
  const B = b.split('.').map((n) => parseInt(n, 10) || 0);
  while (A.length < 4) A.push(0);
  while (B.length < 4) B.push(0);
  for (let i = 0; i < 4; i++) {
    if (A[i] !== B[i]) return A[i] - B[i];
  }
  return 0;
}

/** X.Y.Z.W -> X.Y.Z.(W+1). */
export function nextBuild(version: string): string {
  const p = version.split('.').map((n) => parseInt(n, 10) || 0);
  while (p.length < 4) p.push(0);
  p[3] += 1;
  return p.slice(0, 4).join('.');
}

/** 'Name_001' -> 'Name_002' (width kept). undefined when there is no _NNN suffix. */
export function nextDriveFile(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const m = /^(.*_)(\d+)$/.exec(name);
  if (!m) return undefined;
  const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
  return m[1] + n;
}

/** Every _MCP_PROJECT_VERSION.st below the mirror (one per application). */
export function findVersionGvlFiles(mirrorDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name === VERSION_GVL_FILE) out.push(full);
    }
  };
  walk(mirrorDir);
  return out.sort();
}

/** Parse sVersion / sDriveFile out of a version GVL declaration. */
export function parseVersionGvl(text: string): { version?: string; driveFile?: string } {
  const v = /sVersion\s*:\s*STRING\s*:=\s*'([^']*)'/.exec(text);
  const d = /sDriveFile\s*:\s*STRING\s*:=\s*'([^']*)'/.exec(text);
  return {
    version: v && v[1] ? v[1] : undefined,
    driveFile: d && d[1] ? d[1] : undefined,
  };
}

/** The version the exported project carries (first application's GVL). */
export function readMirrorVersion(mirrorDir: string): { version?: string; driveFile?: string } {
  const files = findVersionGvlFiles(mirrorDir);
  if (files.length === 0) return {};
  try {
    return parseVersionGvl(fs.readFileSync(files[0], 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * True when the working copy already carries a version above the latest
 * release tag, i.e. it was prepared for the next build after that release.
 */
export function isPreparedAhead(workingVersion: string | undefined, latestTag: string): boolean {
  if (!workingVersion || !/^v\d+(\.\d+){1,3}$/.test(latestTag)) return false;
  return cmpVersion(workingVersion, latestTag.slice(1)) > 0;
}

type Level = 'major' | 'minor' | 'revision' | 'build';
export type Classification =
  | { kind: 'bump'; level: Level; evidence: string[] }
  | { kind: 'no-changes'; evidence: string[] }
  | { kind: 'first-run'; evidence: string[] };

/**
 * Drop the version GVL from a classification. In a prepared working copy the
 * GVL differs from the tag only because of the preparation, which is not a
 * code change. The level is recomputed from the remaining file lines.
 */
export function withoutVersionGvl(c: Classification): Classification {
  if (c.kind === 'first-run') return c;
  const isGvl = (e: string) => e.includes(VERSION_GVL_FILE);
  const evidence = c.evidence.filter((e) => !isGvl(e));
  const files = evidence.filter((e) => /^(modified|added|deleted|renamed|added \(untracked\)): /.test(e));
  if (files.length === 0) return { kind: 'no-changes', evidence };
  if (files.some((e) => /^(deleted|renamed): /.test(e))) return { kind: 'bump', level: 'major', evidence };
  if (files.some((e) => /^added/.test(e))) return { kind: 'bump', level: 'minor', evidence };
  return { kind: 'bump', level: 'revision', evidence };
}
