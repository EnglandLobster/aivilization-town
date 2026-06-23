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
  readonly scheduledIntentions: readonly ScheduledIntention[];
  readonly updatedAt: SimulationTimestamp;
};

export function createEmptyAgentIntentionState(agentId: AgentId): AgentIntentionState {
  return {
    agentId,
    updatedAt: 0,
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
    scheduledIntentions: [...intentionsById.values()].sort(compareScheduledIntentions),
    updatedAt,
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

function cloneObjective(objective: LongHorizonObjective): LongHorizonObjective {
  return {
    ...objective,
    affinityTags: [...objective.affinityTags],
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
