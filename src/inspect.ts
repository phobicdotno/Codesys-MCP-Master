import * as fs from 'fs';
import { execFileSync } from 'child_process';

/**
 * Offline inspection of a CODESYS .project file.
 *
 * WHY: Knowing which CODESYS install opens a project (and which mandatory
 * libraries / packages it expects) without spawning CODESYS itself lets users
 * pick the right --codesys-path / --codesys-profile up front, surface
 * mismatches in CI, and audit projects on Linux/Mac where CODESYS doesn't run.
 *
 * The inspection data lives in `projectinspectiondata.auxiliary` -- a plain
 * XML entry inside the .project ZIP archive. The schema is stable enough that
 * regex extraction is sufficient (and avoids adding an XML-parser dependency).
 */

export interface MandatoryLibraryEntry {
  typeGuid?: string;
  title?: string;
  version?: string;
}

export interface InspectionResult {
  filePath: string;
  profileName: string; // e.g. "CODESYS V3.5 SP22 Patch 1"
  profileVersion: string; // e.g. "3.5.22.10"
  major: number;
  minor: number;
  sp: number;
  patch: number; // floor(rawPatch / 10) -- matches install dir convention (e.g. 3.5.22.10 -> Patch 1)
  mandatoryLibraries: MandatoryLibraryEntry[];
}

const PROFILE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/;

/**
 * Pure XML-to-fields parser, factored out so unit tests can run without
 * spawning unzip or touching the filesystem.
 */
export function parseInspectionXml(
  xml: string
): {
  profileName: string;
  profileVersion: string;
  major: number;
  minor: number;
  sp: number;
  patch: number;
  mandatoryLibraries: MandatoryLibraryEntry[];
} {
  const profileName = extractTagText(xml, 'ProfileName');
  const profileVersion = extractTagText(xml, 'ProfileVersion');

  if (!profileName || !profileVersion) {
    throw new Error(
      'Malformed projectinspectiondata.auxiliary: missing <ProfileName> or <ProfileVersion>'
    );
  }

  const m = PROFILE_VERSION_RE.exec(profileVersion);
  if (!m) {
    throw new Error(
      `Malformed <ProfileVersion>: expected X.Y.Z.W, got "${profileVersion}"`
    );
  }
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  const sp = parseInt(m[3], 10);
  const rawPatch = parseInt(m[4], 10);
  const patch = Math.floor(rawPatch / 10);

  const mandatoryLibraries = extractMandatoryEntries(xml);

  return {
    profileName,
    profileVersion,
    major,
    minor,
    sp,
    patch,
    mandatoryLibraries,
  };
}

function extractTagText(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const m = re.exec(xml);
  return m ? m[1].trim() : undefined;
}

function extractMandatoryEntries(xml: string): MandatoryLibraryEntry[] {
  // Narrow to the <MandatoryTypes>...</MandatoryTypes> block so we don't pick
  // up entries from <OptionalPackages> below it.
  const blockMatch = /<MandatoryTypes>([\s\S]*?)<\/MandatoryTypes>/.exec(xml);
  if (!blockMatch) return [];
  const block = blockMatch[1];

  const out: MandatoryLibraryEntry[] = [];
  const detailRe = /<ProjectInspectionDetail>([\s\S]*?)<\/ProjectInspectionDetail>/g;
  let dm: RegExpExecArray | null;
  while ((dm = detailRe.exec(block)) !== null) {
    const inner = dm[1];
    const typeGuid = extractTagText(inner, 'TypeGuid');
    // Prefer the package-level name/version when present (those are the
    // user-meaningful "library" labels); fall back to the plugin-level
    // metadata which is what the per-object detail rows carry.
    const title =
      extractTagText(inner, 'OwningPackageName') ??
      extractTagText(inner, 'OwningPluginName');
    const version =
      extractTagText(inner, 'OwningPackageVersion') ??
      extractTagText(inner, 'OwningPluginVersion');
    out.push({ typeGuid, title, version });
  }
  return out;
}

/**
 * Reads + parses a CODESYS .project file and returns its inspection metadata.
 *
 * Uses the `unzip` CLI (ships with Git for Windows; standard on Linux/Mac)
 * to keep the dependency surface zero -- the wider package has no ZIP-related
 * deps and we want to keep it that way.
 */
export async function inspectProjectFile(filePath: string): Promise<InspectionResult> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Project file not found: ${filePath}`);
  }

  let xml: string;
  try {
    const buf = execFileSync('unzip', ['-p', filePath, 'projectinspectiondata.auxiliary'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    xml = buf.toString('utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: Buffer; status?: number };
    if (e.code === 'ENOENT') {
      throw new Error(
        'unzip CLI required (ships with Git for Windows / standard on Linux+Mac)'
      );
    }
    const stderr = e.stderr ? e.stderr.toString('utf8') : '';
    throw new Error(`Failed to read project ZIP "${filePath}": ${stderr || (err as Error).message}`);
  }

  if (!xml || xml.trim().length === 0) {
    throw new Error(
      `${filePath} is not a CODESYS .project (no projectinspectiondata.auxiliary entry)`
    );
  }

  const parsed = parseInspectionXml(xml);
  return {
    filePath,
    ...parsed,
  };
}

/**
 * Derives the same `codesys-spXX[-patchN]` server-entry name that --detect
 * uses, so users can quickly map a project to the matching .mcp.json entry.
 */
export function suggestedServerName(sp: number, patch: number): string {
  const head = `codesys-sp${sp}`;
  return patch === 0 ? head : `${head}-patch${patch}`;
}
