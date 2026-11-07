import type { IdempotentEventStreamAppend } from '@aivilization/sim-core';
import type { WorldEvent } from '@aivilization/world';
import type { SimulationWideAuthoritySnapshot } from './simulationWideAuthority';
export type CanonicalRequestHistory = {
  readonly version: 'canonical-request-history-v1';
  readonly simulationId: string;
  readonly authorityId: string;
  readonly revision: number;
  readonly operations: SimulationWideAuthoritySnapshot['operations'];
  readonly partitions: readonly {
    readonly partitionKey: string;
    readonly appends: readonly IdempotentEventStreamAppend<WorldEvent>[];
  }[];
};
export function createCanonicalRequestHistory(input: {
  readonly authority: SimulationWideAuthoritySnapshot;
  readonly partitions: CanonicalRequestHistory['partitions'];
}): CanonicalRequestHistory {
  const expected = [...input.authority.partitionKeys].sort();
  const actual = input.partitions.map((p) => p.partitionKey).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, i) => key !== actual[i]) ||
    new Set(actual).size !== actual.length
  )
    throw new Error('canonical-request-history-partitions-mismatch');
  const history: CanonicalRequestHistory = structuredClone({
    version: 'canonical-request-history-v1',
    simulationId: input.authority.simulationId,
    authorityId: input.authority.authorityId,
    revision: input.authority.revision,
    operations: input.authority.operations,
    partitions: input.partitions,
  });
  canonicalHistoricalRequestIds(history, history.simulationId);
  return history;
}
/** Reserve exact recorded IDs; never invent equivalence between old commands and new tools. */
export function canonicalHistoricalRequestIds(
  history: CanonicalRequestHistory | undefined,
  simulationId: string,
): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!history) return ids;
  if (
    history.version !== 'canonical-request-history-v1' ||
    history.simulationId !== simulationId ||
    !history.authorityId.trim() ||
    !Number.isSafeInteger(history.revision) ||
    history.revision < 0
  )
    throw new Error('canonical-request-history-invalid');
  const add = (id: string) => {
    if (typeof id !== 'string' || !id.trim())
      throw new Error('canonical-request-history-id-invalid');
    ids.add(id);
  };
  for (const [key, stored] of Object.entries(history.operations)) {
    if (key !== stored.operation.operationId)
      throw new Error('canonical-request-history-operation-mismatch');
    add(key);
    if ('events' in stored.operation)
      for (const event of stored.operation.events) if (event.commandId) add(event.commandId);
  }
  const seen = new Set<string>();
  for (const partition of history.partitions) {
    if (!partition.partitionKey.trim() || seen.has(partition.partitionKey))
      throw new Error('canonical-request-history-partition-invalid');
    seen.add(partition.partitionKey);
    const keys = new Set<string>();
    for (const receipt of partition.appends) {
      if (
        receipt.streamName !==
          `simulation/${simulationId}/partition/${partition.partitionKey}/events` ||
        keys.has(receipt.idempotencyKey)
      )
        throw new Error('canonical-request-history-append-invalid');
      keys.add(receipt.idempotencyKey);
      add(receipt.idempotencyKey);
      for (const event of receipt.appendedEvents) {
        if (
          event.simulationId !== simulationId ||
          (event.partitionKey !== undefined && event.partitionKey !== partition.partitionKey)
        )
          throw new Error('canonical-request-history-event-mismatch');
        if (event.commandId) add(event.commandId);
      }
    }
  }
  return ids;
}
