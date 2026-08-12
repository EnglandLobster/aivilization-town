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

export type SocialKnowledgeClaimStatus =
  | 'asserted'
  | 'disputed'
  | 'corrected'
  | 'suspected-misinformation';

export type SocialKnowledgeClaim = {
  readonly sourceAgentId: AgentId;
  readonly topic: string;
  readonly statement: string;
  readonly status: SocialKnowledgeClaimStatus;
};

export type MemorySource = {
  readonly commandId?: CommandId;
  readonly eventIds: readonly EventId[];
};

/**
 * Where a memory came from (memory provenance slice).
 * plan #3): `firsthand` memories record events the agent lived through or
 * directly observed (including ambient bystander observations); `hearsay`
 * memories carry knowledge claims heard in conversation; `implanted` memories
 * are injected by human steering.
 */
export type MemoryProvenanceKind = 'firsthand' | 'hearsay' | 'implanted';

/**
 * Correction state machine for a memory's influence: `influencing` (default,
 * asserts normally) -> `doubtful` (contradicted by a dispute) -> `corrected`
 * (superseded by a correction, kept for history and excluded from belief
 * assertions). `past` is reserved for natural aging/expiry paths.
 */
export type MemoryProvenanceStatus = 'influencing' | 'doubtful' | 'corrected' | 'past';

export type MemoryProvenance = {
  readonly kind: MemoryProvenanceKind;
  readonly status: MemoryProvenanceStatus;
  /** Record whose evidence moved this memory into doubtful/corrected. */
  readonly correctedByRecordId?: MemoryRecordId;
};

export function createMemoryProvenance(input: {
  readonly kind: MemoryProvenanceKind;
  readonly status?: MemoryProvenanceStatus;
  readonly correctedByRecordId?: MemoryRecordId;
}): MemoryProvenance {
  const status = input.status ?? 'influencing';
  if (
    (status === 'doubtful' || status === 'corrected') &&
    input.correctedByRecordId === undefined
  ) {
    throw new Error(`provenance status ${status} requires correctedByRecordId`);
  }
  return {
    kind: input.kind,
    status,
    ...(input.correctedByRecordId === undefined
      ? {}
      : { correctedByRecordId: input.correctedByRecordId }),
  };
}

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
      readonly outcomePolicyVersion?: string;
      readonly outcomeSignals?: readonly string[];
      readonly outcomeSignalSeverities?: readonly {
        readonly signal: string;
        readonly severity: number;
      }[];
      readonly knowledgeClaims?: readonly SocialKnowledgeClaim[];
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
  /**
   * Optional provenance tag (memory-provenance slice). Absent on records
   * written before the slice landed; readers must treat absence as unknown
   * and keep legacy ordering/assertion behavior for it.
   */
  readonly provenance?: MemoryProvenance;
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
  readonly provenance?: MemoryProvenance;
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
    ...(input.provenance === undefined ? {} : { provenance: input.provenance }),
  };
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
