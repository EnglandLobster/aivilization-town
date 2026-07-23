import {
  hasSelectableSubtasks,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
} from '@aivilization/agent-runtime';
import type { AgentIntentionRepository } from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import { isAgentAvailableForWorldAction, type WorldProjection } from '@aivilization/world';

export type CompletedActiveObjectiveResult = {
  readonly agentId: AgentId;
  readonly objectiveId: string;
  readonly planId: string;
};

export async function completeFinishedActiveObjectives(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository: BranchPlanProgressRepository;
  readonly completedAt: number;
}): Promise<readonly CompletedActiveObjectiveResult[]> {
  const completed: CompletedActiveObjectiveResult[] = [];

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }
    if (!isAgentAvailableForWorldAction(input.projection, agent.agentId)) {
      continue;
    }

    const intentionState = await input.intentionRepository.getOrCreate(agent.agentId);
    const activeObjective = intentionState.activeObjective;
    if (activeObjective === undefined) {
      continue;
    }

    const planRecord = await input.planRepository.get({
      planId: activeObjective.id,
      agentId: agent.agentId,
    });
    const progress = await input.planProgressRepository.get({
      planId: activeObjective.id,
      agentId: agent.agentId,
    });
    if (
      planRecord === undefined ||
      progress === undefined ||
      hasSelectableSubtasks({ plan: planRecord.plan, progress })
    ) {
      continue;
    }

    await input.intentionRepository.completeObjective(agent.agentId, {
      objectiveId: activeObjective.id,
      completedAt: input.completedAt,
      reason: 'plan-completed',
      planId: activeObjective.id,
    });
    completed.push({
      agentId: agent.agentId,
      objectiveId: activeObjective.id,
      planId: activeObjective.id,
    });
  }

  return completed;
}
