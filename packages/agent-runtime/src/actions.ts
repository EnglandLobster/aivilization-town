import type { CoreCommandType } from '@aivilization/sim-core';

export type ActionResourceEstimate = {
  readonly actionSeconds?: number;
  readonly energyCost?: number;
  readonly satietyCost?: number;
  readonly currencyCost?: number;
  readonly inventoryCosts?: Readonly<Record<string, number>>;
};

export type ActionSynthesisContext = {
  readonly branchId?: string;
  readonly subtaskId?: string;
  readonly subtaskScore?: number;
  readonly strategicAlignment?: number;
  readonly branchUrgency?: number;
};

export type ActionSimulationTraceEvent = {
  readonly type: string;
  readonly sequence?: number;
  readonly summary?: string;
};

export type AtomicActionProposal<
  TCommandType extends string = CoreCommandType,
  TPayload = unknown,
> = {
  readonly id: string;
  readonly description: string;
  readonly commandType: TCommandType;
  readonly payload: TPayload;
  readonly priority?: number;
  readonly resourceEstimate?: ActionResourceEstimate;
  readonly synthesisContext?: ActionSynthesisContext;
};

export type ActionSimulationResult =
  | {
      readonly status: 'accepted';
      readonly action: AtomicActionProposal;
      readonly traceEvents?: readonly ActionSimulationTraceEvent[];
    }
  | {
      readonly status: 'rejected';
      readonly action: AtomicActionProposal;
      readonly reason: string;
      readonly traceEvents?: readonly ActionSimulationTraceEvent[];
    };

export type ActionSimulator = (action: AtomicActionProposal) => ActionSimulationResult;

export type RepairPolicy = (input: {
  readonly rejectedAction: AtomicActionProposal;
  readonly reason: string;
}) => AtomicActionProposal | undefined;

export type ActionWithRepairResult =
  | {
      readonly status: 'accepted';
      readonly action: AtomicActionProposal;
      readonly traceEvents?: readonly ActionSimulationTraceEvent[];
    }
  | {
      readonly status: 'repaired';
      readonly originalAction: AtomicActionProposal;
      readonly repairedAction: AtomicActionProposal;
      readonly reason: string;
      readonly originalTraceEvents?: readonly ActionSimulationTraceEvent[];
      readonly repairedTraceEvents?: readonly ActionSimulationTraceEvent[];
    }
  | {
      readonly status: 'needs-replan';
      readonly action: AtomicActionProposal;
      readonly reason: string;
      readonly attemptedRepair?: AtomicActionProposal;
      readonly traceEvents?: readonly ActionSimulationTraceEvent[];
      readonly attemptedRepairTraceEvents?: readonly ActionSimulationTraceEvent[];
    };

export function simulateActionWithRepair(input: {
  readonly action: AtomicActionProposal;
  readonly simulate: ActionSimulator;
  readonly repair?: RepairPolicy;
}): ActionWithRepairResult {
  const firstResult = input.simulate(input.action);
  if (firstResult.status === 'accepted') {
    return firstResult;
  }

  const repairedAction = input.repair?.({
    rejectedAction: firstResult.action,
    reason: firstResult.reason,
  });
  if (repairedAction === undefined) {
    return {
      status: 'needs-replan',
      action: firstResult.action,
      reason: firstResult.reason,
      ...(firstResult.traceEvents === undefined ? {} : { traceEvents: firstResult.traceEvents }),
    };
  }

  const repairedResult = input.simulate(repairedAction);
  if (repairedResult.status === 'accepted') {
    return {
      status: 'repaired',
      originalAction: firstResult.action,
      repairedAction: repairedResult.action,
      reason: firstResult.reason,
      ...(firstResult.traceEvents === undefined
        ? {}
        : { originalTraceEvents: firstResult.traceEvents }),
      ...(repairedResult.traceEvents === undefined
        ? {}
        : { repairedTraceEvents: repairedResult.traceEvents }),
    };
  }

  return {
    status: 'needs-replan',
    action: firstResult.action,
    attemptedRepair: repairedAction,
    reason: repairedResult.reason,
    ...(firstResult.traceEvents === undefined ? {} : { traceEvents: firstResult.traceEvents }),
    ...(repairedResult.traceEvents === undefined
      ? {}
      : { attemptedRepairTraceEvents: repairedResult.traceEvents }),
  };
}
