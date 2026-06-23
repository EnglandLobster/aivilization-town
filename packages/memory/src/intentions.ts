import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';

export type LongHorizonObjectiveSource = 'human' | 'agent' | 'system';

export type ScheduledIntentionStatus = 'planned' | 'active' | 'completed' | 'cancelled';

export type LongHorizonObjective = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly statement: string;
  readonly priority: number;
  readonly source: LongHorizonObjectiveSource;
  readonly affinityTags: readonly string[];
  readonly createdAt: SimulationTimestamp;
  readonly updatedAt: SimulationTimestamp;
};

export type LongHorizonObjectiveCompletionReason = 'plan-completed';

export type CompletedLongHorizonObjective = {
  readonly objective: LongHorizonObjective;
  readonly completedAt: SimulationTimestamp;
  readonly reason: LongHorizonObjectiveCompletionReason;
  readonly planId?: string;
};

export type ScheduledIntention = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly objectiveId?: string;
  readonly branchId?: string;
  readonly subtaskId?: string;
  readonly description: string;
  readonly priority: number;
  readonly startsAt: SimulationTimestamp;
  readonly endsAt: SimulationTimestamp;
  readonly status: ScheduledIntentionStatus;
  readonly affinityTags: readonly string[];
  readonly createdAt: SimulationTimestamp;
  readonly updatedAt: SimulationTimestamp;
};

export type AgentIntentionState = {
  readonly agentId: AgentId;
  readonly activeObjective?: LongHorizonObjective;
  readonly completedObjectives: readonly CompletedLongHorizonObjective[];
  readonly scheduledIntentions: readonly ScheduledIntention[];
  readonly updatedAt: SimulationTimestamp;
};

export function createEmptyAgentIntentionState(agentId: AgentId): AgentIntentionState {
  return {
    agentId,
    updatedAt: 0,
    completedObjectives: [],
    scheduledIntentions: [],
  };
}

export function setLongHorizonObjective(
  state: AgentIntentionState,
  objective: LongHorizonObjective,
): AgentIntentionState {
  assertSameAgent(state.agentId, objective.agentId, 'objective');
  assertObjective(objective);

  return {
    agentId: state.agentId,
    activeObjective: cloneObjective(objective),
    completedObjectives: state.completedObjectives.map((completed) =>
      cloneCompletedObjective(completed),
    ),
    scheduledIntentions: state.scheduledIntentions.map((intention) =>
      cloneScheduledIntention(intention),
    ),
    updatedAt: Math.max(state.updatedAt, objective.updatedAt),
  };
}

export function upsertScheduledIntentions(
  state: AgentIntentionState,
  scheduledIntentions: readonly ScheduledIntention[],
): AgentIntentionState {
  const intentionsById = new Map<string, ScheduledIntention>();
  for (const intention of state.scheduledIntentions) {
    intentionsById.set(intention.id, cloneScheduledIntention(intention));
  }

  let updatedAt = state.updatedAt;
  for (const intention of scheduledIntentions) {
    assertSameAgent(state.agentId, intention.agentId, 'scheduled intention');
    assertScheduledIntention(intention);
    intentionsById.set(intention.id, cloneScheduledIntention(intention));
    updatedAt = Math.max(updatedAt, intention.updatedAt);
  }

  return {
    agentId: state.agentId,
    ...(state.activeObjective === undefined
      ? {}
      : { activeObjective: cloneObjective(state.activeObjective) }),
    completedObjectives: state.completedObjectives.map((completed) =>
      cloneCompletedObjective(completed),
    ),
    scheduledIntentions: [...intentionsById.values()].sort(compareScheduledIntentions),
    updatedAt,
  };
}

export function completeLongHorizonObjective(
  state: AgentIntentionState,
  input: {
    readonly objectiveId: string;
    readonly completedAt: SimulationTimestamp;
    readonly reason: LongHorizonObjectiveCompletionReason;
    readonly planId?: string;
  },
): AgentIntentionState {
  assertNonEmpty(input.objectiveId, 'objectiveId');
  assertFiniteNumber(input.completedAt, 'completedAt');
  assertOptionalNonEmpty(input.planId, 'planId');

  const activeObjective = state.activeObjective;
  if (activeObjective === undefined || activeObjective.id !== input.objectiveId) {
    throw new Error(`active objective ${input.objectiveId} is required before completion`);
  }

  const completedByObjectiveId = new Map<string, CompletedLongHorizonObjective>();
  for (const completed of state.completedObjectives) {
    completedByObjectiveId.set(completed.objective.id, cloneCompletedObjective(completed));
  }
  completedByObjectiveId.set(input.objectiveId, {
    objective: cloneObjective(activeObjective),
    completedAt: input.completedAt,
    reason: input.reason,
    ...(input.planId === undefined ? {} : { planId: input.planId }),
  });

  return {
    agentId: state.agentId,
    completedObjectives: [...completedByObjectiveId.values()].sort(compareCompletedObjectives),
    scheduledIntentions: state.scheduledIntentions
      .map((intention) =>
        intention.objectiveId === input.objectiveId && !isTerminalScheduledIntention(intention)
          ? {
              ...cloneScheduledIntention(intention),
              status: 'completed' as const,
              updatedAt: Math.max(intention.updatedAt, input.completedAt),
            }
          : cloneScheduledIntention(intention),
      )
      .sort(compareScheduledIntentions),
    updatedAt: Math.max(state.updatedAt, input.completedAt),
  };
}

export function selectActiveScheduledIntentions(
  state: AgentIntentionState,
  at: SimulationTimestamp,
): readonly ScheduledIntention[] {
  assertFiniteNumber(at, 'active schedule timestamp');

  return state.scheduledIntentions
    .filter((intention) => isSelectableAt(intention, at))
    .map((intention) => cloneScheduledIntention(intention));
}

function isSelectableAt(intention: ScheduledIntention, at: SimulationTimestamp): boolean {
  return (
    (intention.status === 'planned' || intention.status === 'active') &&
    intention.startsAt <= at &&
    at < intention.endsAt
  );
}

function isTerminalScheduledIntention(intention: ScheduledIntention): boolean {
  return intention.status === 'completed' || intention.status === 'cancelled';
}

function assertObjective(objective: LongHorizonObjective): void {
  assertNonEmpty(objective.id, 'objective id');
  assertNonEmpty(objective.statement, `objective ${objective.id} statement`);
  assertFiniteNumber(objective.priority, `objective ${objective.id} priority`);
  assertFiniteNumber(objective.createdAt, `objective ${objective.id} createdAt`);
  assertFiniteNumber(objective.updatedAt, `objective ${objective.id} updatedAt`);
  assertAffinityTags(objective.affinityTags, `objective ${objective.id}`);
}

function assertScheduledIntention(intention: ScheduledIntention): void {
  assertNonEmpty(intention.id, 'scheduled intention id');
  assertNonEmpty(intention.description, `scheduled intention ${intention.id} description`);
  assertOptionalNonEmpty(intention.objectiveId, `scheduled intention ${intention.id} objectiveId`);
  assertOptionalNonEmpty(intention.branchId, `scheduled intention ${intention.id} branchId`);
  assertOptionalNonEmpty(intention.subtaskId, `scheduled intention ${intention.id} subtaskId`);
  assertFiniteNumber(intention.priority, `scheduled intention ${intention.id} priority`);
  assertFiniteNumber(intention.startsAt, `scheduled intention ${intention.id} startsAt`);
  assertFiniteNumber(intention.endsAt, `scheduled intention ${intention.id} endsAt`);
  assertFiniteNumber(intention.createdAt, `scheduled intention ${intention.id} createdAt`);
  assertFiniteNumber(intention.updatedAt, `scheduled intention ${intention.id} updatedAt`);
  if (intention.endsAt <= intention.startsAt) {
    throw new Error(`scheduled intention ${intention.id} endsAt must be greater than startsAt`);
  }
  assertAffinityTags(intention.affinityTags, `scheduled intention ${intention.id}`);
}

function assertAffinityTags(tags: readonly string[], name: string): void {
  if (tags.length === 0) {
    throw new Error(`${name} affinityTags must not be empty`);
  }
  for (const tag of tags) {
    assertNonEmpty(tag, `${name} affinity tag`);
  }
}

function assertSameAgent(agentId: AgentId, incomingAgentId: AgentId, name: string): void {
  if (incomingAgentId !== agentId) {
    throw new Error(
      `${name} agent ${incomingAgentId} does not match intention state agent ${agentId}`,
    );
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertOptionalNonEmpty(value: string | undefined, name: string): void {
  if (value !== undefined) {
    assertNonEmpty(value, name);
  }
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function compareScheduledIntentions(left: ScheduledIntention, right: ScheduledIntention): number {
  if (left.startsAt !== right.startsAt) {
    return left.startsAt - right.startsAt;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id.localeCompare(right.id);
}

function compareCompletedObjectives(
  left: CompletedLongHorizonObjective,
  right: CompletedLongHorizonObjective,
): number {
  if (left.completedAt !== right.completedAt) {
    return left.completedAt - right.completedAt;
  }
  return left.objective.id.localeCompare(right.objective.id);
}

function cloneObjective(objective: LongHorizonObjective): LongHorizonObjective {
  return {
    ...objective,
    affinityTags: [...objective.affinityTags],
  };
}

function cloneCompletedObjective(completed: CompletedLongHorizonObjective): CompletedLongHorizonObjective {
  return {
    objective: cloneObjective(completed.objective),
    completedAt: completed.completedAt,
    reason: completed.reason,
    ...(completed.planId === undefined ? {} : { planId: completed.planId }),
  };
}

function cloneScheduledIntention(intention: ScheduledIntention): ScheduledIntention {
  return {
    id: intention.id,
    agentId: intention.agentId,
    ...(intention.objectiveId === undefined ? {} : { objectiveId: intention.objectiveId }),
    ...(intention.branchId === undefined ? {} : { branchId: intention.branchId }),
    ...(intention.subtaskId === undefined ? {} : { subtaskId: intention.subtaskId }),
    description: intention.description,
    priority: intention.priority,
    startsAt: intention.startsAt,
    endsAt: intention.endsAt,
    status: intention.status,
    affinityTags: [...intention.affinityTags],
    createdAt: intention.createdAt,
    updatedAt: intention.updatedAt,
  };
}
