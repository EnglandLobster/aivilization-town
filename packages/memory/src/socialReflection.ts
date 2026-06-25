import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { MemoryRecordId, ShortTermMemoryRecord } from './records';

export type SocialInteractionReflectionRecord = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly statement: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly MemoryRecordId[];
  readonly generatedAt: SimulationTimestamp;
  readonly tags: readonly string[];
};

export function proposeSocialInteractionReflections(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly generatedAt: SimulationTimestamp;
}): SocialInteractionReflectionRecord[] {
  assertFiniteNumber(input.generatedAt, 'generatedAt');

  return [...input.records]
    .filter((record) => record.agentId === input.agentId)
    .filter(isSuccessfulSocialInteractionMemory)
    .sort(compareRecordsByOccurrence)
    .map((record) => {
      const hint = socialHintFor(record);
      return {
        id: `social-reflection-${input.agentId}-${hint.targetAgentId}-${record.id}-${input.generatedAt}`,
        agentId: input.agentId,
        targetAgentId: hint.targetAgentId,
        statement: `Interaction with ${hint.targetAgentId} changed relation by ${hint.relationDelta} and attitude by ${hint.attitudeDelta}: ${hint.summary}`,
        relationDelta: hint.relationDelta,
        attitudeDelta: hint.attitudeDelta,
        confidence: record.importanceScore,
        evidenceRecordIds: [record.id],
        generatedAt: input.generatedAt,
        tags: stableUnique([
          'social',
          'post-interaction-reflection',
          hint.targetAgentId,
          ...record.tags,
        ]),
      };
    });
}

function isSuccessfulSocialInteractionMemory(record: ShortTermMemoryRecord): boolean {
  return (
    record.kind === 'social-interaction' &&
    record.status === 'succeeded' &&
    record.consolidationHint?.kind === 'social'
  );
}

function socialHintFor(record: ShortTermMemoryRecord) {
  const hint = record.consolidationHint;
  if (hint === undefined || hint.kind !== 'social') {
    throw new Error('social reflection records must contain a social consolidation hint');
  }
  return hint;
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

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
