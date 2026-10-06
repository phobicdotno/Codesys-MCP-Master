import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { writeLiveValues } from '../../src/live-values-write';

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'phobics-lvw-'));
}

const sample = {
  device: 'D1',
  pou_name: 'PLC_PRG',
  values: {
    counter: { value: '47', type: 'INT', ts: Date.now() },
  },
};

describe('writeLiveValues', () => {
  it('writes the v1 envelope with required fields', async () => {
    const dir = await tmpDir();
    const target = path.join(dir, 'tui-live-values.json');
    await writeLiveValues(target, '/abs/project', sample);

    const parsed = JSON.parse(await fs.readFile(target, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(parsed.project_dir).toBe('/abs/project');
    expect(parsed.device).toBe('D1');
    expect(parsed.pou_name).toBe('PLC_PRG');
    expect(parsed.values.counter.value).toBe('47');
    expect(typeof parsed.updated_at).toBe('string');
  });

  it('creates parent dirs as needed', async () => {
    const dir = await tmpDir();
    const target = path.join(dir, 'a', 'b', 'tui-live-values.json');
    await writeLiveValues(target, '/abs/project', sample);
    expect((await fs.stat(target)).isFile()).toBe(true);
  });

  it('does not leave .tmp residue on success', async () => {
    const dir = await tmpDir();
    const target = path.join(dir, 'tui-live-values.json');
    await writeLiveValues(target, '/abs/project', sample);
    const entries = await fs.readdir(dir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});
