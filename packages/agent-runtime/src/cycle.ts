import type { AgentId, CommandSource, CoreCommandType, SimulationId } from '@aivilization/sim-core';
import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
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
import { markSubtaskCompleted, type BranchPlanProgress } from './planProgress';
import { scoreProfileInfluence, type ProfileInfluenceScore } from './profileInfluence';
import {
  applyReplanningDecisionToProgress,
  decideAdaptiveReplanning,
  type AdaptiveReplanningPolicy,
  type ReplanningDecision,
  type SubtaskCompletionDecision,
} from './replanning';

export type DomainMicroPlanner = {
  readonly domain: string;
  supports(selectedSubtask: PrioritizedSubtask): boolean;
  propose(input: { readonly selectedSubtask: PrioritizedSubtask }): readonly AtomicActionProposal[];
};

export type CycleActionSimulator = (input: {
  readonly action: AtomicActionProposal;
  readonly selectedSubtask: PrioritizedSubtask;
}) => ActionSimulationResult;

export type CycleRepairPolicy = (input: {
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
  readonly selectedSubtask: PrioritizedSubtask;
}) => AtomicActionProposal | undefined;

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
  readonly selectionEvidence: AgentCycleSelectionEvidence;
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly actionSynthesisResult: ActionSynthesisResult;
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly commandDrafts: readonly CommandDraft[];
  readonly replanningDecision: ReplanningDecision;
  readonly subtaskCompletionDecision: SubtaskCompletionDecision;
  readonly subtaskCompletionDecisions: readonly AgentCycleSubtaskCompletionDecision[];
  readonly progressUpdate?: BranchPlanProgress;
  readonly needsReplan: boolean;
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

export function runAgentPlanningCycle(input: {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly progress?: BranchPlanProgress;
  readonly signals: readonly ContextSignal[];
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
}): AgentCycleResult {
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
    ...(intentionInfluence === undefined ? {} : { intentionInfluence }),
    ...(memoryInfluence === undefined ? {} : { memoryInfluence }),
    ...(profileInfluence === undefined ? {} : { profileInfluence }),
  });
  const proposedActions = collectSynthesisActionProposals({
    candidates: synthesisSubtaskCandidates,
    microPlanners: input.microPlanners,
  });
  if (proposedActions.length === 0) {
    throw new Error(`no micro-planner supports subtask ${selectedSubtask.subtaskId}`);
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
      selectedSubtask,
      selectionEvidence,
      subtaskCandidates,
      actionSynthesisResult,
      candidateActions,
      simulationResults,
      selectedSubtasksByKey: synthesisSubtasksByKey,
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
            fallback: selectedSubtask,
            selectedSubtasksByKey: synthesisSubtasksByKey,
          }),
        }),
      ...(input.repair === undefined
        ? {}
        : {
            repair: ({ rejectedAction, reason }) =>
              input.repair?.({
                rejectedAction,
                reason,
                selectedSubtask: resolveSelectedSubtaskForAction({
                  action: rejectedAction,
                  fallback: selectedSubtask,
                  selectedSubtasksByKey: synthesisSubtasksByKey,
                }),
              }),
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
    selectedSubtask,
    selectionEvidence,
    subtaskCandidates,
    actionSynthesisResult,
    candidateActions,
    simulationResults,
    selectedSubtasksByKey: synthesisSubtasksByKey,
  });
}

function finalizeAgentCycleResult(input: {
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly progress: BranchPlanProgress | undefined;
  readonly replanningPolicy: AdaptiveReplanningPolicy | undefined;
  readonly subtaskCompletion: CycleSubtaskCompletionPolicy | undefined;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[] | undefined;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly selectionEvidence: AgentCycleSelectionEvidence;
  readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[];
  readonly actionSynthesisResult: ActionSynthesisResult;
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly selectedSubtasksByKey: ReadonlyMap<string, PrioritizedSubtask>;
}): AgentCycleResult {
  const replanningDecision = decideAdaptiveReplanning({
    selectedSubtask: input.selectedSubtask,
    simulationResults: input.simulationResults,
    shortTermMemoryContext: input.shortTermMemoryContext ?? [],
    consecutiveFailureThreshold: input.replanningPolicy?.consecutiveFailureThreshold ?? 2,
    ...(input.replanningPolicy?.failureTags === undefined
      ? {}
      : { failureTags: input.replanningPolicy.failureTags }),
    ...(input.replanningPolicy?.majorContextShift === undefined
      ? {}
      : { majorContextShift: input.replanningPolicy.majorContextShift }),
  });
  const subtaskCompletionDecisions = decideSubtaskCompletionByProducer({
    simulationResults: input.simulationResults,
    fallback: input.selectedSubtask,
    selectedSubtasksByKey: input.selectedSubtasksByKey,
    subtaskCompletion: input.subtaskCompletion,
  });
  const subtaskCompletionDecision =
    subtaskCompletionDecisions.find((completion) =>
      sameSelectedSubtask(completion.selectedSubtask, input.selectedSubtask),
    )?.decision ??
    decideSubtaskCompletion({
      selectedSubtask: input.selectedSubtask,
      simulationResults: input.simulationResults,
      ...(input.subtaskCompletion === undefined
        ? {}
        : { subtaskCompletion: input.subtaskCompletion }),
    });
  const progressUpdate =
    input.progress === undefined
      ? undefined
      : applyCycleProgressUpdate({
          progress: input.progress,
          selectedSubtask: input.selectedSubtask,
          decision: replanningDecision,
          selectedSubtaskCompletionDecision: subtaskCompletionDecision,
          subtaskCompletionDecisions,
          at: input.issuedAt,
        });

  return {
    selectedSubtask: input.selectedSubtask,
    selectionEvidence: input.selectionEvidence,
    subtaskCandidates: input.subtaskCandidates,
    actionSynthesisResult: input.actionSynthesisResult,
    candidateActions: input.candidateActions,
    simulationResults: input.simulationResults,
    commandDrafts: input.simulationResults.flatMap((result) =>
      result.status === 'needs-replan'
        ? []
        : [createCommandDraft(input, actionFromSimulationResult(result))],
    ),
    replanningDecision,
    subtaskCompletionDecision,
    subtaskCompletionDecisions,
    ...(progressUpdate === undefined ? {} : { progressUpdate }),
    needsReplan: input.simulationResults.some((result) => result.status === 'needs-replan'),
  };
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
  readonly at: number;
}): BranchPlanProgress | undefined {
  if (input.decision.kind !== 'none') {
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

function collectSynthesisActionProposals(input: {
  readonly candidates: readonly PrioritizedSubtaskCandidate[];
  readonly microPlanners: readonly DomainMicroPlanner[];
}): readonly AtomicActionProposal[] {
  const proposedActions: AtomicActionProposal[] = [];

  for (const candidate of input.candidates) {
    const selectedSubtask = toPrioritizedSubtask(candidate);
    const microPlanner = input.microPlanners.find((planner) => planner.supports(selectedSubtask));
    if (microPlanner === undefined) {
      continue;
    }

    const actions = microPlanner.propose({ selectedSubtask });
    if (actions.length === 0) {
      throw new Error(`micro-planner ${microPlanner.domain} produced no candidate actions`);
    }
    proposedActions.push(
      ...actions.map((action) => attachSelectedSubtaskSynthesisContext(action, candidate)),
    );
  }

  return proposedActions;
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
