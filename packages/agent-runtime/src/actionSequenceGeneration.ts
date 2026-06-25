import type {
  AgentIntentionState,
  LongTermAgentProfile,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { ActionResourceEstimate, AtomicActionProposal } from './actions';
import type { BranchPlan, ContextSignal, PrioritizedSubtask } from './planner';
import type { BranchPlanProgress } from './planProgress';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

export type ActionSequenceGeneratedAction = {
  readonly id: string;
  readonly description: string;
  readonly commandType: string;
  readonly payload: unknown;
  readonly priority?: number;
  readonly resourceEstimate?: ActionResourceEstimate;
  readonly rationale: string;
};

export type ActionSequenceGenerationTraceAttempt = {
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

export type ActionSequenceGenerationTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly selectedSubtask: {
    readonly branchId: string;
    readonly subtaskId: string;
  };
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly actions?: readonly {
    readonly id: string;
    readonly commandType: string;
    readonly rationale: string;
  }[];
  readonly attempts?: readonly ActionSequenceGenerationTraceAttempt[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type ActionSequenceGenerationResult = {
  readonly actions: readonly AtomicActionProposal[];
  readonly trace: ActionSequenceGenerationTrace;
};

export type ActionSequenceGeneratorInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly signals: readonly ContextSignal[];
  readonly deterministicActions: readonly AtomicActionProposal[];
  readonly progress?: BranchPlanProgress;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type ActionSequenceGenerator = (
  input: ActionSequenceGeneratorInput,
) => Promise<ActionSequenceGenerationResult>;

export function createDeterministicActionSequenceGenerationResult(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly deterministicActions: readonly AtomicActionProposal[];
}): ActionSequenceGenerationResult {
  return {
    actions: input.deterministicActions,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      selectedSubtask: toTraceSubtask(input.selectedSubtask),
      actions: input.deterministicActions.map((action) => ({
        id: action.id,
        commandType: action.commandType,
        rationale: 'deterministic micro-planner fallback action',
      })),
    },
  };
}

export function applyActionSequenceProposal(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly deterministicActions: readonly AtomicActionProposal[];
  readonly actions: readonly ActionSequenceGeneratedAction[];
}): readonly AtomicActionProposal[] {
  if (input.actions.length === 0) {
    throw new Error('action sequence must contain at least one action');
  }
  if (input.deterministicActions.length === 0) {
    throw new Error('deterministic action sequence must contain at least one fallback action');
  }

  const allowedCommandTypes = new Set<AtomicActionProposal['commandType']>(
    input.deterministicActions.map((action) => action.commandType),
  );
  const actionIds = new Set<string>();

  return input.actions.map((action, index): AtomicActionProposal => {
    assertNonEmpty(action.id, `actions[${index}].id`);
    assertNonEmpty(action.description, `actions[${index}].description`);
    assertNonEmpty(action.commandType, `actions[${index}].commandType`);
    assertNonEmpty(action.rationale, `actions[${index}].rationale`);
    if (actionIds.has(action.id)) {
      throw new Error(`duplicate action id ${action.id}`);
    }
    actionIds.add(action.id);
    const commandType = action.commandType as AtomicActionProposal['commandType'];
    if (!allowedCommandTypes.has(commandType)) {
      throw new Error(`unknown command type ${action.commandType}`);
    }

    const payload = cloneJsonPayload(action.payload, `actions[${index}].payload`);
    const priority =
      action.priority === undefined
        ? undefined
        : assertFiniteNumber(action.priority, `actions[${index}].priority`);
    const resourceEstimate =
      action.resourceEstimate === undefined
        ? undefined
        : validateResourceEstimate(action.resourceEstimate, `actions[${index}].resourceEstimate`);

    return {
      id: action.id,
      description: action.description,
      commandType,
      payload,
      ...(priority === undefined ? {} : { priority }),
      ...(resourceEstimate === undefined ? {} : { resourceEstimate }),
    };
  });
}

export function createActionSequenceGenerationTraceActions(
  actions: readonly ActionSequenceGeneratedAction[],
): NonNullable<ActionSequenceGenerationTrace['actions']> {
  return actions.map((action) => ({
    id: action.id,
    commandType: action.commandType,
    rationale: action.rationale,
  }));
}

export function toActionSequenceTraceSubtask(
  selectedSubtask: PrioritizedSubtask,
): ActionSequenceGenerationTrace['selectedSubtask'] {
  return toTraceSubtask(selectedSubtask);
}

function toTraceSubtask(
  selectedSubtask: PrioritizedSubtask,
): ActionSequenceGenerationTrace['selectedSubtask'] {
  return {
    branchId: selectedSubtask.branchId,
    subtaskId: selectedSubtask.subtaskId,
  };
}

function validateResourceEstimate(
  estimate: ActionResourceEstimate,
  name: string,
): ActionResourceEstimate {
  return {
    ...(estimate.actionSeconds === undefined
      ? {}
      : { actionSeconds: assertFiniteNumber(estimate.actionSeconds, `${name}.actionSeconds`) }),
    ...(estimate.energyCost === undefined
      ? {}
      : { energyCost: assertFiniteNumber(estimate.energyCost, `${name}.energyCost`) }),
    ...(estimate.satietyCost === undefined
      ? {}
      : { satietyCost: assertFiniteNumber(estimate.satietyCost, `${name}.satietyCost`) }),
    ...(estimate.currencyCost === undefined
      ? {}
      : { currencyCost: assertFiniteNumber(estimate.currencyCost, `${name}.currencyCost`) }),
    ...(estimate.inventoryCosts === undefined
      ? {}
      : {
          inventoryCosts: validateInventoryCosts(estimate.inventoryCosts, `${name}.inventoryCosts`),
        }),
  };
}

function validateInventoryCosts(
  inventoryCosts: Readonly<Record<string, number>>,
  name: string,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [commodityName, quantity] of Object.entries(inventoryCosts)) {
    assertNonEmpty(commodityName, `${name} commodity`);
    result[commodityName] = assertFiniteNumber(quantity, `${name}.${commodityName}`);
  }
  return result;
}

function cloneJsonPayload(value: unknown, name: string): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error('payload must be JSON-serializable');
    }
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(
      `${name} must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
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
