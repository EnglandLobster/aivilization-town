import type {
  MemoryRecordId,
  ShortTermMemoryRecord,
  ShortTermMemoryStatus,
} from '@aivilization/memory';
import type { SimulationTimestamp } from '@aivilization/sim-core';

export type MemoryInfluenceMatch = {
  readonly recordId: MemoryRecordId;
  readonly tag: string;
  readonly contribution: number;
};

export type MemoryInfluenceScore = {
  readonly score: number;
  readonly matches: readonly MemoryInfluenceMatch[];
};

const defaultRecencyWindow = 600;

const statusWeights = {
  failed: 2,
  repaired: 1.5,
  succeeded: 1,
  observed: 1,
} as const satisfies Record<ShortTermMemoryStatus, number>;

export function scoreMemoryInfluence(input: {
  readonly records: readonly ShortTermMemoryRecord[];
  readonly affinityTags: readonly string[];
  readonly at: SimulationTimestamp;
  readonly recencyWindow?: number;
}): MemoryInfluenceScore {
  assertFiniteNumber(input.at, 'at');
  const recencyWindow = input.recencyWindow ?? defaultRecencyWindow;
  assertPositiveFinite(recencyWindow, 'recencyWindow');

  const tags = normalizeAffinityTags(input.affinityTags);
  if (tags.length === 0) {
    return { score: 0, matches: [] };
  }

  const matches = input.records.flatMap((record) =>
    tags
      .filter((tag) => recordMatchesTag(record, tag))
      .map((tag) => ({
        recordId: record.id,
        tag,
        contribution: contributionForRecord({
          record,
          at: input.at,
          recencyWindow,
        }),
      })),
  );

  const sortedMatches = matches.sort(compareMatches);
  return {
    score: roundScore(sortedMatches.reduce((total, match) => total + match.contribution, 0)),
    matches: sortedMatches,
  };
}

function recordMatchesTag(record: ShortTermMemoryRecord, tag: string): boolean {
  return (
    record.tags.some((recordTag) => normalizeText(recordTag).includes(tag)) ||
    normalizeText(record.summary).includes(tag)
  );
}

function contributionForRecord(input: {
  readonly record: ShortTermMemoryRecord;
  readonly at: SimulationTimestamp;
  readonly recencyWindow: number;
}): number {
  const age = Math.max(0, input.at - input.record.occurredAt);
  const recencyBoost = Math.max(0, 1 - age / input.recencyWindow);
  return roundScore(
    input.record.importanceScore * statusWeights[input.record.status] * (1 + recencyBoost),
  );
}

function normalizeAffinityTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map(normalizeText).filter((tag) => tag.length > 0))];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function compareMatches(left: MemoryInfluenceMatch, right: MemoryInfluenceMatch): number {
  if (left.recordId !== right.recordId) {
    return left.recordId.localeCompare(right.recordId);
  }
  return left.tag.localeCompare(right.tag);
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
