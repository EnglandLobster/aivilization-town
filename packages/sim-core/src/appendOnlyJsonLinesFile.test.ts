import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AppendOnlyJsonLinesFile } from './appendOnlyJsonLinesFile';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('AppendOnlyJsonLinesFile', () => {
  test('keeps a stable snapshot and observes appends from another instance', () => {
    const path = createJsonLinesPath();
    const first = new AppendOnlyJsonLinesFile<{ readonly id: number }>(path);
    const second = new AppendOnlyJsonLinesFile<{ readonly id: number }>(path);

    const emptySnapshot = first.read();
    expect(first.read()).toBe(emptySnapshot);

    second.append([{ id: 1 }, { id: 2 }]);
    expect(first.read()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(first.read()).toBe(first.read());
  });

  test('rebuilds after truncation and replacement', () => {
    const path = createJsonLinesPath();
    const file = new AppendOnlyJsonLinesFile<{ readonly id: number }>(path);
    file.append([{ id: 1 }, { id: 2 }]);
    const appendedSnapshot = file.read();

    writeFileSync(path, `${JSON.stringify({ id: 3 })}\n`);

    expect(file.read()).toEqual([{ id: 3 }]);
    expect(file.read()).not.toBe(appendedSnapshot);
  });

  test('rebuilds after a same-size in-place rewrite', () => {
    const path = createJsonLinesPath();
    const file = new AppendOnlyJsonLinesFile<{ readonly id: number }>(path);
    file.append([{ id: 1 }]);
    const originalSnapshot = file.read();

    writeFileSync(path, `${JSON.stringify({ id: 9 })}\n`);

    expect(file.read()).toEqual([{ id: 9 }]);
    expect(file.read()).not.toBe(originalSnapshot);
  });

  test('does not expose an externally written partial row', () => {
    const path = createJsonLinesPath();
    const file = new AppendOnlyJsonLinesFile<{ readonly id: number }>(path);

    appendFileSync(path, '{"id":1');
    expect(file.read()).toEqual([]);

    appendFileSync(path, '}\n');
    expect(file.read()).toEqual([{ id: 1 }]);
  });
});

function createJsonLinesPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-json-lines-'));
  tempRoots.push(root);
  const path = join(root, 'records.jsonl');
  writeFileSync(path, '');
  return path;
}
