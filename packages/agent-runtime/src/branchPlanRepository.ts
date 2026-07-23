import { IncrementalJsonLinesProjection, type AgentId } from '@aivilization/sim-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createBranchPlan, type BranchPlan } from './planner';
import { BRANCH_PLAN_HOT_RECORDS_PER_AGENT } from './planningStoragePolicy';
import type {
  StrategicPlanCompilationAttemptTrace,
  StrategicPlanCompilationTrace,
  StrategicPlanCompilationUsage,
} from './strategicPlanning';

export type BranchPlanRecord = {
  readonly planId: string;
  readonly agentId: AgentId;
  readonly plan: BranchPlan;
  readonly planningTrace?: StrategicPlanCompilationTrace;
  readonly strategicContext?: StrategicPlanContextSnapshot;
  readonly revision?: StrategicPlanRevisionTrace;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type StrategicPlanPhysiologyRegime = 'stable' | 'low-energy' | 'low-satiety' | 'low-health';

export type StrategicPlanEducationInvestmentRegime =
  | 'unavailable'
  | 'unaffordable'
  | 'reserve-breaking'
  | 'affordable';

export type StrategicPlanContextSnapshot = {
  readonly policyVersion: string;
  readonly capturedAt: number;
  readonly physiologyRegimes: readonly StrategicPlanPhysiologyRegime[];
  readonly job: string | null;
  readonly residentialTier: number;
  readonly eligibleOccupationNames: readonly string[];
  readonly educationInvestmentRegime: StrategicPlanEducationInvestmentRegime;
  readonly strategicProfileEntryVersions: readonly string[];
  readonly overallPriceIndex: number | null;
};

export type StrategicPlanRevisionTrace = {
  readonly policyVersion: string;
  readonly trigger: 'major-context-shift' | 'repeated-failure';
  readonly reasons: readonly string[];
  readonly previousContext: StrategicPlanContextSnapshot;
  readonly currentContext: StrategicPlanContextSnapshot;
};

export type BranchPlanLookup = {
  readonly planId: string;
  readonly agentId: AgentId;
};

export type BranchPlanQuery = {
  readonly planId?: string;
  readonly agentId?: AgentId;
  readonly fromCreatedAt?: number;
  readonly toCreatedAt?: number;
  readonly fromUpdatedAt?: number;
  readonly toUpdatedAt?: number;
  readonly limit?: number;
};

export type BranchPlanRepository = {
  readonly get: (lookup: BranchPlanLookup) => Promise<BranchPlanRecord | undefined>;
  readonly require: (lookup: BranchPlanLookup) => Promise<BranchPlanRecord>;
  readonly query: (query: BranchPlanQuery) => Promise<BranchPlanRecord[]>;
  readonly save: (record: BranchPlanRecord) => Promise<void>;
};

export class InMemoryBranchPlanRepository implements BranchPlanRepository {
  private readonly recordsByKey = new Map<string, BranchPlanRecord>();

  get(lookup: BranchPlanLookup): Promise<BranchPlanRecord | undefined> {
    const record = this.recordsByKey.get(planKey(lookup.planId, lookup.agentId));
    return Promise.resolve(record === undefined ? undefined : cloneRecord(record));
  }

  async require(lookup: BranchPlanLookup): Promise<BranchPlanRecord> {
    const record = await this.get(lookup);
    if (record === undefined) {
      throw new Error(notFoundMessage(lookup));
    }
    return record;
  }

  query(query: BranchPlanQuery): Promise<BranchPlanRecord[]> {
    return Promise.resolve(queryBranchPlanRecords([...this.recordsByKey.values()], query));
  }

  save(record: BranchPlanRecord): Promise<void> {
    this.recordsByKey.set(planKey(record.planId, record.agentId), cloneRecord(record));
    return Promise.resolve();
  }
}

export class FileBranchPlanRepository implements BranchPlanRepository {
  private readonly plansPath: string;
  private readonly plansFile: IncrementalJsonLinesProjection<BranchPlanRecord>;
  private readonly hotRecordsByAgent = new Map<AgentId, Map<string, BranchPlanRecord>>();
  private readonly compactionMaximumBytes: number | undefined;
  private suppressedDuplicateSaveCount = 0;
  private compactionCount = 0;
  private compactionReclaimedBytes = 0;

  constructor(input: {
    readonly rootDir: string;
    readonly singleWriterCompactionMaximumBytes?: number;
  }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    if (input.singleWriterCompactionMaximumBytes !== undefined) {
      assertPositiveSafeInteger(
        input.singleWriterCompactionMaximumBytes,
        'singleWriterCompactionMaximumBytes',
      );
    }
    this.compactionMaximumBytes = input.singleWriterCompactionMaximumBytes;
    this.plansPath = join(input.rootDir, 'branch-plans.jsonl');
    ensureFile(this.plansPath, input.rootDir);
    this.plansFile = new IncrementalJsonLinesProjection({
      path: this.plansPath,
      resetProjection: () => this.hotRecordsByAgent.clear(),
      project: (record) => this.projectHotRecord(record),
    });
  }

  get(lookup: BranchPlanLookup): Promise<BranchPlanRecord | undefined> {
    this.plansFile.refresh();
    const key = planKey(lookup.planId, lookup.agentId);
    const hotRecord = this.hotRecordsByAgent.get(lookup.agentId)?.get(key);
    if (hotRecord !== undefined) {
      return Promise.resolve(cloneRecord(hotRecord));
    }

    let record: BranchPlanRecord | undefined;
    this.plansFile.scanCommitted((candidate) => {
      if (planKey(candidate.planId, candidate.agentId) === key) {
        record = candidate;
      }
    });
    return Promise.resolve(record === undefined ? undefined : cloneRecord(record));
  }

  async require(lookup: BranchPlanLookup): Promise<BranchPlanRecord> {
    const record = await this.get(lookup);
    if (record === undefined) {
      throw new Error(notFoundMessage(lookup));
    }
    return record;
  }

  query(query: BranchPlanQuery): Promise<BranchPlanRecord[]> {
    return Promise.resolve().then(() => {
      assertValidQuery(query);
      const latestRecordByPlanKey = new Map<string, BranchPlanRecord>();
      this.plansFile.scanCommitted((record) => {
        if (query.planId !== undefined && record.planId !== query.planId) {
          return;
        }
        if (query.agentId !== undefined && record.agentId !== query.agentId) {
          return;
        }
        latestRecordByPlanKey.set(planKey(record.planId, record.agentId), record);
      });
      return queryBranchPlanRecords([...latestRecordByPlanKey.values()], query);
    });
  }

  async save(record: BranchPlanRecord): Promise<void> {
    const cloned = cloneRecord(record);
    const existing = await this.get({ planId: cloned.planId, agentId: cloned.agentId });
    if (existing !== undefined && isDeepStrictEqual(existing, cloned)) {
      this.suppressedDuplicateSaveCount += 1;
      return;
    }
    this.plansFile.append([cloned]);
    this.compactIfNeeded();
  }

  getStorageDiagnostics(): {
    readonly completeRecordCount: number;
    readonly hotAgentCount: number;
    readonly hotRecordCount: number;
    readonly hotRecordsPerAgent: number;
    readonly committedBytes: number;
    readonly fileBytes: number;
    readonly hasIncompleteTrailingRow: boolean;
    readonly suppressedDuplicateSaveCount: number;
    readonly compactionCount: number;
    readonly compactionReclaimedBytes: number;
  } {
    const file = this.plansFile.diagnostics();
    return {
      ...file,
      hotAgentCount: this.hotRecordsByAgent.size,
      hotRecordCount: [...this.hotRecordsByAgent.values()].reduce(
        (total, records) => total + records.size,
        0,
      ),
      hotRecordsPerAgent: BRANCH_PLAN_HOT_RECORDS_PER_AGENT,
      suppressedDuplicateSaveCount: this.suppressedDuplicateSaveCount,
      compactionCount: this.compactionCount,
      compactionReclaimedBytes: this.compactionReclaimedBytes,
    };
  }

  private compactIfNeeded(): void {
    if (
      this.compactionMaximumBytes === undefined ||
      this.plansFile.diagnostics().fileBytes <= this.compactionMaximumBytes
    ) {
      return;
    }
    const latestByKey = new Map<string, BranchPlanRecord>();
    this.plansFile.scanCommitted((record) => {
      latestByKey.set(planKey(record.planId, record.agentId), record);
    });
    const replacement = [...latestByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, record]) => cloneRecord(record));
    const result = this.plansFile.replaceCommittedForSingleWriter(replacement);
    this.compactionCount += 1;
    this.compactionReclaimedBytes += Math.max(0, result.previousBytes - result.currentBytes);
  }

  private projectHotRecord(record: BranchPlanRecord): void {
    const cloned = cloneRecord(record);
    const key = planKey(cloned.planId, cloned.agentId);
    let records = this.hotRecordsByAgent.get(cloned.agentId);
    if (records === undefined) {
      records = new Map();
      this.hotRecordsByAgent.set(cloned.agentId, records);
    }
    records.delete(key);
    records.set(key, cloned);
    while (records.size > BRANCH_PLAN_HOT_RECORDS_PER_AGENT) {
      const oldestKey = records.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      records.delete(oldestKey);
    }
  }
}

function queryBranchPlanRecords(
  records: readonly BranchPlanRecord[],
  query: BranchPlanQuery,
): BranchPlanRecord[] {
  assertValidQuery(query);
  return records
    .map((record) => cloneRecord(record))
    .filter((record) => query.planId === undefined || record.planId === query.planId)
    .filter((record) => query.agentId === undefined || record.agentId === query.agentId)
    .filter(
      (record) => query.fromCreatedAt === undefined || record.createdAt >= query.fromCreatedAt,
    )
    .filter((record) => query.toCreatedAt === undefined || record.createdAt <= query.toCreatedAt)
    .filter(
      (record) => query.fromUpdatedAt === undefined || record.updatedAt >= query.fromUpdatedAt,
    )
    .filter((record) => query.toUpdatedAt === undefined || record.updatedAt <= query.toUpdatedAt)
    .sort(compareBranchPlanRecordsLatestFirst)
    .slice(0, query.limit)
    .map((record) => cloneRecord(record));
}

function compareBranchPlanRecordsLatestFirst(
  left: BranchPlanRecord,
  right: BranchPlanRecord,
): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return planKey(right.planId, right.agentId).localeCompare(planKey(left.planId, left.agentId));
}

function cloneRecord(record: BranchPlanRecord): BranchPlanRecord {
  assertNonEmpty(record.planId, 'planId');
  assertFiniteNumber(record.createdAt, 'createdAt');
  assertFiniteNumber(record.updatedAt, 'updatedAt');
  return {
    planId: record.planId,
    agentId: record.agentId,
    plan: clonePlan(record.plan),
    ...(record.planningTrace === undefined
      ? {}
      : { planningTrace: clonePlanningTrace(record.planningTrace) }),
    ...(record.strategicContext === undefined
      ? {}
      : { strategicContext: cloneStrategicContext(record.strategicContext) }),
    ...(record.revision === undefined ? {} : { revision: cloneRevision(record.revision) }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function cloneStrategicContext(
  context: StrategicPlanContextSnapshot,
): StrategicPlanContextSnapshot {
  assertNonEmpty(context.policyVersion, 'strategicContext.policyVersion');
  assertFiniteNumber(context.capturedAt, 'strategicContext.capturedAt');
  assertFiniteNumber(context.residentialTier, 'strategicContext.residentialTier');
  if (context.overallPriceIndex !== null) {
    assertFiniteNumber(context.overallPriceIndex, 'strategicContext.overallPriceIndex');
  }
  return {
    policyVersion: context.policyVersion,
    capturedAt: context.capturedAt,
    physiologyRegimes: [...context.physiologyRegimes],
    job: context.job,
    residentialTier: context.residentialTier,
    eligibleOccupationNames: [...context.eligibleOccupationNames],
    educationInvestmentRegime: context.educationInvestmentRegime,
    strategicProfileEntryVersions: [...context.strategicProfileEntryVersions],
    overallPriceIndex: context.overallPriceIndex,
  };
}

function cloneRevision(revision: StrategicPlanRevisionTrace): StrategicPlanRevisionTrace {
  assertNonEmpty(revision.policyVersion, 'revision.policyVersion');
  if (revision.reasons.length === 0) {
    throw new Error('strategic plan revision requires at least one reason');
  }
  return {
    policyVersion: revision.policyVersion,
    trigger: revision.trigger,
    reasons: [...revision.reasons],
    previousContext: cloneStrategicContext(revision.previousContext),
    currentContext: cloneStrategicContext(revision.currentContext),
  };
}

function clonePlan(plan: BranchPlan): BranchPlan {
  return createBranchPlan({
    objective: plan.objective,
    branches: plan.branches.map((branch) => ({
      id: branch.id,
      objective: branch.objective,
      subtasks: branch.subtasks.map((subtask) => ({
        id: subtask.id,
        description: subtask.description,
        basePriority: subtask.basePriority,
        ...(subtask.dependsOnSubtaskIds === undefined
          ? {}
          : { dependsOnSubtaskIds: [...subtask.dependsOnSubtaskIds] }),
        ...(subtask.signalKeys === undefined ? {} : { signalKeys: [...subtask.signalKeys] }),
        ...(subtask.intentionAffinityTags === undefined
          ? {}
          : { intentionAffinityTags: [...subtask.intentionAffinityTags] }),
        ...(subtask.memoryAffinityTags === undefined
          ? {}
          : { memoryAffinityTags: [...subtask.memoryAffinityTags] }),
        ...(subtask.profileAffinityTags === undefined
          ? {}
          : { profileAffinityTags: [...subtask.profileAffinityTags] }),
      })),
    })),
  });
}

function clonePlanningTrace(trace: StrategicPlanCompilationTrace): StrategicPlanCompilationTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.plannerVariant === undefined ? {} : { plannerVariant: trace.plannerVariant }),
    ...(trace.ablationPolicyVersion === undefined
      ? {}
      : { ablationPolicyVersion: trace.ablationPolicyVersion }),
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : { attempts: trace.attempts.map(clonePlanningAttemptTrace) }),
    ...(trace.usage === undefined ? {} : { usage: clonePlanningUsage(trace.usage) }),
    ...(trace.shortTermMemoryContext === undefined
      ? {}
      : {
          shortTermMemoryContext: {
            recordCount: trace.shortTermMemoryContext.recordCount,
          },
        }),
    ...(trace.longTermProfileContext === undefined
      ? {}
      : {
          longTermProfileContext: {
            entryCount: trace.longTermProfileContext.entryCount,
          },
        }),
    ...(trace.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: trace.observedStateSummary }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: { ...trace.worldDecisionContext } }),
  };
}

function clonePlanningAttemptTrace(
  attempt: StrategicPlanCompilationAttemptTrace,
): StrategicPlanCompilationAttemptTrace {
  return {
    attemptIndex: attempt.attemptIndex,
    status: attempt.status,
    providerId: attempt.providerId,
    model: attempt.model,
    message: attempt.message,
    usage: clonePlanningUsage(attempt.usage),
  };
}

function clonePlanningUsage(usage: StrategicPlanCompilationUsage): StrategicPlanCompilationUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostMicros: usage.estimatedCostMicros,
  };
}

function planKey(planId: string, agentId: AgentId): string {
  assertNonEmpty(planId, 'planId');
  return `${agentId}:${planId}`;
}

function notFoundMessage(lookup: BranchPlanLookup): string {
  return `branch plan ${lookup.planId} for agent ${lookup.agentId} was not found`;
}

function assertValidQuery(query: BranchPlanQuery): void {
  if (query.planId !== undefined) {
    assertNonEmpty(query.planId, 'planId');
  }
  if (query.fromCreatedAt !== undefined) {
    assertFiniteNumber(query.fromCreatedAt, 'fromCreatedAt');
  }
  if (query.toCreatedAt !== undefined) {
    assertFiniteNumber(query.toCreatedAt, 'toCreatedAt');
  }
  if (query.fromUpdatedAt !== undefined) {
    assertFiniteNumber(query.fromUpdatedAt, 'fromUpdatedAt');
  }
  if (query.toUpdatedAt !== undefined) {
    assertFiniteNumber(query.toUpdatedAt, 'toUpdatedAt');
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new Error('limit must be a positive integer');
  }
}

function ensureFile(filePath: string, rootDir: string): void {
  mkdirSync(rootDir, { recursive: true });
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '');
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
