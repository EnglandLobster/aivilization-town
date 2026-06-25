import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { MemoryConsolidationHint, ShortTermMemoryRecord } from './records';
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
  return buildSocialPatches({
    agentId: input.agentId,
    records: filterAgentRecords(input),
    proposedAt: input.proposedAt,
  }).sort(comparePatches);
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
    };
  });
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
