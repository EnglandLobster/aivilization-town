import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { BoundedTraceLedger, createBoundedTraceLedgerPolicyManifest } from './boundedTraceLedger';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bounded trace ledger', () => {
  test('keeps a bounded suffix, uses exact cold reads, and avoids scans for definite misses', async () => {
    const path = await createPath();
    const ledger = createLedger(path);
    for (let index = 1; index <= 5; index += 1) {
      expect(ledger.appendUnique({ id: `trace-${index}`, value: index })).toBe(true);
    }

    expect(ledger.get('trace-1')).toEqual({ id: 'trace-1', value: 1 });
    expect(ledger.get('definitely-missing')).toBeUndefined();
    expect(ledger.appendUnique({ id: 'trace-1', value: 999 })).toBe(false);
    expect(ledger.readAll()).toHaveLength(5);
    expect(ledger.diagnostics()).toMatchObject({
      completeRecordCount: 5,
      recentRecordCount: 2,
      recentRecordLimit: 2,
      exactColdScanCount: 2,
      definiteNegativeLookupCount: 6,
      completeQueryScanCount: 1,
      hasIncompleteTrailingRow: false,
    });
  });

  test('rebuilds after replacement and rejects append behind an incomplete row', async () => {
    const path = await createPath();
    const ledger = createLedger(path);
    ledger.appendUnique({ id: 'before', value: 1 });
    const replacement = `${JSON.stringify({ id: 'after', value: 2 })}\n`;
    writeFileSync(path, replacement);

    expect(ledger.get('before')).toBeUndefined();
    expect(ledger.get('after')).toEqual({ id: 'after', value: 2 });
    appendFileSync(path, '{"id":"partial"');
    expect(() => ledger.appendUnique({ id: 'blocked', value: 3 })).toThrow(
      'incomplete trailing row',
    );
    expect(readFileSync(path, 'utf8')).toBe(`${replacement}{"id":"partial"`);
  });

  test('publishes a versioned lossless hot/cold policy', () => {
    expect(createBoundedTraceLedgerPolicyManifest()).toMatchObject({
      policyVersion: 'bounded-trace-ledger-v1',
      durableLayout: 'unchanged-lossless-jsonl',
      recentRecordLimit: 4096,
      duplicateRule: 'recent-key-or-fixed-bloom-plus-exact-cold-scan',
      completeQueryRule: 'transient-committed-ledger-scan',
    });
  });
});

async function createPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bounded-trace-ledger-'));
  roots.push(root);
  return join(root, 'traces.jsonl');
}

function createLedger(path: string) {
  return new BoundedTraceLedger<{ readonly id: string; readonly value: number }>({
    path,
    keyOf: (value) => value.id,
    clone: (value) => ({ ...value }),
    recentRecordLimit: 2,
    bloomBitCount: 128,
    bloomHashCount: 3,
  });
}
