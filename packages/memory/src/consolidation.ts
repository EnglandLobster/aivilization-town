import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import {
  createMemoryProvenance,
  type MemoryConsolidationHint,
  type MemoryProvenance,
  type ShortTermMemoryRecord,
  type SocialKnowledgeClaim,
} from './records';
import type { LongTermMemoryPatch } from './profile';

type PatternHint = Extract<MemoryConsolidationHint, { kind: 'habit' | 'caution' }>;
type SocialHint = Extract<MemoryConsolidationHint, { kind: 'social' }>;

export function proposeLongTermMemoryPatches(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
}): LongTermMemoryPatch[] {
  assertPositiveInteger(input.minPatternCount, 'minPatternCount');
  assertFiniteNumber(input.proposedAt, 'proposedAt');

  return [
    ...proposeNonSocialLongTermMemoryPatches(input),
    ...proposeSocialLongTermMemoryPatches({
      agentId: input.agentId,
      records: input.records,
      proposedAt: input.proposedAt,
    }),
  ].sort(comparePatches);
}

export function proposeNonSocialLongTermMemoryPatches(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
}): LongTermMemoryPatch[] {
  assertPositiveInteger(input.minPatternCount, 'minPatternCount');
  assertFiniteNumber(input.proposedAt, 'proposedAt');
  const records = filterAgentRecords(input);

  return [
    ...buildPatternPatches({
      agentId: input.agentId,
      records,
      minPatternCount: input.minPatternCount,
      proposedAt: input.proposedAt,
      hintKind: 'habit',
    }),
    ...buildPatternPatches({
      agentId: input.agentId,
      records,
      minPatternCount: input.minPatternCount,
      proposedAt: input.proposedAt,
      hintKind: 'caution',
    }),
  ].sort(comparePatches);
}

export function proposeSocialLongTermMemoryPatches(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly proposedAt: SimulationTimestamp;
}): LongTermMemoryPatch[] {
  assertFiniteNumber(input.proposedAt, 'proposedAt');
  const records = filterAgentRecords(input);
  return [
    ...buildSocialPatches({
      agentId: input.agentId,
      records,
      proposedAt: input.proposedAt,
    }),
    ...buildSocialKnowledgePatches({
      agentId: input.agentId,
      records,
      proposedAt: input.proposedAt,
    }),
  ].sort(comparePatches);
}

function filterAgentRecords(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
}): ShortTermMemoryRecord[] {
  return [...input.records]
    .filter((record) => record.agentId === input.agentId)
    .sort(compareRecordsByOccurrence);
}

function buildPatternPatches(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
  readonly hintKind: PatternHint['kind'];
}): LongTermMemoryPatch[] {
  const groups = new Map<string, ShortTermMemoryRecord[]>();

  for (const record of input.records) {
    const hint = record.consolidationHint;
    if (
      hint === undefined ||
      hint.kind !== input.hintKind ||
      !matchesPatternStatus(record, input.hintKind)
    ) {
      continue;
    }
    const group = groups.get(hint.patternKey) ?? [];
    group.push(record);
    groups.set(hint.patternKey, group);
  }

  return [...groups.entries()]
    .filter(([, records]) => records.length >= input.minPatternCount)
    .map(([patternKey, records]) => {
      const hint = firstPatternHint(records);
      const provenanceRecordIds = records.map((record) => record.id);
      const isHabit = input.hintKind === 'habit';

      return {
        id: `ltm-patch-${input.agentId}-${isHabit ? 'habit' : 'belief'}-${patternKey}-${input.proposedAt}`,
        agentId: input.agentId,
        section: isHabit ? 'habits' : 'beliefs',
        key: isHabit ? patternKey : `caution:${patternKey}`,
        statement: hint.statement,
        confidence: averageImportance(records),
        provenanceRecordIds,
        proposedAt: input.proposedAt,
        // Habits/cautions consolidate the agent's own action outcomes: firsthand.
        provenance: createMemoryProvenance({ kind: 'firsthand' }),
      };
    });
}

function buildSocialPatches(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly proposedAt: SimulationTimestamp;
}): LongTermMemoryPatch[] {
  const groups = new Map<AgentId, ShortTermMemoryRecord[]>();

  for (const record of input.records) {
    const hint = record.consolidationHint;
    if (hint === undefined || hint.kind !== 'social') {
      continue;
    }
    const group = groups.get(hint.targetAgentId) ?? [];
    group.push(record);
    groups.set(hint.targetAgentId, group);
  }

  return [...groups.entries()].map(([targetAgentId, records]) => {
    const latestHint = socialHintFor(records.at(-1));
    const relationDelta = sumSocialDelta(records, 'relationDelta');
    const attitudeDelta = sumSocialDelta(records, 'attitudeDelta');
    const outcomeSignals = [
      ...new Set(records.flatMap((record) => socialHintFor(record).outcomeSignals ?? [])),
    ];

    return {
      id: `ltm-patch-${input.agentId}-social-${targetAgentId}-${input.proposedAt}`,
      agentId: input.agentId,
      section: 'socialRecords',
      key: targetAgentId,
      statement: latestHint.summary,
      confidence: averageImportance(records),
      provenanceRecordIds: records.map((record) => record.id),
      proposedAt: input.proposedAt,
      relationDelta,
      attitudeDelta,
      ...(outcomeSignals.length === 0 ? {} : { outcomeSignals }),
      // Direct interactions the agent participated in are firsthand.
      provenance: createMemoryProvenance({ kind: 'firsthand' }),
    };
  });
}

function buildSocialKnowledgePatches(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly proposedAt: SimulationTimestamp;
}): LongTermMemoryPatch[] {
  const groups = new Map<
    string,
    {
      readonly claims: readonly {
        readonly claim: SocialKnowledgeClaim;
        readonly recordId: ShortTermMemoryRecord['id'];
      }[];
      readonly records: readonly ShortTermMemoryRecord[];
    }
  >();
  for (const record of input.records) {
    const hint = record.consolidationHint;
    if (hint?.kind !== 'social') {
      continue;
    }
    for (const claim of hint.knowledgeClaims ?? []) {
      const key = `${claim.sourceAgentId}:${normalizeKnowledgeKey(claim.topic)}`;
      const group = groups.get(key) ?? { claims: [], records: [] };
      groups.set(key, {
        claims: [...group.claims, { claim, recordId: record.id }],
        records: [...group.records, record],
      });
    }
  }

  return [...groups.entries()].map(([key, group]) => {
    const resolution = resolveSocialKnowledgeResolution(group.claims);
    return {
      id: `ltm-patch-${input.agentId}-belief-social-knowledge-${key}-${input.proposedAt}`,
      agentId: input.agentId,
      section: 'beliefs' as const,
      key: `social-knowledge:${key}`,
      statement: formatSocialKnowledgeStatement(resolution.statementClaim),
      confidence: averageImportance([...group.records]),
      provenanceRecordIds: [...new Set(group.records.map((record) => record.id))],
      proposedAt: input.proposedAt,
      // Conversation claims are hearsay; the correction state machine below
      // marks them doubtful/corrected when later claims contradict earlier
      // assertions (deterministic rule over the claim classification).
      provenance: resolution.provenance,
    };
  });
}

/**
 * Deterministic correction rule over the existing claim classification: the
 * latest claim for a subject decides. A later `corrected` claim supersedes the
 * belief (status corrected); a later `disputed`/`suspected-misinformation`
 * claim marks it doubtful; a latest `asserted` claim (re-)asserts it as
 * influencing hearsay. The statement follows the decisive claim when the
 * belief is contradicted, otherwise the first assertion (legacy behavior).
 */
function resolveSocialKnowledgeResolution(
  claims: readonly {
    readonly claim: SocialKnowledgeClaim;
    readonly recordId: ShortTermMemoryRecord['id'];
  }[],
): {
  readonly statementClaim: SocialKnowledgeClaim;
  readonly provenance: MemoryProvenance;
} {
  const first = claims[0];
  const latest = claims.at(-1);
  if (first === undefined || latest === undefined) {
    throw new Error('social knowledge resolution requires at least one claim');
  }
  switch (latest.claim.status) {
    case 'corrected':
      return {
        statementClaim: latest.claim,
        provenance: createMemoryProvenance({
          kind: 'hearsay',
          status: 'corrected',
          correctedByRecordId: latest.recordId,
        }),
      };
    case 'disputed':
    case 'suspected-misinformation':
      return {
        statementClaim: latest.claim,
        provenance: createMemoryProvenance({
          kind: 'hearsay',
          status: 'doubtful',
          correctedByRecordId: latest.recordId,
        }),
      };
    case 'asserted':
      return {
        statementClaim: first.claim,
        provenance: createMemoryProvenance({ kind: 'hearsay' }),
      };
  }
}

function formatSocialKnowledgeStatement(claim: SocialKnowledgeClaim): string {
  const quotedStatement = JSON.stringify(claim.statement.trim());
  switch (claim.status) {
    case 'asserted':
      return `${claim.sourceAgentId} asserted about ${claim.topic}: ${quotedStatement} (unverified).`;
    case 'disputed':
      return `${claim.sourceAgentId} disputed a claim about ${claim.topic}: ${quotedStatement}.`;
    case 'corrected':
      return `${claim.sourceAgentId} offered a correction about ${claim.topic}: ${quotedStatement} (requires verification).`;
    case 'suspected-misinformation':
      return `${claim.sourceAgentId} supplied suspected misinformation about ${claim.topic}: ${quotedStatement}.`;
  }
}

function normalizeKnowledgeKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return normalized.length === 0 ? 'untitled-topic' : normalized;
}

function matchesPatternStatus(
  record: ShortTermMemoryRecord,
  hintKind: PatternHint['kind'],
): boolean {
  return hintKind === 'habit' ? record.status === 'succeeded' : record.status === 'failed';
}

function firstPatternHint(records: readonly ShortTermMemoryRecord[]): PatternHint {
  const record = records[0];
  const hint = record?.consolidationHint;
  if (hint === undefined || (hint.kind !== 'habit' && hint.kind !== 'caution')) {
    throw new Error('pattern records must contain a habit or caution consolidation hint');
  }
  return hint;
}

function socialHintFor(record: ShortTermMemoryRecord | undefined): SocialHint {
  const hint = record?.consolidationHint;
  if (hint === undefined || hint.kind !== 'social') {
    throw new Error('social records must contain a social consolidation hint');
  }
  return hint;
}

function sumSocialDelta(
  records: readonly ShortTermMemoryRecord[],
  field: 'relationDelta' | 'attitudeDelta',
): number {
  return records.reduce((sum, record) => sum + socialHintFor(record)[field], 0);
}

function averageImportance(records: readonly ShortTermMemoryRecord[]): number {
  const sum = records.reduce((total, record) => total + record.importanceScore, 0);
  return Number((sum / records.length).toFixed(6));
}

function compareRecordsByOccurrence(
  left: ShortTermMemoryRecord,
  right: ShortTermMemoryRecord,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.id.localeCompare(right.id);
}

function comparePatches(left: LongTermMemoryPatch, right: LongTermMemoryPatch): number {
  if (left.section !== right.section) {
    return left.section.localeCompare(right.section);
  }
  return left.key.localeCompare(right.key);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
