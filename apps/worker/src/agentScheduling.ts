import {
  hasSelectableSubtasks,
  type ActionSynthesisPolicy,
  type ActionSequenceGenerator,
  type AdaptiveReplanningPolicy,
  type BranchPlanRecord,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
  type CycleActionSimulator,
  type CycleRepairPolicy,
  type CycleSubtaskCompletionPolicy,
  type DomainMicroPlanner,
  type GlobalActionSynthesizer,
  type ReactiveCorrector,
  type SubtaskPrioritizer,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongHorizonObjective,
  LongTermAgentProfile,
  LongTermProfileRepository,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';
import { resolveMemoryRetrievalCandidateLimit } from './memoryContextSelection';
import type { WorkerTickAgentInput } from './tickRunner';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';

export type WorkerAgentRuntimeBinding = {
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
};

export type WorkerAgentRuntimeResolver = (input: {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly activeObjective: LongHorizonObjective;
  readonly planRecord: BranchPlanRecord;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
}) => WorkerAgentRuntimeBinding | undefined | Promise<WorkerAgentRuntimeBinding | undefined>;

export async function buildWorkerTickAgentsFromActivePlans(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly longTermProfileRepository?: LongTermProfileRepository;
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
  readonly resolveRuntime: WorkerAgentRuntimeResolver;
}): Promise<readonly WorkerTickAgentInput[]> {
  validateMemoryRetrievalBudget(input);
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
    if (progress !== undefined && !hasSelectableSubtasks({ plan: planRecord.plan, progress })) {
      continue;
    }

    const longTermProfile =
      input.longTermProfileRepository === undefined
        ? undefined
        : await input.longTermProfileRepository.getOrCreate(agent.agentId);
    const worldDecisionContext = createWorldDecisionContextFromProjection({
      projection: input.projection,
      agentId: agent.agentId,
    });
    const runtime = await input.resolveRuntime({
      agentId: agent.agentId,
      agent,
      projection: input.projection,
      activeObjective,
      planRecord,
      ...(longTermProfile === undefined ? {} : { longTermProfile }),
      worldDecisionContext,
    });
    if (runtime === undefined) {
      continue;
    }

    agents.push({
      agentId: agent.agentId,
      observedStateSummary: summarizeWorldAgentState(agent),
      worldDecisionContext,
      planId: activeObjective.id,
      signals: activeObjective.affinityTags.map((tag) => ({
        key: tag,
        weight: activeObjective.priority,
      })),
      ...(input.memoryRetrievalLimit === undefined
        ? {}
        : { memoryRetrievalLimit: input.memoryRetrievalLimit }),
      ...(input.memoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: input.memoryRetrievalCandidateLimit }),
      microPlanners: runtime.microPlanners,
      ...(runtime.actionSynthesis === undefined
        ? {}
        : { actionSynthesis: runtime.actionSynthesis }),
      ...(runtime.subtaskPrioritizer === undefined
        ? {}
        : { subtaskPrioritizer: runtime.subtaskPrioritizer }),
      ...(runtime.actionSequenceGenerator === undefined
        ? {}
        : { actionSequenceGenerator: runtime.actionSequenceGenerator }),
      ...(runtime.globalSynthesizer === undefined
        ? {}
        : { globalSynthesizer: runtime.globalSynthesizer }),
      ...(runtime.reactiveCorrector === undefined
        ? {}
        : { reactiveCorrector: runtime.reactiveCorrector }),
      simulate: runtime.simulate,
      ...(runtime.repair === undefined ? {} : { repair: runtime.repair }),
      ...(runtime.subtaskCompletion === undefined
        ? {}
        : { subtaskCompletion: runtime.subtaskCompletion }),
      ...(runtime.replanningPolicy === undefined
        ? {}
        : { replanningPolicy: runtime.replanningPolicy }),
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

function validateMemoryRetrievalBudget(input: {
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
}): void {
  if (input.memoryRetrievalLimit === undefined) {
    if (input.memoryRetrievalCandidateLimit !== undefined) {
      throw new Error('memoryRetrievalLimit is required when memoryRetrievalCandidateLimit is set');
    }
    return;
  }
  resolveMemoryRetrievalCandidateLimit({
    memoryRetrievalLimit: input.memoryRetrievalLimit,
    ...(input.memoryRetrievalCandidateLimit === undefined
      ? {}
      : { memoryRetrievalCandidateLimit: input.memoryRetrievalCandidateLimit }),
  });
}
