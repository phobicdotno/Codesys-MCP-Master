import { describe, it, expect, vi } from 'vitest';
import { LiveValuesPump } from '../../src/live-values-pump';

const okSelection = (overrides: Record<string, unknown> = {}) => ({
  status: 'ok' as const,
  payload: {
    version: 1 as const,
    updated_at: new Date().toISOString(),
    project_dir: '/abs/proj',
    device: 'D1',
    selection: {
      kind: 'PRG',
      name: 'PLC_PRG',
      path: 'PLC_PRG.st',
      abs_path: '/abs/PLC_PRG.st',
    },
    viewer_line: 1,
    ...overrides,
  },
});

const sampleSt = [
  'PROGRAM PLC_PRG',
  'VAR',
  '  counter : INT := 0;',
  '  bRunning : BOOL;',
  'END_VAR',
].join('\n');

describe('LiveValuesPump.tick', () => {
  it('writes a snapshot containing every var read successfully', async () => {
    const writeLiveValues = vi.fn(async () => {});
    const readVariable = vi.fn(async (_proj: string, varPath: string) => {
      if (varPath.endsWith('.counter')) return '47';
      if (varPath.endsWith('.bRunning')) return 'TRUE';
      throw new Error('not found');
    });
    const pump = new LiveValuesPump(
      { stateFilePath: '/state.json', liveValuesFilePath: '/lv.json', intervalMs: 500 },
      {
        readSelection: vi.fn(async () => okSelection()),
        readPouFile: vi.fn(async () => sampleSt),
        readVariable,
        writeLiveValues,
      }
    );
    await pump.tick();
    expect(writeLiveValues).toHaveBeenCalledTimes(1);
    const [, projectDir, payload] = writeLiveValues.mock.calls[0];
    expect(projectDir).toBe('/abs/proj');
    expect(payload.device).toBe('D1');
    expect(payload.pou_name).toBe('PLC_PRG');
    expect(payload.values.counter.value).toBe('47');
    expect(payload.values.bRunning.value).toBe('TRUE');
  });

  it('skips writing when selection is missing/stale', async () => {
    const writeLiveValues = vi.fn(async () => {});
    const pump = new LiveValuesPump(
      { stateFilePath: '/state.json', liveValuesFilePath: '/lv.json', intervalMs: 500 },
      {
        readSelection: vi.fn(async () => ({ status: 'missing' as const })),
        readPouFile: vi.fn(async () => sampleSt),
        readVariable: vi.fn(async () => '1'),
        writeLiveValues,
      }
    );
    await pump.tick();
    expect(writeLiveValues).not.toHaveBeenCalled();
  });

  it('continues when one read_variable fails (partial write)', async () => {
    const writeLiveValues = vi.fn(async () => {});
    const pump = new LiveValuesPump(
      { stateFilePath: '/state.json', liveValuesFilePath: '/lv.json', intervalMs: 500 },
      {
        readSelection: vi.fn(async () => okSelection()),
        readPouFile: vi.fn(async () => sampleSt),
        readVariable: vi.fn(async (_p, varPath) => {
          if (varPath.endsWith('.counter')) return '47';
          throw new Error('boom');
        }),
        writeLiveValues,
      }
    );
    await pump.tick();
    const payload = writeLiveValues.mock.calls[0][2];
    expect(payload.values.counter.value).toBe('47');
    expect(payload.values.bRunning).toBeUndefined();
  });

  it('never throws when readPouFile throws', async () => {
    const writeLiveValues = vi.fn(async () => {});
    const pump = new LiveValuesPump(
      { stateFilePath: '/state.json', liveValuesFilePath: '/lv.json', intervalMs: 500 },
      {
        readSelection: vi.fn(async () => okSelection()),
        readPouFile: vi.fn(async () => { throw new Error('disk gone'); }),
        readVariable: vi.fn(async () => '1'),
        writeLiveValues,
      }
    );
    await expect(pump.tick()).resolves.toBeUndefined();
    expect(writeLiveValues).not.toHaveBeenCalled();
  });

  it('descends one level for vars whose type resolves to a mirror file', async () => {
    const parent = [
      'PROGRAM PLC_PRG',
      'VAR',
      '  fb : FB_Test;',
      'END_VAR',
    ].join('\n');
    const child = [
      'FUNCTION_BLOCK FB_Test',
      'VAR',
      '  inner : INT;',
      '  bAlive : BOOL;',
      'END_VAR',
    ].join('\n');
    const writeLiveValues = vi.fn(async () => {});
    const reads: string[] = [];
    const pump = new LiveValuesPump(
      { stateFilePath: '/state.json', liveValuesFilePath: '/lv.json', intervalMs: 500 },
      {
        readSelection: vi.fn(async () => okSelection()),
        readPouFile: vi.fn(async () => parent),
        resolveTypeMirror: vi.fn(async (typeName: string) =>
          typeName === 'FB_Test' ? child : null
        ),
        readVariable: vi.fn(async (_proj: string, varPath: string) => {
          reads.push(varPath);
          if (varPath === 'PLC_PRG.fb') return '<FB_Test>';
          if (varPath === 'PLC_PRG.fb.inner') return '7';
          if (varPath === 'PLC_PRG.fb.bAlive') return 'TRUE';
          throw new Error('unknown');
        }),
        writeLiveValues,
      }
    );
    await pump.tick();
    expect(reads).toContain('PLC_PRG.fb.inner');
    expect(reads).toContain('PLC_PRG.fb.bAlive');
    const payload = writeLiveValues.mock.calls[0][2];
    expect(payload.values.inner.value).toBe('7');
    expect(payload.values.bAlive.value).toBe('TRUE');
  });

  it('does not descend into vars with primitive types (no mirror file)', async () => {
    const parent = [
      'PROGRAM PLC_PRG',
      'VAR',
      '  counter : INT;',
      '  bFlag : BOOL;',
      'END_VAR',
    ].join('\n');
    const writeLiveValues = vi.fn(async () => {});
    const resolveTypeMirror = vi.fn(async () => null);
    const pump = new LiveValuesPump(
      { stateFilePath: '/state.json', liveValuesFilePath: '/lv.json', intervalMs: 500 },
      {
        readSelection: vi.fn(async () => okSelection()),
        readPouFile: vi.fn(async () => parent),
        resolveTypeMirror,
        readVariable: vi.fn(async () => '1'),
        writeLiveValues,
      }
    );
    await pump.tick();
    // resolveTypeMirror still gets ASKED for primitives; the resolver returns
    // null for each, so no descent. That's fine — caller decides what's
    // resolvable.
    expect(resolveTypeMirror).toHaveBeenCalled();
    const payload = writeLiveValues.mock.calls[0][2];
    expect(Object.keys(payload.values).sort()).toEqual(['bFlag', 'counter']);
  });
});
