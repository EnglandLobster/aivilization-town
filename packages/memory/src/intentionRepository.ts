import type { AgentId } from '@aivilization/sim-core';
import {
  createEmptyAgentIntentionState,
  setLongHorizonObjective,
  upsertScheduledIntentions,
  type AgentIntentionState,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './intentions';

export type AgentIntentionRepository = {
  readonly getOrCreate: (agentId: AgentId) => Promise<AgentIntentionState>;
  readonly save: (state: AgentIntentionState) => Promise<void>;
  readonly setObjective: (
    agentId: AgentId,
    objective: LongHorizonObjective,
  ) => Promise<AgentIntentionState>;
  readonly upsertScheduledIntentions: (
    agentId: AgentId,
    scheduledIntentions: readonly ScheduledIntention[],
  ) => Promise<AgentIntentionState>;
};

export class InMemoryAgentIntentionRepository implements AgentIntentionRepository {
  private readonly states = new Map<AgentId, AgentIntentionState>();

  getOrCreate(agentId: AgentId): Promise<AgentIntentionState> {
    const existing = this.states.get(agentId);
    if (existing !== undefined) {
      return Promise.resolve(cloneState(existing));
    }

    const state = createEmptyAgentIntentionState(agentId);
    this.states.set(agentId, cloneState(state));
    return Promise.resolve(state);
  }

  save(state: AgentIntentionState): Promise<void> {
    this.states.set(state.agentId, cloneState(state));
    return Promise.resolve();
  }

  async setObjective(
    agentId: AgentId,
    objective: LongHorizonObjective,
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = setLongHorizonObjective(current, objective);
    await this.save(updated);
    return updated;
  }

  async upsertScheduledIntentions(
    agentId: AgentId,
    scheduledIntentions: readonly ScheduledIntention[],
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = upsertScheduledIntentions(current, scheduledIntentions);
    await this.save(updated);
    return updated;
  }
}

function cloneState(state: AgentIntentionState): AgentIntentionState {
  return {
    agentId: state.agentId,
    ...(state.activeObjective === undefined
      ? {}
      : { activeObjective: cloneObjective(state.activeObjective) }),
    scheduledIntentions: state.scheduledIntentions.map((intention) =>
      cloneScheduledIntention(intention),
    ),
    updatedAt: state.updatedAt,
  };
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
