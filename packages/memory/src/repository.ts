import type { ShortTermMemoryRecord } from './records';
import { retrieveShortTermMemory, type ShortTermMemoryQuery } from './retrieval';

export type ShortTermMemoryRepository = {
  append(record: ShortTermMemoryRecord): Promise<void>;
  appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void>;
  retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]>;
};

export class InMemoryShortTermMemoryRepository implements ShortTermMemoryRepository {
  private records: ShortTermMemoryRecord[] = [];

  async append(record: ShortTermMemoryRecord): Promise<void> {
    this.records = [...this.records, record];
  }

  async appendMany(records: readonly ShortTermMemoryRecord[]): Promise<void> {
    this.records = [...this.records, ...records];
  }

  async retrieve(query: ShortTermMemoryQuery): Promise<ShortTermMemoryRecord[]> {
    return retrieveShortTermMemory(this.records, query);
  }
}
