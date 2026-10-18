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
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

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

/**
 * Facts for the download guard: is this working copy the next build that a
 * release prepared, with nothing changed since? Then a download would put a
 * number on the PLC that no release has: the released build is the tag.
 */
export interface PreparedState {
  /** The last commit of the .project is a "Prepare v..." commit and the file equals HEAD's. */
  unchangedSincePreparation: boolean;
  latestTag: string;
  preparedVersion?: string;
  preparedDriveFile?: string;
}

export function decideDownloadGuard(s: PreparedState): string | null {
  if (!s.unchangedSincePreparation || !isPreparedAhead(s.preparedVersion, s.latestTag)) return null;
  const next = `v${s.preparedVersion}${s.preparedDriveFile ? ` / ${s.preparedDriveFile}` : ''}`;
  return (
    `This working copy is the next build (${next}) that the release of ${s.latestTag} prepared, ` +
    `and nothing has changed since. Downloading it would put a number on the PLC that no release has ` +
    `(the code is ${s.latestTag}'s, the label is the next one).\n` +
    `Download the released build instead: take it from the tag (git show ${s.latestTag}:<file>.project, ` +
    `in cmd or Git Bash), put it in a scratch folder with the .codesys-version file, and download that copy. ` +
    `Or make the change first: then the download carries ${next}, which the next release keeps.\n` +
    `allowUnreleasedNumber: true downloads this copy anyway.`
  );
}

/** Read the PreparedState of a project in a git repo; null outside git or without a tag. */
export function readPreparedState(projectFile: string, mirrorDir: string): PreparedState | null {
  const dir = path.dirname(projectFile);
  const git = (args: string): string =>
    execSync(`git -C "${dir}" ${args}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const latestTag = git('describe --tags --abbrev=0 --match "v*"');
    // The last commit that touched the .project, not HEAD: a vessel release is
    // followed by a Drive / Changelog commit that leaves the binary alone.
    const base = path.basename(projectFile);
    const subject = git(`log -1 --format=%s -- "${base}"`);
    let unchanged = false;
    if (/^Prepare v/.test(subject)) {
      const committed = execSync(`git -C "${dir}" show "HEAD:./${base}"`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 512 * 1024 * 1024,
      });
      const hash = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
      unchanged = hash(committed) === hash(fs.readFileSync(projectFile));
    }
    const v = readMirrorVersion(mirrorDir);
    return { unchangedSincePreparation: unchanged, latestTag, preparedVersion: v.version, preparedDriveFile: v.driveFile };
  } catch {
    return null;
  }
}

type Level = 'major' | 'minor' | 'revision' | 'build';
export type Classification =
  | { kind: 'bump'; level: Level; evidence: string[] }
  | { kind: 'no-changes'; evidence: string[] }
  | { kind: 'first-run'; evidence: string[] };

/**
 * Drop the version files from a classification. In a prepared working copy the
 * GVL differs from the tag only because of the preparation, which is not a
 * code change. The level is recomputed from the remaining file lines.
 */
export function withoutVersionGvl(c: Classification): Classification {
  if (c.kind === 'first-run') return c;
  // A bump also rewrites the version constants CODESYS generates under
  // "Project Information" (GetVersion / GetVersionProperty).
  const isGvl = (e: string) =>
    e.includes(VERSION_GVL_FILE) || /Project Information\/GetVersion(Property)?\.st$/.test(e);
  const evidence = c.evidence.filter((e) => !isGvl(e));
  const files = evidence.filter((e) => /^(modified|added|deleted|renamed|added \(untracked\)): /.test(e));
  if (files.length === 0) return { kind: 'no-changes', evidence };
  if (files.some((e) => /^(deleted|renamed): /.test(e))) return { kind: 'bump', level: 'major', evidence };
  if (files.some((e) => /^added/.test(e))) return { kind: 'bump', level: 'minor', evidence };
  return { kind: 'bump', level: 'revision', evidence };
}
