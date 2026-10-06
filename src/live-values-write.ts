import * as fs from 'fs/promises';
import * as path from 'path';

export interface LiveValueSnapshotIn {
  value: string;
  type?: string;
  ts: number;
}

export interface LiveValuesPayloadIn {
  device: string;
  pou_name: string;
  values: Record<string, LiveValueSnapshotIn>;
}

/**
 * Server-side counterpart to the TUI's readLiveValues.
 *
 * Wraps the caller's payload in the v1 envelope, writes atomically via
 * `<file>.<pid>.tmp` + rename, and creates parent dirs as needed. Mirrors
 * src/tui/shared/state-write.ts (the selection writer); kept separate
 * because that one's ESM and the server is CJS.
 */
export async function writeLiveValues(
  filePath: string,
  projectDir: string,
  payload: LiveValuesPayloadIn
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const envelope = {
    version: 1,
    updated_at: new Date().toISOString(),
    project_dir: projectDir,
    device: payload.device,
    pou_name: payload.pou_name,
    values: payload.values,
  };
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(envelope, null, 2), 'utf8');
  await fs.rename(tmp, filePath);
}
