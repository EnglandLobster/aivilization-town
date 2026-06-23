import type {
  AgentId,
  Brand,
  CommandId,
  EventId,
  SimulationTimestamp,
} from '@aivilization/sim-core';

export type MemoryRecordId = Brand<string, 'MemoryRecordId'>;

export type ShortTermMemoryKind = 'action' | 'observation' | 'social-interaction' | 'human-command';

export type ShortTermMemoryStatus = 'succeeded' | 'failed' | 'repaired' | 'observed';

export type MemorySource = {
  readonly commandId?: CommandId;
  readonly eventIds: readonly EventId[];
};

export type MemoryConsolidationHint =
  | {
      readonly kind: 'habit';
      readonly patternKey: string;
      readonly statement: string;
    }
  | {
      readonly kind: 'caution';
      readonly patternKey: string;
      readonly statement: string;
    }
  | {
      readonly kind: 'social';
      readonly targetAgentId: AgentId;
      readonly relationDelta: number;
      readonly attitudeDelta: number;
      readonly summary: string;
    };

export type ShortTermMemoryRecord = {
  readonly id: MemoryRecordId;
  readonly agentId: AgentId;
  readonly kind: ShortTermMemoryKind;
  readonly status: ShortTermMemoryStatus;
  readonly summary: string;
  readonly occurredAt: SimulationTimestamp;
  readonly importanceScore: number;
  readonly source: MemorySource;
  readonly tags: readonly string[];
  readonly consolidationHint?: MemoryConsolidationHint;
};

export function asMemoryRecordId(value: string): MemoryRecordId {
  if (value.trim().length === 0) {
    throw new Error('memory record id must not be empty');
  }
  return value as MemoryRecordId;
}

export function createShortTermMemoryRecord(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly kind: ShortTermMemoryKind;
  readonly status: ShortTermMemoryStatus;
  readonly summary: string;
  readonly occurredAt: SimulationTimestamp;
  readonly importanceScore: number;
  readonly source: MemorySource;
  readonly tags?: readonly string[];
  readonly consolidationHint?: MemoryConsolidationHint;
}): ShortTermMemoryRecord {
  const summary = input.summary.trim();
  if (summary.length === 0) {
    throw new Error('summary must not be empty');
  }
  assertFiniteNumber(input.occurredAt, 'occurredAt');
  if (
    !Number.isFinite(input.importanceScore) ||
    input.importanceScore < 0 ||
    input.importanceScore > 1
  ) {
    throw new Error('importanceScore must be within [0, 1]');
  }

  const tags = [...(input.tags ?? [])].map((tag) => tag.trim());
  if (tags.some((tag) => tag.length === 0)) {
    throw new Error('tags must not contain empty values');
  }

  return {
    id: asMemoryRecordId(input.id),
    agentId: input.agentId,
    kind: input.kind,
    status: input.status,
    summary,
    occurredAt: input.occurredAt,
    importanceScore: input.importanceScore,
    source: {
      ...input.source,
      eventIds: [...input.source.eventIds],
    },
    tags,
    ...(input.consolidationHint === undefined
      ? {}
      : { consolidationHint: input.consolidationHint }),
  };
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
