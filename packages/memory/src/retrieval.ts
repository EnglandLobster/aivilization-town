import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type {
  MemoryProvenance,
  MemoryProvenanceKind,
  MemoryProvenanceStatus,
  ShortTermMemoryKind,
  ShortTermMemoryRecord,
  ShortTermMemoryStatus,
} from './records';

export type ShortTermMemoryOrder = 'importance' | 'oldest-first' | 'provenance-importance';

export type ShortTermMemoryQuery = {
  readonly agentId: AgentId;
  readonly kinds?: readonly ShortTermMemoryKind[];
  readonly statuses?: readonly ShortTermMemoryStatus[];
  readonly requiredTags?: readonly string[];
  readonly occurredAfter?: SimulationTimestamp;
  readonly orderBy?: ShortTermMemoryOrder;
  /**
   * Optional provenance-status exclusion (memory-provenance slice): records
   * whose provenance carries one of these statuses are filtered out, so e.g.
   * corrected hearsay stops asserting. Untagged legacy records are never
   * excluded by this filter.
   */
  readonly excludeProvenanceStatuses?: readonly MemoryProvenanceStatus[];
  readonly limit: number;
};

/**
 * Planning-context rank: what the agent lived through or directly observed
 * (firsthand, and untagged legacy records) outranks human-steering implants,
 * which outrank secondhand conversation claims (hearsay). Records whose
 * provenance was corrected or aged out sink below everything else.
 */
export function memoryProvenanceRank(provenance: MemoryProvenance | undefined): number {
  if (provenance === undefined) {
    return 0;
  }
  if (provenance.status === 'corrected' || provenance.status === 'past') {
    return 10;
  }
  const kindRank: Record<MemoryProvenanceKind, number> = {
    firsthand: 0,
    implanted: 1,
    hearsay: 2,
  };
  return kindRank[provenance.kind];
}

export function retrieveShortTermMemory(
  records: readonly ShortTermMemoryRecord[],
  query: ShortTermMemoryQuery,
): ShortTermMemoryRecord[] {
  assertPositiveInteger(query.limit, 'limit');
  if (query.occurredAfter !== undefined) {
    assertFiniteNumber(query.occurredAfter, 'occurredAfter');
  }

  const kinds = query.kinds === undefined ? undefined : new Set(query.kinds);
  const statuses = query.statuses === undefined ? undefined : new Set(query.statuses);
  const requiredTags = query.requiredTags ?? [];
  const excludedProvenanceStatuses =
    query.excludeProvenanceStatuses === undefined
      ? undefined
      : new Set(query.excludeProvenanceStatuses);
  const orderBy = query.orderBy ?? 'importance';

  return [...records]
    .filter((record) => record.agentId === query.agentId)
    .filter((record) => kinds === undefined || kinds.has(record.kind))
    .filter((record) => statuses === undefined || statuses.has(record.status))
    .filter((record) => requiredTags.every((tag) => record.tags.includes(tag)))
    .filter(
      (record) => query.occurredAfter === undefined || record.occurredAt > query.occurredAfter,
    )
    .filter(
      (record) =>
        excludedProvenanceStatuses === undefined ||
        record.provenance === undefined ||
        !excludedProvenanceStatuses.has(record.provenance.status),
    )
    .sort(resolveComparator(orderBy))
    .slice(0, query.limit);
}

function resolveComparator(
  orderBy: ShortTermMemoryOrder,
): (left: ShortTermMemoryRecord, right: ShortTermMemoryRecord) => number {
  switch (orderBy) {
    case 'oldest-first':
      return compareShortTermMemoryRecordsOldestFirst;
    case 'provenance-importance':
      return compareShortTermMemoryRecordsByProvenance;
    case 'importance':
      return compareShortTermMemoryRecordsByImportance;
  }
}

function compareShortTermMemoryRecordsByProvenance(
  left: ShortTermMemoryRecord,
  right: ShortTermMemoryRecord,
): number {
  const rankDelta = memoryProvenanceRank(left.provenance) - memoryProvenanceRank(right.provenance);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return compareShortTermMemoryRecordsByImportance(left, right);
}

function compareShortTermMemoryRecordsByImportance(
  left: ShortTermMemoryRecord,
  right: ShortTermMemoryRecord,
): number {
  if (left.importanceScore !== right.importanceScore) {
    return right.importanceScore - left.importanceScore;
  }
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt - left.occurredAt;
  }
  return left.id.localeCompare(right.id);
}

function compareShortTermMemoryRecordsOldestFirst(
  left: ShortTermMemoryRecord,
  right: ShortTermMemoryRecord,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.id.localeCompare(right.id);
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
