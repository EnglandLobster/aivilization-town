import type { IntentionInfluenceScore } from './intentionInfluence';
import type { MemoryInfluenceScore } from './memoryInfluence';
import type { ProfileInfluenceScore } from './profileInfluence';

export type PlannerSubtask = {
  readonly id: string;
  readonly description: string;
  readonly basePriority: number;
  readonly signalKeys?: readonly string[];
  readonly intentionAffinityTags?: readonly string[];
  readonly memoryAffinityTags?: readonly string[];
  readonly profileAffinityTags?: readonly string[];
};

export type PlannerBranch = {
  readonly id: string;
  readonly objective: string;
  readonly subtasks: readonly PlannerSubtask[];
};

export type BranchPlan = {
  readonly objective: string;
  readonly branches: readonly PlannerBranch[];
};

export type ContextSignal = {
  readonly key: string;
  readonly weight: number;
};

export type PrioritizedSubtask = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly description: string;
  readonly score: number;
};

export function createBranchPlan(input: {
  readonly objective: string;
  readonly branches: readonly PlannerBranch[];
}): BranchPlan {
  assertNonEmpty(input.objective, 'objective');
  if (input.branches.length === 0) {
    throw new Error('branch plan requires at least one branch');
  }

  const branchIds = new Set<string>();
  const branches = input.branches.map((branch) => {
    assertNonEmpty(branch.id, 'branch id');
    if (branchIds.has(branch.id)) {
      throw new Error(`duplicate branch id ${branch.id}`);
    }
    branchIds.add(branch.id);
    assertNonEmpty(branch.objective, `branch ${branch.id} objective`);
    if (branch.subtasks.length === 0) {
      throw new Error(`branch ${branch.id} requires at least one subtask`);
    }

    const subtaskIds = new Set<string>();
    const subtasks = branch.subtasks.map((subtask) => {
      assertNonEmpty(subtask.id, 'subtask id');
      if (subtaskIds.has(subtask.id)) {
        throw new Error(`duplicate subtask id ${subtask.id} in branch ${branch.id}`);
      }
      subtaskIds.add(subtask.id);
      assertNonEmpty(subtask.description, `subtask ${subtask.id} description`);
      assertFiniteNumber(subtask.basePriority, `subtask ${subtask.id} basePriority`);

      return {
        id: subtask.id,
        description: subtask.description,
        basePriority: subtask.basePriority,
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
      };
    });

    return {
      id: branch.id,
      objective: branch.objective,
      subtasks,
    };
  });

  return {
    objective: input.objective,
    branches,
  };
}

export function selectPrioritizedSubtask(input: {
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly intentionInfluence?: Readonly<Record<string, IntentionInfluenceScore>>;
  readonly memoryInfluence?: Readonly<Record<string, MemoryInfluenceScore>>;
  readonly profileInfluence?: Readonly<Record<string, ProfileInfluenceScore>>;
}): PrioritizedSubtask {
  const signalWeights = new Map<string, number>();
  for (const signal of input.signals) {
    assertNonEmpty(signal.key, 'signal key');
    assertFiniteNumber(signal.weight, `signal ${signal.key} weight`);
    signalWeights.set(signal.key, (signalWeights.get(signal.key) ?? 0) + signal.weight);
  }

  const candidates = input.plan.branches.flatMap((branch) =>
    branch.subtasks.map((subtask) => ({
      branchId: branch.id,
      subtaskId: subtask.id,
      description: subtask.description,
      score:
        subtask.basePriority +
        (subtask.signalKeys ?? []).reduce(
          (total, signalKey) => total + (signalWeights.get(signalKey) ?? 0),
          0,
        ) +
        (input.intentionInfluence?.[subtask.id]?.score ?? 0) +
        (input.memoryInfluence?.[subtask.id]?.score ?? 0) +
        (input.profileInfluence?.[subtask.id]?.score ?? 0),
    })),
  );

  const selected = candidates.sort(comparePrioritizedSubtasks)[0];
  if (selected === undefined) {
    throw new Error('branch plan produced no candidate subtasks');
  }

  return selected;
}

function comparePrioritizedSubtasks(left: PrioritizedSubtask, right: PrioritizedSubtask): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.branchId !== right.branchId) {
    return left.branchId.localeCompare(right.branchId);
  }
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
