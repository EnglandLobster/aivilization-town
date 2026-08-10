import type { AgentId } from '@aivilization/sim-core';
import {
  completeLongHorizonObjective,
  createEmptyAgentIntentionState,
  enforceAgentIntentionStateRetention,
  setLongHorizonObjective,
  upsertScheduledIntentions,
  type AgentIntentionState,
  type LongHorizonObjective,
  type LongHorizonObjectiveCompletionReason,
  type ScheduledIntention,
} from './intentions';

export type CompleteLongHorizonObjectiveRequest = {
  readonly objectiveId: string;
  readonly completedAt: number;
  readonly reason: LongHorizonObjectiveCompletionReason;
  readonly planId?: string;
};

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
  readonly completeObjective: (
    agentId: AgentId,
    input: CompleteLongHorizonObjectiveRequest,
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

  async completeObjective(
    agentId: AgentId,
    input: CompleteLongHorizonObjectiveRequest,
  ): Promise<AgentIntentionState> {
    const current = await this.getOrCreate(agentId);
    const updated = completeLongHorizonObjective(current, input);
    await this.save(updated);
    return updated;
  }
}

function cloneState(state: AgentIntentionState): AgentIntentionState {
  return enforceAgentIntentionStateRetention(state);
}
