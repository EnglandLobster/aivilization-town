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
  type ReplanningDecider,
  type SocialDialogueGenerator,
  type SocialSignalExtractor,
  type SubtaskPrioritizer,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongHorizonObjective,
  LongTermAgentProfile,
  LongTermProfileRepository,
} from '@aivilization/memory';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import {
  isAgentAvailableForWorldAction,
  type WorldAgentState,
  type WorldProjection,
} from '@aivilization/world';
import { summarizeObservedAgentState } from './agentStateSummary';
import type { EducationOpportunityCostConfig } from './educationOpportunityCost';
import type { LocalSimulationSocietyDirectory } from './localSimulationSocietyDirectory';
import { resolveMemoryRetrievalCandidateLimit } from './memoryContextSelection';
import type { WorkerTickAgentInput } from './tickRunner';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import {
  createWorldDecisionContextFromProjection,
  type WorldDecisionMarketOverride,
} from './worldDecisionContext';

export type WorkerAgentRuntimeBinding = {
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly socialSignalExtractor?: SocialSignalExtractor;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
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
  readonly marketOverride?: WorldDecisionMarketOverride;
}) => WorkerAgentRuntimeBinding | undefined | Promise<WorkerAgentRuntimeBinding | undefined>;

export type WorkerActivePlanAgentSchedulingInput = {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly longTermProfileRepository?: LongTermProfileRepository;
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
  readonly policies?: WorldCommandPolicySource;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
  readonly societyDirectory?: LocalSimulationSocietyDirectory;
  readonly marketOverride?: WorldDecisionMarketOverride;
  readonly resolveRuntime: WorkerAgentRuntimeResolver;
};

export async function buildWorkerTickAgentsFromActivePlans(
  input: WorkerActivePlanAgentSchedulingInput,
): Promise<readonly WorkerTickAgentInput[]> {
  validateMemoryRetrievalBudget(input);
  const agents: WorkerTickAgentInput[] = [];
  const worldDecisionPolicies =
    input.policies === undefined
      ? undefined
      : resolveWorldCommandPolicies({
          policies: input.policies,
          projection: input.projection,
        });

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const scheduled = await buildWorkerTickAgentFromActivePlanWithPolicies({
      input,
      agentId: asAgentId(agentId),
      worldDecisionPolicies,
    });
    if (scheduled !== undefined) agents.push(scheduled);
  }

  return agents;
}

export async function buildWorkerTickAgentFromActivePlan(
  input: WorkerActivePlanAgentSchedulingInput & { readonly agentId: AgentId },
): Promise<WorkerTickAgentInput | undefined> {
  validateMemoryRetrievalBudget(input);
  const worldDecisionPolicies =
    input.policies === undefined
      ? undefined
      : resolveWorldCommandPolicies({
          policies: input.policies,
          projection: input.projection,
        });
  return buildWorkerTickAgentFromActivePlanWithPolicies({
    input,
    agentId: input.agentId,
    worldDecisionPolicies,
  });
}

async function buildWorkerTickAgentFromActivePlanWithPolicies(input: {
  readonly input: WorkerActivePlanAgentSchedulingInput;
  readonly agentId: AgentId;
  readonly worldDecisionPolicies: ReturnType<typeof resolveWorldCommandPolicies> | undefined;
}): Promise<WorkerTickAgentInput | undefined> {
  const scheduling = input.input;
  const agent = scheduling.projection.agents[input.agentId];
  if (
    agent === undefined ||
    !isAgentAvailableForWorldAction(scheduling.projection, agent.agentId)
  ) {
    return undefined;
  }

  const intentionState = await scheduling.intentionRepository.getOrCreate(agent.agentId);
  const activeObjective = intentionState.activeObjective;
  if (activeObjective === undefined) {
    return undefined;
  }

  const planRecord = await scheduling.planRepository.get({
    planId: activeObjective.id,
    agentId: agent.agentId,
  });
  if (planRecord === undefined) {
    return undefined;
  }
  const progress =
    scheduling.planProgressRepository === undefined
      ? undefined
      : await scheduling.planProgressRepository.get({
          planId: activeObjective.id,
          agentId: agent.agentId,
        });
  if (progress !== undefined && !hasSelectableSubtasks({ plan: planRecord.plan, progress })) {
    return undefined;
  }

  const longTermProfile =
    scheduling.longTermProfileRepository === undefined
      ? undefined
      : await scheduling.longTermProfileRepository.getOrCreate(agent.agentId);
  const worldDecisionContext = createWorldDecisionContextFromProjection({
    projection: scheduling.projection,
    agentId: agent.agentId,
    ...(input.worldDecisionPolicies === undefined ? {} : { policies: input.worldDecisionPolicies }),
    ...(scheduling.educationOpportunityCost === undefined
      ? {}
      : { educationOpportunityCost: scheduling.educationOpportunityCost }),
    ...(scheduling.societyDirectory === undefined
      ? {}
      : { societyDirectory: scheduling.societyDirectory }),
    ...(scheduling.marketOverride === undefined
      ? {}
      : { marketOverride: scheduling.marketOverride }),
  });
  const runtime = await scheduling.resolveRuntime({
    agentId: agent.agentId,
    agent,
    projection: scheduling.projection,
    activeObjective,
    planRecord,
    ...(longTermProfile === undefined ? {} : { longTermProfile }),
    ...(scheduling.marketOverride === undefined
      ? {}
      : { marketOverride: scheduling.marketOverride }),
    worldDecisionContext,
  });
  if (runtime === undefined) {
    return undefined;
  }

  return {
    agentId: agent.agentId,
    observedStateSummary: summarizeObservedAgentState(agent),
    worldDecisionContext,
    planId: activeObjective.id,
    ...(progress === undefined ? {} : { progress }),
    signals: activeObjective.affinityTags.map((tag) => ({
      key: tag,
      weight: activeObjective.priority,
    })),
    ...(scheduling.memoryRetrievalLimit === undefined
      ? {}
      : { memoryRetrievalLimit: scheduling.memoryRetrievalLimit }),
    ...(scheduling.memoryRetrievalCandidateLimit === undefined
      ? {}
      : { memoryRetrievalCandidateLimit: scheduling.memoryRetrievalCandidateLimit }),
    microPlanners: runtime.microPlanners,
    ...(runtime.actionSynthesis === undefined ? {} : { actionSynthesis: runtime.actionSynthesis }),
    ...(runtime.subtaskPrioritizer === undefined
      ? {}
      : { subtaskPrioritizer: runtime.subtaskPrioritizer }),
    ...(runtime.actionSequenceGenerator === undefined
      ? {}
      : { actionSequenceGenerator: runtime.actionSequenceGenerator }),
    ...(runtime.socialDialogueGenerator === undefined
      ? {}
      : { socialDialogueGenerator: runtime.socialDialogueGenerator }),
    ...(runtime.socialSignalExtractor === undefined
      ? {}
      : { socialSignalExtractor: runtime.socialSignalExtractor }),
    ...(runtime.globalSynthesizer === undefined
      ? {}
      : { globalSynthesizer: runtime.globalSynthesizer }),
    ...(runtime.reactiveCorrector === undefined
      ? {}
      : { reactiveCorrector: runtime.reactiveCorrector }),
    ...(runtime.replanningDecider === undefined
      ? {}
      : { replanningDecider: runtime.replanningDecider }),
    simulate: runtime.simulate,
    ...(runtime.repair === undefined ? {} : { repair: runtime.repair }),
    ...(runtime.subtaskCompletion === undefined
      ? {}
      : { subtaskCompletion: runtime.subtaskCompletion }),
    ...(runtime.replanningPolicy === undefined
      ? {}
      : { replanningPolicy: runtime.replanningPolicy }),
  };
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
