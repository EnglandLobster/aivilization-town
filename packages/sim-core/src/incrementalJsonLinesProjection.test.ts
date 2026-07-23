import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { IncrementalJsonLinesProjection } from './incrementalJsonLinesProjection';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('IncrementalJsonLinesProjection', () => {
  test('refreshes only complete appended rows and supports exact committed scans', async () => {
    const path = await createPath();
    const projected: number[] = [];
    const projection = createProjection(path, projected);
    projection.append([{ id: 1 }, { id: 2 }]);
    appendFileSync(path, JSON.stringify({ id: 3 }));

    expect(projection.diagnostics()).toMatchObject({
      completeRecordCount: 2,
      hasIncompleteTrailingRow: true,
    });
    const scanned: number[] = [];
    expect(projection.scanCommitted((value) => scanned.push(value.id))).toBe(2);
    expect(scanned).toEqual([1, 2]);
    expect(() => projection.append([{ id: 4 }])).toThrow('incomplete trailing row');
  });

  test('rebuilds caller-owned state after same-size replacement', async () => {
    const path = await createPath();
    const projected: number[] = [];
    const projection = createProjection(path, projected);
    projection.append([{ id: 1 }]);
    writeFileSync(path, `${JSON.stringify({ id: 9 })}\n`);

    projection.refresh();
    expect(projected).toEqual([9]);
    expect(projection.diagnostics()).toMatchObject({
      completeRecordCount: 1,
      hasIncompleteTrailingRow: false,
    });
  });

  test('rejects a committed scan when the ledger changes before it returns', async () => {
    const path = await createPath();
    const projected: number[] = [];
    const projection = createProjection(path, projected);
    projection.append([{ id: 1 }, { id: 2 }]);

    expect(() =>
      projection.scanCommitted((value) => {
        if (value.id === 1) {
          appendFileSync(path, `${JSON.stringify({ id: 3 })}\n`);
        }
      }),
    ).toThrow('ledger changed during the committed scan');

    projection.refresh();
    expect(projected).toEqual([1, 2, 3]);
  });
});

async function createPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'incremental-jsonl-projection-'));
  roots.push(root);
  const path = join(root, 'records.jsonl');
  writeFileSync(path, '');
  return path;
}

function createProjection(path: string, projected: number[]) {
  return new IncrementalJsonLinesProjection<{ readonly id: number }>({
    path,
    resetProjection: () => projected.splice(0),
    project: (value) => projected.push(value.id),
  });
}
