import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyLongTermMemoryPatch,
  asMemoryRecordId,
  createEmptyLongTermAgentProfile,
  createMemoryProvenance,
  createShortTermMemoryRecord,
  isAssertableProfileEntry,
  listAssertableBeliefs,
  memoryProvenanceRank,
  proposeLongTermMemoryPatches,
  retrieveShortTermMemory,
  type ShortTermMemoryRecord,
  type SocialKnowledgeClaim,
  type SocialKnowledgeClaimStatus,
} from './index';

const agentId = asAgentId('agent-1');
const sourceAgentId = asAgentId('agent-2');

function createClaimRecord(input: {
  readonly id: string;
  readonly occurredAt: number;
  readonly claimStatus: SocialKnowledgeClaimStatus;
  readonly statement?: string;
}): ShortTermMemoryRecord {
  const claim: SocialKnowledgeClaim = {
    sourceAgentId,
    topic: 'wheat harvest',
    statement: input.statement ?? 'The wheat harvest has failed.',
    status: input.claimStatus,
  };
  return createShortTermMemoryRecord({
    id: input.id,
    agentId,
    kind: 'social-interaction',
    status: 'succeeded',
    summary: 'Agent-2 discussed the harvest.',
    occurredAt: input.occurredAt,
    importanceScore: 0.6,
    source: { eventIds: [] },
    provenance: createMemoryProvenance({ kind: 'firsthand' }),
    consolidationHint: {
      kind: 'social',
      targetAgentId: sourceAgentId,
      relationDelta: 0,
      attitudeDelta: 0,
      summary: 'Agent-2 discussed the harvest.',
      knowledgeClaims: [claim],
    },
  });
}

describe('memory provenance model', () => {
  test('defaults to influencing and requires evidence for contradicted statuses', () => {
    expect(createMemoryProvenance({ kind: 'firsthand' })).toEqual({
      kind: 'firsthand',
      status: 'influencing',
    });
    expect(() => createMemoryProvenance({ kind: 'hearsay', status: 'corrected' })).toThrow(
      /correctedByRecordId/,
    );
    expect(() =>
      createMemoryProvenance({ kind: 'hearsay', status: 'doubtful' }),
    ).toThrow(/doubtful requires correctedByRecordId/);
  });

  test('keeps provenance optional on short-term records for append compatibility', () => {
    const legacy = createShortTermMemoryRecord({
      id: 'legacy-1',
      agentId,
      kind: 'action',
      status: 'succeeded',
      summary: 'Worked a shift.',
      occurredAt: 1,
      importanceScore: 0.5,
      source: { eventIds: [] },
    });
    expect(legacy.provenance).toBeUndefined();
    // Durable JSON round-trip: tagged and untagged records both survive.
    const tagged = createShortTermMemoryRecord({
      id: 'tagged-1',
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: 'Saw the market crash.',
      occurredAt: 2,
      importanceScore: 0.5,
      source: { eventIds: [] },
      provenance: createMemoryProvenance({ kind: 'firsthand' }),
    });
    expect(JSON.parse(JSON.stringify(tagged))).toEqual(tagged);
    expect(JSON.parse(JSON.stringify(legacy))).toEqual(legacy);
  });
});

describe('hearsay correction state machine', () => {
  const consolidate = (records: readonly ShortTermMemoryRecord[]) =>
    proposeLongTermMemoryPatches({ agentId, records, minPatternCount: 1, proposedAt: 100 }).find(
      (patch) => patch.key.startsWith('social-knowledge:'),
    );

  test('tags conversation claims as influencing hearsay beliefs', () => {
    const patch = consolidate([createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' })]);
    expect(patch?.provenance).toEqual({ kind: 'hearsay', status: 'influencing' });
  });

  test('marks a belief corrected when a later corrected claim supersedes the assertion', () => {
    const patch = consolidate([
      createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' }),
      createClaimRecord({
        id: 'c-2',
        occurredAt: 2,
        claimStatus: 'corrected',
        statement: 'Actually the wheat harvest was fine.',
      }),
    ]);
    expect(patch?.provenance).toEqual({
      kind: 'hearsay',
      status: 'corrected',
      correctedByRecordId: 'c-2',
    });
    expect(patch?.statement).toContain('offered a correction');
    expect(patch?.statement).toContain('Actually the wheat harvest was fine.');
  });

  test('marks a belief doubtful when a later dispute contradicts the assertion', () => {
    const patch = consolidate([
      createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' }),
      createClaimRecord({ id: 'c-2', occurredAt: 2, claimStatus: 'disputed' }),
    ]);
    expect(patch?.provenance).toEqual({
      kind: 'hearsay',
      status: 'doubtful',
      correctedByRecordId: 'c-2',
    });
    expect(patch?.statement).toContain('disputed');
  });

  test('re-assertion after a correction returns the belief to influencing', () => {
    const patch = consolidate([
      createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' }),
      createClaimRecord({ id: 'c-2', occurredAt: 2, claimStatus: 'corrected' }),
      createClaimRecord({ id: 'c-3', occurredAt: 3, claimStatus: 'asserted' }),
    ]);
    expect(patch?.provenance).toEqual({ kind: 'hearsay', status: 'influencing' });
  });

  test('a corrected patch removes the belief from assertions while staying durable', () => {
    const profile = createEmptyLongTermAgentProfile(agentId);
    const asserted = consolidate([
      createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' }),
    ]);
    const corrected = consolidate([
      createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' }),
      createClaimRecord({ id: 'c-2', occurredAt: 2, claimStatus: 'corrected' }),
    ]);
    if (asserted === undefined || corrected === undefined) {
      throw new Error('expected social knowledge patches');
    }
    const withAssertion = applyLongTermMemoryPatch(profile, asserted);
    expect(listAssertableBeliefs(withAssertion)).toHaveLength(1);

    const withCorrection = applyLongTermMemoryPatch(withAssertion, corrected);
    const entry = withCorrection.beliefs.find((belief) => belief.key === corrected.key);
    // The corrected entry stays stored (history) but no longer asserts.
    expect(entry?.provenance?.status).toBe('corrected');
    expect(entry?.provenanceRecordIds).toEqual(['c-1', 'c-2']);
    expect(listAssertableBeliefs(withCorrection)).toHaveLength(0);
    expect(isAssertableProfileEntry(entry!)).toBe(false);
  });

  test('a provenance-free legacy patch preserves the entry provenance on upsert', () => {
    const profile = createEmptyLongTermAgentProfile(agentId);
    const asserted = consolidate([
      createClaimRecord({ id: 'c-1', occurredAt: 1, claimStatus: 'asserted' }),
    ]);
    if (asserted === undefined) {
      throw new Error('expected a social knowledge patch');
    }
    const tagged = applyLongTermMemoryPatch(profile, asserted);
    const legacyPatch = Object.fromEntries(
      Object.entries(asserted).filter(([key]) => key !== 'provenance'),
    ) as typeof asserted;
    const merged = applyLongTermMemoryPatch(tagged, legacyPatch);
    expect(merged.beliefs[0]?.provenance).toEqual({ kind: 'hearsay', status: 'influencing' });
  });
});

describe('provenance-aware retrieval', () => {
  const record = (
    id: string,
    importanceScore: number,
    provenance?: ReturnType<typeof createMemoryProvenance>,
  ) =>
    createShortTermMemoryRecord({
      id,
      agentId,
      kind: 'observation',
      status: 'observed',
      summary: `Memory ${id}.`,
      occurredAt: 1,
      importanceScore,
      source: { eventIds: [] },
      ...(provenance === undefined ? {} : { provenance }),
    });

  const records = [
    record('hearsay-high', 0.9, createMemoryProvenance({ kind: 'hearsay' })),
    record('firsthand-low', 0.2, createMemoryProvenance({ kind: 'firsthand' })),
    record('legacy-mid', 0.5),
    record('implanted-mid', 0.5, createMemoryProvenance({ kind: 'implanted' })),
    record(
      'corrected-hearsay',
      0.95,
      createMemoryProvenance({
        kind: 'hearsay',
        status: 'corrected',
        correctedByRecordId: asMemoryRecordId('x'),
      }),
    ),
  ];

  test('ranks firsthand above implanted above hearsay, sinking corrected memories', () => {
    expect(
      retrieveShortTermMemory(records, { agentId, orderBy: 'provenance-importance', limit: 10 }).map(
        (entry) => entry.id,
      ),
    ).toEqual([
      'legacy-mid',
      'firsthand-low',
      'implanted-mid',
      'hearsay-high',
      'corrected-hearsay',
    ]);
    expect(memoryProvenanceRank(undefined)).toBe(0);
  });

  test('keeps legacy importance ordering for untagged records', () => {
    const untagged = [record('a', 0.3), record('b', 0.9), record('c', 0.5)];
    const byImportance = retrieveShortTermMemory(untagged, { agentId, limit: 10 }).map(
      (entry) => entry.id,
    );
    const byProvenance = retrieveShortTermMemory(untagged, {
      agentId,
      orderBy: 'provenance-importance',
      limit: 10,
    }).map((entry) => entry.id);
    expect(byImportance).toEqual(['b', 'c', 'a']);
    expect(byProvenance).toEqual(byImportance);
  });

  test('excludes corrected/past records on request without dropping untagged records', () => {
    expect(
      retrieveShortTermMemory(records, {
        agentId,
        orderBy: 'provenance-importance',
        excludeProvenanceStatuses: ['corrected', 'past'],
        limit: 10,
      }).map((entry) => entry.id),
    ).toEqual(['legacy-mid', 'firsthand-low', 'implanted-mid', 'hearsay-high']);
  });
});
