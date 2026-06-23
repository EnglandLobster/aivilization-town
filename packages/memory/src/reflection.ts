import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { LongTermMemoryPatch } from './profile';
import type { MemoryRecordId, ShortTermMemoryRecord } from './records';

export type ReflectiveInsightKind = 'habit' | 'caution';

export type ReflectiveInsightRecord = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly kind: ReflectiveInsightKind;
  readonly topicKey: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly MemoryRecordId[];
  readonly generatedAt: SimulationTimestamp;
  readonly tags: readonly string[];
};

export function proposeReflectiveInsights(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minEvidenceCount: number;
  readonly generatedAt: SimulationTimestamp;
}): ReflectiveInsightRecord[] {
  assertPositiveInteger(input.minEvidenceCount, 'minEvidenceCount');
  assertFiniteNumber(input.generatedAt, 'generatedAt');

  const records = [...input.records]
    .filter((record) => record.agentId === input.agentId)
    .filter((record) => record.consolidationHint === undefined)
    .sort(compareRecordsByOccurrence);

  return [
    ...createStudyRoutineInsight({
      agentId: input.agentId,
      records,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
    ...createWorkEnergyCautionInsight({
      agentId: input.agentId,
      records,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
    ...createSocialRoutineInsights({
      agentId: input.agentId,
      records,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
  ].sort(compareInsights);
}

export function convertReflectiveInsightsToLongTermMemoryPatches(input: {
  readonly insights: readonly ReflectiveInsightRecord[];
}): LongTermMemoryPatch[] {
  return input.insights
    .map((insight) => {
      const isHabit = insight.kind === 'habit';
      return {
        id: `ltm-patch-${insight.agentId}-reflection-${isHabit ? 'habit' : 'belief'}-${insight.topicKey}-${insight.generatedAt}`,
        agentId: insight.agentId,
        section: isHabit ? ('habits' as const) : ('beliefs' as const),
        key: isHabit ? insight.topicKey : `caution:${insight.topicKey}`,
        statement: insight.statement,
        confidence: insight.confidence,
        provenanceRecordIds: [...insight.evidenceRecordIds],
        proposedAt: insight.generatedAt,
      };
    })
    .sort(comparePatches);
}

function createStudyRoutineInsight(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minEvidenceCount: number;
  readonly generatedAt: SimulationTimestamp;
}): readonly ReflectiveInsightRecord[] {
  const evidence = input.records.filter(
    (record) => record.status === 'succeeded' && matchesStudyContext(record),
  );
  if (evidence.length < input.minEvidenceCount) {
    return [];
  }

  return [
    createInsight({
      agentId: input.agentId,
      kind: 'habit',
      topicKey: 'study-routine',
      statement: 'Repeated successful study sessions suggest a reliable study routine.',
      records: evidence,
      generatedAt: input.generatedAt,
      tags: ['study', 'education', 'routine'],
    }),
  ];
}

function createWorkEnergyCautionInsight(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minEvidenceCount: number;
  readonly generatedAt: SimulationTimestamp;
}): readonly ReflectiveInsightRecord[] {
  const evidence = input.records.filter(
    (record) => record.status === 'failed' && matchesWorkEnergyContext(record),
  );
  if (evidence.length < input.minEvidenceCount) {
    return [];
  }

  return [
    createInsight({
      agentId: input.agentId,
      kind: 'caution',
      topicKey: 'work-energy-risk',
      statement: 'Repeated failed work attempts suggest avoiding work when energy is low.',
      records: evidence,
      generatedAt: input.generatedAt,
      tags: ['work', 'energy', 'risk'],
    }),
  ];
}

function createSocialRoutineInsights(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minEvidenceCount: number;
  readonly generatedAt: SimulationTimestamp;
}): readonly ReflectiveInsightRecord[] {
  const groups = new Map<string, ShortTermMemoryRecord[]>();
  for (const record of input.records) {
    if (record.status !== 'succeeded') {
      continue;
    }
    const targetKey = extractSocialTargetKey(record);
    if (targetKey === undefined) {
      continue;
    }
    const group = groups.get(targetKey) ?? [];
    group.push(record);
    groups.set(targetKey, group);
  }

  return [...groups.entries()]
    .filter(([, records]) => records.length >= input.minEvidenceCount)
    .map(([targetKey, records]) =>
      createInsight({
        agentId: input.agentId,
        kind: 'habit',
        topicKey: `social-${targetKey}`,
        statement: `Repeated successful social interactions with ${targetKey} suggest a stable social routine.`,
        records,
        generatedAt: input.generatedAt,
        tags: ['social', targetKey, 'routine'],
      }),
    );
}

function createInsight(input: {
  readonly agentId: AgentId;
  readonly kind: ReflectiveInsightKind;
  readonly topicKey: string;
  readonly statement: string;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly generatedAt: SimulationTimestamp;
  readonly tags: readonly string[];
}): ReflectiveInsightRecord {
  return {
    id: `reflection-${input.agentId}-${input.kind}-${input.topicKey}-${input.generatedAt}`,
    agentId: input.agentId,
    kind: input.kind,
    topicKey: input.topicKey,
    statement: input.statement,
    confidence: averageImportance(input.records),
    evidenceRecordIds: input.records.map((record) => record.id),
    generatedAt: input.generatedAt,
    tags: [...input.tags],
  };
}

function matchesStudyContext(record: ShortTermMemoryRecord): boolean {
  return containsAny(recordContext(record), ['study', 'studied', 'school', 'education', 'learn']);
}

function matchesWorkEnergyContext(record: ShortTermMemoryRecord): boolean {
  const context = recordContext(record);
  return (
    containsAny(context, ['work', 'job', 'labor']) &&
    containsAny(context, ['energy', 'tired', 'fatigue', 'depleted'])
  );
}

function extractSocialTargetKey(record: ShortTermMemoryRecord): string | undefined {
  const context = recordContext(record);
  if (!containsAny(context, ['social', 'shared', 'together'])) {
    return undefined;
  }

  return context.match(/agent-[a-z0-9-]+/)?.[0];
}

function recordContext(record: ShortTermMemoryRecord): string {
  return `${record.summary} ${record.tags.join(' ')}`.toLowerCase();
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

function compareInsights(left: ReflectiveInsightRecord, right: ReflectiveInsightRecord): number {
  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }
  return left.topicKey.localeCompare(right.topicKey);
}

function comparePatches(left: LongTermMemoryPatch, right: LongTermMemoryPatch): number {
  if (left.section !== right.section) {
    return left.section.localeCompare(right.section);
  }
  return left.key.localeCompare(right.key);
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
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
