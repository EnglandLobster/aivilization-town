import {
  convertReflectiveInsightsToLongTermMemoryPatches,
  proposeLongTermMemoryPatches,
  proposeReflectiveInsights,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileRepository,
  type ReflectiveInsightRecord,
  type ShortTermMemoryOrder,
  type ShortTermMemoryRecord,
  type ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type WorkerMemoryConsolidationInput = {
  readonly agentId: AgentId;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly retrievalLimit: number;
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
  readonly occurredAfter?: SimulationTimestamp;
  readonly orderBy?: ShortTermMemoryOrder;
};

export type WorkerMemoryConsolidationResult = {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly reflectiveInsights: readonly ReflectiveInsightRecord[];
  readonly patches: readonly LongTermMemoryPatch[];
  readonly profile: LongTermAgentProfile;
};

export type WorkerMemoryConsolidationBatchInput = Omit<
  WorkerMemoryConsolidationInput,
  'agentId'
> & {
  readonly agentIds: readonly AgentId[];
};

export type WorkerMemoryConsolidationBatchResult = {
  readonly agentIds: readonly AgentId[];
  readonly results: readonly WorkerMemoryConsolidationResult[];
  readonly patchCount: number;
};

export type MemoryConsolidationCursor = {
  readonly agentId: AgentId;
  readonly lastProcessedOccurredAt: SimulationTimestamp;
  readonly updatedAt: SimulationTimestamp;
};

export type MemoryConsolidationCursorStore = {
  getCursor(agentId: AgentId): Promise<MemoryConsolidationCursor | undefined>;
  saveCursor(cursor: MemoryConsolidationCursor): Promise<MemoryConsolidationCursor>;
};

export class InMemoryMemoryConsolidationCursorStore implements MemoryConsolidationCursorStore {
  private readonly cursors = new Map<AgentId, MemoryConsolidationCursor>();

  getCursor(agentId: AgentId): Promise<MemoryConsolidationCursor | undefined> {
    const cursor = this.cursors.get(agentId);
    return Promise.resolve(cursor === undefined ? undefined : cloneCursor(cursor));
  }

  saveCursor(cursor: MemoryConsolidationCursor): Promise<MemoryConsolidationCursor> {
    const cloned = cloneCursor(cursor);
    this.cursors.set(cursor.agentId, cloned);
    return Promise.resolve(cloneCursor(cloned));
  }
}

export class FileMemoryConsolidationCursorStore implements MemoryConsolidationCursorStore {
  private readonly cursorsPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.cursorsPath = join(input.rootDir, 'memory-consolidation-cursors.jsonl');
    ensureFile(this.cursorsPath, input.rootDir);
  }

  getCursor(agentId: AgentId): Promise<MemoryConsolidationCursor | undefined> {
    const cursor = readJsonLines<MemoryConsolidationCursor>(this.cursorsPath)
      .filter((candidate) => candidate.agentId === agentId)
      .at(-1);
    return Promise.resolve(cursor === undefined ? undefined : cloneCursor(cursor));
  }

  saveCursor(cursor: MemoryConsolidationCursor): Promise<MemoryConsolidationCursor> {
    const cloned = cloneCursor(cursor);
    appendJsonLines(this.cursorsPath, [cloned]);
    return Promise.resolve(cloneCursor(cloned));
  }
}

export type WorkerMemoryConsolidationScheduleInput = WorkerMemoryConsolidationBatchInput & {
  readonly cursorStore: MemoryConsolidationCursorStore;
};

export type WorkerMemoryConsolidationScheduleResult = {
  readonly agentIds: readonly AgentId[];
  readonly results: readonly WorkerMemoryConsolidationResult[];
  readonly cursors: readonly MemoryConsolidationCursor[];
  readonly patchCount: number;
};

export async function runWorkerMemoryConsolidation(
  input: WorkerMemoryConsolidationInput,
): Promise<WorkerMemoryConsolidationResult> {
  const records = await input.shortTermMemoryRepository.retrieve({
    agentId: input.agentId,
    limit: input.retrievalLimit,
    ...(input.occurredAfter === undefined ? {} : { occurredAfter: input.occurredAfter }),
    ...(input.orderBy === undefined ? {} : { orderBy: input.orderBy }),
  });
  const hintPatches = proposeLongTermMemoryPatches({
    agentId: input.agentId,
    records,
    minPatternCount: input.minPatternCount,
    proposedAt: input.proposedAt,
  });
  const reflectiveInsights = proposeReflectiveInsights({
    agentId: input.agentId,
    records,
    minEvidenceCount: input.minPatternCount,
    generatedAt: input.proposedAt,
  });
  const patches = [
    ...hintPatches,
    ...convertReflectiveInsightsToLongTermMemoryPatches({ insights: reflectiveInsights }),
  ];
  const profile =
    patches.length === 0
      ? await input.longTermProfileRepository.getOrCreate(input.agentId)
      : await input.longTermProfileRepository.applyPatches(input.agentId, patches);

  return {
    agentId: input.agentId,
    records,
    reflectiveInsights,
    patches,
    profile,
  };
}

export async function runWorkerMemoryConsolidationBatch(
  input: WorkerMemoryConsolidationBatchInput,
): Promise<WorkerMemoryConsolidationBatchResult> {
  const agentIds = dedupeAgentIds(input.agentIds);
  const results: WorkerMemoryConsolidationResult[] = [];
  for (const agentId of agentIds) {
    results.push(
      await runWorkerMemoryConsolidation({
        agentId,
        shortTermMemoryRepository: input.shortTermMemoryRepository,
        longTermProfileRepository: input.longTermProfileRepository,
        retrievalLimit: input.retrievalLimit,
        minPatternCount: input.minPatternCount,
        proposedAt: input.proposedAt,
      }),
    );
  }

  return {
    agentIds,
    results,
    patchCount: results.reduce((count, result) => count + result.patches.length, 0),
  };
}

export async function runWorkerMemoryConsolidationSchedule(
  input: WorkerMemoryConsolidationScheduleInput,
): Promise<WorkerMemoryConsolidationScheduleResult> {
  const agentIds = dedupeAgentIds(input.agentIds);
  const results: WorkerMemoryConsolidationResult[] = [];
  const cursors: MemoryConsolidationCursor[] = [];

  for (const agentId of agentIds) {
    const cursor = await input.cursorStore.getCursor(agentId);
    const result = await runWorkerMemoryConsolidation({
      agentId,
      shortTermMemoryRepository: input.shortTermMemoryRepository,
      longTermProfileRepository: input.longTermProfileRepository,
      retrievalLimit: input.retrievalLimit,
      minPatternCount: input.minPatternCount,
      proposedAt: input.proposedAt,
      orderBy: 'oldest-first',
      ...(cursor === undefined ? {} : { occurredAfter: cursor.lastProcessedOccurredAt }),
    });
    results.push(result);

    const nextCursor = createCursorFromRecords(agentId, result.records, input.proposedAt);
    if (nextCursor !== undefined) {
      cursors.push(await input.cursorStore.saveCursor(nextCursor));
    }
  }

  return {
    agentIds,
    results,
    cursors,
    patchCount: results.reduce((count, result) => count + result.patches.length, 0),
  };
}

function dedupeAgentIds(agentIds: readonly AgentId[]): readonly AgentId[] {
  return [...new Set(agentIds)];
}

function createCursorFromRecords(
  agentId: AgentId,
  records: readonly ShortTermMemoryRecord[],
  updatedAt: SimulationTimestamp,
): MemoryConsolidationCursor | undefined {
  const lastProcessedOccurredAt = records.reduce<SimulationTimestamp | undefined>(
    (latest, record) =>
      latest === undefined || record.occurredAt > latest ? record.occurredAt : latest,
    undefined,
  );
  if (lastProcessedOccurredAt === undefined) {
    return undefined;
  }
  return {
    agentId,
    lastProcessedOccurredAt,
    updatedAt,
  };
}

function cloneCursor(cursor: MemoryConsolidationCursor): MemoryConsolidationCursor {
  return {
    agentId: cursor.agentId,
    lastProcessedOccurredAt: cursor.lastProcessedOccurredAt,
    updatedAt: cursor.updatedAt,
  };
}

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function appendJsonLines(path: string, values: readonly unknown[]): void {
  if (values.length === 0) {
    return;
  }
  const payload = values.map((value) => JSON.stringify(value)).join('\n');
  appendFileSync(path, `${payload}\n`);
}

function readJsonLines<TValue>(path: string): readonly TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as TValue);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
