import { asAgentId } from '@aivilization/sim-core';
import type {
  ShortTermMemoryRepository,
  SequencedShortTermMemoryRecord,
} from '@aivilization/memory';

export type CanonicalMemoryEntry = SequencedShortTermMemoryRecord & {
  readonly partitionKey: string;
};
export type CanonicalMemoryContinuation = {
  readonly version: 'canonical-memory-continuation-v1';
  readonly recordsByResident: Readonly<Record<string, readonly CanonicalMemoryEntry[]>>;
};
/** Read complete append-order pages, never the bounded retrieval buffer. Sources must be frozen. */
export async function readCanonicalResidentMemory(input: {
  readonly residentIds: readonly string[];
  readonly partitions: readonly {
    readonly partitionKey: string;
    readonly repository: Pick<ShortTermMemoryRepository, 'retrieveLedgerMany'>;
  }[];
}): Promise<CanonicalMemoryContinuation> {
  if (
    new Set(input.residentIds).size !== input.residentIds.length ||
    new Set(input.partitions.map((p) => p.partitionKey)).size !== input.partitions.length ||
    input.partitions.length === 0
  )
    throw new Error('canonical-memory-source-set-invalid');
  const recordsByResident: Record<string, CanonicalMemoryEntry[]> = Object.fromEntries(
    input.residentIds.map((id) => [id, []]),
  );
  for (const partition of [...input.partitions].sort((a, b) =>
    a.partitionKey.localeCompare(b.partitionKey, 'en'),
  )) {
    if (!partition.partitionKey.trim()) throw new Error('canonical-memory-partition-invalid');
    for (const id of input.residentIds) {
      let after = 0;
      for (;;) {
        const pages = await partition.repository.retrieveLedgerMany([
          { agentId: asAgentId(id), appendedAfterSequence: after, limit: 128 },
        ]);
        if (pages.length !== 1 || !pages[0] || pages[0].entries.length > 128)
          throw new Error('canonical-memory-page-invalid');
        const entries = pages[0].entries;
        for (const entry of entries) {
          if (
            entry.record.agentId !== id ||
            !Number.isSafeInteger(entry.appendSequence) ||
            entry.appendSequence <= after
          )
            throw new Error('canonical-memory-entry-invalid');
          after = entry.appendSequence;
          recordsByResident[id]!.push(
            structuredClone({ ...entry, partitionKey: partition.partitionKey }),
          );
        }
        if (entries.length === 0) break;
      }
    }
  }
  return { version: 'canonical-memory-continuation-v1', recordsByResident };
}
