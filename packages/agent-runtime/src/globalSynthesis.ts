import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { AtomicActionProposal } from './actions';
import {
  synthesizeActionCandidates,
  type ActionSynthesisBudget,
  type ActionSynthesisPolicy,
  type ActionSynthesisResult,
} from './actionSynthesis';
import type {
  LlmLongTermProfileContextTrace,
  LlmShortTermMemoryContextTrace,
} from './llmContextTrace';
import type { BranchPlan, ContextSignal } from './planner';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

export type GlobalSynthesisChoice = {
  readonly actionId: string;
  readonly priorityScore: number;
  readonly rationale: string;
  readonly strategicAlignment?: number;
  readonly branchUrgency?: number;
};

export type GlobalSynthesisTraceAttempt = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
};

export type GlobalSynthesisTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly choices?: readonly GlobalSynthesisChoice[];
  readonly attempts?: readonly GlobalSynthesisTraceAttempt[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
  readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type GlobalSynthesisResult = {
  readonly actions: readonly AtomicActionProposal[];
  readonly trace: GlobalSynthesisTrace;
};

export const DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION = 'global-action-synthesis-v1';

export type DeterministicGlobalSynthesisPolicy = {
  readonly policyVersion: string;
  readonly weights: {
    readonly actionPriority: number;
    readonly strategicAlignment: number;
    readonly branchUrgency: number;
    readonly resourceHeadroom: number;
  };
  readonly physiologyUrgencyThresholds: {
    readonly energy: number;
    readonly satiety: number;
    readonly health: number;
  };
  readonly infeasibleScore: number;
};

export const DEFAULT_DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY: DeterministicGlobalSynthesisPolicy = {
  policyVersion: DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY_VERSION,
  weights: {
    actionPriority: 0.05,
    strategicAlignment: 0.2,
    branchUrgency: 0.6,
    resourceHeadroom: 0.15,
  },
  physiologyUrgencyThresholds: {
    energy: 20,
    satiety: 20,
    health: 20,
  },
  infeasibleScore: -1,
};

export type GlobalSynthesizerInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly deterministicSynthesisResult: ActionSynthesisResult;
  readonly actionSynthesisPolicy?: ActionSynthesisPolicy;
  readonly observedStateSummary?: string;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type GlobalActionSynthesizer = (
  input: GlobalSynthesizerInput,
) => Promise<GlobalSynthesisResult>;

export function createDeterministicGlobalSynthesisResult(
  input: GlobalSynthesizerInput,
  policy: DeterministicGlobalSynthesisPolicy = DEFAULT_DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY,
): GlobalSynthesisResult {
  validateDeterministicPolicy(policy);
  if (input.candidateActions.length === 0) {
    throw new Error('global synthesis requires at least one candidate action');
  }

  const candidateScores = [...scoreGlobalSynthesisCandidates({ input, policy })].sort(
    (left, right) =>
      right.priorityScore - left.priorityScore || left.action.id.localeCompare(right.action.id),
  );
  const choices = candidateScores.map((candidate): GlobalSynthesisChoice => ({
    actionId: candidate.action.id,
    priorityScore: candidate.priorityScore,
    strategicAlignment: candidate.strategicAlignment,
    branchUrgency: candidate.branchUrgency,
    rationale: [
      policy.policyVersion,
      `feasible=${candidate.feasible}`,
      `actionPriority=${formatScore(candidate.actionPriority)}`,
      `strategicAlignment=${formatScore(candidate.strategicAlignment)}`,
      `branchUrgency=${formatScore(candidate.branchUrgency)}`,
      `resourceHeadroom=${formatScore(candidate.resourceHeadroom)}`,
    ].join('; '),
  }));

  return {
    actions: applyGlobalSynthesisChoices({
      candidateActions: input.candidateActions,
      choices,
    }),
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      message: policy.policyVersion,
      choices,
    },
  };
}

export function createDeterministicGlobalActionSynthesizer(
  policy: DeterministicGlobalSynthesisPolicy = DEFAULT_DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY,
): GlobalActionSynthesizer {
  validateDeterministicPolicy(policy);
  return (input) => Promise.resolve(createDeterministicGlobalSynthesisResult(input, policy));
}

export function createDeterministicGlobalSynthesisPolicyManifest(
  policy: DeterministicGlobalSynthesisPolicy = DEFAULT_DETERMINISTIC_GLOBAL_SYNTHESIS_POLICY,
) {
  validateDeterministicPolicy(policy);
  return {
    policyVersion: policy.policyVersion,
    weights: { ...policy.weights },
    physiologyUrgencyThresholds: { ...policy.physiologyUrgencyThresholds },
    infeasibleScore: policy.infeasibleScore,
    tieBreak: 'action-id-ascending',
    resourceRule: 'individually-infeasible-actions-rank-below-feasible-actions',
    urgencyRule:
      'contextual-subtask-score-with-physiology-crisis-override-for-eat-sleep-healthcare',
  } as const;
}

type ScoredGlobalSynthesisCandidate = {
  readonly action: AtomicActionProposal;
  readonly priorityScore: number;
  readonly actionPriority: number;
  readonly strategicAlignment: number;
  readonly branchUrgency: number;
  readonly resourceHeadroom: number;
  readonly feasible: boolean;
};

function scoreGlobalSynthesisCandidates(input: {
  readonly input: GlobalSynthesizerInput;
  readonly policy: DeterministicGlobalSynthesisPolicy;
}): readonly ScoredGlobalSynthesisCandidate[] {
  const actionPriorities = input.input.candidateActions.map((action) => action.priority ?? 0);
  const strategicPriorities = input.input.candidateActions.map((action) =>
    resolveStrategicPriority(input.input.plan, action),
  );
  const contextualScores = input.input.candidateActions.map(
    (action) => action.synthesisContext?.subtaskScore ?? 0,
  );

  return input.input.candidateActions.map((action, index) => {
    const actionPriority = normalizeAcrossCandidates(actionPriorities, index);
    const strategicAlignment = normalizeAcrossCandidates(strategicPriorities, index);
    const contextualUrgency = normalizeAcrossCandidates(contextualScores, index);
    const physiologyUrgency = calculatePhysiologyUrgency({
      action,
      context: input.input.worldDecisionContext,
      thresholds: input.policy.physiologyUrgencyThresholds,
    });
    const branchUrgency = Math.max(contextualUrgency, physiologyUrgency);
    const feasible = isIndividuallyFeasible({
      action,
      policy: input.input.actionSynthesisPolicy,
    });
    const resourceHeadroom = calculateResourceHeadroom(
      action,
      input.input.actionSynthesisPolicy?.budget,
    );
    const priorityScore = feasible
      ? actionPriority * input.policy.weights.actionPriority +
        strategicAlignment * input.policy.weights.strategicAlignment +
        branchUrgency * input.policy.weights.branchUrgency +
        resourceHeadroom * input.policy.weights.resourceHeadroom
      : input.policy.infeasibleScore;

    return {
      action,
      priorityScore,
      actionPriority,
      strategicAlignment,
      branchUrgency,
      resourceHeadroom,
      feasible,
    };
  });
}

function resolveStrategicPriority(plan: BranchPlan, action: AtomicActionProposal): number {
  const branchId = action.synthesisContext?.branchId;
  const subtaskId = action.synthesisContext?.subtaskId;
  if (branchId === undefined || subtaskId === undefined) {
    return action.synthesisContext?.strategicAlignment ?? 0;
  }
  const branch = plan.branches.find((candidate) => candidate.id === branchId);
  const subtask = branch?.subtasks.find((candidate) => candidate.id === subtaskId);
  return action.synthesisContext?.strategicAlignment ?? subtask?.basePriority ?? 0;
}

function calculatePhysiologyUrgency(input: {
  readonly action: AtomicActionProposal;
  readonly context: WorldDecisionContext | undefined;
  readonly thresholds: DeterministicGlobalSynthesisPolicy['physiologyUrgencyThresholds'];
}): number {
  const physiology = input.context?.agent.physiology;
  if (physiology === undefined) {
    return 0;
  }
  switch (input.action.commandType) {
    case 'AgentEat':
      return urgencyForValue(physiology.satiety, input.thresholds.satiety);
    case 'AgentSleep':
      return urgencyForValue(physiology.energy, input.thresholds.energy);
    case 'AgentSeeDoctor':
      return urgencyForValue(physiology.health, input.thresholds.health);
    default:
      return 0;
  }
}

function urgencyForValue(value: number, threshold: number): number {
  if (!Number.isFinite(value) || value > threshold) {
    return 0;
  }
  return 1 + Math.min(1, Math.max(0, threshold - value) / threshold);
}

function isIndividuallyFeasible(input: {
  readonly action: AtomicActionProposal;
  readonly policy: ActionSynthesisPolicy | undefined;
}): boolean {
  const result = synthesizeActionCandidates({
    actions: [input.action],
    ...(input.policy === undefined
      ? {}
      : {
          policy: {
            ...input.policy,
            maxActions: 1,
          },
        }),
  });
  return result.acceptedActions.length === 1;
}

function calculateResourceHeadroom(
  action: AtomicActionProposal,
  budget: ActionSynthesisBudget | undefined,
): number {
  if (budget === undefined) {
    return 1;
  }
  const estimate = action.resourceEstimate;
  const ratios = [
    resourceRatio(estimate?.actionSeconds ?? 0, budget.availableActionSeconds),
    resourceRatio(estimate?.energyCost ?? 0, budget.energyBudget),
    resourceRatio(estimate?.satietyCost ?? 0, budget.satietyBudget),
    resourceRatio(estimate?.currencyCost ?? 0, budget.currencyBudget),
    ...Object.entries(estimate?.inventoryCosts ?? {}).map(([itemName, quantity]) =>
      resourceRatio(quantity, budget.inventoryBudget?.[itemName]),
    ),
  ];
  return 1 - Math.min(1, Math.max(0, ...ratios));
}

function resourceRatio(required: number, available: number | undefined): number {
  if (required <= 0 || available === undefined) {
    return 0;
  }
  if (available <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return required / available;
}

function normalizeAcrossCandidates(values: readonly number[], index: number): number {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('global synthesis candidate score must be finite');
    }
  }
  const value = values[index] ?? 0;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? 0.5 : (value - min) / (max - min);
}

function validateDeterministicPolicy(policy: DeterministicGlobalSynthesisPolicy): void {
  assertNonEmpty(policy.policyVersion, 'global synthesis policyVersion');
  const weights = Object.values(policy.weights);
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error('global synthesis policy weights must be non-negative finite numbers');
    }
  }
  if (weights.reduce((sum, weight) => sum + weight, 0) <= 0) {
    throw new Error('global synthesis policy requires at least one positive weight');
  }
  for (const threshold of Object.values(policy.physiologyUrgencyThresholds)) {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new Error('global synthesis physiology thresholds must be positive finite numbers');
    }
  }
  if (!Number.isFinite(policy.infeasibleScore)) {
    throw new Error('global synthesis infeasibleScore must be finite');
  }
}

function formatScore(value: number): string {
  return value.toFixed(6);
}

export function applyGlobalSynthesisChoices(input: {
  readonly candidateActions: readonly AtomicActionProposal[];
  readonly choices: readonly GlobalSynthesisChoice[];
}): readonly AtomicActionProposal[] {
  if (input.candidateActions.length === 0) {
    throw new Error('global synthesis requires at least one candidate action');
  }
  if (input.choices.length !== input.candidateActions.length) {
    throw new Error('global synthesis choices must cover every candidate action exactly once');
  }

  const candidateActionsById = new Map(input.candidateActions.map((action) => [action.id, action]));
  const seenActionIds = new Set<string>();

  return input.choices.map((choice, index) => {
    assertNonEmpty(choice.actionId, `rankedActions[${index}].actionId`);
    assertNonEmpty(choice.rationale, `rankedActions[${index}].rationale`);
    const priorityScore = assertFiniteNumber(
      choice.priorityScore,
      `rankedActions[${index}].priorityScore`,
    );
    const strategicAlignment =
      choice.strategicAlignment === undefined
        ? undefined
        : assertFiniteNumber(
            choice.strategicAlignment,
            `rankedActions[${index}].strategicAlignment`,
          );
    const branchUrgency =
      choice.branchUrgency === undefined
        ? undefined
        : assertFiniteNumber(choice.branchUrgency, `rankedActions[${index}].branchUrgency`);
    if (seenActionIds.has(choice.actionId)) {
      throw new Error(`duplicate action id ${choice.actionId}`);
    }
    seenActionIds.add(choice.actionId);

    const action = candidateActionsById.get(choice.actionId);
    if (action === undefined) {
      throw new Error(`unknown action id ${choice.actionId}`);
    }

    return {
      ...action,
      priority: priorityScore,
      synthesisContext: {
        ...(action.synthesisContext ?? {}),
        ...(strategicAlignment === undefined ? {} : { strategicAlignment }),
        ...(branchUrgency === undefined ? {} : { branchUrgency }),
      },
    };
  });
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
}
