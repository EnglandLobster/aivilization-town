import {
  hasSelectableSubtasks,
  type BranchPlanRecord,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
  type CycleActionSimulator,
  type CycleRepairPolicy,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type { AgentIntentionRepository, LongHorizonObjective } from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';
import type { WorkerTickAgentInput } from './tickRunner';

export type WorkerAgentRuntimeBinding = {
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
};

export type WorkerAgentRuntimeResolver = (input: {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly activeObjective: LongHorizonObjective;
  readonly planRecord: BranchPlanRecord;
}) => WorkerAgentRuntimeBinding | undefined | Promise<WorkerAgentRuntimeBinding | undefined>;

export async function buildWorkerTickAgentsFromActivePlans(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly resolveRuntime: WorkerAgentRuntimeResolver;
}): Promise<readonly WorkerTickAgentInput[]> {
  const agents: WorkerTickAgentInput[] = [];

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
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
    if (planRecord === undefined) {
      continue;
    }
    const progress =
      input.planProgressRepository === undefined
        ? undefined
        : await input.planProgressRepository.get({
            planId: activeObjective.id,
            agentId: agent.agentId,
          });
    if (
      progress !== undefined &&
      !hasSelectableSubtasks({ plan: planRecord.plan, progress })
    ) {
      continue;
    }

    const runtime = await input.resolveRuntime({
      agentId: agent.agentId,
      agent,
      projection: input.projection,
      activeObjective,
      planRecord,
    });
    if (runtime === undefined) {
      continue;
    }

    agents.push({
      agentId: agent.agentId,
      observedStateSummary: summarizeWorldAgentState(agent),
      planId: activeObjective.id,
      signals: activeObjective.affinityTags.map((tag) => ({
        key: tag,
        weight: activeObjective.priority,
      })),
      microPlanners: runtime.microPlanners,
      simulate: runtime.simulate,
      ...(runtime.repair === undefined ? {} : { repair: runtime.repair }),
    });
  }

  return agents;
}

function summarizeWorldAgentState(agent: WorldAgentState): string {
  return [
    `energy=${agent.physiology.energy}`,
    `satiety=${agent.physiology.satiety}`,
    `health=${agent.physiology.health}`,
    `education=${agent.educationScore}`,
    `balance=${agent.balance}`,
    `residentialTier=${agent.residentialTier}`,
    `job=${agent.job ?? 'unemployed'}`,
    `inventory=${summarizeInventory(agent.inventory)}`,
  ].join(' ');
}

function summarizeInventory(inventory: Readonly<Record<string, number>>): string {
  const entries = Object.entries(inventory)
    .filter(([, quantity]) => quantity !== 0)
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return 'empty';
  }

  return entries.map(([itemName, quantity]) => `${itemName}:${quantity}`).join(',');
}
