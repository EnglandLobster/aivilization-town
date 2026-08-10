import {
  asAgentId,
  type AgentId,
  type CommandSource,
  type CoreCommandType,
  type SimulationId,
} from '@aivilization/sim-core';
import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { WorldDecisionContext } from './worldDecisionContext';
import type {
  ActionSimulationResult,
  AtomicActionProposal,
  ActionWithRepairResult,
} from './actions';
import { simulateActionWithRepair } from './actions';
import type {
  ActionSynthesisPolicy,
  ActionSynthesisResult,
  RejectedSynthesizedAction,
} from './actionSynthesis';
import { synthesizeActionCandidates } from './actionSynthesis';
import type {
  BranchPlan,
  ContextSignal,
  PrioritizedSubtask,
  PrioritizedSubtaskCandidate,
} from './planner';
import { scorePrioritizedSubtaskCandidates } from './planner';
import { scoreIntentionInfluence, type IntentionInfluenceScore } from './intentionInfluence';
import { scoreMemoryInfluence, type MemoryInfluenceScore } from './memoryInfluence';
import { markSubtaskBlocked, markSubtaskCompleted, type BranchPlanProgress } from './planProgress';
import { scoreProfileInfluence, type ProfileInfluenceScore } from './profileInfluence';
import {
  applyReplanningDecisionToProgress,
  createDeterministicReplanningDecisionResult,
  decideAdaptiveReplanning,
  type AdaptiveReplanningPolicy,
  type ReplanningDecider,
  type ReplanningDecision,
  type ReplanningDecisionResult,
  type ReplanningDecisionTrace,
  type SubtaskCompletionDecision,
} from './replanning';
import {
  createDeterministicSubtaskPrioritizationResult,
  type SubtaskPrioritizationTrace,
  type SubtaskPrioritizer,
} from './subtaskPrioritization';
import type {
  ActionSequenceGenerationTrace,
  ActionSequenceGenerator,
} from './actionSequenceGeneration';
import {
  AGENT_ACTION_COMMAND_TYPES,
  simulateActionWithTieredRepair,
  type ActionRepairTrace,
  type ReactiveCorrector,
  type TieredActionRepairResult,
} from './actionRepair';
import type { GlobalActionSynthesizer, GlobalSynthesisTrace } from './globalSynthesis';
import {
  parseSocialPlanningContextTrace,
  type SocialDialogueGenerationTrace,
  type SocialDialogueGenerator,
  type SocialDialoguePayload,
} from './socialDialogueGeneration';
import {
  createDeterministicSocialSignalExtractionTrace,
  type SocialSignalExtractionTrace,
  type SocialSignalExtractor,
} from './socialSignalExtraction';

export type DomainMicroPlanner = {
  readonly domain: string;
  supports(selectedSubtask: PrioritizedSubtask): boolean;
  propose(input: DomainMicroPlannerInput): readonly AtomicActionProposal[];
};

export type DomainMicroPlannerContext = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly observedStateSummary?: string;
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type DomainMicroPlannerInput = DomainMicroPlannerContext & {
  readonly selectedSubtask: PrioritizedSubtask;
};

export type CycleActionSimulator = (input: {
  readonly action: AtomicActionProposal;
  readonly selectedSubtask: PrioritizedSubtask;
}) => ActionSimulationResult;

export type CycleRepairPolicyInput = DomainMicroPlannerContext & {
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
  readonly selectedSubtask: PrioritizedSubtask;
};

export type CycleRepairPolicy = (
  input: CycleRepairPolicyInput,
) => AtomicActionProposal | undefined;

export type CycleSubtaskCompletionPolicy = (input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
}) => SubtaskCompletionDecision;

export type CommandDraft = {
  readonly simulationId: SimulationId;
  readonly actorId: AgentId;
  readonly source: Extract<CommandSource, 'agent-runtime'>;
  readonly type: CoreCommandType;
  readonly payload: unknown;
  readonly issuedAt: number;
};

export type AgentCycleResult = {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly prioritizationTrace?: SubtaskPrioritizationTrace;
  readonly actionSequenceTraces?: readonly ActionSequenceGenerationTrace[];
  readonly socialDialogueGenerationTraces?: readonly SocialDialogueGenerationTrace[];
  readonly socialSignalExtractionTraces?: readonly SocialSignalExtractionTrace[];
  readonly globalSynthesisTrace?: GlobalSynthesisTrace;
  readonly actionRepairTraces?: readonly ActionRepairTrace[];
  readonly selectionEvidence: AgentCycleSelectionEvidence;
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly actionSynthesisResult: ActionSynthesisResult;
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly commandDrafts: readonly CommandDraft[];
  readonly replanningDecision: ReplanningDecision;
  readonly replanningTrace?: ReplanningDecisionTrace;
  readonly subtaskReplanningDecisions: readonly AgentCycleSubtaskReplanningDecision[];
  readonly subtaskCompletionDecision: SubtaskCompletionDecision;
  readonly subtaskCompletionDecisions: readonly AgentCycleSubtaskCompletionDecision[];
  readonly progressUpdate?: BranchPlanProgress;
  readonly needsReplan: boolean;
};

export type AgentCycleSubtaskReplanningDecision = {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly decision: ReplanningDecision;
};

export type AgentCycleSubtaskCompletionDecision = {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly decision: SubtaskCompletionDecision;
};

export type AgentCycleSelectionEvidence = {
  readonly selectedSubtaskId: string;
  readonly intentionInfluenceScore: number;
  readonly memoryInfluenceScore: number;
  readonly profileInfluenceScore: number;
  readonly memoryEvidenceRecordIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
};

export type AgentPlanningCycleInput = {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly observedStateSummary?: string;
  readonly progress?: BranchPlanProgress;
  readonly signals: readonly ContextSignal[];
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
};

export type AgentPlanningCycleWithPrioritizationInput = AgentPlanningCycleInput & {
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly socialSignalExtractor?: SocialSignalExtractor;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
};

export function runAgentPlanningCycle(input: AgentPlanningCycleInput): AgentCycleResult {
  const prepared = prepareCyclePrioritization(input);
  return runAgentPlanningCycleFromCandidates({
    ...input,
    ...prepared,
  });
}

export async function runAgentPlanningCycleWithPrioritization(
  input: AgentPlanningCycleWithPrioritizationInput,
): Promise<AgentCycleResult> {
  const prepared = prepareCyclePrioritization(input);
  const prioritization =
    input.subtaskPrioritizer === undefined
      ? createDeterministicSubtaskPrioritizationResult({ candidates: prepared.subtaskCandidates })
      : await input.subtaskPrioritizer({
          agentId: input.agentId,
          issuedAt: input.issuedAt,
          plan: input.plan,
          signals: input.signals,
          candidates: prepared.subtaskCandidates,
          ...(input.observedStateSummary === undefined
            ? {}
            : { observedStateSummary: input.observedStateSummary }),
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
          ...(input.shortTermMemoryContext === undefined
            ? {}
            : { shortTermMemoryContext: input.shortTermMemoryContext }),
          ...(input.longTermProfile === undefined
            ? {}
            : { longTermProfile: input.longTermProfile }),
          ...(input.worldDecisionContext === undefined
            ? {}
            : { worldDecisionContext: input.worldDecisionContext }),
        });

  const cycleCandidateInput = {
    ...input,
    ...prepared,
    subtaskCandidates: prioritization.candidates,
    prioritizationTrace: prioritization.trace,
  };

  return input.actionSequenceGenerator === undefined &&
    input.socialDialogueGenerator === undefined &&
    input.socialSignalExtractor === undefined &&
    input.globalSynthesizer === undefined &&
    input.reactiveCorrector === undefined &&
    input.replanningDecider === undefined
    ? runAgentPlanningCycleFromCandidates(cycleCandidateInput)
    : runAgentPlanningCycleFromCandidatesWithAsyncStages({
        ...cycleCandidateInput,
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
}

function prepareCyclePrioritization(input: AgentPlanningCycleInput): {
  readonly intentionInfluence?: Readonly<Record<string, IntentionInfluenceScore>>;
  readonly memoryInfluence?: Readonly<Record<string, MemoryInfluenceScore>>;
  readonly profileInfluence?: Readonly<Record<string, ProfileInfluenceScore>>;
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
} {
  const intentionInfluence =
    input.intentionState === undefined
      ? undefined
      : buildIntentionInfluenceBySubtask(input.plan, input.intentionState, input.issuedAt);
  const memoryInfluence =
    input.shortTermMemoryContext === undefined
      ? undefined
      : buildMemoryInfluenceBySubtask(input.plan, input.shortTermMemoryContext, input.issuedAt);
  const profileInfluence =
    input.longTermProfile === undefined
      ? undefined
      : buildProfileInfluenceBySubtask(input.plan, input.longTermProfile);
  const subtaskCandidates = scorePrioritizedSubtaskCandidates({
    plan: input.plan,
    signals: input.signals,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(intentionInfluence === undefined ? {} : { intentionInfluence }),
    ...(memoryInfluence === undefined ? {} : { memoryInfluence }),
    ...(profileInfluence === undefined ? {} : { profileInfluence }),
  });

  return {
    ...(intentionInfluence === undefined ? {} : { intentionInfluence }),
    ...(memoryInfluence === undefined ? {} : { memoryInfluence }),
    ...(profileInfluence === undefined ? {} : { profileInfluence }),
    subtaskCandidates,
  };
}

type CycleCandidateInput = AgentPlanningCycleInput & {
  readonly intentionInfluence?: Readonly<Record<string, IntentionInfluenceScore>>;
  readonly memoryInfluence?: Readonly<Record<string, MemoryInfluenceScore>>;
  readonly profileInfluence?: Readonly<Record<string, ProfileInfluenceScore>>;
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly prioritizationTrace?: SubtaskPrioritizationTrace;
};

type PreparedCycleCandidateExecution = {
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly selectedSubtask: PrioritizedSubtask;
  readonly synthesisSubtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly synthesisSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
  readonly selectionEvidence: AgentCycleSelectionEvidence;
};

function runAgentPlanningCycleFromCandidates(input: CycleCandidateInput): AgentCycleResult {
  const prepared = prepareCycleCandidateExecution(input);
  const proposedActions = collectSynthesisActionProposals({
    ...createDomainMicroPlannerContext(input),
    candidates: prepared.synthesisSubtaskCandidates,
    microPlanners: input.microPlanners,
  });

  return runAgentPlanningCycleFromProposedActions({
    ...input,
    ...prepared,
    proposedActions,
  });
}

async function runAgentPlanningCycleFromCandidatesWithAsyncStages(
  input: CycleCandidateInput & {
    readonly actionSequenceGenerator?: ActionSequenceGenerator;
    readonly socialDialogueGenerator?: SocialDialogueGenerator;
    readonly socialSignalExtractor?: SocialSignalExtractor;
    readonly globalSynthesizer?: GlobalActionSynthesizer;
    readonly reactiveCorrector?: ReactiveCorrector;
    readonly replanningDecider?: ReplanningDecider;
  },
): Promise<AgentCycleResult> {
  const prepared = prepareCycleCandidateExecution(input);
  const generated =
    input.actionSequenceGenerator === undefined
      ? {
          proposedActions: collectSynthesisActionProposals({
            ...createDomainMicroPlannerContext(input),
            candidates: prepared.synthesisSubtaskCandidates,
            microPlanners: input.microPlanners,
          }),
          traces: undefined,
        }
      : await collectSynthesisActionProposalsWithGeneration({
          agentId: input.agentId,
          issuedAt: input.issuedAt,
          plan: input.plan,
          signals: input.signals,
          ...(input.observedStateSummary === undefined
            ? {}
            : { observedStateSummary: input.observedStateSummary }),
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
          ...(input.shortTermMemoryContext === undefined
            ? {}
            : { shortTermMemoryContext: input.shortTermMemoryContext }),
          ...(input.longTermProfile === undefined
            ? {}
            : { longTermProfile: input.longTermProfile }),
          ...(input.worldDecisionContext === undefined
            ? {}
            : { worldDecisionContext: input.worldDecisionContext }),
          candidates: prepared.synthesisSubtaskCandidates,
          microPlanners: input.microPlanners,
          actionSequenceGenerator: input.actionSequenceGenerator,
        });
  const socialDialogue =
    input.socialDialogueGenerator === undefined && input.socialSignalExtractor === undefined
      ? { proposedActions: generated.proposedActions, traces: undefined, signalTraces: undefined }
      : await applySocialDialogueGenerationToActions({
          agentId: input.agentId,
          issuedAt: input.issuedAt,
          plan: input.plan,
          signals: input.signals,
          ...(input.observedStateSummary === undefined
            ? {}
            : { observedStateSummary: input.observedStateSummary }),
          ...(input.progress === undefined ? {} : { progress: input.progress }),
          ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
          ...(input.shortTermMemoryContext === undefined
            ? {}
            : { shortTermMemoryContext: input.shortTermMemoryContext }),
          ...(input.longTermProfile === undefined
            ? {}
            : { longTermProfile: input.longTermProfile }),
          ...(input.worldDecisionContext === undefined
            ? {}
            : { worldDecisionContext: input.worldDecisionContext }),
          proposedActions: generated.proposedActions,
          selectedSubtask: prepared.selectedSubtask,
          selectedSubtasksByKey: prepared.synthesisSubtasksByKey,
          ...(input.socialDialogueGenerator === undefined
            ? {}
            : { socialDialogueGenerator: input.socialDialogueGenerator }),
          ...(input.socialSignalExtractor === undefined
            ? {}
            : { socialSignalExtractor: input.socialSignalExtractor }),
        });

  if (input.globalSynthesizer !== undefined) {
    const deterministicSynthesisResult = synthesizeActionCandidates({
      actions: socialDialogue.proposedActions,
      ...(input.actionSynthesis === undefined ? {} : { policy: input.actionSynthesis }),
    });
    const globalSynthesis = await input.globalSynthesizer({
      agentId: input.agentId,
      issuedAt: input.issuedAt,
      plan: input.plan,
      signals: input.signals,
      candidateActions: socialDialogue.proposedActions,
      deterministicSynthesisResult,
      ...(input.actionSynthesis === undefined
        ? {}
        : { actionSynthesisPolicy: input.actionSynthesis }),
      ...(input.observedStateSummary === undefined
        ? {}
        : { observedStateSummary: input.observedStateSummary }),
      ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
      ...(input.shortTermMemoryContext === undefined
        ? {}
        : { shortTermMemoryContext: input.shortTermMemoryContext }),
      ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
      ...(input.worldDecisionContext === undefined
        ? {}
        : { worldDecisionContext: input.worldDecisionContext }),
    });

    const proposedInput = {
      ...input,
      ...prepared,
      proposedActions: globalSynthesis.actions,
      globalSynthesisTrace: globalSynthesis.trace,
      ...(generated.traces === undefined ? {} : { actionSequenceTraces: generated.traces }),
      ...(socialDialogue.traces === undefined
        ? {}
        : { socialDialogueGenerationTraces: socialDialogue.traces }),
      ...(socialDialogue.signalTraces === undefined
        ? {}
        : { socialSignalExtractionTraces: socialDialogue.signalTraces }),
    };

    return input.reactiveCorrector === undefined
      ? input.replanningDecider === undefined
        ? runAgentPlanningCycleFromProposedActions(proposedInput)
        : runAgentPlanningCycleFromProposedActionsWithAsyncReplanning({
            ...proposedInput,
            replanningDecider: input.replanningDecider,
          })
      : runAgentPlanningCycleFromProposedActionsWithReactiveCorrection({
          ...proposedInput,
          reactiveCorrector: input.reactiveCorrector,
          ...(input.replanningDecider === undefined
            ? {}
            : { replanningDecider: input.replanningDecider }),
        });
  }

  const proposedInput = {
    ...input,
    ...prepared,
    proposedActions: socialDialogue.proposedActions,
    ...(generated.traces === undefined ? {} : { actionSequenceTraces: generated.traces }),
    ...(socialDialogue.traces === undefined
      ? {}
      : { socialDialogueGenerationTraces: socialDialogue.traces }),
    ...(socialDialogue.signalTraces === undefined
      ? {}
      : { socialSignalExtractionTraces: socialDialogue.signalTraces }),
  };

  return input.reactiveCorrector === undefined
    ? input.replanningDecider === undefined
      ? runAgentPlanningCycleFromProposedActions(proposedInput)
      : runAgentPlanningCycleFromProposedActionsWithAsyncReplanning({
          ...proposedInput,
          replanningDecider: input.replanningDecider,
        })
    : runAgentPlanningCycleFromProposedActionsWithReactiveCorrection({
        ...proposedInput,
        reactiveCorrector: input.reactiveCorrector,
        ...(input.replanningDecider === undefined
          ? {}
          : { replanningDecider: input.replanningDecider }),
      });
}

function prepareCycleCandidateExecution(
  input: CycleCandidateInput,
): PreparedCycleCandidateExecution {
  const subtaskCandidates = input.subtaskCandidates;
  const selectedCandidate = subtaskCandidates[0];
  if (selectedCandidate === undefined) {
    throw new Error('branch plan produced no selectable subtasks');
  }
  const selectedSubtask = toPrioritizedSubtask(selectedCandidate);
  const synthesisSubtaskCandidates = selectSynthesisSubtaskCandidates({
    candidates: subtaskCandidates,
    policy: input.actionSynthesis,
  });
  const synthesisSubtasksByKey = createSelectedSubtaskMap(synthesisSubtaskCandidates);
  const selectionEvidence = createSelectionEvidence({
    selectedSubtask,
    ...(input.intentionInfluence === undefined
      ? {}
      : { intentionInfluence: input.intentionInfluence }),
    ...(input.memoryInfluence === undefined ? {} : { memoryInfluence: input.memoryInfluence }),
    ...(input.profileInfluence === undefined ? {} : { profileInfluence: input.profileInfluence }),
  });

  return {
    subtaskCandidates,
    selectedSubtask,
    synthesisSubtaskCandidates,
    synthesisSubtasksByKey,
    selectionEvidence,
  };
}

function runAgentPlanningCycleFromProposedActions(
  input: CycleCandidateInput &
    PreparedCycleCandidateExecution & {
      readonly proposedActions: readonly AtomicActionProposal[];
      readonly actionSequenceTraces?: readonly ActionSequenceGenerationTrace[];
      readonly socialDialogueGenerationTraces?: readonly SocialDialogueGenerationTrace[];
      readonly socialSignalExtractionTraces?: readonly SocialSignalExtractionTrace[];
      readonly globalSynthesisTrace?: GlobalSynthesisTrace;
    },
): AgentCycleResult {
  const proposedActions = input.proposedActions;
  if (proposedActions.length === 0) {
    throw new Error(`no micro-planner supports subtask ${input.selectedSubtask.subtaskId}`);
  }
  const actionSynthesisResult = synthesizeActionCandidates({
    actions: proposedActions,
    ...(input.actionSynthesis === undefined ? {} : { policy: input.actionSynthesis }),
  });
  const candidateActions = actionSynthesisResult.acceptedActions;
  if (candidateActions.length === 0) {
    const simulationResults = createActionSynthesisReplanResults(
      actionSynthesisResult.rejectedActions,
    );
    return finalizeAgentCycleResult({
      simulationId: input.simulationId,
      agentId: input.agentId,
      issuedAt: input.issuedAt,
      progress: input.progress,
      replanningPolicy: input.replanningPolicy,
      subtaskCompletion: input.subtaskCompletion,
      shortTermMemoryContext: input.shortTermMemoryContext,
      selectedSubtask: input.selectedSubtask,
      prioritizationTrace: input.prioritizationTrace,
      actionSequenceTraces: input.actionSequenceTraces,
      socialDialogueGenerationTraces: input.socialDialogueGenerationTraces,
      socialSignalExtractionTraces: input.socialSignalExtractionTraces,
      globalSynthesisTrace: input.globalSynthesisTrace,
      selectionEvidence: input.selectionEvidence,
      subtaskCandidates: input.subtaskCandidates,
      actionSynthesisResult,
      candidateActions,
      simulationResults,
      selectedSubtasksByKey: input.synthesisSubtasksByKey,
    });
  }

  const simulationResults = candidateActions.map((action) =>
    simulateActionWithRepair({
      action,
      simulate: (candidate) =>
        input.simulate({
          action: candidate,
          selectedSubtask: resolveSelectedSubtaskForAction({
            action: candidate,
            fallback: input.selectedSubtask,
            selectedSubtasksByKey: input.synthesisSubtasksByKey,
          }),
        }),
      ...(input.repair === undefined
        ? {}
        : {
            repair: ({ rejectedAction, reason }) => {
              const selectedSubtask = resolveSelectedSubtaskForAction({
                action: rejectedAction,
                fallback: input.selectedSubtask,
                selectedSubtasksByKey: input.synthesisSubtasksByKey,
              });
              return input.repair?.(
                createCycleRepairPolicyInput({
                  input,
                  selectedSubtask,
                  rejectedAction,
                  reason,
                }),
              );
            },
          }),
    }),
  );
  return finalizeAgentCycleResult({
    simulationId: input.simulationId,
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    progress: input.progress,
    replanningPolicy: input.replanningPolicy,
    subtaskCompletion: input.subtaskCompletion,
    shortTermMemoryContext: input.shortTermMemoryContext,
    selectedSubtask: input.selectedSubtask,
    prioritizationTrace: input.prioritizationTrace,
    actionSequenceTraces: input.actionSequenceTraces,
    socialDialogueGenerationTraces: input.socialDialogueGenerationTraces,
    socialSignalExtractionTraces: input.socialSignalExtractionTraces,
    globalSynthesisTrace: input.globalSynthesisTrace,
    selectionEvidence: input.selectionEvidence,
    subtaskCandidates: input.subtaskCandidates,
    actionSynthesisResult,
    candidateActions,
    simulationResults,
    selectedSubtasksByKey: input.synthesisSubtasksByKey,
  });
}

async function runAgentPlanningCycleFromProposedActionsWithAsyncReplanning(
  input: CycleCandidateInput &
    PreparedCycleCandidateExecution & {
      readonly proposedActions: readonly AtomicActionProposal[];
      readonly actionSequenceTraces?: readonly ActionSequenceGenerationTrace[];
      readonly socialDialogueGenerationTraces?: readonly SocialDialogueGenerationTrace[];
      readonly socialSignalExtractionTraces?: readonly SocialSignalExtractionTrace[];
      readonly globalSynthesisTrace?: GlobalSynthesisTrace;
      readonly replanningDecider: ReplanningDecider;
    },
): Promise<AgentCycleResult> {
  const proposedActions = input.proposedActions;
  if (proposedActions.length === 0) {
    throw new Error(`no micro-planner supports subtask ${input.selectedSubtask.subtaskId}`);
  }
  const actionSynthesisResult = synthesizeActionCandidates({
    actions: proposedActions,
    ...(input.actionSynthesis === undefined ? {} : { policy: input.actionSynthesis }),
  });
  const candidateActions = actionSynthesisResult.acceptedActions;
  if (candidateActions.length === 0) {
    const simulationResults = createActionSynthesisReplanResults(
      actionSynthesisResult.rejectedActions,
    );
    return finalizeAgentCycleResultWithAsyncReplanning({
      simulationId: input.simulationId,
      agentId: input.agentId,
      issuedAt: input.issuedAt,
      plan: input.plan,
      signals: input.signals,
      progress: input.progress,
      ...(input.observedStateSummary === undefined
        ? {}
        : { observedStateSummary: input.observedStateSummary }),
      replanningPolicy: input.replanningPolicy,
      replanningDecider: input.replanningDecider,
      subtaskCompletion: input.subtaskCompletion,
      shortTermMemoryContext: input.shortTermMemoryContext,
      ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
      ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
      ...(input.worldDecisionContext === undefined
        ? {}
        : { worldDecisionContext: input.worldDecisionContext }),
      selectedSubtask: input.selectedSubtask,
      prioritizationTrace: input.prioritizationTrace,
      actionSequenceTraces: input.actionSequenceTraces,
      socialDialogueGenerationTraces: input.socialDialogueGenerationTraces,
      socialSignalExtractionTraces: input.socialSignalExtractionTraces,
      globalSynthesisTrace: input.globalSynthesisTrace,
      selectionEvidence: input.selectionEvidence,
      subtaskCandidates: input.subtaskCandidates,
      actionSynthesisResult,
      candidateActions,
      simulationResults,
      selectedSubtasksByKey: input.synthesisSubtasksByKey,
    });
  }

  const simulationResults = candidateActions.map((action) =>
    simulateActionWithRepair({
      action,
      simulate: (candidate) =>
        input.simulate({
          action: candidate,
          selectedSubtask: resolveSelectedSubtaskForAction({
            action: candidate,
            fallback: input.selectedSubtask,
            selectedSubtasksByKey: input.synthesisSubtasksByKey,
          }),
        }),
      ...(input.repair === undefined
        ? {}
        : {
            repair: ({ rejectedAction, reason }) => {
              const selectedSubtask = resolveSelectedSubtaskForAction({
                action: rejectedAction,
                fallback: input.selectedSubtask,
                selectedSubtasksByKey: input.synthesisSubtasksByKey,
              });
              return input.repair?.(
                createCycleRepairPolicyInput({
                  input,
                  selectedSubtask,
                  rejectedAction,
                  reason,
                }),
              );
            },
          }),
    }),
  );
  return finalizeAgentCycleResultWithAsyncReplanning({
    simulationId: input.simulationId,
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: input.signals,
    progress: input.progress,
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    replanningPolicy: input.replanningPolicy,
    replanningDecider: input.replanningDecider,
    subtaskCompletion: input.subtaskCompletion,
    shortTermMemoryContext: input.shortTermMemoryContext,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
    selectedSubtask: input.selectedSubtask,
    prioritizationTrace: input.prioritizationTrace,
    actionSequenceTraces: input.actionSequenceTraces,
    socialDialogueGenerationTraces: input.socialDialogueGenerationTraces,
    socialSignalExtractionTraces: input.socialSignalExtractionTraces,
    globalSynthesisTrace: input.globalSynthesisTrace,
    selectionEvidence: input.selectionEvidence,
    subtaskCandidates: input.subtaskCandidates,
    actionSynthesisResult,
    candidateActions,
    simulationResults,
    selectedSubtasksByKey: input.synthesisSubtasksByKey,
  });
}

async function runAgentPlanningCycleFromProposedActionsWithReactiveCorrection(
  input: CycleCandidateInput &
    PreparedCycleCandidateExecution & {
      readonly proposedActions: readonly AtomicActionProposal[];
      readonly actionSequenceTraces?: readonly ActionSequenceGenerationTrace[];
      readonly socialDialogueGenerationTraces?: readonly SocialDialogueGenerationTrace[];
      readonly socialSignalExtractionTraces?: readonly SocialSignalExtractionTrace[];
      readonly globalSynthesisTrace?: GlobalSynthesisTrace;
      readonly reactiveCorrector: ReactiveCorrector;
      readonly replanningDecider?: ReplanningDecider;
    },
): Promise<AgentCycleResult> {
  const proposedActions = input.proposedActions;
  if (proposedActions.length === 0) {
    throw new Error(`no micro-planner supports subtask ${input.selectedSubtask.subtaskId}`);
  }
  const actionSynthesisResult = synthesizeActionCandidates({
    actions: proposedActions,
    ...(input.actionSynthesis === undefined ? {} : { policy: input.actionSynthesis }),
  });
  const candidateActions = actionSynthesisResult.acceptedActions;
  if (candidateActions.length === 0) {
    const simulationResults = createActionSynthesisReplanResults(
      actionSynthesisResult.rejectedActions,
    );
    return finalizeAgentCycleResultWithOptionalAsyncReplanning({
      simulationId: input.simulationId,
      agentId: input.agentId,
      issuedAt: input.issuedAt,
      plan: input.plan,
      signals: input.signals,
      progress: input.progress,
      ...(input.observedStateSummary === undefined
        ? {}
        : { observedStateSummary: input.observedStateSummary }),
      replanningPolicy: input.replanningPolicy,
      ...(input.replanningDecider === undefined
        ? {}
        : { replanningDecider: input.replanningDecider }),
      subtaskCompletion: input.subtaskCompletion,
      shortTermMemoryContext: input.shortTermMemoryContext,
      ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
      ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
      ...(input.worldDecisionContext === undefined
        ? {}
        : { worldDecisionContext: input.worldDecisionContext }),
      selectedSubtask: input.selectedSubtask,
      prioritizationTrace: input.prioritizationTrace,
      actionSequenceTraces: input.actionSequenceTraces,
      socialDialogueGenerationTraces: input.socialDialogueGenerationTraces,
      socialSignalExtractionTraces: input.socialSignalExtractionTraces,
      globalSynthesisTrace: input.globalSynthesisTrace,
      selectionEvidence: input.selectionEvidence,
      subtaskCandidates: input.subtaskCandidates,
      actionSynthesisResult,
      candidateActions,
      simulationResults,
      selectedSubtasksByKey: input.synthesisSubtasksByKey,
    });
  }

  const repairResults: TieredActionRepairResult[] = [];
  for (const action of candidateActions) {
    const selectedSubtask = resolveSelectedSubtaskForAction({
      action,
      fallback: input.selectedSubtask,
      selectedSubtasksByKey: input.synthesisSubtasksByKey,
    });
    repairResults.push(
      await simulateActionWithTieredRepair({
        action,
        selectedSubtask,
        simulate: (candidate) =>
          input.simulate({
            action: candidate,
            selectedSubtask: resolveSelectedSubtaskForAction({
              action: candidate,
              fallback: selectedSubtask,
              selectedSubtasksByKey: input.synthesisSubtasksByKey,
            }),
          }),
        ...(input.repair === undefined
          ? {}
          : {
              localRepair: ({ rejectedAction, reason }) =>
                input.repair?.(
                  createCycleRepairPolicyInput({
                    input,
                    selectedSubtask,
                    rejectedAction,
                    reason,
                  }),
                ),
            }),
        reactiveCorrector: input.reactiveCorrector,
        reactiveCorrectorInput: {
          agentId: input.agentId,
          issuedAt: input.issuedAt,
          plan: input.plan,
          signals: input.signals,
          allowedCommandTypes: AGENT_ACTION_COMMAND_TYPES,
          ...(input.observedStateSummary === undefined
            ? {}
            : { observedStateSummary: input.observedStateSummary }),
          ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
          ...(input.shortTermMemoryContext === undefined
            ? {}
            : { shortTermMemoryContext: input.shortTermMemoryContext }),
          ...(input.longTermProfile === undefined
            ? {}
            : { longTermProfile: input.longTermProfile }),
          ...(input.worldDecisionContext === undefined
            ? {}
            : { worldDecisionContext: input.worldDecisionContext }),
        },
      }),
    );
  }
  const simulationResults = repairResults.map((result) => result.result);
  const actionRepairTraces = repairResults.flatMap((result) =>
    result.trace === undefined ? [] : [result.trace],
  );

  return finalizeAgentCycleResultWithOptionalAsyncReplanning({
    simulationId: input.simulationId,
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: input.signals,
    progress: input.progress,
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    replanningPolicy: input.replanningPolicy,
    ...(input.replanningDecider === undefined
      ? {}
      : { replanningDecider: input.replanningDecider }),
    subtaskCompletion: input.subtaskCompletion,
    shortTermMemoryContext: input.shortTermMemoryContext,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
    selectedSubtask: input.selectedSubtask,
    prioritizationTrace: input.prioritizationTrace,
    actionSequenceTraces: input.actionSequenceTraces,
    socialDialogueGenerationTraces: input.socialDialogueGenerationTraces,
    socialSignalExtractionTraces: input.socialSignalExtractionTraces,
    globalSynthesisTrace: input.globalSynthesisTrace,
    ...(actionRepairTraces.length === 0 ? {} : { actionRepairTraces }),
    selectionEvidence: input.selectionEvidence,
    subtaskCandidates: input.subtaskCandidates,
    actionSynthesisResult,
    candidateActions,
    simulationResults,
    selectedSubtasksByKey: input.synthesisSubtasksByKey,
  });
}

type FinalizeAgentCycleResultInput = {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan?: BranchPlan;
  readonly signals?: readonly ContextSignal[];
  readonly observedStateSummary?: string;
  readonly intentionState?: AgentIntentionState;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
  readonly progress: BranchPlanProgress | undefined;
  readonly replanningPolicy: AdaptiveReplanningPolicy | undefined;
  readonly subtaskCompletion: CycleSubtaskCompletionPolicy | undefined;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[] | undefined;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly prioritizationTrace: SubtaskPrioritizationTrace | undefined;
  readonly actionSequenceTraces: readonly ActionSequenceGenerationTrace[] | undefined;
  readonly socialDialogueGenerationTraces: readonly SocialDialogueGenerationTrace[] | undefined;
  readonly socialSignalExtractionTraces: readonly SocialSignalExtractionTrace[] | undefined;
  readonly globalSynthesisTrace: GlobalSynthesisTrace | undefined;
  readonly actionRepairTraces?: readonly ActionRepairTrace[];
  readonly selectionEvidence: AgentCycleSelectionEvidence;
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly actionSynthesisResult: ActionSynthesisResult;
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
};

function finalizeAgentCycleResult(input: FinalizeAgentCycleResultInput): AgentCycleResult {
  const replanningDecisionResult = createDeterministicReplanningDecisionResult({
    selectedSubtask: input.selectedSubtask,
    simulationResults: input.simulationResults,
    shortTermMemoryContext: input.shortTermMemoryContext ?? [],
    policy: normalizeReplanningPolicy(input.replanningPolicy),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
  return buildAgentCycleResult({
    input,
    replanningDecisionResult,
    includeReplanningTrace: false,
  });
}

async function finalizeAgentCycleResultWithOptionalAsyncReplanning(
  input: FinalizeAgentCycleResultInput & {
    readonly plan: BranchPlan;
    readonly signals: readonly ContextSignal[];
    readonly replanningDecider?: ReplanningDecider;
  },
): Promise<AgentCycleResult> {
  if (input.replanningDecider === undefined) {
    return finalizeAgentCycleResult(input);
  }
  return finalizeAgentCycleResultWithAsyncReplanning({
    ...input,
    replanningDecider: input.replanningDecider,
  });
}

async function finalizeAgentCycleResultWithAsyncReplanning(
  input: FinalizeAgentCycleResultInput & {
    readonly plan: BranchPlan;
    readonly signals: readonly ContextSignal[];
    readonly replanningDecider: ReplanningDecider;
  },
): Promise<AgentCycleResult> {
  const replanningDecisionResult = await input.replanningDecider({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: input.signals,
    selectedSubtask: input.selectedSubtask,
    simulationResults: input.simulationResults,
    shortTermMemoryContext: input.shortTermMemoryContext ?? [],
    policy: normalizeReplanningPolicy(input.replanningPolicy),
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });

  return buildAgentCycleResult({
    input,
    replanningDecisionResult,
    includeReplanningTrace: true,
  });
}

function buildAgentCycleResult(input: {
  readonly input: FinalizeAgentCycleResultInput;
  readonly replanningDecisionResult: ReplanningDecisionResult;
  readonly includeReplanningTrace: boolean;
}): AgentCycleResult {
  const replanningDecision = input.replanningDecisionResult.decision;
  const subtaskReplanningDecisions = decideSubtaskReplanningByProducer({
    simulationResults: input.input.simulationResults,
    fallback: input.input.selectedSubtask,
    selectedSubtasksByKey: input.input.selectedSubtasksByKey,
    shortTermMemoryContext: input.input.shortTermMemoryContext,
    replanningPolicy: input.input.replanningPolicy,
  });
  const subtaskCompletionDecisions = decideSubtaskCompletionByProducer({
    simulationResults: input.input.simulationResults,
    fallback: input.input.selectedSubtask,
    selectedSubtasksByKey: input.input.selectedSubtasksByKey,
    subtaskCompletion: input.input.subtaskCompletion,
  });
  const subtaskCompletionDecision =
    subtaskCompletionDecisions.find((completion) =>
      sameSelectedSubtask(completion.selectedSubtask, input.input.selectedSubtask),
    )?.decision ??
    decideSubtaskCompletion({
      selectedSubtask: input.input.selectedSubtask,
      simulationResults: input.input.simulationResults,
      ...(input.input.subtaskCompletion === undefined
        ? {}
        : { subtaskCompletion: input.input.subtaskCompletion }),
    });
  const progressUpdate =
    input.input.progress === undefined
      ? undefined
      : applyCycleProgressUpdate({
          progress: input.input.progress,
          selectedSubtask: input.input.selectedSubtask,
          decision: replanningDecision,
          selectedSubtaskCompletionDecision: subtaskCompletionDecision,
          subtaskCompletionDecisions,
          simulationResults: input.input.simulationResults,
          selectedSubtasksByKey: input.input.selectedSubtasksByKey,
          at: input.input.issuedAt,
        });

  return {
    selectedSubtask: input.input.selectedSubtask,
    ...(input.input.prioritizationTrace === undefined
      ? {}
      : { prioritizationTrace: input.input.prioritizationTrace }),
    ...(input.input.actionSequenceTraces === undefined
      ? {}
      : { actionSequenceTraces: input.input.actionSequenceTraces }),
    ...(input.input.socialDialogueGenerationTraces === undefined
      ? {}
      : { socialDialogueGenerationTraces: input.input.socialDialogueGenerationTraces }),
    ...(input.input.socialSignalExtractionTraces === undefined
      ? {}
      : { socialSignalExtractionTraces: input.input.socialSignalExtractionTraces }),
    ...(input.input.globalSynthesisTrace === undefined
      ? {}
      : { globalSynthesisTrace: input.input.globalSynthesisTrace }),
    ...(input.input.actionRepairTraces === undefined
      ? {}
      : { actionRepairTraces: input.input.actionRepairTraces }),
    selectionEvidence: input.input.selectionEvidence,
    subtaskCandidates: input.input.subtaskCandidates,
    actionSynthesisResult: input.input.actionSynthesisResult,
    candidateActions: input.input.candidateActions,
    simulationResults: input.input.simulationResults,
    commandDrafts: input.input.simulationResults.flatMap((result) =>
      result.status === 'needs-replan'
        ? []
        : [createCommandDraft(input.input, actionFromSimulationResult(result))],
    ),
    replanningDecision,
    ...(input.includeReplanningTrace
      ? { replanningTrace: input.replanningDecisionResult.trace }
      : {}),
    subtaskReplanningDecisions,
    subtaskCompletionDecision,
    subtaskCompletionDecisions,
    ...(progressUpdate === undefined ? {} : { progressUpdate }),
    needsReplan: input.input.simulationResults.some((result) => result.status === 'needs-replan'),
  };
}

function normalizeReplanningPolicy(
  policy: AdaptiveReplanningPolicy | undefined,
): AdaptiveReplanningPolicy {
  return {
    consecutiveFailureThreshold: policy?.consecutiveFailureThreshold ?? 2,
    ...(policy?.failureTags === undefined ? {} : { failureTags: policy.failureTags }),
    ...(policy?.majorContextShift === undefined ? {} : { majorContextShift: policy.majorContextShift }),
  };
}

function decideSubtaskReplanningByProducer(input: {
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly fallback: PrioritizedSubtask;
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[] | undefined;
  readonly replanningPolicy: AdaptiveReplanningPolicy | undefined;
}): readonly AgentCycleSubtaskReplanningDecision[] {
  return groupSimulationResultsByProducer(input).map((group) => ({
    selectedSubtask: group.selectedSubtask,
    decision: decideAdaptiveReplanning({
      selectedSubtask: group.selectedSubtask,
      simulationResults: group.simulationResults,
      shortTermMemoryContext: input.shortTermMemoryContext ?? [],
      consecutiveFailureThreshold: input.replanningPolicy?.consecutiveFailureThreshold ?? 2,
      ...(input.replanningPolicy?.failureTags === undefined
        ? {}
        : { failureTags: input.replanningPolicy.failureTags }),
      ...(input.replanningPolicy?.majorContextShift === undefined
        ? {}
        : { majorContextShift: input.replanningPolicy.majorContextShift }),
    }),
  }));
}

function decideSubtaskCompletionByProducer(input: {
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly fallback: PrioritizedSubtask;
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
  readonly subtaskCompletion: CycleSubtaskCompletionPolicy | undefined;
}): readonly AgentCycleSubtaskCompletionDecision[] {
  return groupSimulationResultsByProducer(input).map((group) => ({
    selectedSubtask: group.selectedSubtask,
    decision: decideSubtaskCompletion({
      selectedSubtask: group.selectedSubtask,
      simulationResults: group.simulationResults,
      ...(input.subtaskCompletion === undefined
        ? {}
        : { subtaskCompletion: input.subtaskCompletion }),
    }),
  }));
}

function applyCycleProgressUpdate(input: {
  readonly progress: BranchPlanProgress;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly decision: ReplanningDecision;
  readonly selectedSubtaskCompletionDecision: SubtaskCompletionDecision;
  readonly subtaskCompletionDecisions: readonly AgentCycleSubtaskCompletionDecision[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
  readonly at: number;
}): BranchPlanProgress | undefined {
  if (input.decision.kind !== 'none') {
    if (input.decision.kind === 'full-replan') {
      const failedProducerSubtasks = resolveFailedProducerSubtasks({
        simulationResults: input.simulationResults,
        fallback: input.selectedSubtask,
        selectedSubtasksByKey: input.selectedSubtasksByKey,
      });
      if (failedProducerSubtasks.length > 0) {
        return blockFailedProducerSubtasks({
          progress: input.progress,
          failedProducerSubtasks,
          decision: input.decision,
          at: input.at,
        });
      }
    }

    return applyReplanningDecisionToProgress({
      progress: input.progress,
      selectedSubtask: input.selectedSubtask,
      decision: input.decision,
      completionDecision: input.selectedSubtaskCompletionDecision,
      at: input.at,
    });
  }

  let updatedProgress = input.progress;
  let hasCompletedSubtask = false;
  for (const completion of input.subtaskCompletionDecisions) {
    if (completion.decision.status === 'in-progress') {
      continue;
    }
    updatedProgress = markSubtaskCompleted(updatedProgress, {
      subtaskId: completion.selectedSubtask.subtaskId,
      completedAt: input.at,
    });
    hasCompletedSubtask = true;
  }

  return hasCompletedSubtask ? updatedProgress : undefined;
}

function resolveFailedProducerSubtasks(input: {
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly fallback: PrioritizedSubtask;
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
}): readonly PrioritizedSubtask[] {
  const failedProducerSubtasks = new Map<string, PrioritizedSubtask>();

  for (const result of input.simulationResults) {
    if (result.status !== 'needs-replan') {
      continue;
    }
    const selectedSubtask = resolveSelectedSubtaskForAction({
      action: actionFromSimulationResultForAttribution(result),
      fallback: input.fallback,
      selectedSubtasksByKey: input.selectedSubtasksByKey,
    });
    failedProducerSubtasks.set(
      createSubtaskContextKey(selectedSubtask.branchId, selectedSubtask.subtaskId),
      selectedSubtask,
    );
  }

  return [...failedProducerSubtasks.values()];
}

function blockFailedProducerSubtasks(input: {
  readonly progress: BranchPlanProgress;
  readonly failedProducerSubtasks: readonly PrioritizedSubtask[];
  readonly decision: Extract<ReplanningDecision, { readonly kind: 'full-replan' }>;
  readonly at: number;
}): BranchPlanProgress {
  let updatedProgress = input.progress;
  for (const selectedSubtask of input.failedProducerSubtasks) {
    updatedProgress = markSubtaskBlocked(updatedProgress, {
      subtaskId: selectedSubtask.subtaskId,
      reason: `${input.decision.trigger}: ${input.decision.reason}`,
      blockedAt: input.at,
    });
  }
  return updatedProgress;
}

function groupSimulationResultsByProducer(input: {
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly fallback: PrioritizedSubtask;
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
}): readonly {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
}[] {
  const groups = new Map<
    string,
    {
      readonly selectedSubtask: PrioritizedSubtask;
      readonly simulationResults: ActionWithRepairResult[];
    }
  >();

  for (const result of input.simulationResults) {
    const selectedSubtask = resolveSelectedSubtaskForAction({
      action: actionFromSimulationResultForAttribution(result),
      fallback: input.fallback,
      selectedSubtasksByKey: input.selectedSubtasksByKey,
    });
    const key = createSubtaskContextKey(selectedSubtask.branchId, selectedSubtask.subtaskId);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { selectedSubtask, simulationResults: [result] });
      continue;
    }
    group.simulationResults.push(result);
  }

  return [...groups.values()];
}

function actionFromSimulationResultForAttribution(
  result: ActionWithRepairResult,
): AtomicActionProposal {
  switch (result.status) {
    case 'accepted':
      return result.action;
    case 'repaired':
      return result.repairedAction.synthesisContext === undefined
        ? result.originalAction
        : result.repairedAction;
    case 'needs-replan':
      return result.action;
  }
}

function createActionSynthesisReplanResults(
  rejectedActions: readonly RejectedSynthesizedAction[],
): readonly ActionWithRepairResult[] {
  if (rejectedActions.length === 0) {
    throw new Error('action synthesis produced no accepted or rejected candidate actions');
  }

  return rejectedActions.map((rejectedAction) => ({
    status: 'needs-replan',
    action: rejectedAction.action,
    reason: `action synthesis rejected action: ${rejectedAction.reason}`,
  }));
}

function selectSynthesisSubtaskCandidates(input: {
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
  readonly policy: ActionSynthesisPolicy | undefined;
}): readonly PrioritizedSubtaskCandidate[] {
  const maxSubtasks = input.policy?.candidateSubtasks?.maxSubtasks ?? 1;
  if (!Number.isInteger(maxSubtasks) || maxSubtasks <= 0) {
    throw new Error('action synthesis candidateSubtasks.maxSubtasks must be a positive integer');
  }
  return input.candidates.slice(0, maxSubtasks);
}

function collectSynthesisActionProposals(
  input: DomainMicroPlannerContext & {
    readonly candidates: readonly PrioritizedSubtaskCandidate[];
    readonly microPlanners: readonly DomainMicroPlanner[];
  },
): readonly AtomicActionProposal[] {
  const proposedActions: AtomicActionProposal[] = [];

  for (const candidate of input.candidates) {
    const selectedSubtask = toPrioritizedSubtask(candidate);
    const microPlanner = input.microPlanners.find((planner) => planner.supports(selectedSubtask));
    if (microPlanner === undefined) {
      continue;
    }

    const actions = microPlanner.propose(
      createDomainMicroPlannerInput({
        ...input,
        selectedSubtask,
      }),
    );
    if (actions.length === 0) {
      throw new Error(`micro-planner ${microPlanner.domain} produced no candidate actions`);
    }
    proposedActions.push(
      ...actions.map((action) => attachSelectedSubtaskSynthesisContext(action, candidate)),
    );
  }

  return proposedActions;
}

async function collectSynthesisActionProposalsWithGeneration(input: {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly observedStateSummary?: string;
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly actionSequenceGenerator: ActionSequenceGenerator;
}): Promise<{
  readonly proposedActions: readonly AtomicActionProposal[];
  readonly traces: readonly ActionSequenceGenerationTrace[];
}> {
  const proposedActions: AtomicActionProposal[] = [];
  const traces: ActionSequenceGenerationTrace[] = [];

  for (const candidate of input.candidates) {
    const selectedSubtask = toPrioritizedSubtask(candidate);
    const microPlanner = input.microPlanners.find((planner) => planner.supports(selectedSubtask));
    if (microPlanner === undefined) {
      continue;
    }

    const deterministicActions = microPlanner.propose(
      createDomainMicroPlannerInput({
        ...input,
        selectedSubtask,
      }),
    );
    if (deterministicActions.length === 0) {
      throw new Error(`micro-planner ${microPlanner.domain} produced no candidate actions`);
    }

    const result = await input.actionSequenceGenerator({
      agentId: input.agentId,
      issuedAt: input.issuedAt,
      plan: input.plan,
      selectedSubtask,
      signals: input.signals,
      deterministicActions,
      ...(input.observedStateSummary === undefined
        ? {}
        : { observedStateSummary: input.observedStateSummary }),
      ...(input.progress === undefined ? {} : { progress: input.progress }),
      ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
      ...(input.shortTermMemoryContext === undefined
        ? {}
        : { shortTermMemoryContext: input.shortTermMemoryContext }),
      ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
      ...(input.worldDecisionContext === undefined
        ? {}
        : { worldDecisionContext: input.worldDecisionContext }),
    });
    if (result.actions.length === 0) {
      throw new Error(`action sequence generator produced no candidate actions`);
    }

    traces.push(result.trace);
    proposedActions.push(
      ...result.actions.map((action) => attachSelectedSubtaskSynthesisContext(action, candidate)),
    );
  }

  return { proposedActions, traces };
}

function createDomainMicroPlannerContext(
  input: AgentPlanningCycleInput,
): DomainMicroPlannerContext {
  return {
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: input.signals,
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
    ...(input.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: input.shortTermMemoryContext }),
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  };
}

function createDomainMicroPlannerInput(input: DomainMicroPlannerInput): DomainMicroPlannerInput {
  return {
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    selectedSubtask: input.selectedSubtask,
    signals: input.signals,
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
    ...(input.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: input.shortTermMemoryContext }),
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  };
}

function createCycleRepairPolicyInput(input: {
  readonly input: AgentPlanningCycleInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
}): CycleRepairPolicyInput {
  return {
    ...createDomainMicroPlannerContext(input.input),
    selectedSubtask: input.selectedSubtask,
    rejectedAction: input.rejectedAction,
    reason: input.reason,
  };
}

async function applySocialDialogueGenerationToActions(input: {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly observedStateSummary?: string;
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
  readonly proposedActions: readonly AtomicActionProposal[];
  readonly selectedSubtask: PrioritizedSubtask;
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly socialSignalExtractor?: SocialSignalExtractor;
}): Promise<{
  readonly proposedActions: readonly AtomicActionProposal[];
  readonly traces?: readonly SocialDialogueGenerationTrace[];
  readonly signalTraces?: readonly SocialSignalExtractionTrace[];
}> {
  const proposedActions: AtomicActionProposal[] = [];
  const traces: SocialDialogueGenerationTrace[] = [];
  const signalTraces: SocialSignalExtractionTrace[] = [];

  for (const action of input.proposedActions) {
    const deterministicPayload =
      action.commandType === 'AgentStartConversation'
        ? readSocialDialoguePayload(action.payload)
        : undefined;
    if (deterministicPayload === undefined) {
      proposedActions.push(action);
      continue;
    }

    const selectedSubtask = resolveSelectedSubtaskForAction({
      action,
      fallback: input.selectedSubtask,
      selectedSubtasksByKey: input.selectedSubtasksByKey,
    });
    let payload = deterministicPayload;
    if (input.socialDialogueGenerator !== undefined) {
      const socialAction: AtomicActionProposal<'AgentStartConversation', SocialDialoguePayload> = {
        ...action,
        commandType: 'AgentStartConversation',
        payload: deterministicPayload,
      };
      const result = await input.socialDialogueGenerator({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        plan: input.plan,
        selectedSubtask,
        action: socialAction,
        deterministicPayload,
        signals: input.signals,
        ...(input.observedStateSummary === undefined
          ? {}
          : { observedStateSummary: input.observedStateSummary }),
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
        ...(input.shortTermMemoryContext === undefined
          ? {}
          : { shortTermMemoryContext: input.shortTermMemoryContext }),
        ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
      });

      traces.push(result.trace);
      payload = result.payload;
    }

    const extractionInput = {
      agentId: input.agentId,
      issuedAt: input.issuedAt,
      targetAgentId: payload.targetAgentId,
      topic: payload.topic,
      turns: payload.turns,
    };
    if (input.socialSignalExtractor === undefined) {
      signalTraces.push(createDeterministicSocialSignalExtractionTrace(extractionInput));
    } else {
      const extraction = await input.socialSignalExtractor(extractionInput);
      signalTraces.push(extraction.trace);
      if (extraction.turnSignals !== undefined) {
        payload = { ...payload, turnSignals: extraction.turnSignals };
      }
    }

    proposedActions.push({
      ...action,
      payload,
    });
  }

  return {
    proposedActions,
    ...(traces.length === 0 ? {} : { traces }),
    ...(signalTraces.length === 0 ? {} : { signalTraces }),
  };
}

function readSocialDialoguePayload(value: unknown): SocialDialoguePayload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.targetAgentId !== 'string' ||
    record.targetAgentId.trim().length === 0 ||
    typeof record.topic !== 'string' ||
    record.topic.trim().length === 0 ||
    typeof record.relationDelta !== 'number' ||
    !Number.isFinite(record.relationDelta) ||
    typeof record.attitudeDelta !== 'number' ||
    !Number.isFinite(record.attitudeDelta) ||
    !Array.isArray(record.turns)
  ) {
    return undefined;
  }

  const turns = readSocialDialogueTurns(record.turns);
  if (turns === undefined) {
    return undefined;
  }
  const planningContext = parseSocialPlanningContextTrace(record.planningContext);
  if (record.planningContext !== undefined && planningContext === undefined) {
    return undefined;
  }

  return {
    targetAgentId: asAgentId(record.targetAgentId),
    topic: record.topic,
    relationDelta: record.relationDelta,
    attitudeDelta: record.attitudeDelta,
    turns,
    ...(planningContext === undefined ? {} : { planningContext }),
  };
}

function readSocialDialogueTurns(
  values: readonly unknown[],
): readonly SocialDialoguePayload['turns'][number][] | undefined {
  const turns: SocialDialoguePayload['turns'][number][] = [];
  for (const value of values) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.speakerAgentId !== 'string' ||
      record.speakerAgentId.trim().length === 0 ||
      typeof record.utterance !== 'string' ||
      record.utterance.trim().length === 0
    ) {
      return undefined;
    }
    if (record.intent !== undefined && typeof record.intent !== 'string') {
      return undefined;
    }
    turns.push({
      speakerAgentId: asAgentId(record.speakerAgentId),
      utterance: record.utterance,
      ...(record.intent === undefined ? {} : { intent: record.intent }),
    });
  }
  return turns;
}

function createSelectedSubtaskMap(
  candidates: readonly PrioritizedSubtaskCandidate[],
): ReadonlyMap<string, PrioritizedSubtask> {
  return new Map(
    candidates.map((candidate) => [
      createSubtaskContextKey(candidate.branchId, candidate.subtaskId),
      toPrioritizedSubtask(candidate),
    ]),
  );
}

function resolveSelectedSubtaskForAction(input: {
  readonly action: AtomicActionProposal;
  readonly fallback: PrioritizedSubtask;
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
}): PrioritizedSubtask {
  const branchId = input.action.synthesisContext?.branchId;
  const subtaskId = input.action.synthesisContext?.subtaskId;
  if (branchId === undefined || subtaskId === undefined) {
    return input.fallback;
  }
  return (
    input.selectedSubtasksByKey.get(createSubtaskContextKey(branchId, subtaskId)) ?? input.fallback
  );
}

function attachSelectedSubtaskSynthesisContext(
  action: AtomicActionProposal,
  selectedCandidate: PrioritizedSubtaskCandidate,
): AtomicActionProposal {
  const context = action.synthesisContext;
  return {
    ...action,
    synthesisContext: {
      branchId: context?.branchId ?? selectedCandidate.branchId,
      subtaskId: context?.subtaskId ?? selectedCandidate.subtaskId,
      subtaskScore: context?.subtaskScore ?? selectedCandidate.score,
      ...(context?.strategicAlignment === undefined
        ? {}
        : { strategicAlignment: context.strategicAlignment }),
      ...(context?.branchUrgency === undefined ? {} : { branchUrgency: context.branchUrgency }),
    },
  };
}

function createSubtaskContextKey(branchId: string, subtaskId: string): string {
  return `${branchId}\u0000${subtaskId}`;
}

function sameSelectedSubtask(left: PrioritizedSubtask, right: PrioritizedSubtask): boolean {
  return left.branchId === right.branchId && left.subtaskId === right.subtaskId;
}

function decideSubtaskCompletion(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
}): SubtaskCompletionDecision {
  if (input.simulationResults.some((result) => result.status === 'needs-replan')) {
    return { status: 'in-progress', reason: 'cycle requires replanning' };
  }

  return (
    input.subtaskCompletion?.({
      selectedSubtask: input.selectedSubtask,
      simulationResults: input.simulationResults,
    }) ?? { status: 'completed' }
  );
}

function createSelectionEvidence(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly intentionInfluence?: Readonly<Record<string, IntentionInfluenceScore>>;
  readonly memoryInfluence?: Readonly<Record<string, MemoryInfluenceScore>>;
  readonly profileInfluence?: Readonly<Record<string, ProfileInfluenceScore>>;
}): AgentCycleSelectionEvidence {
  const subtaskId = input.selectedSubtask.subtaskId;
  const intentionInfluence = input.intentionInfluence?.[subtaskId];
  const memoryInfluence = input.memoryInfluence?.[subtaskId];
  const profileInfluence = input.profileInfluence?.[subtaskId];

  return {
    selectedSubtaskId: subtaskId,
    intentionInfluenceScore: intentionInfluence?.score ?? 0,
    memoryInfluenceScore: memoryInfluence?.score ?? 0,
    profileInfluenceScore: profileInfluence?.score ?? 0,
    memoryEvidenceRecordIds: sortedUnique(
      memoryInfluence?.matches.map((match) => match.recordId) ?? [],
    ),
    profileEntryKeys: sortedUnique(profileInfluence?.matches.map((match) => match.key) ?? []),
    profileEvidenceRecordIds: sortedUnique(
      profileInfluence?.matches.flatMap((match) => match.provenanceRecordIds) ?? [],
    ),
  };
}

function buildIntentionInfluenceBySubtask(
  plan: BranchPlan,
  intentionState: AgentIntentionState,
  at: number,
): Readonly<Record<string, IntentionInfluenceScore>> {
  return Object.fromEntries(
    plan.branches.flatMap((branch) =>
      branch.subtasks.map((subtask) => [
        subtask.id,
        scoreIntentionInfluence({
          intentionState,
          affinityTags: subtask.intentionAffinityTags ?? [],
          at,
        }),
      ]),
    ),
  );
}

function buildMemoryInfluenceBySubtask(
  plan: BranchPlan,
  records: readonly ShortTermMemoryRecord[],
  at: number,
): Readonly<Record<string, MemoryInfluenceScore>> {
  return Object.fromEntries(
    plan.branches.flatMap((branch) =>
      branch.subtasks.map((subtask) => [
        subtask.id,
        scoreMemoryInfluence({
          records,
          affinityTags: subtask.memoryAffinityTags ?? [],
          at,
        }),
      ]),
    ),
  );
}

function buildProfileInfluenceBySubtask(
  plan: BranchPlan,
  profile: LongTermAgentProfile,
): Readonly<Record<string, ProfileInfluenceScore>> {
  return Object.fromEntries(
    plan.branches.flatMap((branch) =>
      branch.subtasks.map((subtask) => [
        subtask.id,
        scoreProfileInfluence({
          profile,
          affinityTags: subtask.profileAffinityTags ?? [],
        }),
      ]),
    ),
  );
}

function actionFromSimulationResult(result: ActionWithRepairResult): AtomicActionProposal {
  switch (result.status) {
    case 'accepted':
      return result.action;
    case 'repaired':
      return result.repairedAction;
    case 'needs-replan':
      throw new Error('cannot create a command draft from an action that needs replanning');
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toPrioritizedSubtask(candidate: PrioritizedSubtaskCandidate): PrioritizedSubtask {
  return {
    branchId: candidate.branchId,
    subtaskId: candidate.subtaskId,
    description: candidate.description,
    score: candidate.score,
  };
}

function createCommandDraft(
  input: {
    readonly simulationId: SimulationId;
    readonly agentId: AgentId;
    readonly issuedAt: number;
  },
  action: AtomicActionProposal,
): CommandDraft {
  return {
    simulationId: input.simulationId,
    actorId: input.agentId,
    source: 'agent-runtime',
    type: action.commandType,
    payload: action.payload,
    issuedAt: input.issuedAt,
  };
}
