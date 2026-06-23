import type { ShortTermMemoryRecord } from './records';
import { retrieveShortTermMemory, type ShortTermMemoryQuery } from './retrieval';

export type ShortTermMemoryRepository = {
  append(record: ShortTermMemoryRecord): Promise<void>;
  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void>;
  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]>;
};

export class InMemoryShortTermMemoryRepository implements ShortTermMemoryRepository {
  private records: ShortTermMemoryRecord[] = [];

  append(record: ShortTermMemoryRecord): Promise<void> {
    this.records = [...this.records, record];
    return Promise.resolve();
  }

  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void> {
    this.records = [...this.records, ...records];
    return Promise.resolve();
  }

  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]> {
    return Promise.resolve(retrieveShortTermMemory(this.records, query));
  }
}
