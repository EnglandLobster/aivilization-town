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
    }
  | {
      readonly status: 'rejected';
      readonly action: AtomicActionProposal;
      readonly reason: string;
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
    }
  | {
      readonly status: 'repaired';
      readonly originalAction: AtomicActionProposal;
      readonly repairedAction: AtomicActionProposal;
      readonly reason: string;
    }
  | {
      readonly status: 'needs-replan';
      readonly action: AtomicActionProposal;
      readonly reason: string;
      readonly attemptedRepair?: AtomicActionProposal;
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
    };
  }

  const repairedResult = input.simulate(repairedAction);
  if (repairedResult.status === 'accepted') {
    return {
      status: 'repaired',
      originalAction: firstResult.action,
      repairedAction: repairedResult.action,
      reason: firstResult.reason,
    };
  }

  return {
    status: 'needs-replan',
    action: firstResult.action,
    attemptedRepair: repairedAction,
    reason: repairedResult.reason,
  };
}
