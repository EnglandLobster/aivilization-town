import { IncrementalJsonLinesProjection, type AgentId } from '@aivilization/sim-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createBranchPlanProgress, type BranchPlanProgress } from './planProgress';
import { BRANCH_PLAN_PROGRESS_HOT_RECORDS_PER_AGENT } from './planningStoragePolicy';

export type BranchPlanProgressRepository = {
  readonly get: (input: {
    readonly planId: string;
    readonly agentId: AgentId;
  }) => Promise<BranchPlanProgress | undefined>;
  readonly getOrCreate: (input: {
    readonly planId: string;
    readonly agentId: AgentId;
    readonly createdAt: number;
  }) => Promise<BranchPlanProgress>;
  readonly save: (progress: BranchPlanProgress) => Promise<void>;
};

export class InMemoryBranchPlanProgressRepository implements BranchPlanProgressRepository {
  private readonly progressByKey = new Map<string, BranchPlanProgress>();

  get(input: {
    readonly planId: string;
    readonly agentId: AgentId;
  }): Promise<BranchPlanProgress | undefined> {
    const existing = this.progressByKey.get(progressKey(input.planId, input.agentId));
    return Promise.resolve(existing === undefined ? undefined : cloneProgress(existing));
  }

  async getOrCreate(input: {
    readonly planId: string;
    readonly agentId: AgentId;
    readonly createdAt: number;
  }): Promise<BranchPlanProgress> {
    const existing = await this.get(input);
    if (existing !== undefined) {
      return existing;
    }

    const key = progressKey(input.planId, input.agentId);
    const progress = createBranchPlanProgress(input);
    this.progressByKey.set(key, cloneProgress(progress));
    return progress;
  }

  save(progress: BranchPlanProgress): Promise<void> {
    this.progressByKey.set(progressKey(progress.planId, progress.agentId), cloneProgress(progress));
    return Promise.resolve();
  }
}

export class FileBranchPlanProgressRepository implements BranchPlanProgressRepository {
  private readonly progressPath: string;
  private readonly progressFile: IncrementalJsonLinesProjection<BranchPlanProgress>;
  private readonly hotProgressByAgent = new Map<AgentId, Map<string, BranchPlanProgress>>();
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
    this.progressPath = join(input.rootDir, 'branch-plan-progress.jsonl');
    ensureFile(this.progressPath, input.rootDir);
    this.progressFile = new IncrementalJsonLinesProjection({
      path: this.progressPath,
      resetProjection: () => this.hotProgressByAgent.clear(),
      project: (progress) => this.projectHotProgress(progress),
    });
  }

  get(input: {
    readonly planId: string;
    readonly agentId: AgentId;
  }): Promise<BranchPlanProgress | undefined> {
    const existing = this.getLatestProgress(input.planId, input.agentId);
    return Promise.resolve(existing === undefined ? undefined : cloneProgress(existing));
  }

  async getOrCreate(input: {
    readonly planId: string;
    readonly agentId: AgentId;
    readonly createdAt: number;
  }): Promise<BranchPlanProgress> {
    const existing = await this.get(input);
    if (existing !== undefined) {
      return existing;
    }

    const progress = createBranchPlanProgress(input);
    await this.save(progress);
    return progress;
  }

  async save(progress: BranchPlanProgress): Promise<void> {
    const cloned = cloneProgress(progress);
    const existing = await this.get({ planId: cloned.planId, agentId: cloned.agentId });
    if (existing !== undefined && isDeepStrictEqual(existing, cloned)) {
      this.suppressedDuplicateSaveCount += 1;
      return;
    }
    this.progressFile.append([cloned]);
    this.compactIfNeeded();
  }

  private getLatestProgress(planId: string, agentId: AgentId): BranchPlanProgress | undefined {
    this.progressFile.refresh();
    const key = progressKey(planId, agentId);
    const hotProgress = this.hotProgressByAgent.get(agentId)?.get(key);
    if (hotProgress !== undefined) {
      return hotProgress;
    }

    let latest: BranchPlanProgress | undefined;
    this.progressFile.scanCommitted((candidate) => {
      if (progressKey(candidate.planId, candidate.agentId) === key) {
        latest = candidate;
      }
    });
    return latest;
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
    const file = this.progressFile.diagnostics();
    return {
      ...file,
      hotAgentCount: this.hotProgressByAgent.size,
      hotRecordCount: [...this.hotProgressByAgent.values()].reduce(
        (total, records) => total + records.size,
        0,
      ),
      hotRecordsPerAgent: BRANCH_PLAN_PROGRESS_HOT_RECORDS_PER_AGENT,
      suppressedDuplicateSaveCount: this.suppressedDuplicateSaveCount,
      compactionCount: this.compactionCount,
      compactionReclaimedBytes: this.compactionReclaimedBytes,
    };
  }

  private compactIfNeeded(): void {
    if (
      this.compactionMaximumBytes === undefined ||
      this.progressFile.diagnostics().fileBytes <= this.compactionMaximumBytes
    ) {
      return;
    }
    const latestByKey = new Map<string, BranchPlanProgress>();
    this.progressFile.scanCommitted((progress) => {
      latestByKey.set(progressKey(progress.planId, progress.agentId), progress);
    });
    const replacement = [...latestByKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, progress]) => cloneProgress(progress));
    const result = this.progressFile.replaceCommittedForSingleWriter(replacement);
    this.compactionCount += 1;
    this.compactionReclaimedBytes += Math.max(0, result.previousBytes - result.currentBytes);
  }

  private projectHotProgress(progress: BranchPlanProgress): void {
    const cloned = cloneProgress(progress);
    const key = progressKey(cloned.planId, cloned.agentId);
    let records = this.hotProgressByAgent.get(cloned.agentId);
    if (records === undefined) {
      records = new Map();
      this.hotProgressByAgent.set(cloned.agentId, records);
    }
    records.delete(key);
    records.set(key, cloned);
    while (records.size > BRANCH_PLAN_PROGRESS_HOT_RECORDS_PER_AGENT) {
      const oldestKey = records.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      records.delete(oldestKey);
    }
  }
}

function progressKey(planId: string, agentId: AgentId): string {
  assertNonEmpty(planId, 'planId');
  return `${agentId}:${planId}`;
}

function cloneProgress(progress: BranchPlanProgress): BranchPlanProgress {
  return {
    planId: progress.planId,
    agentId: progress.agentId,
    completedSubtaskIds: [...progress.completedSubtaskIds],
    blockedSubtasks: progress.blockedSubtasks.map((blocked) => ({
      subtaskId: blocked.subtaskId,
      reason: blocked.reason,
      blockedAt: blocked.blockedAt,
    })),
    updatedAt: progress.updatedAt,
  };
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
