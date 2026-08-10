import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { ShortTermMemoryKind, ShortTermMemoryRecord, ShortTermMemoryStatus } from './records';

export type ShortTermMemoryOrder = 'importance' | 'oldest-first';

export type ShortTermMemoryQuery = {
  readonly agentId: AgentId;
  readonly kinds?: readonly ShortTermMemoryKind[];
  readonly statuses?: readonly ShortTermMemoryStatus[];
  readonly requiredTags?: readonly string[];
  readonly occurredAfter?: SimulationTimestamp;
  readonly orderBy?: ShortTermMemoryOrder;
  readonly limit: number;
};

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
  const orderBy = query.orderBy ?? 'importance';

  return [...records]
    .filter((record) => record.agentId === query.agentId)
    .filter((record) => kinds === undefined || kinds.has(record.kind))
    .filter((record) => statuses === undefined || statuses.has(record.status))
    .filter((record) => requiredTags.every((tag) => record.tags.includes(tag)))
    .filter(
      (record) => query.occurredAfter === undefined || record.occurredAt > query.occurredAfter,
    )
    .sort(
      orderBy === 'oldest-first'
        ? compareShortTermMemoryRecordsOldestFirst
        : compareShortTermMemoryRecordsByImportance,
    )
    .slice(0, query.limit);
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
