import type { AgentId } from '@aivilization/sim-core';
import type { ShortTermMemoryKind, ShortTermMemoryRecord, ShortTermMemoryStatus } from './records';

export type ShortTermMemoryQuery = {
  readonly agentId: AgentId;
  readonly kinds?: readonly ShortTermMemoryKind[];
  readonly statuses?: readonly ShortTermMemoryStatus[];
  readonly requiredTags?: readonly string[];
  readonly limit: number;
};

export function retrieveShortTermMemory(
  records: readonly ShortTermMemoryRecord[],
  query: ShortTermMemoryQuery,
): ShortTermMemoryRecord[] {
  assertPositiveInteger(query.limit, 'limit');

  const kinds = query.kinds === undefined ? undefined : new Set(query.kinds);
  const statuses = query.statuses === undefined ? undefined : new Set(query.statuses);
  const requiredTags = query.requiredTags ?? [];

  return [...records]
    .filter((record) => record.agentId === query.agentId)
    .filter((record) => kinds === undefined || kinds.has(record.kind))
    .filter((record) => statuses === undefined || statuses.has(record.status))
    .filter((record) => requiredTags.every((tag) => record.tags.includes(tag)))
    .sort(compareShortTermMemoryRecords)
    .slice(0, query.limit);
}

function compareShortTermMemoryRecords(
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

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
