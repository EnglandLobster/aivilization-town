import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';

export type BlockedSubtask = {
  readonly subtaskId: string;
  readonly reason: string;
  readonly blockedAt: SimulationTimestamp;
};

export type BranchPlanProgress = {
  readonly planId: string;
  readonly agentId: AgentId;
  readonly completedSubtaskIds: readonly string[];
  readonly blockedSubtasks: readonly BlockedSubtask[];
  readonly updatedAt: SimulationTimestamp;
};

export function createBranchPlanProgress(input: {
  readonly planId: string;
  readonly agentId: AgentId;
  readonly createdAt: SimulationTimestamp;
}): BranchPlanProgress {
  assertNonEmpty(input.planId, 'planId');
  assertFiniteNumber(input.createdAt, 'createdAt');

  return {
    planId: input.planId,
    agentId: input.agentId,
    completedSubtaskIds: [],
    blockedSubtasks: [],
    updatedAt: input.createdAt,
  };
}

export function markSubtaskCompleted(
  progress: BranchPlanProgress,
  input: { readonly subtaskId: string; readonly completedAt: SimulationTimestamp },
): BranchPlanProgress {
  assertNonEmpty(input.subtaskId, 'subtaskId');
  assertFiniteNumber(input.completedAt, 'completedAt');

  const completedSubtaskIds = new Set(progress.completedSubtaskIds);
  completedSubtaskIds.add(input.subtaskId);

  return {
    ...cloneProgress(progress),
    completedSubtaskIds: [...completedSubtaskIds].sort(),
    updatedAt: Math.max(progress.updatedAt, input.completedAt),
  };
}

export function markSubtaskBlocked(
  progress: BranchPlanProgress,
  input: {
    readonly subtaskId: string;
    readonly reason: string;
    readonly blockedAt: SimulationTimestamp;
  },
): BranchPlanProgress {
  assertNonEmpty(input.subtaskId, 'subtaskId');
  assertNonEmpty(input.reason, 'reason');
  assertFiniteNumber(input.blockedAt, 'blockedAt');

  const blockedSubtasks = new Map<string, BlockedSubtask>();
  for (const blocked of progress.blockedSubtasks) {
    blockedSubtasks.set(blocked.subtaskId, cloneBlockedSubtask(blocked));
  }
  blockedSubtasks.set(input.subtaskId, {
    subtaskId: input.subtaskId,
    reason: input.reason,
    blockedAt: input.blockedAt,
  });

  return {
    ...cloneProgress(progress),
    blockedSubtasks: [...blockedSubtasks.values()].sort(compareBlockedSubtasks),
    updatedAt: Math.max(progress.updatedAt, input.blockedAt),
  };
}

function cloneProgress(progress: BranchPlanProgress): BranchPlanProgress {
  return {
    planId: progress.planId,
    agentId: progress.agentId,
    completedSubtaskIds: [...progress.completedSubtaskIds],
    blockedSubtasks: progress.blockedSubtasks.map((blocked) => cloneBlockedSubtask(blocked)),
    updatedAt: progress.updatedAt,
  };
}

function cloneBlockedSubtask(blocked: BlockedSubtask): BlockedSubtask {
  return {
    subtaskId: blocked.subtaskId,
    reason: blocked.reason,
    blockedAt: blocked.blockedAt,
  };
}

function compareBlockedSubtasks(left: BlockedSubtask, right: BlockedSubtask): number {
  return left.subtaskId.localeCompare(right.subtaskId);
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
