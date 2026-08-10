import {
  compileStrategicObjectiveToBranchPlan,
  createDeterministicSocialDialogueGenerator,
  createDeterministicGlobalActionSynthesizer,
  type ActionSequenceGenerator,
  type AdaptiveReplanningPolicy,
  type GlobalActionSynthesizer,
  type ReactiveCorrector,
  type ReplanningDecider,
  type SocialDialogueGenerator,
  type StrategicPlanCompiler,
  type SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import type { ObjectiveRenewalTrace } from '@aivilization/observability';
import { buildWorkerTickAgentsFromActivePlans } from './agentScheduling';
import type { WorldStateActionSynthesisPolicyConfig } from './actionSynthesisPolicy';
import { createCanonicalWorkerRuntimeResolver } from './canonicalWorkerRuntimeResolver';
import type { CanonicalDomainRuntimeConfig } from './canonicalDomainRuntimes';
import { completeFinishedActiveObjectives } from './objectiveLifecycle';
import {
  renewMissingActiveObjectives,
  type AutonomousObjectiveProposer,
  type ObjectiveRenewalDecisionTrace,
} from './objectiveRenewal';
import type { LocalWorldRuntimeAgentProvider } from './localRuntimeStep';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';
import { renewActiveStrategicPlansForMajorContextShifts } from './strategicPlanRenewal';
import { supersedeActiveAutonomousObjectivesForMajorContextShifts } from './strategicPlanRenewal';
import {
  CANONICAL_OPPORTUNITY_COST_ACTION_SYNTHESIS_CONFIG,
  type EducationOpportunityCostConfig,
} from './educationOpportunityCost';

const DEFAULT_CANONICAL_AGENT_MEMORY_RETRIEVAL_LIMIT = 8;

export type CanonicalLocalRuntimeAgentProviderConfig = {
  readonly policies: WorldCommandPolicySource;
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly actionSynthesis?: WorldStateActionSynthesisPolicyConfig | false;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
  readonly objectiveProposer?: AutonomousObjectiveProposer;
};

export function createCanonicalLocalRuntimeAgentProvider(
  input: CanonicalLocalRuntimeAgentProviderConfig,
): LocalWorldRuntimeAgentProvider {
  const memoryRetrievalLimit =
    input.memoryRetrievalLimit ?? DEFAULT_CANONICAL_AGENT_MEMORY_RETRIEVAL_LIMIT;
  assertPositiveInteger(memoryRetrievalLimit, 'memoryRetrievalLimit');
  const educationOpportunityCost = resolveEducationOpportunityCostConfig(input);
  const globalSynthesizer = input.globalSynthesizer ?? createDeterministicGlobalActionSynthesizer();
  const socialDialogueGenerator =
    input.socialDialogueGenerator ?? createDeterministicSocialDialogueGenerator();
  const strategicPlanCompiler =
    input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;

  return async ({ storage, projection, issuedAt, societyDirectory, marketOverride }) => {
    await completeFinishedActiveObjectives({
      projection,
      intentionRepository: storage.intentionRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      completedAt: issuedAt,
    });
    await supersedeActiveAutonomousObjectivesForMajorContextShifts({
      projection,
      policies: input.policies,
      intentionRepository: storage.intentionRepository,
      longTermProfileRepository: storage.longTermProfileRepository,
      planRepository: storage.planRepository,
      issuedAt,
      educationOpportunityCost,
      ...(societyDirectory === undefined ? {} : { societyDirectory }),
    });
    await renewMissingActiveObjectives({
      projection,
      policies: input.policies,
      intentionRepository: storage.intentionRepository,
      longTermProfileRepository: storage.longTermProfileRepository,
      shortTermMemoryRepository: storage.shortTermMemoryRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      issuedAt,
      memoryRetrievalLimit,
      educationOpportunityCost,
      ...(input.objectiveProposer === undefined
        ? {}
        : { objectiveProposer: input.objectiveProposer }),
      objectiveRenewalTraceSink: {
        record: (trace) =>
          storage.objectiveRenewalTraceRepository.record(
            createCanonicalObjectiveRenewalTrace({
              simulationId: storage.partition.simulationId,
              partitionKey: storage.partition.partitionKey,
              trace,
            }),
          ),
      },
      strategicPlanCompiler,
    });
    await renewActiveStrategicPlansForMajorContextShifts({
      projection,
      policies: input.policies,
      intentionRepository: storage.intentionRepository,
      longTermProfileRepository: storage.longTermProfileRepository,
      shortTermMemoryRepository: storage.shortTermMemoryRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      strategicPlanCompiler,
      issuedAt,
      memoryRetrievalLimit,
      educationOpportunityCost,
    });

    return buildWorkerTickAgentsFromActivePlans({
      projection,
      intentionRepository: storage.intentionRepository,
      planRepository: storage.planRepository,
      planProgressRepository: storage.planProgressRepository,
      longTermProfileRepository: storage.longTermProfileRepository,
      memoryRetrievalLimit,
      ...(input.memoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: input.memoryRetrievalCandidateLimit }),
      policies: input.policies,
      educationOpportunityCost,
      ...(marketOverride === undefined ? {} : { marketOverride }),
      resolveRuntime: createCanonicalWorkerRuntimeResolver({
        simulationId: storage.partition.simulationId,
        policies: input.policies,
        issuedAt,
        commandIdPrefix: `${storage.partition.partitionKey}:canonical-agent-provider:${issuedAt}`,
        ...(input.domainConfig === undefined ? {} : { domainConfig: input.domainConfig }),
        actionSynthesis:
          input.actionSynthesis === undefined
            ? CANONICAL_OPPORTUNITY_COST_ACTION_SYNTHESIS_CONFIG
            : input.actionSynthesis,
        ...(input.replanningPolicy === undefined
          ? {}
          : { replanningPolicy: input.replanningPolicy }),
        ...(input.subtaskPrioritizer === undefined
          ? {}
          : { subtaskPrioritizer: input.subtaskPrioritizer }),
        ...(input.actionSequenceGenerator === undefined
          ? {}
          : { actionSequenceGenerator: input.actionSequenceGenerator }),
        socialDialogueGenerator,
        globalSynthesizer,
        ...(input.reactiveCorrector === undefined
          ? {}
          : { reactiveCorrector: input.reactiveCorrector }),
        ...(input.replanningDecider === undefined
          ? {}
          : { replanningDecider: input.replanningDecider }),
      }),
    });
  };
}

function resolveEducationOpportunityCostConfig(
  input: CanonicalLocalRuntimeAgentProviderConfig,
): EducationOpportunityCostConfig {
  return {
    ...(input.domainConfig?.study?.durationSeconds === undefined
      ? {}
      : { studyDurationSeconds: input.domainConfig.study.durationSeconds }),
    ...(input.domainConfig?.study?.educationRatePerSecond === undefined
      ? {}
      : { educationRatePerSecond: input.domainConfig.study.educationRatePerSecond }),
    ...(input.domainConfig?.work?.laborSeconds === undefined
      ? {}
      : { workLaborSeconds: input.domainConfig.work.laborSeconds }),
    ...(input.educationOpportunityCost ?? {}),
  };
}

function createCanonicalObjectiveRenewalTrace(input: {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly trace: ObjectiveRenewalDecisionTrace;
}): ObjectiveRenewalTrace {
  return {
    traceId: `${input.simulationId}:${input.partitionKey}:${input.trace.agentId}:${input.trace.objectiveId}:${input.trace.issuedAt}`,
    simulationId: input.simulationId,
    partitionKey: input.partitionKey,
    agentId: input.trace.agentId,
    objectiveId: input.trace.objectiveId,
    selectedCandidateId: input.trace.selectedCandidateId,
    rationale: input.trace.rationale,
    score: input.trace.score,
    shortTermMemoryContextIds: [...input.trace.shortTermMemoryContextIds],
    profileEntryKeys: [...input.trace.profileEntryKeys],
    profileEvidenceRecordIds: [...input.trace.profileEvidenceRecordIds],
    ...(input.trace.scheduledIntentionIds === undefined
      ? {}
      : { scheduledIntentionIds: [...input.trace.scheduledIntentionIds] }),
    ...(input.trace.strategicPlan === undefined
      ? {}
      : { strategicPlan: input.trace.strategicPlan }),
    issuedAt: input.trace.issuedAt,
  };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
