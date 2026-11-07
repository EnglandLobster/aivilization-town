import { OpenSocietyJournal } from './openSociety/journal';
import { createCanonicalRequestHistory } from './canonicalRequestHistory';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { asSimulationId } from '@aivilization/sim-core';
import { createAivilizationWorldPolicyManifest } from './aivilizationWorldPolicies';
import { createOpenSocietyManifest } from './openSociety/manifest';
import { OpenSocietyRuntime } from './openSociety/runtime';
import { createCanonicalSocietyCandidate } from './canonicalSocietyCandidate';
import type { SimulationWideAuthoritySnapshot } from './simulationWideAuthority';
import type { CanonicalPolicyContinuation } from './canonicalPolicyContinuation';
function fixture() {
  const m = createOpenSocietyManifest({ count: 2, life: false, societyKernel: false });
  const w = m.initialWorld;
  const authority: SimulationWideAuthoritySnapshot = {
    schemaVersion: 'simulation-wide-authority-v1',
    authorityId: 'source',
    manifestId: 'source',
    simulationId: asSimulationId('source'),
    revision: 0,
    latestFencingToken: 0,
    projection: w,
    partitionKeys: ['p'],
    ownerPartitionKeyByAgentId: Object.fromEntries(m.residents.map((r) => [r.id, 'p'])),
    partitionClockNowByKey: { p: w.clock.now },
    partitionAccountsByKey: {
      p: {
        moneySupply: w.moneySupply,
        ...(w.treasury === undefined ? {} : { treasury: w.treasury }),
      },
    },
    pendingTransfers: {},
    materializerCursors: {},
    operations: {},
  };
  const policies: CanonicalPolicyContinuation = {
    version: 'canonical-policy-continuation-v1',
    seed: m.seed,
    configuration: {},
    sourcePolicyManifest: JSON.parse(
      JSON.stringify(createAivilizationWorldPolicyManifest()),
    ) as Record<string, unknown>,
  };
  return {
    authority,
    partitions: [{ partitionKey: 'p', consumerId: 'reader', projection: w }],
    policies,
    residents: m.residents,
    memories: {
      version: 'canonical-memory-continuation-v1' as const,
      recordsByResident: Object.fromEntries(m.residents.map((r) => [r.id, []])),
    },
    documents: {
      version: 'canonical-cognitive-documents-v2' as const,
      capturedAt: w.clock.now,
      documentsByResident: Object.fromEntries(m.residents.map((r) => [r.id, []])),
    },
  };
}
test('one candidate joins source world, identity, policies and cognition without seeded assets; isolated runtime replays', () => {
  const input = fixture();
  const before = structuredClone(input);
  const candidate = createCanonicalSocietyCandidate(input);
  if (candidate.status !== 'candidate') throw Error(JSON.stringify(candidate.issues));
  expect(input).toEqual(before);
  expect(candidate.manifest.initialWorld).toEqual(input.authority.projection);
  expect(candidate.manifest.residents).toEqual(input.residents);
  expect(candidate.manifest).not.toHaveProperty('rhythm');
  expect(candidate.manifest).not.toHaveProperty('lifeVersion');
  expect(candidate.activation).toBe('not-authorized-by-candidate');
  const root = mkdtempSync(join(tmpdir(), 'canonical-candidate-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    runtime = new OpenSocietyRuntime(root, candidate.manifest);
    expect(runtime.state.world).toEqual(input.authority.projection);
    expect(runtime.advanceTime(1, 'advance').ok).toBe(true);
    expect(runtime.state.world.moneySupply).toBe(input.authority.projection.moneySupply);
    const state = structuredClone(runtime.state);
    runtime.close();
    runtime = new OpenSocietyRuntime(root);
    expect(runtime.state).toEqual(state);
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test('mixed resident/capture sets and incomplete world boundary cannot produce a candidate', () => {
  const input = fixture();
  expect(() =>
    createCanonicalSocietyCandidate({
      ...input,
      residents: [input.residents[0]!, input.residents[0]!],
    }),
  ).toThrow('resident-set-mismatch');
  expect(() =>
    createCanonicalSocietyCandidate({
      ...input,
      memories: { ...input.memories, recordsByResident: {} },
    }),
  ).toThrow('resident-set-mismatch');
  expect(() =>
    createCanonicalSocietyCandidate({ ...input, documents: { ...input.documents, capturedAt: 1 } }),
  ).toThrow('cognition-boundary-mismatch');
  const blocked = createCanonicalSocietyCandidate({ ...input, partitions: [] });
  expect(blocked.status).toBe('blocked');
  expect(blocked).not.toHaveProperty('manifest');
});

test('historical receipts stay bound to the source and prevent repeated execution after restart', () => {
  const input = fixture();
  const history = createCanonicalRequestHistory({
    authority: input.authority,
    partitions: [
      {
        partitionKey: 'p',
        appends: [
          {
            idempotencyKey: 'old-request',
            streamName: 'simulation/source/partition/p/events',
            expectedVersion: 0,
            appendedEvents: [],
            streamVersion: 0,
          },
        ],
      },
    ],
  });
  expect(() =>
    createCanonicalRequestHistory({ authority: input.authority, partitions: [] }),
  ).toThrow('partitions-mismatch');
  expect(() =>
    createCanonicalRequestHistory({
      authority: input.authority,
      partitions: [history.partitions[0]!, history.partitions[0]!],
    }),
  ).toThrow('partitions-mismatch');
  expect(() =>
    createCanonicalRequestHistory({
      authority: input.authority,
      partitions: [
        {
          partitionKey: 'p',
          appends: [
            {
              ...history.partitions[0]!.appends[0]!,
              streamName: 'simulation/other/partition/p/events',
            },
          ],
        },
      ],
    }),
  ).toThrow('append-invalid');
  const candidate = createCanonicalSocietyCandidate({ ...input, requestHistory: history });
  if (candidate.status !== 'candidate') throw Error('blocked');
  expect(candidate.manifest.canonicalRequestHistory).toEqual(history);
  expect(() =>
    createCanonicalSocietyCandidate({ ...input, requestHistory: { ...history, revision: 1 } }),
  ).toThrow('request-history-boundary-mismatch');
  const root = mkdtempSync(join(tmpdir(), 'canonical-requests-'));
  let runtime: OpenSocietyRuntime | undefined;
  try {
    runtime = new OpenSocietyRuntime(root, candidate.manifest);
    const state = structuredClone(runtime.state);
    expect(runtime.advanceTime(1, 'old-request')).toMatchObject({
      ok: false,
      error: 'historical-request-id',
    });
    expect(runtime.state).toEqual(state);
    const actor = input.residents[0]!.id;
    expect(
      runtime.invoke(actor, {
        name: 'world.deposit',
        arguments: { amount: 1 },
        requestId: 'old-request',
      }),
    ).toMatchObject({ ok: false, error: 'historical-request-id' });
    expect(runtime.state).toEqual(state);
    expect(runtime.advanceTime(1, 'fresh-request').ok).toBe(true);
    const advanced = structuredClone(runtime.state);
    const replicaRoot = join(root, 'replica');
    const replica = new OpenSocietyJournal(replicaRoot, candidate.manifest, { replica: true });
    try {
      const commit = runtime.journal.commits.at(-1)!;
      expect(() => replica.receive({ ...commit, requestId: 'old-request' })).toThrow(
        'historical-request-id',
      );
      expect(replica.commits).toHaveLength(0);
      replica.receive(commit);
      expect(replica.state).toEqual(advanced);
    } finally {
      replica.close();
    }
    runtime.close();
    runtime = new OpenSocietyRuntime(root);
    expect(runtime.advanceTime(1, 'old-request')).toMatchObject({
      ok: false,
      error: 'historical-request-id',
    });
    expect(runtime.advanceTime(1, 'fresh-request').ok).toBe(true);
    expect(runtime.state).toEqual(advanced);
  } finally {
    runtime?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
