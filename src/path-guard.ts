/**
 * Guards against UNC network paths for project files.
 *
 * CODESYS cannot reliably open/save projects served straight from a Windows UNC
 * path (\\server\share\...). The script engine and the IDE's project-open path
 * tend to fail late and opaquely on these. A mapped drive letter (e.g. Z: ->
 * \\server\share) works fine, so the fix for the user is always the same: map
 * the share or copy the project locally. We detect UNC up front and return a
 * clear, actionable error instead of letting CODESYS fail mid-way.
 */

/**
 * True when `p` is a Windows UNC path (\\server\share\... or the extended-length
 * \\?\UNC\server\share form). Mapped drive letters (Z:\...) and ordinary local
 * drives (C:\...) are NOT UNC, including the extended-length \\?\C:\ form.
 */
export function isUncPath(p: string): boolean {
  if (!p) return false;
  // Treat forward and back slashes alike; CODESYS and Node accept both.
  const s = p.replace(/\//g, '\\');

  // Extended-length UNC: \\?\UNC\server\share  or  \\.\UNC\server\share
  if (/^\\\\[?.]\\UNC\\/i.test(s)) return true;

  // Extended-length local drive: \\?\C:\...  — local, not UNC.
  if (/^\\\\[?.]\\[a-zA-Z]:/.test(s)) return false;

  // Plain UNC: \\server\share — two leading separators, next char is a host
  // character (not another separator and not the ?/. of the extended prefix).
  if (/^\\\\[^\\?.]/.test(s)) return true;

  return false;
}

/**
 * Returns a clear, actionable error message if `resolvedPath` is a UNC path,
 * otherwise null. `label` names the path in the message (e.g. "project file").
 */
export function uncPathError(resolvedPath: string, label = 'project file'): string | null {
  if (!isUncPath(resolvedPath)) return null;
  return (
    `UNC network path not supported for the ${label}: '${resolvedPath}'.\n` +
    `CODESYS cannot reliably open or save projects from UNC paths (\\\\server\\share\\...). ` +
    `Map the share to a drive letter and use that instead ` +
    `(e.g. \`net use Z: \\\\server\\share\` then 'Z:\\...\\MyPLC.project'), ` +
    `or copy the project to a local drive (e.g. C:\\).`
  );
}
