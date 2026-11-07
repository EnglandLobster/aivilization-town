import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import { FileShortTermMemoryRepository, createShortTermMemoryRecord } from '@aivilization/memory';
import { readCanonicalResidentMemory } from './canonicalMemoryContinuation';
import { createOpenSocietyManifest, openWorldPolicies } from './openSociety/manifest';
import { OpenSocietyRuntime } from './openSociety/runtime';
import { executeCognitionTool } from './openSociety/cognitionTools';
import { buildOpenResidentContext } from './openSociety/context';
import { canonicalMemoryExperiences } from './openSociety/canonicalMemory';

test('full ledger exceeds fast buffer, remains personally readable after restart without prompt injection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canonical-memory-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    const manifest = createOpenSocietyManifest({ count: 2 });
    const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
    const repository = new FileShortTermMemoryRepository({ rootDir: join(root, 'source') });
    const records = Array.from({ length: 601 }, (_, i) =>
      createShortTermMemoryRecord({
        id: `original-${i}`,
        agentId: asAgentId(a),
        kind: 'human-command',
        status: 'observed',
        summary: `Unexecuted historical suggestion ${i}`,
        occurredAt: 10000 - i,
        importanceScore: 0.5,
        source: { eventIds: [] },
        provenance: { kind: 'implanted', status: 'influencing' },
      }),
    );
    await repository.appendMany(records);
    const continuation = await readCanonicalResidentMemory({
      residentIds: [a, b],
      partitions: [{ partitionKey: 'old', repository }],
    });
    expect(continuation.recordsByResident[a]).toHaveLength(601);
    expect(continuation.recordsByResident[a]!.map((r) => r.record)).toEqual(records);
    expect(continuation.recordsByResident[b]).toEqual([]);
    runtime = new OpenSocietyRuntime(join(root, 'target'), {
      ...manifest,
      canonicalMemoryContinuation: continuation,
    });
    expect(runtime.state.cognition).toEqual({});
    const own = runtime.state.experiences[a]!;
    expect(own).toHaveLength(601);
    expect(
      executeCognitionTool(runtime.state, a, 'memory.read', { id: own[0]!.id }).data,
    ).toMatchObject({ canonicalSource: { record: records[0] }, provenance: 'legacy-record' });
    expect(() =>
      executeCognitionTool(runtime!.state, b, 'memory.read', { id: own[0]!.id }),
    ).toThrow('not-found');
    const search = executeCognitionTool(runtime.state, a, 'memory.search', {
      query: 'suggestion',
      limit: 2,
    });
    expect(JSON.stringify(search.data)).not.toContain('canonicalSource');
    const context = buildOpenResidentContext(
      runtime.state,
      runtime.manifest,
      a,
      openWorldPolicies(manifest.seed, runtime.state.world),
    );
    expect(context.memories.items).toEqual([]);
    expect(context.memories.total).toBe(601);
    expect(context.memories.historicalRecords).toBe(601);
    expect(JSON.stringify(context)).not.toContain('Unexecuted historical suggestion');
    const before = structuredClone(runtime.state);
    runtime.close();
    runtime = new OpenSocietyRuntime(join(root, 'target'));
    expect(runtime.state).toEqual(before);
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test('wrong owner and non-progressing pages reject instead of looping or mixing private history', async () => {
  const record = createShortTermMemoryRecord({
    id: 'x',
    agentId: asAgentId('a'),
    kind: 'action',
    status: 'failed',
    summary: 'failed',
    occurredAt: 0,
    importanceScore: 0.1,
    source: { eventIds: [] },
  });
  let calls = 0;
  const repository = {
    retrieveLedgerMany: () => {
      calls++;
      return Promise.resolve([{ entries: [{ appendSequence: 1, record }] }]);
    },
  };
  await expect(
    readCanonicalResidentMemory({
      residentIds: ['a'],
      partitions: [{ partitionKey: 'p', repository }],
    }),
  ).rejects.toThrow('entry-invalid');
  expect(calls).toBe(2);
  await expect(
    readCanonicalResidentMemory({
      residentIds: ['b'],
      partitions: [{ partitionKey: 'p', repository }],
    }),
  ).rejects.toThrow('entry-invalid');
  await expect(readCanonicalResidentMemory({ residentIds: ['a'], partitions: [] })).rejects.toThrow(
    'source-set-invalid',
  );
});
test('legacy manifests stay empty and foreign owners reject', () => {
  const manifest = createOpenSocietyManifest({ count: 1 });
  expect(canonicalMemoryExperiences(manifest)).toEqual({});
  expect(() =>
    canonicalMemoryExperiences({
      ...manifest,
      canonicalMemoryContinuation: {
        version: 'canonical-memory-continuation-v1',
        recordsByResident: { foreign: [] },
      },
    }),
  ).toThrow('owner-unknown');
});
