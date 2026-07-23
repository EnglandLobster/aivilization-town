import { FixedBloomFilter, IncrementalJsonLinesProjection } from '@aivilization/sim-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const BOUNDED_TRACE_LEDGER_POLICY_VERSION = 'bounded-trace-ledger-v1';
export const BOUNDED_TRACE_LEDGER_RECENT_RECORD_LIMIT = 4_096;
export const BOUNDED_TRACE_LEDGER_BLOOM_BIT_COUNT = 8_388_608;
export const BOUNDED_TRACE_LEDGER_BLOOM_HASH_COUNT = 7;

export type BoundedTraceLedgerDiagnostics = {
  readonly completeRecordCount: number;
  readonly committedBytes: number;
  readonly fileBytes: number;
  readonly hasIncompleteTrailingRow: boolean;
  readonly recentRecordCount: number;
  readonly recentRecordLimit: number;
  readonly bloomBitCount: number;
  readonly bloomByteLength: number;
  readonly definiteNegativeLookupCount: number;
  readonly exactColdScanCount: number;
  readonly completeQueryScanCount: number;
};

/**
 * Lossless JSONL trace ledger with bounded hot state.
 *
 * The Bloom filter is a negative index only. A possible match always performs
 * an exact committed-ledger scan, so false positives affect latency rather than
 * correctness. Complete history queries are intentionally transient scans.
 */
export class BoundedTraceLedger<TValue> {
  private readonly recentByKey = new Map<string, TValue>();
  private bloom: FixedBloomFilter | undefined;
  private definiteNegativeLookupCount = 0;
  private exactColdScanCount = 0;
  private completeQueryScanCount = 0;
  private readonly file: IncrementalJsonLinesProjection<TValue>;

  constructor(
    private readonly input: {
      readonly path: string;
      readonly keyOf: (value: TValue) => string;
      readonly clone: (value: TValue) => TValue;
      readonly recentRecordLimit?: number;
      readonly bloomBitCount?: number;
      readonly bloomHashCount?: number;
    },
  ) {
    assertNonEmpty(input.path, 'path');
    assertPositiveInteger(
      input.recentRecordLimit ?? BOUNDED_TRACE_LEDGER_RECENT_RECORD_LIMIT,
      'recentRecordLimit',
    );
    assertPositiveInteger(
      input.bloomBitCount ?? BOUNDED_TRACE_LEDGER_BLOOM_BIT_COUNT,
      'bloomBitCount',
    );
    assertPositiveInteger(
      input.bloomHashCount ?? BOUNDED_TRACE_LEDGER_BLOOM_HASH_COUNT,
      'bloomHashCount',
    );
    ensureFile(input.path);
    this.file = new IncrementalJsonLinesProjection({
      path: input.path,
      resetProjection: () => this.resetProjection(),
      project: (value) => this.project(value),
    });
  }

  appendUnique(value: TValue): boolean {
    const cloned = this.input.clone(value);
    const key = this.requireKey(cloned);
    if (this.get(key) !== undefined) {
      return false;
    }
    this.file.append([cloned]);
    return true;
  }

  get(key: string): TValue | undefined {
    assertNonEmpty(key, 'key');
    this.file.refresh();
    const recent = this.recentByKey.get(key);
    if (recent !== undefined) {
      return this.input.clone(recent);
    }
    if (this.bloom === undefined || !this.bloom.mightContain(key)) {
      this.definiteNegativeLookupCount += 1;
      return undefined;
    }

    this.exactColdScanCount += 1;
    let match: TValue | undefined;
    this.file.scanCommitted((candidate) => {
      if (this.requireKey(candidate) === key) {
        match = candidate;
      }
    });
    return match === undefined ? undefined : this.input.clone(match);
  }

  readAll(): TValue[] {
    this.completeQueryScanCount += 1;
    const values: TValue[] = [];
    this.file.scanCommitted((value) => values.push(this.input.clone(value)));
    return values;
  }

  diagnostics(): BoundedTraceLedgerDiagnostics {
    const file = this.file.diagnostics();
    return {
      ...file,
      recentRecordCount: this.recentByKey.size,
      recentRecordLimit: this.input.recentRecordLimit ?? BOUNDED_TRACE_LEDGER_RECENT_RECORD_LIMIT,
      bloomBitCount: this.bloom?.bitCount ?? 0,
      bloomByteLength: this.bloom?.byteLength ?? 0,
      definiteNegativeLookupCount: this.definiteNegativeLookupCount,
      exactColdScanCount: this.exactColdScanCount,
      completeQueryScanCount: this.completeQueryScanCount,
    };
  }

  private project(value: TValue): void {
    const cloned = this.input.clone(value);
    const key = this.requireKey(cloned);
    this.ensureBloom().add(key);
    this.recentByKey.delete(key);
    this.recentByKey.set(key, cloned);
    const limit = this.input.recentRecordLimit ?? BOUNDED_TRACE_LEDGER_RECENT_RECORD_LIMIT;
    while (this.recentByKey.size > limit) {
      const oldestKey = this.recentByKey.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.recentByKey.delete(oldestKey);
    }
  }

  private resetProjection(): void {
    this.recentByKey.clear();
    this.bloom = undefined;
  }

  private ensureBloom(): FixedBloomFilter {
    this.bloom ??= new FixedBloomFilter({
      bitCount: this.input.bloomBitCount ?? BOUNDED_TRACE_LEDGER_BLOOM_BIT_COUNT,
      hashCount: this.input.bloomHashCount ?? BOUNDED_TRACE_LEDGER_BLOOM_HASH_COUNT,
    });
    return this.bloom;
  }

  private requireKey(value: TValue): string {
    const key = this.input.keyOf(value);
    assertNonEmpty(key, 'trace key');
    return key;
  }
}

export function createBoundedTraceLedgerPolicyManifest() {
  return {
    policyVersion: BOUNDED_TRACE_LEDGER_POLICY_VERSION,
    source: 'repository-design' as const,
    durableLayout: 'unchanged-lossless-jsonl' as const,
    recentRecordLimit: BOUNDED_TRACE_LEDGER_RECENT_RECORD_LIMIT,
    duplicateRule: 'recent-key-or-fixed-bloom-plus-exact-cold-scan' as const,
    bloom: {
      allocation: 'lazy-on-first-record' as const,
      bitCount: BOUNDED_TRACE_LEDGER_BLOOM_BIT_COUNT,
      hashCount: BOUNDED_TRACE_LEDGER_BLOOM_HASH_COUNT,
      falsePositiveRule: 'latency-only-never-correctness' as const,
    },
    completeQueryRule: 'transient-committed-ledger-scan' as const,
    mutationRecovery:
      'rebuild-bounded-index-after-replacement-truncation-or-committed-boundary-rewrite' as const,
    incompleteTailRule: 'exclude-from-reads-and-reject-local-append' as const,
  };
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, '');
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
