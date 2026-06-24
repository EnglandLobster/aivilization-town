import type { AgentId } from '@aivilization/sim-core';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBranchPlan, type BranchPlan } from './planner';
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
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type BranchPlanLookup = {
  readonly planId: string;
  readonly agentId: AgentId;
};

export type BranchPlanRepository = {
  readonly get: (lookup: BranchPlanLookup) => Promise<BranchPlanRecord | undefined>;
  readonly require: (lookup: BranchPlanLookup) => Promise<BranchPlanRecord>;
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

  save(record: BranchPlanRecord): Promise<void> {
    this.recordsByKey.set(planKey(record.planId, record.agentId), cloneRecord(record));
    return Promise.resolve();
  }
}

export class FileBranchPlanRepository implements BranchPlanRepository {
  private readonly plansPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.plansPath = join(input.rootDir, 'branch-plans.jsonl');
    ensureFile(this.plansPath, input.rootDir);
  }

  get(lookup: BranchPlanLookup): Promise<BranchPlanRecord | undefined> {
    const record = readJsonLines<BranchPlanRecord>(this.plansPath)
      .filter(
        (candidate) => candidate.planId === lookup.planId && candidate.agentId === lookup.agentId,
      )
      .at(-1);
    return Promise.resolve(record === undefined ? undefined : cloneRecord(record));
  }

  async require(lookup: BranchPlanLookup): Promise<BranchPlanRecord> {
    const record = await this.get(lookup);
    if (record === undefined) {
      throw new Error(notFoundMessage(lookup));
    }
    return record;
  }

  save(record: BranchPlanRecord): Promise<void> {
    appendJsonLines(this.plansPath, [cloneRecord(record)]);
    return Promise.resolve();
  }
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
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : { attempts: trace.attempts.map(clonePlanningAttemptTrace) }),
    ...(trace.usage === undefined ? {} : { usage: clonePlanningUsage(trace.usage) }),
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

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
