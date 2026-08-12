import {
  convertReflectiveInsightsToLongTermMemoryPatches,
  createDeterministicReflectiveInsightSynthesizer,
  createDeterministicSocialModelSynthesizer,
  createMemoryProvenance,
  createShortTermMemoryRecord,
  proposeNonSocialLongTermMemoryPatches,
  type LongTermAgentProfile,
  type LongTermMemoryPatch,
  type LongTermProfileRepository,
  type MemorySynthesisWorldDecisionContext,
  type ReflectiveInsightRecord,
  type ReflectiveInsightSynthesizer,
  type ReflectiveInsightSynthesisTrace,
  type SocialInteractionReflectionRecord,
  type SocialModelSynthesizer,
  type SocialModelSynthesisTrace,
  type SequencedShortTermMemoryRecord,
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
import { summarizeObservedAgentState } from './agentStateSummary';

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
  readonly worldDecisionContext?: MemorySynthesisWorldDecisionContext;
};

export type WorkerMemoryConsolidationResult = {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly socialReflections: readonly SocialInteractionReflectionRecord[];
  readonly socialModelSynthesisTrace: SocialModelSynthesisTrace;
  readonly reflectiveInsights: readonly ReflectiveInsightRecord[];
  readonly reflectionSynthesisTrace: ReflectiveInsightSynthesisTrace;
  readonly patches: readonly LongTermMemoryPatch[];
  /**
   * Correction memories generated when a hearsay belief transitioned to
   * doubtful/corrected during this consolidation. They are appended to the
   * agent's short-term memory so later reflection can reason about them.
   */
  readonly correctionRecords: readonly ShortTermMemoryRecord[];
  readonly profile: LongTermAgentProfile;
};

export type WorkerMemoryConsolidationBatchInput = Omit<
  WorkerMemoryConsolidationInput,
  'agentId' | 'worldDecisionContext'
> & {
  readonly agentIds: readonly AgentId[];
  readonly worldDecisionContextProvider?: (
    agentId: AgentId,
  ) => MemorySynthesisWorldDecisionContext | undefined;
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
  readonly lastProcessedAppendSequence?: number;
  readonly lastProcessedOccurredAt: SimulationTimestamp;
  readonly updatedAt: SimulationTimestamp;
};

export type MemoryConsolidationCursorStore = {
  getCursor(agentId: AgentId): Promise<MemoryConsolidationCursor | undefined>;
  getCursors(agentIds: readonly AgentId[]): Promise<(MemoryConsolidationCursor | undefined)[]>;
  saveCursor(cursor: MemoryConsolidationCursor): Promise<MemoryConsolidationCursor>;
};

export class InMemoryMemoryConsolidationCursorStore implements MemoryConsolidationCursorStore {
  private readonly cursors = new Map<AgentId, MemoryConsolidationCursor>();

  getCursor(agentId: AgentId): Promise<MemoryConsolidationCursor | undefined> {
    const cursor = this.cursors.get(agentId);
    return Promise.resolve(cursor === undefined ? undefined : cloneCursor(cursor));
  }

  getCursors(agentIds: readonly AgentId[]): Promise<(MemoryConsolidationCursor | undefined)[]> {
    return Promise.resolve(
      agentIds.map((agentId) => {
        const cursor = this.cursors.get(agentId);
        return cursor === undefined ? undefined : cloneCursor(cursor);
      }),
    );
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
    return this.getCursors([agentId]).then((cursors) => cursors[0]);
  }

  getCursors(agentIds: readonly AgentId[]): Promise<(MemoryConsolidationCursor | undefined)[]> {
    const requestedAgentIds = new Set(agentIds);
    const latestByAgent = new Map<AgentId, MemoryConsolidationCursor>();
    for (const cursor of readJsonLines<MemoryConsolidationCursor>(this.cursorsPath)) {
      if (requestedAgentIds.has(cursor.agentId)) {
        latestByAgent.set(cursor.agentId, cursor);
      }
    }
    return Promise.resolve(
      agentIds.map((agentId) => {
        const cursor = latestByAgent.get(agentId);
        return cursor === undefined ? undefined : cloneCursor(cursor);
      }),
    );
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
    shortTermMemoryRepository: input.shortTermMemoryRepository,
    longTermProfileRepository: input.longTermProfileRepository,
    minPatternCount: input.minPatternCount,
    proposedAt: input.proposedAt,
    ...(input.reflectiveInsightSynthesizer === undefined
      ? {}
      : { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }),
    ...(input.socialModelSynthesizer === undefined
      ? {}
      : { socialModelSynthesizer: input.socialModelSynthesizer }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
}

async function applyWorkerMemoryConsolidation(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly minPatternCount: number;
  readonly proposedAt: SimulationTimestamp;
  readonly reflectiveInsightSynthesizer?: ReflectiveInsightSynthesizer;
  readonly socialModelSynthesizer?: SocialModelSynthesizer;
  readonly worldDecisionContext?: MemorySynthesisWorldDecisionContext;
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
  const observedStateSummary =
    input.worldDecisionContext === undefined
      ? undefined
      : summarizeObservedAgentState(input.worldDecisionContext.agent);
  const socialModelSynthesis = await socialModelSynthesizer({
    agentId: input.agentId,
    records: input.records,
    generatedAt: input.proposedAt,
    longTermProfile: currentProfile,
    ...(observedStateSummary === undefined ? {} : { observedStateSummary }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
  const reflectiveInsightSynthesizer =
    input.reflectiveInsightSynthesizer ?? createDeterministicReflectiveInsightSynthesizer();
  const reflectionSynthesis = await reflectiveInsightSynthesizer({
    agentId: input.agentId,
    records: input.records,
    minEvidenceCount: input.minPatternCount,
    generatedAt: input.proposedAt,
    longTermProfile: currentProfile,
    ...(observedStateSummary === undefined ? {} : { observedStateSummary }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
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

  // A corrected/doubtful hearsay belief is itself memorable: the correction
  // is recorded as a firsthand short-term memory so reflection can pick it up.
  const correctionRecords = createBeliefCorrectionRecords({
    agentId: input.agentId,
    patches,
    currentProfile,
    proposedAt: input.proposedAt,
  });
  if (correctionRecords.length > 0) {
    await input.shortTermMemoryRepository.appendMany(correctionRecords);
  }

  return {
    agentId: input.agentId,
    records: input.records,
    socialReflections: socialModelSynthesis.socialReflections,
    socialModelSynthesisTrace: socialModelSynthesis.trace,
    reflectiveInsights,
    reflectionSynthesisTrace: reflectionSynthesis.trace,
    patches,
    correctionRecords,
    profile,
  };
}

/**
 * Deterministic transition detection: a correction memory is generated exactly
 * when a belief patch moves the entry's provenance status to doubtful or
 * corrected from a different previous state (a legacy entry without provenance
 * counts as influencing). Record ids derive from the patch id, so replaying
 * the same consolidation window regenerates the same records.
 */
function createBeliefCorrectionRecords(input: {
  readonly agentId: AgentId;
  readonly patches: readonly LongTermMemoryPatch[];
  readonly currentProfile: LongTermAgentProfile;
  readonly proposedAt: SimulationTimestamp;
}): ShortTermMemoryRecord[] {
  const records: ShortTermMemoryRecord[] = [];
  for (const patch of input.patches) {
    const status = patch.provenance?.status;
    if (patch.section !== 'beliefs' || (status !== 'corrected' && status !== 'doubtful')) {
      continue;
    }
    const existing = input.currentProfile.beliefs.find((entry) => entry.key === patch.key);
    const previousStatus = existing?.provenance?.status ?? 'influencing';
    if (existing !== undefined && previousStatus === status) {
      continue;
    }
    records.push(
      createShortTermMemoryRecord({
        id: `${patch.id}:belief-correction`,
        agentId: input.agentId,
        kind: 'observation',
        status: 'observed',
        summary: `Belief ${patch.key} marked ${status}: ${patch.statement}`,
        occurredAt: input.proposedAt,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['belief-correction', status, patch.key],
        provenance: createMemoryProvenance({ kind: 'firsthand' }),
      }),
    );
  }
  return records;
}

export async function runWorkerMemoryConsolidationBatch(
  input: WorkerMemoryConsolidationBatchInput,
): Promise<WorkerMemoryConsolidationBatchResult> {
  const agentIds = dedupeAgentIds(input.agentIds);
  const results: WorkerMemoryConsolidationResult[] = [];
  for (const agentId of agentIds) {
    const worldDecisionContext = input.worldDecisionContextProvider?.(agentId);
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
        ...(worldDecisionContext === undefined ? {} : { worldDecisionContext }),
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

  const existingCursors = await input.cursorStore.getCursors(agentIds);
  const pendingRecordWindows = await input.shortTermMemoryRepository.retrieveLedgerMany(
    agentIds.map((agentId, index) => {
      const cursor = existingCursors[index];
      return {
        agentId,
        limit: input.retrievalLimit,
        ...(cursor?.lastProcessedAppendSequence === undefined
          ? cursor === undefined
            ? {}
            : { occurredAtOrAfter: cursor.lastProcessedOccurredAt }
          : { appendedAfterSequence: cursor.lastProcessedAppendSequence }),
      };
    }),
  );

  for (const [index, agentId] of agentIds.entries()) {
    const pendingEntries = pendingRecordWindows[index]?.entries ?? [];
    const pendingRecords = pendingEntries.map((entry) => entry.record);
    const skip = evaluateReflectionTrigger({
      agentId,
      records: pendingRecords,
      reflectionTrigger: input.reflectionTrigger,
    });
    if (skip !== undefined) {
      skipped.push(skip);
      continue;
    }

    const worldDecisionContext = input.worldDecisionContextProvider?.(agentId);
    const result = await applyWorkerMemoryConsolidation({
      agentId,
      records: pendingRecords,
      shortTermMemoryRepository: input.shortTermMemoryRepository,
      longTermProfileRepository: input.longTermProfileRepository,
      minPatternCount: input.minPatternCount,
      proposedAt: input.proposedAt,
      ...(input.reflectiveInsightSynthesizer === undefined
        ? {}
        : { reflectiveInsightSynthesizer: input.reflectiveInsightSynthesizer }),
      ...(input.socialModelSynthesizer === undefined
        ? {}
        : { socialModelSynthesizer: input.socialModelSynthesizer }),
      ...(worldDecisionContext === undefined ? {} : { worldDecisionContext }),
    });
    results.push(result);

    const nextCursor = createCursorFromEntries(agentId, pendingEntries, input.proposedAt);
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

  // Section 2.2.1 requires every completed social interaction to enter post-interaction
  // reflection immediately; those records must not wait for the general importance budget.
  if (input.records.some(isImmediateSocialReflectionRecord)) {
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

function isImmediateSocialReflectionRecord(record: ShortTermMemoryRecord): boolean {
  return (
    record.kind === 'social-interaction' &&
    record.status === 'succeeded' &&
    record.consolidationHint?.kind === 'social'
  );
}

function sumImportance(records: readonly ShortTermMemoryRecord[]): number {
  return Number(records.reduce((total, record) => total + record.importanceScore, 0).toFixed(6));
}

function dedupeAgentIds(agentIds: readonly AgentId[]): readonly AgentId[] {
  return [...new Set(agentIds)];
}

function createCursorFromEntries(
  agentId: AgentId,
  entries: readonly SequencedShortTermMemoryRecord[],
  updatedAt: SimulationTimestamp,
): MemoryConsolidationCursor | undefined {
  const last = entries.at(-1);
  if (last === undefined) {
    return undefined;
  }
  return {
    agentId,
    lastProcessedAppendSequence: last.appendSequence,
    lastProcessedOccurredAt: last.record.occurredAt,
    updatedAt,
  };
}

function cloneCursor(cursor: MemoryConsolidationCursor): MemoryConsolidationCursor {
  return {
    agentId: cursor.agentId,
    ...(cursor.lastProcessedAppendSequence === undefined
      ? {}
      : { lastProcessedAppendSequence: cursor.lastProcessedAppendSequence }),
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
