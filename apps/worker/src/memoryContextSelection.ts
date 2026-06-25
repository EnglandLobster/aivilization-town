import {
  scoreMemoryInfluence,
  type BranchPlan,
  type ContextSignal,
} from '@aivilization/agent-runtime';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { SimulationTimestamp } from '@aivilization/sim-core';

export const DEFAULT_MEMORY_CONTEXT_CANDIDATE_MULTIPLIER = 4;

export function resolveMemoryRetrievalCandidateLimit(input: {
  readonly memoryRetrievalLimit: number;
  readonly memoryRetrievalCandidateLimit?: number;
}): number {
  assertPositiveInteger(input.memoryRetrievalLimit, 'memoryRetrievalLimit');
  if (input.memoryRetrievalCandidateLimit === undefined) {
    return input.memoryRetrievalLimit * DEFAULT_MEMORY_CONTEXT_CANDIDATE_MULTIPLIER;
  }
  assertPositiveInteger(input.memoryRetrievalCandidateLimit, 'memoryRetrievalCandidateLimit');
  if (input.memoryRetrievalCandidateLimit < input.memoryRetrievalLimit) {
    throw new Error('memoryRetrievalCandidateLimit must be >= memoryRetrievalLimit');
  }
  return input.memoryRetrievalCandidateLimit;
}

export function selectRelevantShortTermMemoryContext(input: {
  readonly records: readonly ShortTermMemoryRecord[];
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly issuedAt: SimulationTimestamp;
  readonly limit: number;
  readonly recencyWindow?: number;
}): readonly ShortTermMemoryRecord[] {
  assertPositiveInteger(input.limit, 'limit');
  const affinityTags = collectMemoryContextAffinityTags({
    plan: input.plan,
    signals: input.signals,
  });
  if (affinityTags.length === 0) {
    return orderByImportance(input.records).slice(0, input.limit);
  }

  return input.records
    .map((record) => ({
      record,
      influenceScore: scoreMemoryInfluence({
        records: [record],
        affinityTags,
        at: input.issuedAt,
        ...(input.recencyWindow === undefined ? {} : { recencyWindow: input.recencyWindow }),
      }).score,
    }))
    .sort(compareScoredMemoryRecords)
    .slice(0, input.limit)
    .map((entry) => entry.record);
}

function collectMemoryContextAffinityTags(input: {
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
}): readonly string[] {
  return sortedUniqueNormalized([
    ...input.plan.branches.flatMap((branch) =>
      branch.subtasks.flatMap((subtask) => subtask.memoryAffinityTags ?? []),
    ),
    ...input.signals.map((signal) => signal.key),
  ]);
}

function compareScoredMemoryRecords(
  left: { readonly record: ShortTermMemoryRecord; readonly influenceScore: number },
  right: { readonly record: ShortTermMemoryRecord; readonly influenceScore: number },
): number {
  if (left.influenceScore !== right.influenceScore) {
    return right.influenceScore - left.influenceScore;
  }
  return compareMemoryRecordsByImportance(left.record, right.record);
}

function orderByImportance(
  records: readonly ShortTermMemoryRecord[],
): readonly ShortTermMemoryRecord[] {
  return [...records].sort(compareMemoryRecordsByImportance);
}

function compareMemoryRecordsByImportance(
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

function sortedUniqueNormalized(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeText).filter((value) => value.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
