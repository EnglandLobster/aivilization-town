import type { ShortTermMemoryRecord } from './records';
import { retrieveShortTermMemory, type ShortTermMemoryQuery } from './retrieval';

/**
 * Repository policy, not a paper constant: retain two canonical 32-record consolidation pages as
 * each agent's fast-thinking buffer while the append-only ledger remains complete for consolidation.
 */
export const SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT = 64;

/**
 * Repository policy, not a paper constant: checkpoint every 1,024 ledger rows and retain only the
 * newest 4,096 checkpoints. This covers roughly four million recent rows without per-record heap
 * growth; older recovery queries deliberately fall back to a complete streaming scan.
 */
export const SHORT_TERM_MEMORY_SPARSE_CHECKPOINT_INTERVAL = 1_024;
export const SHORT_TERM_MEMORY_MAX_SPARSE_CHECKPOINT_COUNT = 4_096;

export type SequencedShortTermMemoryRecord = {
  readonly appendSequence: number;
  readonly record: ShortTermMemoryRecord;
};

export type ShortTermMemoryLedgerQuery = {
  readonly agentId: ShortTermMemoryQuery['agentId'];
  readonly appendedAfterSequence?: number;
  readonly occurredAtOrAfter?: number;
  readonly limit: number;
};

export type ShortTermMemoryLedgerWindow = {
  readonly entries: readonly SequencedShortTermMemoryRecord[];
};

export type ShortTermMemoryRepository = {
  append(record: ShortTermMemoryRecord): Promise<void>;
  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void>;
  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]>;
  retrieveMany(queries: readonly ShortTermMemoryQuery[]): Promise<ShortTermMemoryRecord[][]>;
  retrieveLedgerMany(
    queries: readonly ShortTermMemoryLedgerQuery[],
  ): Promise<ShortTermMemoryLedgerWindow[]>;
};

export class InMemoryShortTermMemoryRepository implements ShortTermMemoryRepository {
  private records: SequencedShortTermMemoryRecord[] = [];
  private nextAppendSequence = 1;

  append(record: ShortTermMemoryRecord): Promise<void> {
    return this.appendMany([record]);
  }

  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void> {
    this.records = [
      ...this.records,
      ...records.map((record) => ({
        appendSequence: this.nextAppendSequence++,
        record,
      })),
    ];
    return Promise.resolve();
  }

  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]> {
    return Promise.resolve(retrieveShortTermMemory(this.recentRecords(query.agentId), query));
  }

  retrieveMany(queries: readonly ShortTermMemoryQuery[]): Promise<ShortTermMemoryRecord[][]> {
    return Promise.resolve(
      queries.map((query) => retrieveShortTermMemory(this.recentRecords(query.agentId), query)),
    );
  }

  retrieveLedgerMany(
    queries: readonly ShortTermMemoryLedgerQuery[],
  ): Promise<ShortTermMemoryLedgerWindow[]> {
    return Promise.resolve(
      queries.map((query) => {
        assertValidShortTermMemoryLedgerQuery(query);
        return {
          entries: this.records
            .filter((entry) => entry.record.agentId === query.agentId)
            .filter(
              (entry) =>
                query.appendedAfterSequence === undefined ||
                entry.appendSequence > query.appendedAfterSequence,
            )
            .filter(
              (entry) =>
                query.occurredAtOrAfter === undefined ||
                entry.record.occurredAt >= query.occurredAtOrAfter,
            )
            .slice(0, query.limit),
        };
      }),
    );
  }

  private recentRecords(agentId: ShortTermMemoryQuery['agentId']): ShortTermMemoryRecord[] {
    return this.records
      .filter((entry) => entry.record.agentId === agentId)
      .slice(-SHORT_TERM_MEMORY_RECENT_BUFFER_LIMIT_PER_AGENT)
      .map((entry) => entry.record);
  }
}

export function assertValidShortTermMemoryLedgerQuery(query: ShortTermMemoryLedgerQuery): void {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
    throw new Error('limit must be a positive safe integer');
  }
  if (
    query.appendedAfterSequence !== undefined &&
    (!Number.isSafeInteger(query.appendedAfterSequence) || query.appendedAfterSequence < 0)
  ) {
    throw new Error('appendedAfterSequence must be a non-negative safe integer');
  }
  if (query.occurredAtOrAfter !== undefined && !Number.isFinite(query.occurredAtOrAfter)) {
    throw new Error('occurredAtOrAfter must be finite');
  }
  if (query.appendedAfterSequence !== undefined && query.occurredAtOrAfter !== undefined) {
    throw new Error(
      'ledger query must use append sequence or legacy occurrence boundary, not both',
    );
  }
}
