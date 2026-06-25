import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { LongTermAgentProfile, LongTermMemoryPatch } from './profile';
import type { MemoryRecordId, ShortTermMemoryRecord } from './records';
import type { MemorySynthesisWorldDecisionContext } from './worldContext';

export type ReflectiveInsightKind = 'habit' | 'caution' | 'mood' | 'value' | 'personality';

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

export type ReflectiveInsightProposal = {
  readonly kind: string;
  readonly topicKey: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly MemoryRecordId[];
  readonly tags: readonly string[];
};

export type ReflectiveInsightSynthesizerInput = {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minEvidenceCount: number;
  readonly generatedAt: SimulationTimestamp;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: MemorySynthesisWorldDecisionContext;
};

export type ReflectiveInsightSynthesisUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type ReflectiveInsightSynthesisAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: ReflectiveInsightSynthesisUsage;
};

export type ReflectiveInsightSynthesisTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly choices?: readonly {
    readonly kind: string;
    readonly topicKey: string;
    readonly confidence: number;
    readonly evidenceRecordIds: readonly MemoryRecordId[];
    readonly rationale?: string;
  }[];
  readonly attempts?: readonly ReflectiveInsightSynthesisAttemptTrace[];
  readonly usage?: ReflectiveInsightSynthesisUsage;
};

export type ReflectiveInsightSynthesisResult = {
  readonly insights: readonly ReflectiveInsightRecord[];
  readonly trace: ReflectiveInsightSynthesisTrace;
};

export type ReflectiveInsightSynthesizer = (
  input: ReflectiveInsightSynthesizerInput,
) => ReflectiveInsightSynthesisResult | Promise<ReflectiveInsightSynthesisResult>;

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
    .sort(compareRecordsByOccurrence);
  const unhintedRecords = records.filter((record) => record.consolidationHint === undefined);

  return [
    ...createStudyRoutineInsight({
      agentId: input.agentId,
      records: unhintedRecords,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
    ...createWorkEnergyCautionInsight({
      agentId: input.agentId,
      records: unhintedRecords,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
    ...createSocialRoutineInsights({
      agentId: input.agentId,
      records,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
    ...createSocialProfileInsights({
      agentId: input.agentId,
      records,
      minEvidenceCount: input.minEvidenceCount,
      generatedAt: input.generatedAt,
    }),
  ].sort(compareInsights);
}

export function createDeterministicReflectiveInsightSynthesizer(): ReflectiveInsightSynthesizer {
  return (input) => ({
    insights: proposeReflectiveInsights(input),
    trace: {
      status: 'deterministic',
      source: 'deterministic',
    },
  });
}

export function applyReflectiveInsightProposal(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly generatedAt: SimulationTimestamp;
  readonly insights: readonly ReflectiveInsightProposal[];
}): ReflectiveInsightRecord[] {
  assertFiniteNumber(input.generatedAt, 'generatedAt');
  const validEvidenceRecordIds = new Set(
    input.records
      .filter((record) => record.agentId === input.agentId)
      .map((record) => record.id as string),
  );
  const insightsByKey = new Map<string, ReflectiveInsightRecord>();

  for (const proposal of input.insights) {
    const kind = assertReflectiveInsightKind(proposal.kind);
    const topicKey = normalizeNonEmpty(proposal.topicKey, 'reflective insight topicKey');
    const statement = normalizeNonEmpty(proposal.statement, 'reflective insight statement');
    assertConfidence(proposal.confidence, 'reflective insight confidence');
    if (proposal.evidenceRecordIds.length === 0) {
      throw new Error('reflective insight evidenceRecordIds must not be empty');
    }
    const evidenceRecordIds = proposal.evidenceRecordIds.map((recordId) => {
      if (!validEvidenceRecordIds.has(recordId)) {
        throw new Error(`reflective insight evidence ${recordId} is not in synthesis records`);
      }
      return recordId;
    });
    const tags = stableUnique(
      proposal.tags.map((tag) => normalizeNonEmpty(tag, 'reflective insight tag')),
    );

    const insight: ReflectiveInsightRecord = {
      id: createReflectiveInsightId({
        agentId: input.agentId,
        kind,
        topicKey,
        generatedAt: input.generatedAt,
      }),
      agentId: input.agentId,
      kind,
      topicKey,
      statement,
      confidence: proposal.confidence,
      evidenceRecordIds,
      generatedAt: input.generatedAt,
      tags,
    };
    const dedupeKey = `${kind}:${topicKey}`;
    const existing = insightsByKey.get(dedupeKey);
    if (existing === undefined || insight.confidence > existing.confidence) {
      insightsByKey.set(dedupeKey, insight);
    }
  }

  return [...insightsByKey.values()].sort(compareInsights);
}

export function convertReflectiveInsightsToLongTermMemoryPatches(input: {
  readonly insights: readonly ReflectiveInsightRecord[];
}): LongTermMemoryPatch[] {
  return input.insights
    .map((insight) => {
      const target = resolveLongTermPatchTarget(insight);
      return {
        id: `ltm-patch-${insight.agentId}-reflection-${target.idSegment}-${insight.topicKey}-${insight.generatedAt}`,
        agentId: insight.agentId,
        section: target.section,
        key: target.key,
        statement: insight.statement,
        confidence: insight.confidence,
        provenanceRecordIds: [...insight.evidenceRecordIds],
        proposedAt: insight.generatedAt,
      };
    })
    .sort(comparePatches);
}

function resolveLongTermPatchTarget(insight: ReflectiveInsightRecord): Pick<
  LongTermMemoryPatch,
  'section' | 'key'
> & {
  readonly idSegment: string;
} {
  switch (insight.kind) {
    case 'habit':
      return { section: 'habits', key: insight.topicKey, idSegment: 'habit' };
    case 'caution':
      return { section: 'beliefs', key: `caution:${insight.topicKey}`, idSegment: 'belief' };
    case 'mood':
      return { section: 'mood', key: insight.topicKey, idSegment: 'mood' };
    case 'value':
      return { section: 'values', key: insight.topicKey, idSegment: 'value' };
    case 'personality':
      return { section: 'personality', key: insight.topicKey, idSegment: 'personality' };
  }
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

function createSocialProfileInsights(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly minEvidenceCount: number;
  readonly generatedAt: SimulationTimestamp;
}): readonly ReflectiveInsightRecord[] {
  const evidence = input.records.filter(
    (record) => record.status === 'succeeded' && matchesSocialContext(record),
  );
  if (evidence.length < input.minEvidenceCount) {
    return [];
  }

  const targetKeys = new Set(
    evidence
      .map((record) => extractSocialTargetKey(record))
      .filter((targetKey): targetKey is string => targetKey !== undefined),
  );
  if (targetKeys.size < 2) {
    return [];
  }

  return [
    createInsight({
      agentId: input.agentId,
      kind: 'mood',
      topicKey: 'cooperative-composure',
      statement: 'Repeated positive social interactions suggest a cooperative and composed mood.',
      records: evidence,
      generatedAt: input.generatedAt,
      tags: ['social', 'mood', 'cooperative-composure'],
    }),
    createInsight({
      agentId: input.agentId,
      kind: 'personality',
      topicKey: 'sociable',
      statement:
        'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
      records: evidence,
      generatedAt: input.generatedAt,
      tags: ['social', 'personality', 'sociable'],
    }),
    createInsight({
      agentId: input.agentId,
      kind: 'value',
      topicKey: 'community-cooperation',
      statement:
        'Repeated positive social interactions suggest the agent values cooperative community routines.',
      records: evidence,
      generatedAt: input.generatedAt,
      tags: ['social', 'community', 'cooperation', 'value'],
    }),
  ];
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
    id: createReflectiveInsightId(input),
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

function createReflectiveInsightId(input: {
  readonly agentId: AgentId;
  readonly kind: ReflectiveInsightKind;
  readonly topicKey: string;
  readonly generatedAt: SimulationTimestamp;
}): string {
  return `reflection-${input.agentId}-${input.kind}-${input.topicKey}-${input.generatedAt}`;
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
  if (record.consolidationHint?.kind === 'social') {
    return record.consolidationHint.targetAgentId;
  }

  const context = recordContext(record);
  if (!containsAny(context, ['social', 'shared', 'together'])) {
    return undefined;
  }

  return context.match(/agent-[a-z0-9-]+/)?.[0];
}

function matchesSocialContext(record: ShortTermMemoryRecord): boolean {
  if (record.kind === 'social-interaction') {
    return true;
  }

  return containsAny(recordContext(record), ['social', 'conversation', 'shared', 'together']);
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

function assertReflectiveInsightKind(kind: string): ReflectiveInsightKind {
  switch (kind) {
    case 'habit':
    case 'caution':
    case 'mood':
    case 'value':
    case 'personality':
      return kind;
    default:
      throw new Error(`reflective insight kind ${kind} is not supported`);
  }
}

function normalizeNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
  return normalized;
}

function stableUnique<TValue>(values: readonly TValue[]): readonly TValue[] {
  return [...new Set(values)];
}

function assertConfidence(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be within [0, 1]`);
  }
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
