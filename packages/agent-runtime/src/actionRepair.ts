import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId, CoreCommandType } from '@aivilization/sim-core';
import type {
  ActionResourceEstimate,
  ActionSimulationTraceEvent,
  ActionSimulator,
  ActionWithRepairResult,
  AtomicActionProposal,
} from './actions';
import type {
  LlmLongTermProfileContextTrace,
  LlmShortTermMemoryContextTrace,
} from './llmContextTrace';
import type { BranchPlan, ContextSignal, PrioritizedSubtask } from './planner';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

export type AgentActionCommandType = Exclude<
  CoreCommandType,
  'SetLongHorizonObjective' | 'IssueReactiveCommand' | 'AdvanceSimulationTime'
>;

export const AGENT_ACTION_COMMAND_TYPES = [
  'AgentAttack',
  'AgentApplyEducationExam',
  'AgentApplyJob',
  'AgentAssignMatter',
  'AgentCloseMatter',
  'AgentCloseEnterprise',
  'AgentConfront',
  'AgentConsume',
  'AgentDeposit',
  'AgentEat',
  'AgentExportCommodity',
  'AgentFoundEnterprise',
  'AgentFundEnterprise',
  'AgentGiveResource',
  'AgentImportCommodity',
  'AgentIntervene',
  'AgentJoinEnterprise',
  'AgentMoveTo',
  'AgentObserveLocation',
  'AgentProduce',
  'AgentRaisePetition',
  'AgentRaiseMatter',
  'AgentRequestLoan',
  'AgentRespondMatter',
  'AgentSeeDoctor',
  'AgentSetEnterpriseJobPosting',
  'AgentSignPetition',
  'AgentSleep',
  'AgentStartConversation',
  'AgentStudy',
  'AgentTrade',
  'AgentUpgradeResidentialTier',
  'AgentWithdraw',
  'AgentWork',
  'SetTaxPolicy',
  'SetPublicBudget',
  'SetSubsidyPolicy',
] as const satisfies readonly AgentActionCommandType[];

export type ReactiveCorrectionGeneratedAction = {
  readonly id: string;
  readonly description: string;
  readonly commandType: string;
  readonly payload: unknown;
  readonly priority?: number;
  readonly resourceEstimate?: ActionResourceEstimate;
};

export type ReactiveCorrectionGeneratedDecision =
  | {
      readonly kind: 'propose-action';
      readonly rationale: string;
      readonly evidenceRecordIds?: readonly string[];
      readonly action: ReactiveCorrectionGeneratedAction;
    }
  | {
      readonly kind: 'no-correction';
      readonly rationale: string;
      readonly evidenceRecordIds?: readonly string[];
    };

export type ReactiveCorrectionTraceDecision =
  | {
      readonly kind: 'propose-action';
      readonly rationale: string;
      readonly evidenceRecordIds: readonly string[];
      readonly action: {
        readonly id: string;
        readonly description: string;
        readonly commandType: string;
      };
    }
  | {
      readonly kind: 'no-correction';
      readonly rationale: string;
      readonly evidenceRecordIds: readonly string[];
    };

export type ReactiveCorrectionTraceAttempt = {
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

export type ReactiveCorrectionTrace = {
  readonly status: 'accepted' | 'fallback';
  readonly source: 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly decision: ReactiveCorrectionTraceDecision;
  readonly attempts?: readonly ReactiveCorrectionTraceAttempt[];
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

export type ReactiveCorrectionResult = {
  readonly action: AtomicActionProposal | undefined;
  readonly trace: ReactiveCorrectionTrace;
};

export type ReactiveCorrectorInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly selectedSubtask: PrioritizedSubtask;
  readonly rejectedAction: AtomicActionProposal;
  readonly rejectionReason: string;
  readonly localRepairAttempt?: AtomicActionProposal;
  readonly localRepairRejectionReason?: string;
  readonly allowedCommandTypes: readonly string[];
  readonly observedStateSummary?: string;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

type ReactiveCorrectorBaseInput = Omit<
  ReactiveCorrectorInput,
  | 'selectedSubtask'
  | 'rejectedAction'
  | 'rejectionReason'
  | 'localRepairAttempt'
  | 'localRepairRejectionReason'
>;

export type ReactiveCorrector = (
  input: ReactiveCorrectorInput,
) => Promise<ReactiveCorrectionResult>;

export type LocalActionRepairInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly selectedSubtask: PrioritizedSubtask;
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
  readonly observedStateSummary?: string;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type LocalActionRepairPolicy = (
  input: LocalActionRepairInput,
) => AtomicActionProposal | undefined;

export type LocalActionRepairTrace = {
  readonly status: 'skipped' | 'accepted' | 'rejected';
  readonly attemptedAction?: {
    readonly id: string;
    readonly description: string;
    readonly commandType: string;
  };
  readonly rejectionReason?: string;
};

export type ActionRepairTrace = {
  readonly actionId: string;
  readonly rejectionReason: string;
  readonly selectedSubtask: {
    readonly branchId: string;
    readonly subtaskId: string;
  };
  readonly localRepair: LocalActionRepairTrace;
  readonly reactiveCorrection?: ReactiveCorrectionTrace & {
    readonly simulatorResult?: {
      readonly status: 'accepted' | 'rejected';
      readonly reason?: string;
      readonly traceEvents?: readonly ActionSimulationTraceEvent[];
    };
  };
  readonly outcome: 'repaired' | 'needs-replan';
};

export type TieredActionRepairResult = {
  readonly result: ActionWithRepairResult;
  readonly trace: ActionRepairTrace | undefined;
};

export async function simulateActionWithTieredRepair(input: {
  readonly action: AtomicActionProposal;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulate: ActionSimulator;
  readonly localRepair?: LocalActionRepairPolicy;
  readonly reactiveCorrector: ReactiveCorrector | undefined;
  readonly reactiveCorrectorInput: ReactiveCorrectorBaseInput;
}): Promise<TieredActionRepairResult> {
  const firstResult = input.simulate(input.action);
  if (firstResult.status === 'accepted') {
    return { result: firstResult, trace: undefined };
  }

  const localAttempt = input.localRepair?.(
    createLocalActionRepairInput({
      reactiveCorrectorInput: input.reactiveCorrectorInput,
      selectedSubtask: input.selectedSubtask,
      rejectedAction: firstResult.action,
      reason: firstResult.reason,
    }),
  );
  if (localAttempt !== undefined) {
    const localResult = input.simulate(localAttempt);
    if (localResult.status === 'accepted') {
      return {
        result: {
          status: 'repaired',
          originalAction: firstResult.action,
          repairedAction: localResult.action,
          reason: firstResult.reason,
          ...(firstResult.traceEvents === undefined
            ? {}
            : { originalTraceEvents: firstResult.traceEvents }),
          ...(localResult.traceEvents === undefined
            ? {}
            : { repairedTraceEvents: localResult.traceEvents }),
        },
        trace: {
          actionId: firstResult.action.id,
          rejectionReason: firstResult.reason,
          selectedSubtask: toTraceSubtask(input.selectedSubtask),
          localRepair: {
            status: 'accepted',
            attemptedAction: toTraceAction(localResult.action),
          },
          outcome: 'repaired',
        },
      };
    }

    return runReactiveCorrectionAfterLocalFailure({
      firstResult,
      selectedSubtask: input.selectedSubtask,
      localRepairAttempt: localAttempt,
      localRepairRejectionReason: localResult.reason,
      localRepairTrace: {
        status: 'rejected',
        attemptedAction: toTraceAction(localAttempt),
        rejectionReason: localResult.reason,
      },
      reactiveCorrector: input.reactiveCorrector,
      reactiveCorrectorInput: input.reactiveCorrectorInput,
      simulate: input.simulate,
    });
  }

  return runReactiveCorrectionAfterLocalFailure({
    firstResult,
    selectedSubtask: input.selectedSubtask,
    localRepairTrace: { status: 'skipped' },
    reactiveCorrector: input.reactiveCorrector,
    reactiveCorrectorInput: input.reactiveCorrectorInput,
    simulate: input.simulate,
  });
}

function createLocalActionRepairInput(input: {
  readonly reactiveCorrectorInput: ReactiveCorrectorBaseInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
}): LocalActionRepairInput {
  const context = input.reactiveCorrectorInput;
  return {
    agentId: context.agentId,
    issuedAt: context.issuedAt,
    plan: context.plan,
    signals: context.signals,
    selectedSubtask: input.selectedSubtask,
    rejectedAction: input.rejectedAction,
    reason: input.reason,
    ...(context.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: context.observedStateSummary }),
    ...(context.intentionState === undefined ? {} : { intentionState: context.intentionState }),
    ...(context.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: context.shortTermMemoryContext }),
    ...(context.longTermProfile === undefined ? {} : { longTermProfile: context.longTermProfile }),
    ...(context.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: context.worldDecisionContext }),
  };
}

export function applyReactiveCorrectionDecision(input: {
  readonly decision: ReactiveCorrectionGeneratedDecision;
  readonly allowedCommandTypes: readonly string[];
}): {
  readonly action: AtomicActionProposal | undefined;
  readonly traceDecision: ReactiveCorrectionTraceDecision;
} {
  const evidenceRecordIds = [...(input.decision.evidenceRecordIds ?? [])];
  assertNonEmpty(input.decision.rationale, 'decision.rationale');

  if (input.decision.kind === 'no-correction') {
    return {
      action: undefined,
      traceDecision: {
        kind: 'no-correction',
        rationale: input.decision.rationale,
        evidenceRecordIds,
      },
    };
  }

  const action = validateGeneratedAction({
    action: input.decision.action,
    allowedCommandTypes: input.allowedCommandTypes,
  });
  return {
    action,
    traceDecision: {
      kind: 'propose-action',
      rationale: input.decision.rationale,
      evidenceRecordIds,
      action: toTraceAction(action),
    },
  };
}

function runReactiveCorrectionAfterLocalFailure(input: {
  readonly firstResult: Extract<ReturnType<ActionSimulator>, { readonly status: 'rejected' }>;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly localRepairAttempt?: AtomicActionProposal;
  readonly localRepairRejectionReason?: string;
  readonly localRepairTrace: LocalActionRepairTrace;
  readonly reactiveCorrector: ReactiveCorrector | undefined;
  readonly reactiveCorrectorInput: ReactiveCorrectorBaseInput;
  readonly simulate: ActionSimulator;
}): Promise<TieredActionRepairResult> {
  if (input.reactiveCorrector === undefined) {
    const reason = input.localRepairRejectionReason ?? input.firstResult.reason;
    return Promise.resolve({
      result: {
        status: 'needs-replan',
        action: input.firstResult.action,
        ...(input.localRepairAttempt === undefined
          ? {}
          : { attemptedRepair: input.localRepairAttempt }),
        reason,
        ...(input.firstResult.traceEvents === undefined
          ? {}
          : { traceEvents: input.firstResult.traceEvents }),
      },
      trace: {
        actionId: input.firstResult.action.id,
        rejectionReason: input.firstResult.reason,
        selectedSubtask: toTraceSubtask(input.selectedSubtask),
        localRepair: input.localRepairTrace,
        outcome: 'needs-replan',
      },
    });
  }

  return input
    .reactiveCorrector({
      ...input.reactiveCorrectorInput,
      selectedSubtask: input.selectedSubtask,
      rejectedAction: input.firstResult.action,
      rejectionReason: input.firstResult.reason,
      ...(input.localRepairAttempt === undefined
        ? {}
        : { localRepairAttempt: input.localRepairAttempt }),
      ...(input.localRepairRejectionReason === undefined
        ? {}
        : { localRepairRejectionReason: input.localRepairRejectionReason }),
    })
    .then((correction) => {
      if (correction.action === undefined) {
        return {
          result: {
            status: 'needs-replan' as const,
            action: input.firstResult.action,
            ...(input.localRepairAttempt === undefined
              ? {}
              : { attemptedRepair: input.localRepairAttempt }),
            reason: input.localRepairRejectionReason ?? input.firstResult.reason,
            ...(input.firstResult.traceEvents === undefined
              ? {}
              : { traceEvents: input.firstResult.traceEvents }),
          },
          trace: {
            actionId: input.firstResult.action.id,
            rejectionReason: input.firstResult.reason,
            selectedSubtask: toTraceSubtask(input.selectedSubtask),
            localRepair: input.localRepairTrace,
            reactiveCorrection: correction.trace,
            outcome: 'needs-replan' as const,
          },
        };
      }

      const reactiveResult = input.simulate(correction.action);
      if (reactiveResult.status === 'accepted') {
        return {
          result: {
            status: 'repaired' as const,
            originalAction: input.firstResult.action,
            repairedAction: reactiveResult.action,
            reason: input.firstResult.reason,
            ...(input.firstResult.traceEvents === undefined
              ? {}
              : { originalTraceEvents: input.firstResult.traceEvents }),
            ...(reactiveResult.traceEvents === undefined
              ? {}
              : { repairedTraceEvents: reactiveResult.traceEvents }),
          },
          trace: {
            actionId: input.firstResult.action.id,
            rejectionReason: input.firstResult.reason,
            selectedSubtask: toTraceSubtask(input.selectedSubtask),
            localRepair: input.localRepairTrace,
            reactiveCorrection: {
              ...correction.trace,
              simulatorResult: {
                status: 'accepted' as const,
                ...(reactiveResult.traceEvents === undefined
                  ? {}
                  : { traceEvents: reactiveResult.traceEvents }),
              },
            },
            outcome: 'repaired' as const,
          },
        };
      }

      return {
        result: {
          status: 'needs-replan' as const,
          action: input.firstResult.action,
          attemptedRepair: correction.action,
          reason: reactiveResult.reason,
          ...(input.firstResult.traceEvents === undefined
            ? {}
            : { traceEvents: input.firstResult.traceEvents }),
          ...(reactiveResult.traceEvents === undefined
            ? {}
            : { attemptedRepairTraceEvents: reactiveResult.traceEvents }),
        },
        trace: {
          actionId: input.firstResult.action.id,
          rejectionReason: input.firstResult.reason,
          selectedSubtask: toTraceSubtask(input.selectedSubtask),
          localRepair: input.localRepairTrace,
          reactiveCorrection: {
            ...correction.trace,
            simulatorResult: {
              status: 'rejected' as const,
              reason: reactiveResult.reason,
              ...(reactiveResult.traceEvents === undefined
                ? {}
                : { traceEvents: reactiveResult.traceEvents }),
            },
          },
          outcome: 'needs-replan' as const,
        },
      };
    });
}

function validateGeneratedAction(input: {
  readonly action: ReactiveCorrectionGeneratedAction;
  readonly allowedCommandTypes: readonly string[];
}): AtomicActionProposal {
  assertNonEmpty(input.action.id, 'decision.action.id');
  assertNonEmpty(input.action.description, 'decision.action.description');
  assertNonEmpty(input.action.commandType, 'decision.action.commandType');
  if (!new Set(input.allowedCommandTypes).has(input.action.commandType)) {
    throw new Error(`unknown command type ${input.action.commandType}`);
  }
  const payload = cloneJsonPayload(input.action.payload, 'decision.action.payload');
  const priority =
    input.action.priority === undefined
      ? undefined
      : assertFiniteNumber(input.action.priority, 'decision.action.priority');
  const resourceEstimate =
    input.action.resourceEstimate === undefined
      ? undefined
      : validateResourceEstimate(input.action.resourceEstimate, 'decision.action.resourceEstimate');

  return {
    id: input.action.id,
    description: input.action.description,
    commandType: input.action.commandType as AtomicActionProposal['commandType'],
    payload,
    ...(priority === undefined ? {} : { priority }),
    ...(resourceEstimate === undefined ? {} : { resourceEstimate }),
  };
}

function validateResourceEstimate(
  value: ActionResourceEstimate,
  label: string,
): ActionResourceEstimate {
  return {
    ...(value.actionSeconds === undefined
      ? {}
      : { actionSeconds: assertFiniteNumber(value.actionSeconds, `${label}.actionSeconds`) }),
    ...(value.energyCost === undefined
      ? {}
      : { energyCost: assertFiniteNumber(value.energyCost, `${label}.energyCost`) }),
    ...(value.satietyCost === undefined
      ? {}
      : { satietyCost: assertFiniteNumber(value.satietyCost, `${label}.satietyCost`) }),
    ...(value.currencyCost === undefined
      ? {}
      : { currencyCost: assertFiniteNumber(value.currencyCost, `${label}.currencyCost`) }),
    ...(value.inventoryCosts === undefined
      ? {}
      : {
          inventoryCosts: validateInventoryCosts(value.inventoryCosts, `${label}.inventoryCosts`),
        }),
  };
}

function validateInventoryCosts(
  value: Readonly<Record<string, number>>,
  label: string,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(value).map(([commodityName, quantity]) => [
      commodityName,
      assertFiniteNumber(quantity, `${label}.${commodityName}`),
    ]),
  );
}

function cloneJsonPayload(value: unknown, label: string): unknown {
  if (value === undefined) {
    throw new Error(`${label} is required`);
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch (error) {
    throw new Error(`${label} must be JSON serializable`, { cause: error });
  }
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

function toTraceSubtask(selectedSubtask: PrioritizedSubtask): {
  readonly branchId: string;
  readonly subtaskId: string;
} {
  return {
    branchId: selectedSubtask.branchId,
    subtaskId: selectedSubtask.subtaskId,
  };
}

function toTraceAction(action: AtomicActionProposal): {
  readonly id: string;
  readonly description: string;
  readonly commandType: string;
} {
  return {
    id: action.id,
    description: action.description,
    commandType: action.commandType,
  };
}
