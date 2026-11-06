// A connect (and every other login that only looks at the PLC) logs in with
// OnlineChangeOption.Keep and never downloads (src/scripts/ensure_online_connection.py,
// login_without_download). When the project's _MCP_PROJECT_VERSION differs from the
// one running on the PLC, the script prints a WARNING line; the success reply of the
// tool carries it, so the caller learns that the PLC runs another program.
export function plcVersionWarnings(output: string | undefined | null): string[] {
  if (!output) return [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('WARNING: the PLC runs version')) seen.add(t);
  }
  return [...seen];
}
