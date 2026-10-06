/**
 * Pre-flight check for `open_project`.
 *
 * WHY: When the user calls `open_project` with a .project file saved on a
 * different SP than the configured CODESYS install, CODESYS pops a modal
 * dialog (patch difference) or flat-out refuses (SP difference). Either
 * way it blocks the IPC pipe and every subsequent script call hangs.
 *
 * This module compares the project's saved profile (read offline via
 * src/inspect.ts -- ZIP+XML, no CODESYS) against the server's configured
 * --codesys-profile and decides one of three outcomes BEFORE the open
 * script is dispatched:
 *
 *   - exact match           -> proceed silently
 *   - same SP, diff patch   -> proceed but warn (CODESYS will pop the
 *                              patch-difference dialog; the user knows)
 *   - SP mismatch           -> refuse outright with a routing hint to
 *                              regenerate config via `--print-config
 *                              --for-project <path>`
 *
 * If inspection or profile parsing fails for any reason, the caller is
 * expected to fall through silently and let CODESYS produce its native
 * error -- pre-flight is a UX nicety, not a hard dependency.
 */

export interface PreflightDecision {
  action: 'proceed' | 'proceed-with-warning' | 'refuse';
  /** Populated for 'proceed-with-warning' and 'refuse'. */
  message?: string;
}

export interface PreflightProjectInspection {
  sp: number;
  patch: number;
  profileName: string;
  profileVersion: string;
}

export interface PreflightServerProfile {
  sp: number;
  patch: number;
}

export function decideOpenProjectPreflight(
  projectInspection: PreflightProjectInspection,
  serverProfile: PreflightServerProfile,
  projectFilePath: string
): PreflightDecision {
  const { sp: projSp, patch: projPatch, profileName, profileVersion } = projectInspection;
  const { sp: srvSp, patch: srvPatch } = serverProfile;

  // Exact match -> silent proceed.
  if (projSp === srvSp && projPatch === srvPatch) {
    return { action: 'proceed' };
  }

  // Same SP, different patch -> warn and proceed. CODESYS will pop the
  // patch-difference dialog; the user has been told, so they can decide
  // whether to dismiss it or kill the server and pick a closer-matching
  // entry. The warning is one line so it doesn't drown the success
  // message.
  if (projSp === srvSp) {
    const srvProfile = patchToProfileName(srvSp, srvPatch);
    const srvVersion = patchToProfileVersion(srvSp, srvPatch);
    return {
      action: 'proceed-with-warning',
      message:
        `⚠ Project saved on ${profileName} (${profileVersion}); ` +
        `this server is ${srvProfile} (${srvVersion}). ` +
        `Open will trigger CODESYS's patch-difference dialog -- proceeding.`,
    };
  }

  // SP mismatch -> refuse. Opening would force a downgrade/upgrade
  // conversion that almost always breaks the project (libraries get
  // remapped, devices may not exist in the other SP's device repository,
  // etc.). Suggest the routing fix.
  const srvProfile = patchToProfileName(srvSp, srvPatch);
  return {
    action: 'refuse',
    message:
      `Refused: project saved on ${profileName} (${profileVersion}), ` +
      `this server is configured for ${srvProfile}. ` +
      `Opening would trigger a downgrade/upgrade conversion dialog and likely break the project.\n\n` +
      `Use a different MCP server entry that points at SP${projSp}, or generate one with:\n` +
      `  codesys-mcp-master --print-config --for-project "${projectFilePath}"`,
  };
}

function patchToProfileName(sp: number, patch: number): string {
  const head = `CODESYS V3.5 SP${sp}`;
  return patch === 0 ? head : `${head} Patch ${patch}`;
}

function patchToProfileVersion(sp: number, patch: number): string {
  // Mirrors the convention used by inspect.ts: rawPatch = patch * 10.
  return `3.5.${sp}.${patch * 10}`;
}
