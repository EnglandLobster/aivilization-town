import type { AgentId } from '@aivilization/sim-core';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createBranchPlanProgress, type BranchPlanProgress } from './planProgress';

export type BranchPlanProgressRepository = {
  readonly getOrCreate: (input: {
    readonly planId: string;
    readonly agentId: AgentId;
    readonly createdAt: number;
  }) => Promise<BranchPlanProgress>;
  readonly save: (progress: BranchPlanProgress) => Promise<void>;
};

export class InMemoryBranchPlanProgressRepository implements BranchPlanProgressRepository {
  private readonly progressByKey = new Map<string, BranchPlanProgress>();

  getOrCreate(input: {
    readonly planId: string;
    readonly agentId: AgentId;
    readonly createdAt: number;
  }): Promise<BranchPlanProgress> {
    const key = progressKey(input.planId, input.agentId);
    const existing = this.progressByKey.get(key);
    if (existing !== undefined) {
      return Promise.resolve(cloneProgress(existing));
    }

    const progress = createBranchPlanProgress(input);
    this.progressByKey.set(key, cloneProgress(progress));
    return Promise.resolve(progress);
  }

  save(progress: BranchPlanProgress): Promise<void> {
    this.progressByKey.set(progressKey(progress.planId, progress.agentId), cloneProgress(progress));
    return Promise.resolve();
  }
}

export class FileBranchPlanProgressRepository implements BranchPlanProgressRepository {
  private readonly progressPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.progressPath = join(input.rootDir, 'branch-plan-progress.jsonl');
    ensureFile(this.progressPath, input.rootDir);
  }

  async getOrCreate(input: {
    readonly planId: string;
    readonly agentId: AgentId;
    readonly createdAt: number;
  }): Promise<BranchPlanProgress> {
    const existing = this.getLatestProgress(input.planId, input.agentId);
    if (existing !== undefined) {
      return cloneProgress(existing);
    }

    const progress = createBranchPlanProgress(input);
    await this.save(progress);
    return progress;
  }

  save(progress: BranchPlanProgress): Promise<void> {
    appendJsonLines(this.progressPath, [cloneProgress(progress)]);
    return Promise.resolve();
  }

  private getLatestProgress(planId: string, agentId: AgentId): BranchPlanProgress | undefined {
    return readJsonLines<BranchPlanProgress>(this.progressPath)
      .filter((progress) => progress.planId === planId && progress.agentId === agentId)
      .at(-1);
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
