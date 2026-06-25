import {
  convertReflectiveInsightsToLongTermMemoryPatches,
  createDeterministicReflectiveInsightSynthesizer,
  createDeterministicSocialModelSynthesizer,
  proposeNonSocialLongTermMemoryPatches,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileRepository,
  type ReflectiveInsightRecord,
  type ReflectiveInsightSynthesizer,
  type ReflectiveInsightSynthesisTrace,
  type SocialInteractionReflectionRecord,
  type SocialModelSynthesizer,
  type SocialModelSynthesisTrace,
  type ShortTermMemoryOrder,
  type ShortTermMemoryRecord,
  type ShortTermMemoryRepository,
} from '@aivilization/memory';
import type {
  SocialReflectionObservation,
  SocialReflectionObservationRepository,
} from '@aivilization/observability';
import type {
  AgentId,
  PartitionKey,
  SimulationId,
  SimulationTimestamp,
} from '@aivilization/sim-core';
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
  readonly reflectiveInsightSynthesizer?: ReflectiveInsightSynthesizer;
  readonly socialModelSynthesizer?: SocialModelSynthesizer;
};

export type WorkerMemoryConsolidationResult = {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly socialReflections: readonly SocialInteractionReflectionRecord[];
  readonly socialModelSynthesisTrace: SocialModelSynthesisTrace;
  readonly reflectiveInsights: readonly ReflectiveInsightRecord[];
  readonly reflectionSynthesisTrace: ReflectiveInsightSynthesisTrace;
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

export type WorkerMemoryConsolidationReflectionTrigger = {
  readonly minimumImportanceScore: number;
};

export type WorkerMemoryConsolidationSkippedResult = {
  readonly agentId: AgentId;
  readonly reason: 'importance-threshold-not-met';
  readonly pendingRecordCount: number;
  readonly pendingImportanceScore: number;
  readonly minimumImportanceScore: number;
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
  readonly reflectionTrigger?: WorkerMemoryConsolidationReflectionTrigger;
  readonly socialReflectionObservationSink?: WorkerMemoryConsolidationSocialReflectionObservationSink;
};

export type WorkerMemoryConsolidationScheduleResult = {
  readonly agentIds: readonly AgentId[];
  readonly results: readonly WorkerMemoryConsolidationResult[];
  readonly skipped: readonly WorkerMemoryConsolidationSkippedResult[];
  readonly cursors: readonly MemoryConsolidationCursor[];
  readonly patchCount: number;
  readonly socialReflectionObservationCount: number;
};

export type WorkerMemoryConsolidationSocialReflectionObservationSink = {
  readonly repository: SocialReflectionObservationRepository;
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
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
  return applyWorkerMemoryConsolidation({
    agentId: input.agentId,
    records,
    longTermProfileRepository: input.longTermProfileRepository,
    minPatternCount: input.minPatternCount,
    proposedAt: input.proposedAt,
    ...(input.reflectiveInsightSynthesizer === undefined
      ? {}
      : { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }),
    ...(input.socialModelSynthesizer === undefined
      ? {}
      : { socialModelSynthesizer: input.socialModelSynthesizer }),
  });
}

async function applyWorkerMemoryConsolidation(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
  readonly reflectiveInsightSynthesizer?: ReflectiveInsightSynthesizer;
  readonly socialModelSynthesizer?: SocialModelSynthesizer;
}): Promise<WorkerMemoryConsolidationResult> {
  const currentProfile = await input.longTermProfileRepository.getOrCreate(input.agentId);
  const nonSocialPatches = proposeNonSocialLongTermMemoryPatches({
    agentId: input.agentId,
    records: input.records,
    minPatternCount: input.minPatternCount,
    proposedAt: input.proposedAt,
  });
  const socialModelSynthesizer =
    input.socialModelSynthesizer ?? createDeterministicSocialModelSynthesizer();
  const socialModelSynthesis = await socialModelSynthesizer({
    agentId: input.agentId,
    records: input.records,
    generatedAt: input.proposedAt,
    longTermProfile: currentProfile,
  });
  const reflectiveInsightSynthesizer =
    input.reflectiveInsightSynthesizer ?? createDeterministicReflectiveInsightSynthesizer();
  const reflectionSynthesis = await reflectiveInsightSynthesizer({
    agentId: input.agentId,
    records: input.records,
    minEvidenceCount: input.minPatternCount,
    generatedAt: input.proposedAt,
    longTermProfile: currentProfile,
  });
  const reflectiveInsights = reflectionSynthesis.insights;
  const patches = [
    ...nonSocialPatches,
    ...socialModelSynthesis.patches,
    ...convertReflectiveInsightsToLongTermMemoryPatches({ insights: reflectiveInsights }),
  ];
  const profile =
    patches.length === 0
      ? currentProfile
      : await input.longTermProfileRepository.applyPatches(input.agentId, patches);

  return {
    agentId: input.agentId,
    records: input.records,
    socialReflections: socialModelSynthesis.socialReflections,
    socialModelSynthesisTrace: socialModelSynthesis.trace,
    reflectiveInsights,
    reflectionSynthesisTrace: reflectionSynthesis.trace,
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
        ...(input.reflectiveInsightSynthesizer === undefined
          ? {}
          : { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }),
        ...(input.socialModelSynthesizer === undefined
          ? {}
          : { socialModelSynthesizer: input.socialModelSynthesizer }),
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
  const skipped: WorkerMemoryConsolidationSkippedResult[] = [];
  const cursors: MemoryConsolidationCursor[] = [];
  if (input.reflectionTrigger !== undefined) {
    assertPositiveFinite(
      input.reflectionTrigger.minimumImportanceScore,
      'reflectionTrigger.minimumImportanceScore',
    );
  }

  for (const agentId of agentIds) {
    const cursor = await input.cursorStore.getCursor(agentId);
    const pendingRecords = await input.shortTermMemoryRepository.retrieve({
      agentId,
      limit: input.retrievalLimit,
      orderBy: 'oldest-first',
      ...(cursor === undefined ? {} : { occurredAfter: cursor.lastProcessedOccurredAt }),
    });
    const skip = evaluateReflectionTrigger({
      agentId,
      records: pendingRecords,
      reflectionTrigger: input.reflectionTrigger,
    });
    if (skip !== undefined) {
      skipped.push(skip);
      continue;
    }

    const result = await applyWorkerMemoryConsolidation({
      agentId,
      records: pendingRecords,
      longTermProfileRepository: input.longTermProfileRepository,
      minPatternCount: input.minPatternCount,
      proposedAt: input.proposedAt,
      ...(input.reflectiveInsightSynthesizer === undefined
        ? {}
        : { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }),
      ...(input.socialModelSynthesizer === undefined
        ? {}
        : { socialModelSynthesizer: input.socialModelSynthesizer }),
    });
    results.push(result);

    const nextCursor = createCursorFromRecords(agentId, result.records, input.proposedAt);
    if (nextCursor !== undefined) {
      cursors.push(await input.cursorStore.saveCursor(nextCursor));
    }
  }
  const socialReflectionObservations = createSocialReflectionObservations({
    results,
    sink: input.socialReflectionObservationSink,
  });
  if (input.socialReflectionObservationSink !== undefined) {
    await input.socialReflectionObservationSink.repository.record(socialReflectionObservations);
  }

  return {
    agentIds,
    results,
    skipped,
    cursors,
    patchCount: results.reduce((count, result) => count + result.patches.length, 0),
    socialReflectionObservationCount: socialReflectionObservations.length,
  };
}

function createSocialReflectionObservations(input: {
  readonly results: readonly WorkerMemoryConsolidationResult[];
  readonly sink: WorkerMemoryConsolidationSocialReflectionObservationSink | undefined;
}): SocialReflectionObservation[] {
  const sink = input.sink;
  if (sink === undefined) {
    return [];
  }
  return input.results.flatMap((result) =>
    result.socialReflections.map((reflection) => ({
      observationId: `${sink.simulationId}:${sink.partitionKey}:${reflection.id}`,
      simulationId: sink.simulationId,
      partitionKey: sink.partitionKey,
      reflectionId: reflection.id,
      agentId: reflection.agentId,
      targetAgentId: reflection.targetAgentId,
      statement: reflection.statement,
      relationDelta: reflection.relationDelta,
      attitudeDelta: reflection.attitudeDelta,
      confidence: reflection.confidence,
      evidenceRecordIds: [...reflection.evidenceRecordIds],
      generatedAt: reflection.generatedAt,
      tags: [...reflection.tags],
      source: 'memory-consolidation',
    })),
  );
}

function evaluateReflectionTrigger(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly reflectionTrigger: WorkerMemoryConsolidationReflectionTrigger | undefined;
}): WorkerMemoryConsolidationSkippedResult | undefined {
  if (input.reflectionTrigger === undefined) {
    return undefined;
  }

  const pendingImportanceScore = sumImportance(input.records);
  if (pendingImportanceScore >= input.reflectionTrigger.minimumImportanceScore) {
    return undefined;
  }

  return {
    agentId: input.agentId,
    reason: 'importance-threshold-not-met',
    pendingRecordCount: input.records.length,
    pendingImportanceScore,
    minimumImportanceScore: input.reflectionTrigger.minimumImportanceScore,
  };
}

function sumImportance(records: readonly ShortTermMemoryRecord[]): number {
  return Number(records.reduce((total, record) => total + record.importanceScore, 0).toFixed(6));
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

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}
