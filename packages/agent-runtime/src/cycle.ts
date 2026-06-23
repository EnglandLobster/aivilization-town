import type { AgentId, CommandSource, CoreCommandType, SimulationId } from '@aivilization/sim-core';
import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type {
  ActionSimulationResult,
  AtomicActionProposal,
  RepairPolicy,
  ActionWithRepairResult,
} from './actions';
import { simulateActionWithRepair } from './actions';
import type { BranchPlan, ContextSignal, PrioritizedSubtask } from './planner';
import { selectPrioritizedSubtask } from './planner';
import { scoreIntentionInfluence, type IntentionInfluenceScore } from './intentionInfluence';
import { scoreMemoryInfluence, type MemoryInfluenceScore } from './memoryInfluence';
import type { BranchPlanProgress } from './planProgress';
import { scoreProfileInfluence, type ProfileInfluenceScore } from './profileInfluence';
import {
  applyReplanningDecisionToProgress,
  decideAdaptiveReplanning,
  type AdaptiveReplanningPolicy,
  type ReplanningDecision,
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
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly commandDrafts: readonly CommandDraft[];
  readonly replanningDecision: ReplanningDecision;
  readonly progressUpdate?: BranchPlanProgress;
  readonly needsReplan: boolean;
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
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
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
  const selectedSubtask = selectPrioritizedSubtask({
    plan: input.plan,
    signals: input.signals,
    ...(input.progress === undefined ? {} : { progress: input.progress }),
    ...(intentionInfluence === undefined ? {} : { intentionInfluence }),
    ...(memoryInfluence === undefined ? {} : { memoryInfluence }),
    ...(profileInfluence === undefined ? {} : { profileInfluence }),
  });
  const selectionEvidence = createSelectionEvidence({
    selectedSubtask,
    ...(intentionInfluence === undefined ? {} : { intentionInfluence }),
    ...(memoryInfluence === undefined ? {} : { memoryInfluence }),
    ...(profileInfluence === undefined ? {} : { profileInfluence }),
  });
  const microPlanner = input.microPlanners.find((planner) => planner.supports(selectedSubtask));
  if (microPlanner === undefined) {
    throw new Error(`no micro-planner supports subtask ${selectedSubtask.subtaskId}`);
  }

  const candidateActions = [...microPlanner.propose({ selectedSubtask })];
  if (candidateActions.length === 0) {
    throw new Error(`micro-planner ${microPlanner.domain} produced no candidate actions`);
  }

  const repair = adaptRepairPolicy(input.repair, selectedSubtask);
  const simulationResults = candidateActions.map((action) =>
    simulateActionWithRepair({
      action,
      simulate: (candidate) => input.simulate({ action: candidate, selectedSubtask }),
      ...(repair === undefined ? {} : { repair }),
    }),
  );
  const replanningDecision = decideAdaptiveReplanning({
    selectedSubtask,
    simulationResults,
    shortTermMemoryContext: input.shortTermMemoryContext ?? [],
    consecutiveFailureThreshold: input.replanningPolicy?.consecutiveFailureThreshold ?? 2,
    ...(input.replanningPolicy?.failureTags === undefined
      ? {}
      : { failureTags: input.replanningPolicy.failureTags }),
    ...(input.replanningPolicy?.majorContextShift === undefined
      ? {}
      : { majorContextShift: input.replanningPolicy.majorContextShift }),
  });
  const progressUpdate =
    input.progress === undefined
      ? undefined
      : applyReplanningDecisionToProgress({
          progress: input.progress,
          selectedSubtask,
          decision: replanningDecision,
          at: input.issuedAt,
        });

  return {
    selectedSubtask,
    selectionEvidence,
    candidateActions,
    simulationResults,
    commandDrafts: simulationResults.flatMap((result) =>
      result.status === 'needs-replan'
        ? []
        : [createCommandDraft(input, actionFromSimulationResult(result))],
    ),
    replanningDecision,
    ...(progressUpdate === undefined ? {} : { progressUpdate }),
    needsReplan: simulationResults.some((result) => result.status === 'needs-replan'),
  };
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

function adaptRepairPolicy(
  repair: CycleRepairPolicy | undefined,
  selectedSubtask: PrioritizedSubtask,
): RepairPolicy | undefined {
  if (repair === undefined) {
    return undefined;
  }

  return ({ rejectedAction, reason }) => repair({ rejectedAction, reason, selectedSubtask });
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
