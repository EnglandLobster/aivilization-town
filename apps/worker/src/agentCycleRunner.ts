import {
  runAgentPlanningCycle,
  runAgentPlanningCycleWithPrioritization,
  type ActionSynthesisPolicy,
  type ActionSimulationTraceEvent,
  type ActionWithRepairResult,
  type ActionRepairTrace,
  type ActionSequenceGenerationTrace,
  type ActionSequenceGenerator,
  type AgentCycleResult,
  type AdaptiveReplanningPolicy,
  type AtomicActionProposal,
  type BranchPlan,
  type BranchPlanRepository,
  type BranchPlanProgress,
  type BranchPlanProgressRepository,
  type CycleSubtaskCompletionPolicy,
  type CycleActionSimulator,
  type CycleRepairPolicy,
  type DomainMicroPlanner,
  type GlobalActionSynthesizer,
  type GlobalSynthesisTrace,
  type ReactiveCorrector,
  type ReplanningDecider,
  type ReplanningDecisionTrace,
  type SocialDialogueGenerationTrace,
  type SocialDialogueGenerator,
  type SocialSignalExtractionTrace,
  type SocialSignalExtractor,
  type StrategicPlanCompiler,
  type SubtaskPrioritizer,
  type WorldDecisionContext,
  type WorldDecisionContextTrace,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermProfileRepository,
  ShortTermMemoryRecord,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import {
  createAgentCycleTrace,
  type AgentCycleActionProposalTrace,
  type AgentCycleActionResourceEstimateTrace,
  type AgentCycleActionSynthesisContextTrace,
  type AgentCycleActionSynthesisTrace,
  type AgentCycleActionRepairTrace,
  type AgentCycleGlobalSynthesisTrace,
  type AgentCycleSimulatorEventTrace,
  type AgentCycleSimulatorTraceEvent,
  type AgentCycleSubtaskReplanningDecisionTrace,
  type AgentCycleReplanningDecisionTrace,
  type AgentCycleTrace,
  type SimulatorTraceResult,
} from '@aivilization/observability';
import type { AgentId, EventStore, EventStreamName, SimulationId } from '@aivilization/sim-core';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import {
  dispatchCommandDraftsToWorldEventStream,
  type DispatchCommandDraftsToEventStreamResult,
} from './commandDispatch';
import type { SimulationCommandRouter } from './simulationCommandRouter';
import {
  resolveMemoryRetrievalCandidateLimit,
  selectRelevantShortTermMemoryContext,
} from './memoryContextSelection';
import {
  materializeFullReplanForActiveObjective,
  type WorkerFullReplanMaterializationResult,
} from './objectiveReplanning';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import {
  createWorldDecisionContextFromProjection,
  type WorldDecisionMarketOverride,
} from './worldDecisionContext';

export type WorkerAgentCycleTraceSink = {
  readonly record: (trace: AgentCycleTrace) => void | Promise<void>;
  readonly recordMany?: (traces: readonly AgentCycleTrace[]) => void | Promise<void>;
};

const DEFAULT_AGENT_CYCLE_MEMORY_RETRIEVAL_LIMIT = 8;

export type WorkerAgentCycleResult = {
  readonly cycleResult: AgentCycleResult;
  readonly dispatchResult?: DispatchCommandDraftsToEventStreamResult;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
  readonly progressUpdate?: BranchPlanProgress;
  readonly replanMaterialization?: WorkerFullReplanMaterializationResult;
  readonly trace: AgentCycleTrace;
};

type WorkerAgentCyclePlanInput =
  | {
      readonly plan: BranchPlan;
      readonly planRepository?: BranchPlanRepository;
      readonly planId?: string;
    }
  | {
      readonly plan?: undefined;
      readonly planRepository: BranchPlanRepository;
      readonly planId: string;
    };

type LlmCognitiveContextTrace = {
  readonly shortTermMemoryContext?: { readonly recordCount: number };
  readonly longTermProfileContext?: { readonly entryCount: number };
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export async function runWorkerAgentCycle(
  input: {
    readonly cycleId: string;
    readonly simulationId: SimulationId;
    readonly agentId: AgentId;
    readonly issuedAt: number;
    readonly observedStateSummary: string;
    readonly worldDecisionContext?: WorldDecisionContext;
    readonly progress?: BranchPlanProgress;
    readonly planProgressRepository?: BranchPlanProgressRepository;
    readonly planProgressId?: string;
    readonly signals: Parameters<typeof runAgentPlanningCycle>[0]['signals'];
    readonly projection: WorldProjection;
    readonly policies: WorldCommandPolicySource;
    readonly eventStore: EventStore<WorldEvent>;
    readonly streamName: EventStreamName;
    readonly appendIdempotencyKey: string;
    readonly commandIdPrefix: string;
    readonly intentionRepository: AgentIntentionRepository;
    readonly longTermProfileRepository: LongTermProfileRepository;
    readonly shortTermMemoryRepository: ShortTermMemoryRepository;
    readonly memoryRetrievalLimit?: number;
    readonly memoryRetrievalCandidateLimit?: number;
    readonly microPlanners: readonly DomainMicroPlanner[];
    readonly actionSynthesis?: ActionSynthesisPolicy;
    readonly simulate: CycleActionSimulator;
    readonly repair?: CycleRepairPolicy;
    readonly replanningPolicy?: AdaptiveReplanningPolicy;
    readonly replanningDecider?: ReplanningDecider;
    readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
    readonly subtaskPrioritizer?: SubtaskPrioritizer;
    readonly actionSequenceGenerator?: ActionSequenceGenerator;
    readonly socialDialogueGenerator?: SocialDialogueGenerator;
    readonly socialSignalExtractor?: SocialSignalExtractor;
    readonly globalSynthesizer?: GlobalActionSynthesizer;
    readonly reactiveCorrector?: ReactiveCorrector;
    readonly materializeFullReplan?: {
      readonly strategicPlanCompiler?: StrategicPlanCompiler;
      readonly resetProgress?: boolean;
    };
    readonly expectedVersion?: number;
    readonly commandRouter?: SimulationCommandRouter;
    readonly marketOverride?: WorldDecisionMarketOverride;
    readonly traceSink?: WorkerAgentCycleTraceSink;
  } & WorkerAgentCyclePlanInput,
): Promise<WorkerAgentCycleResult> {
  const [intentionState, longTermProfile, plan] = await Promise.all([
    input.intentionRepository.getOrCreate(input.agentId),
    input.longTermProfileRepository.getOrCreate(input.agentId),
    resolveBranchPlan({
      agentId: input.agentId,
      plan: input.plan,
      planRepository: input.planRepository,
      planId: input.planId,
    }),
  ]);
  const shortTermMemoryContext = await resolveShortTermMemoryContext({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan,
    signals: input.signals,
    shortTermMemoryRepository: input.shortTermMemoryRepository,
    ...(input.memoryRetrievalLimit === undefined
      ? {}
      : { memoryRetrievalLimit: input.memoryRetrievalLimit }),
    ...(input.memoryRetrievalCandidateLimit === undefined
      ? {}
      : { memoryRetrievalCandidateLimit: input.memoryRetrievalCandidateLimit }),
  });
  const progress = await resolvePlanProgress({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    progress: input.progress,
    planProgressRepository: input.planProgressRepository,
    planProgressId: input.planProgressId,
  });
  const worldDecisionPolicies = resolveWorldCommandPolicies({
    policies: input.policies,
    projection: input.projection,
  });
  const worldDecisionContext =
    input.worldDecisionContext ??
    createWorldDecisionContextFromProjection({
      projection: input.projection,
      agentId: input.agentId,
      policies: worldDecisionPolicies,
      ...(input.marketOverride === undefined ? {} : { marketOverride: input.marketOverride }),
    });
  const cycleInput = {
    simulationId: input.simulationId,
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan,
    observedStateSummary: input.observedStateSummary,
    ...(progress === undefined ? {} : { progress }),
    signals: input.signals,
    intentionState,
    longTermProfile,
    worldDecisionContext,
    shortTermMemoryContext,
    microPlanners: input.microPlanners,
    ...(input.actionSynthesis === undefined ? {} : { actionSynthesis: input.actionSynthesis }),
    simulate: input.simulate,
    ...(input.repair === undefined ? {} : { repair: input.repair }),
    ...(input.replanningPolicy === undefined ? {} : { replanningPolicy: input.replanningPolicy }),
    ...(input.replanningDecider === undefined
      ? {}
      : { replanningDecider: input.replanningDecider }),
    ...(input.subtaskCompletion === undefined
      ? {}
      : { subtaskCompletion: input.subtaskCompletion }),
  };
  const cycleResult =
    input.subtaskPrioritizer === undefined &&
    input.actionSequenceGenerator === undefined &&
    input.socialDialogueGenerator === undefined &&
    input.socialSignalExtractor === undefined &&
    input.globalSynthesizer === undefined &&
    input.reactiveCorrector === undefined &&
    input.replanningDecider === undefined
      ? runAgentPlanningCycle(cycleInput)
      : await runAgentPlanningCycleWithPrioritization({
          ...cycleInput,
          ...(input.subtaskPrioritizer === undefined
            ? {}
            : { subtaskPrioritizer: input.subtaskPrioritizer }),
          ...(input.actionSequenceGenerator === undefined
            ? {}
            : { actionSequenceGenerator: input.actionSequenceGenerator }),
          ...(input.socialDialogueGenerator === undefined
            ? {}
            : { socialDialogueGenerator: input.socialDialogueGenerator }),
          ...(input.socialSignalExtractor === undefined
            ? {}
            : { socialSignalExtractor: input.socialSignalExtractor }),
          ...(input.globalSynthesizer === undefined
            ? {}
            : { globalSynthesizer: input.globalSynthesizer }),
          ...(input.reactiveCorrector === undefined
            ? {}
            : { reactiveCorrector: input.reactiveCorrector }),
          ...(input.replanningDecider === undefined
            ? {}
            : { replanningDecider: input.replanningDecider }),
        });

  const dispatchResult =
    cycleResult.commandDrafts.length === 0
      ? undefined
      : input.commandRouter === undefined
        ? dispatchCommandDraftsToWorldEventStream({
            commandDrafts: cycleResult.commandDrafts,
            projection: input.projection,
            policies: input.policies,
            eventStore: input.eventStore,
            streamName: input.streamName,
            appendIdempotencyKey: input.appendIdempotencyKey,
            commandIdPrefix: input.commandIdPrefix,
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          })
        : await input.commandRouter.routeCommandDrafts({
            commandDrafts: cycleResult.commandDrafts,
            projection: input.projection,
            policies: input.policies,
            eventStore: input.eventStore,
            streamName: input.streamName,
            appendIdempotencyKey: input.appendIdempotencyKey,
            commandIdPrefix: input.commandIdPrefix,
            ...(input.expectedVersion === undefined
              ? {}
              : { expectedVersion: input.expectedVersion }),
          });
  const shortTermMemoryRecords =
    dispatchResult === undefined || dispatchResult.appendResult.idempotentReplay
      ? []
      : extractShortTermMemoryRecords(dispatchResult.events, input.projection);
  if (shortTermMemoryRecords.length > 0) {
    await input.shortTermMemoryRepository.appendMany(shortTermMemoryRecords);
  }
  if (cycleResult.progressUpdate !== undefined && input.planProgressRepository !== undefined) {
    await input.planProgressRepository.save(cycleResult.progressUpdate);
  }
  const replanMaterialization =
    cycleResult.replanningDecision.kind === 'full-replan' &&
    input.materializeFullReplan !== undefined &&
    input.planRepository !== undefined &&
    input.planId !== undefined
      ? await materializeFullReplanForActiveObjective({
          agentId: input.agentId,
          planId: input.planId,
          issuedAt: input.issuedAt,
          longTermProfile,
          worldDecisionContext,
          intentionRepository: input.intentionRepository,
          planRepository: input.planRepository,
          ...(input.planProgressRepository === undefined
            ? {}
            : { planProgressRepository: input.planProgressRepository }),
          replanningDecision: cycleResult.replanningDecision,
          ...(input.materializeFullReplan.strategicPlanCompiler === undefined
            ? {}
            : { strategicPlanCompiler: input.materializeFullReplan.strategicPlanCompiler }),
          ...(input.materializeFullReplan.resetProgress === undefined
            ? {}
            : { resetProgress: input.materializeFullReplan.resetProgress }),
        })
      : undefined;

  const trace = createAgentCycleTrace({
    traceId: input.cycleId,
    simulationId: input.simulationId,
    agentId: input.agentId,
    cycleStartedAt: input.issuedAt,
    observedStateSummary: input.observedStateSummary,
    selectedBranch: cycleResult.selectedSubtask.branchId,
    ...(cycleResult.prioritizationTrace === undefined
      ? {}
      : {
          contextualPrioritization: mapContextualPrioritizationTrace(
            cycleResult.prioritizationTrace,
          ),
        }),
    ...(cycleResult.actionSequenceTraces === undefined
      ? {}
      : {
          actionSequenceGeneration: cycleResult.actionSequenceTraces.map((entry) =>
            mapActionSequenceGenerationTrace(entry),
          ),
        }),
    ...(cycleResult.socialDialogueGenerationTraces === undefined
      ? {}
      : {
          socialDialogueGeneration: cycleResult.socialDialogueGenerationTraces.map((entry) =>
            mapSocialDialogueGenerationTrace(entry),
          ),
        }),
    ...(cycleResult.socialSignalExtractionTraces === undefined
      ? {}
      : {
          socialSignalExtraction: cycleResult.socialSignalExtractionTraces.map((entry) =>
            mapSocialSignalExtractionTrace(entry),
          ),
        }),
    ...(cycleResult.globalSynthesisTrace === undefined
      ? {}
      : { globalSynthesis: mapGlobalSynthesisTrace(cycleResult.globalSynthesisTrace) }),
    ...(cycleResult.actionRepairTraces === undefined
      ? {}
      : {
          actionRepair: cycleResult.actionRepairTraces.map((entry) => mapActionRepairTrace(entry)),
        }),
    subtaskCandidates: cycleResult.subtaskCandidates,
    actionSynthesis: mapActionSynthesisTrace(cycleResult.actionSynthesisResult),
    candidateActions: cycleResult.candidateActions.map((action) => action.description),
    simulatorResult: summarizeSimulatorResult(cycleResult),
    simulatorEvents: mapSimulatorEventTraces(cycleResult.simulationResults),
    selectionEvidence: cycleResult.selectionEvidence,
    replanningDecision: cycleResult.replanningDecision,
    ...(cycleResult.replanningTrace === undefined
      ? {}
      : { replanningDecisionTrace: mapReplanningDecisionTrace(cycleResult.replanningTrace) }),
    ...(replanMaterialization === undefined
      ? {}
      : { replanMaterialization: mapReplanMaterializationTrace(replanMaterialization) }),
    subtaskReplanningDecisions: cycleResult.subtaskReplanningDecisions.map((entry) =>
      mapSubtaskReplanningDecisionTrace(entry),
    ),
    emittedCommandIds: dispatchResult?.commands.map((command) => command.id) ?? [],
    memoryContextIds: shortTermMemoryContext.map((record) => record.id),
    memoryWriteIds: shortTermMemoryRecords.map((record) => record.id),
  });
  await input.traceSink?.record(trace);

  return {
    cycleResult,
    ...(dispatchResult === undefined ? {} : { dispatchResult }),
    events: dispatchResult?.events ?? [],
    projection: dispatchResult?.projection ?? input.projection,
    shortTermMemoryRecords,
    ...(cycleResult.progressUpdate === undefined
      ? {}
      : { progressUpdate: cycleResult.progressUpdate }),
    ...(replanMaterialization === undefined ? {} : { replanMaterialization }),
    trace,
  };
}

async function resolveShortTermMemoryContext(input: {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: Parameters<typeof runAgentPlanningCycle>[0]['signals'];
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
}): Promise<readonly ShortTermMemoryRecord[]> {
  const memoryRetrievalLimit =
    input.memoryRetrievalLimit ?? DEFAULT_AGENT_CYCLE_MEMORY_RETRIEVAL_LIMIT;

  const candidates = await input.shortTermMemoryRepository.retrieve({
    agentId: input.agentId,
    limit: resolveMemoryRetrievalCandidateLimit({
      memoryRetrievalLimit,
      ...(input.memoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: input.memoryRetrievalCandidateLimit }),
    }),
  });
  return selectRelevantShortTermMemoryContext({
    records: candidates,
    plan: input.plan,
    signals: input.signals,
    issuedAt: input.issuedAt,
    limit: memoryRetrievalLimit,
  });
}

function mapSimulatorEventTraces(
  simulationResults: readonly ActionWithRepairResult[],
): readonly AgentCycleSimulatorEventTrace[] {
  return simulationResults.flatMap((result): readonly AgentCycleSimulatorEventTrace[] => {
    switch (result.status) {
      case 'accepted':
        return [
          {
            actionId: result.action.id,
            attempt: 'original',
            status: 'accepted',
            events: mapSimulatorTraceEvents(result.traceEvents),
          },
        ];
      case 'needs-replan':
        return [
          {
            actionId: result.action.id,
            attempt: 'original',
            status: 'rejected',
            reason: result.reason,
            events: mapSimulatorTraceEvents(result.traceEvents),
          },
          ...(result.attemptedRepair === undefined
            ? []
            : [
                {
                  actionId: result.attemptedRepair.id,
                  attempt: 'repair' as const,
                  status: 'rejected' as const,
                  reason: result.reason,
                  events: mapSimulatorTraceEvents(result.attemptedRepairTraceEvents),
                },
              ]),
        ];
      case 'repaired':
        return [
          {
            actionId: result.originalAction.id,
            attempt: 'original',
            status: 'rejected',
            reason: result.reason,
            events: mapSimulatorTraceEvents(result.originalTraceEvents),
          },
          {
            actionId: result.repairedAction.id,
            attempt: 'repair',
            status: 'accepted',
            events: mapSimulatorTraceEvents(result.repairedTraceEvents),
          },
        ];
    }
  });
}

function mapSimulatorTraceEvents(
  events: readonly ActionSimulationTraceEvent[] | undefined,
): readonly AgentCycleSimulatorTraceEvent[] {
  return (events ?? []).map((event) => ({
    type: event.type,
    ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    ...(event.summary === undefined ? {} : { summary: event.summary }),
    ...(event.counterfactualStep === undefined
      ? {}
      : { counterfactualStep: event.counterfactualStep }),
    ...(event.projectionEventCountBefore === undefined
      ? {}
      : { projectionEventCountBefore: event.projectionEventCountBefore }),
    ...(event.projectionEventCountAfter === undefined
      ? {}
      : { projectionEventCountAfter: event.projectionEventCountAfter }),
  }));
}

function mapActionSynthesisTrace(
  actionSynthesisResult: AgentCycleResult['actionSynthesisResult'],
): AgentCycleActionSynthesisTrace {
  return {
    acceptedActions: actionSynthesisResult.acceptedActions.map((action) =>
      mapActionProposalTrace(action),
    ),
    rejectedActions: actionSynthesisResult.rejectedActions.map((rejectedAction) => ({
      action: mapActionProposalTrace(rejectedAction.action),
      reason: rejectedAction.reason,
    })),
  };
}

function mapSubtaskReplanningDecisionTrace(
  entry: AgentCycleResult['subtaskReplanningDecisions'][number],
): AgentCycleSubtaskReplanningDecisionTrace {
  return {
    branchId: entry.selectedSubtask.branchId,
    subtaskId: entry.selectedSubtask.subtaskId,
    decision: entry.decision,
  };
}

function mapReplanMaterializationTrace(
  materialization: WorkerFullReplanMaterializationResult,
): NonNullable<AgentCycleTrace['replanMaterialization']> {
  switch (materialization.status) {
    case 'replanned':
      return {
        status: 'replanned',
        objectiveId: materialization.objectiveId,
        planId: materialization.planId,
        progressReset: materialization.progressReset,
        trigger: materialization.trigger,
        failedActionIds: materialization.failedActionIds,
        evidenceRecordIds: materialization.evidenceRecordIds,
        matchingFailureCount: materialization.matchingFailureCount,
      };
    case 'skipped':
      return {
        status: 'skipped',
        planId: materialization.planId,
        reason: materialization.reason,
        ...(materialization.objectiveId === undefined
          ? {}
          : { objectiveId: materialization.objectiveId }),
      };
  }
}

function mapContextualPrioritizationTrace(
  trace: NonNullable<AgentCycleResult['prioritizationTrace']>,
): NonNullable<AgentCycleTrace['contextualPrioritization']> {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.choices === undefined
      ? {}
      : {
          choices: trace.choices.map((choice) => ({
            branchId: choice.branchId,
            subtaskId: choice.subtaskId,
            priorityScore: choice.priorityScore,
            rationale: choice.rationale,
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...mapLlmCognitiveContextTrace(trace),
  };
}

function mapLlmCognitiveContextTrace(trace: LlmCognitiveContextTrace): LlmCognitiveContextTrace {
  return {
    ...(trace.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: { recordCount: trace.shortTermMemoryContext.recordCount } }),
    ...(trace.longTermProfileContext === undefined
      ? {}
      : { longTermProfileContext: { entryCount: trace.longTermProfileContext.entryCount } }),
    ...(trace.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: trace.observedStateSummary }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: { ...trace.worldDecisionContext } }),
  };
}

function mapActionSequenceGenerationTrace(
  trace: ActionSequenceGenerationTrace,
): NonNullable<AgentCycleTrace['actionSequenceGeneration']>[number] {
  return {
    status: trace.status,
    source: trace.source,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.actions === undefined
      ? {}
      : {
          actions: trace.actions.map((action) => ({
            id: action.id,
            commandType: action.commandType,
            rationale: action.rationale,
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...mapLlmCognitiveContextTrace(trace),
  };
}

function mapSocialDialogueGenerationTrace(
  trace: SocialDialogueGenerationTrace,
): NonNullable<AgentCycleTrace['socialDialogueGeneration']>[number] {
  return {
    status: trace.status,
    source: trace.source,
    selectedSubtask: {
      branchId: trace.selectedSubtask.branchId,
      subtaskId: trace.selectedSubtask.subtaskId,
    },
    actionId: trace.actionId,
    targetAgentId: trace.targetAgentId,
    ...(trace.topic === undefined ? {} : { topic: trace.topic }),
    ...(trace.policyVersion === undefined ? {} : { policyVersion: trace.policyVersion }),
    ...(trace.planningContext === undefined
      ? {}
      : {
          planningContext: {
            policyVersion: trace.planningContext.policyVersion,
            targetSelection: {
              selectedAgentId: trace.planningContext.targetSelection.selectedAgentId,
              candidates: trace.planningContext.targetSelection.candidates.map((candidate) => ({
                agentId: candidate.agentId,
                score: { ...candidate.score },
              })),
              tieBreak: trace.planningContext.targetSelection.tieBreak,
            },
            topicSelection: { ...trace.planningContext.topicSelection },
          },
        }),
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    turnCount: trace.turnCount,
    rationale: trace.rationale,
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...mapLlmCognitiveContextTrace(trace),
  };
}

function mapSocialSignalExtractionTrace(
  trace: SocialSignalExtractionTrace,
): NonNullable<AgentCycleTrace['socialSignalExtraction']>[number] {
  return {
    status: trace.status === 'no-proposal' ? 'fallback' : trace.status,
    source: trace.source,
    policyVersion: trace.policyVersion,
    agentId: trace.agentId,
    targetAgentId: trace.targetAgentId,
    topic: trace.topic,
    turnCount: trace.turnCount,
    extractedSignalCount: trace.extractedSignalCount,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
  };
}

function mapGlobalSynthesisTrace(trace: GlobalSynthesisTrace): AgentCycleGlobalSynthesisTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.choices === undefined
      ? {}
      : {
          choices: trace.choices.map((choice) => ({
            actionId: choice.actionId,
            priorityScore: choice.priorityScore,
            rationale: choice.rationale,
            ...(choice.strategicAlignment === undefined
              ? {}
              : { strategicAlignment: choice.strategicAlignment }),
            ...(choice.branchUrgency === undefined ? {} : { branchUrgency: choice.branchUrgency }),
          })),
        }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...mapLlmCognitiveContextTrace(trace),
  };
}

function mapReplanningDecisionTrace(
  trace: ReplanningDecisionTrace,
): AgentCycleReplanningDecisionTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    decision:
      trace.decision.kind === 'none'
        ? { kind: 'none' }
        : trace.decision.kind === 'memory-guided-correction'
          ? {
              kind: 'memory-guided-correction',
              trigger: trace.decision.trigger,
              reason: trace.decision.reason,
              failedActionIds: [...trace.decision.failedActionIds],
              evidenceRecordIds: [...trace.decision.evidenceRecordIds],
            }
          : {
              kind: 'full-replan',
              trigger: trace.decision.trigger,
              reason: trace.decision.reason,
              failedActionIds: [...trace.decision.failedActionIds],
              evidenceRecordIds: [...trace.decision.evidenceRecordIds],
              matchingFailureCount: trace.decision.matchingFailureCount,
            },
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: { ...attempt.usage },
          })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...mapLlmCognitiveContextTrace(trace),
  };
}

function mapActionRepairTrace(trace: ActionRepairTrace): AgentCycleActionRepairTrace {
  return {
    actionId: trace.actionId,
    rejectionReason: trace.rejectionReason,
    selectedSubtask: { ...trace.selectedSubtask },
    localRepair: {
      status: trace.localRepair.status,
      ...(trace.localRepair.attemptedAction === undefined
        ? {}
        : { attemptedAction: { ...trace.localRepair.attemptedAction } }),
      ...(trace.localRepair.rejectionReason === undefined
        ? {}
        : { rejectionReason: trace.localRepair.rejectionReason }),
    },
    ...(trace.reactiveCorrection === undefined
      ? {}
      : {
          reactiveCorrection: {
            status: trace.reactiveCorrection.status,
            source: trace.reactiveCorrection.source,
            ...(trace.reactiveCorrection.requestId === undefined
              ? {}
              : { requestId: trace.reactiveCorrection.requestId }),
            ...(trace.reactiveCorrection.providerId === undefined
              ? {}
              : { providerId: trace.reactiveCorrection.providerId }),
            ...(trace.reactiveCorrection.model === undefined
              ? {}
              : { model: trace.reactiveCorrection.model }),
            ...(trace.reactiveCorrection.failureReason === undefined
              ? {}
              : { failureReason: trace.reactiveCorrection.failureReason }),
            ...(trace.reactiveCorrection.message === undefined
              ? {}
              : { message: trace.reactiveCorrection.message }),
            decision:
              trace.reactiveCorrection.decision.kind === 'no-correction'
                ? {
                    kind: 'no-correction',
                    rationale: trace.reactiveCorrection.decision.rationale,
                    evidenceRecordIds: [...trace.reactiveCorrection.decision.evidenceRecordIds],
                  }
                : {
                    kind: 'propose-action',
                    rationale: trace.reactiveCorrection.decision.rationale,
                    evidenceRecordIds: [...trace.reactiveCorrection.decision.evidenceRecordIds],
                    action: { ...trace.reactiveCorrection.decision.action },
                  },
            ...(trace.reactiveCorrection.attempts === undefined
              ? {}
              : {
                  attempts: trace.reactiveCorrection.attempts.map((attempt) => ({
                    attemptIndex: attempt.attemptIndex,
                    status: attempt.status,
                    providerId: attempt.providerId,
                    model: attempt.model,
                    message: attempt.message,
                    usage: { ...attempt.usage },
                  })),
                }),
            ...(trace.reactiveCorrection.usage === undefined
              ? {}
              : { usage: { ...trace.reactiveCorrection.usage } }),
            ...mapLlmCognitiveContextTrace(trace.reactiveCorrection),
            ...(trace.reactiveCorrection.simulatorResult === undefined
              ? {}
              : {
                  simulatorResult: {
                    status: trace.reactiveCorrection.simulatorResult.status,
                    ...(trace.reactiveCorrection.simulatorResult.reason === undefined
                      ? {}
                      : { reason: trace.reactiveCorrection.simulatorResult.reason }),
                    ...(trace.reactiveCorrection.simulatorResult.traceEvents === undefined
                      ? {}
                      : {
                          traceEvents: trace.reactiveCorrection.simulatorResult.traceEvents.map(
                            (event) => ({ ...event }),
                          ),
                        }),
                  },
                }),
          },
        }),
    outcome: trace.outcome,
  };
}

function mapActionProposalTrace(action: AtomicActionProposal): AgentCycleActionProposalTrace {
  return {
    id: action.id,
    description: action.description,
    commandType: action.commandType,
    ...(action.priority === undefined ? {} : { priority: action.priority }),
    ...(action.synthesisContext === undefined
      ? {}
      : { synthesisContext: mapSynthesisContextTrace(action.synthesisContext) }),
    ...(action.resourceEstimate === undefined
      ? {}
      : { resourceEstimate: mapResourceEstimateTrace(action.resourceEstimate) }),
  };
}

function mapSynthesisContextTrace(
  synthesisContext: NonNullable<AtomicActionProposal['synthesisContext']>,
): AgentCycleActionSynthesisContextTrace {
  return {
    ...(synthesisContext.branchId === undefined ? {} : { branchId: synthesisContext.branchId }),
    ...(synthesisContext.subtaskId === undefined ? {} : { subtaskId: synthesisContext.subtaskId }),
    ...(synthesisContext.subtaskScore === undefined
      ? {}
      : { subtaskScore: synthesisContext.subtaskScore }),
    ...(synthesisContext.strategicAlignment === undefined
      ? {}
      : { strategicAlignment: synthesisContext.strategicAlignment }),
    ...(synthesisContext.branchUrgency === undefined
      ? {}
      : { branchUrgency: synthesisContext.branchUrgency }),
  };
}

function mapResourceEstimateTrace(
  resourceEstimate: NonNullable<AtomicActionProposal['resourceEstimate']>,
): AgentCycleActionResourceEstimateTrace {
  return {
    ...(resourceEstimate.actionSeconds === undefined
      ? {}
      : { actionSeconds: resourceEstimate.actionSeconds }),
    ...(resourceEstimate.energyCost === undefined
      ? {}
      : { energyCost: resourceEstimate.energyCost }),
    ...(resourceEstimate.satietyCost === undefined
      ? {}
      : { satietyCost: resourceEstimate.satietyCost }),
    ...(resourceEstimate.currencyCost === undefined
      ? {}
      : { currencyCost: resourceEstimate.currencyCost }),
    ...(resourceEstimate.inventoryCosts === undefined
      ? {}
      : { inventoryCosts: { ...resourceEstimate.inventoryCosts } }),
  };
}

async function resolveBranchPlan(input: {
  readonly agentId: AgentId;
  readonly plan: BranchPlan | undefined;
  readonly planRepository: BranchPlanRepository | undefined;
  readonly planId: string | undefined;
}): Promise<BranchPlan> {
  if (input.plan !== undefined) {
    return input.plan;
  }
  if (input.planRepository === undefined) {
    throw new Error('planRepository is required when plan is omitted');
  }
  if (input.planId === undefined) {
    throw new Error('planId is required when plan is omitted');
  }
  return (await input.planRepository.require({ planId: input.planId, agentId: input.agentId }))
    .plan;
}

async function resolvePlanProgress(input: {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly progress: BranchPlanProgress | undefined;
  readonly planProgressRepository: BranchPlanProgressRepository | undefined;
  readonly planProgressId: string | undefined;
}): Promise<BranchPlanProgress | undefined> {
  if (input.progress !== undefined) {
    return input.progress;
  }
  if (input.planProgressRepository === undefined) {
    return undefined;
  }
  if (input.planProgressId === undefined) {
    throw new Error('planProgressId is required when planProgressRepository is provided');
  }
  return input.planProgressRepository.getOrCreate({
    planId: input.planProgressId,
    agentId: input.agentId,
    createdAt: input.issuedAt,
  });
}

/**
 * Extracts the memory records this partition durably owns from dispatched
 * events. Global settlements routed through the authority can emit records for
 * Agents owned by other partitions (for example the remote participant of a
 * cross-owner conversation); those records materialize through the owner
 * partition's inbox instead and must never enter this partition's memory.
 */
function extractShortTermMemoryRecords(
  events: readonly WorldEvent[],
  projection: WorldProjection,
): readonly ShortTermMemoryRecord[] {
  return events.flatMap((event) =>
    event.type === 'ShortTermMemoryRecorded' &&
    projection.agents[event.payload.record.agentId] !== undefined
      ? [event.payload.record]
      : [],
  );
}

function summarizeSimulatorResult(cycleResult: AgentCycleResult): SimulatorTraceResult {
  const firstReplan = cycleResult.simulationResults.find(
    (result) => result.status === 'needs-replan',
  );
  if (firstReplan !== undefined) {
    return { status: 'rejected', reason: firstReplan.reason };
  }
  const firstRepair = cycleResult.simulationResults.find((result) => result.status === 'repaired');
  if (firstRepair !== undefined) {
    return { status: 'repaired', reason: firstRepair.reason };
  }
  return { status: 'accepted' };
}
