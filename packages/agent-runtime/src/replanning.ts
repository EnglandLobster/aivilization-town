import type {
  AgentIntentionState,
  LongTermAgentProfile,
  MemoryRecordId,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { ActionWithRepairResult, AtomicActionProposal } from './actions';
import { markSubtaskBlocked, markSubtaskCompleted, type BranchPlanProgress } from './planProgress';
import type { BranchPlan, ContextSignal, PrioritizedSubtask } from './planner';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
  type WorldDecisionContextTrace,
} from './worldDecisionContext';

export type ReplanningMajorContextShift = {
  readonly key: string;
  readonly reason: string;
};

export type AdaptiveReplanningPolicy = {
  readonly consecutiveFailureThreshold: number;
  readonly failureTags?: readonly string[];
  readonly majorContextShift?: ReplanningMajorContextShift;
};

export type ReplanningDecision =
  | {
      readonly kind: 'none';
    }
  | {
      readonly kind: 'memory-guided-correction';
      readonly trigger: 'simulator-rejection';
      readonly reason: string;
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly MemoryRecordId[];
    }
  | {
      readonly kind: 'full-replan';
      readonly trigger: 'major-context-shift' | 'repeated-failure';
      readonly reason: string;
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly MemoryRecordId[];
      readonly matchingFailureCount: number;
    };

export type ReplanningDecisionTraceAttempt = {
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

export type ReplanningDecisionTrace = {
  readonly status: 'deterministic' | 'accepted' | 'fallback';
  readonly source: 'deterministic' | 'llm' | 'deterministic-fallback';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly decision: ReplanningDecision;
  readonly attempts?: readonly ReplanningDecisionTraceAttempt[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostMicros: number;
  };
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type ReplanningDecisionResult = {
  readonly decision: ReplanningDecision;
  readonly trace: ReplanningDecisionTrace;
};

export type ReplanningDeciderInput = {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly policy: AdaptiveReplanningPolicy;
  readonly intentionState?: AgentIntentionState;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type ReplanningDecider = (
  input: ReplanningDeciderInput,
) => ReplanningDecisionResult | Promise<ReplanningDecisionResult>;

export type SubtaskCompletionDecision =
  | {
      readonly status: 'completed';
    }
  | {
      readonly status: 'in-progress';
      readonly reason: string;
    };

export function createDeterministicReplanningDecisionResult(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly policy: AdaptiveReplanningPolicy;
  readonly worldDecisionContext?: WorldDecisionContext;
}): ReplanningDecisionResult {
  const decision = decideAdaptiveReplanning({
    selectedSubtask: input.selectedSubtask,
    simulationResults: input.simulationResults,
    shortTermMemoryContext: input.shortTermMemoryContext,
    consecutiveFailureThreshold: input.policy.consecutiveFailureThreshold,
    ...(input.policy.failureTags === undefined ? {} : { failureTags: input.policy.failureTags }),
    ...(input.policy.majorContextShift === undefined
      ? {}
      : { majorContextShift: input.policy.majorContextShift }),
  });
  return {
    decision,
    trace: {
      status: 'deterministic',
      source: 'deterministic',
      decision,
      ...mapWorldDecisionContextTrace(input.worldDecisionContext),
    },
  };
}

export function decideAdaptiveReplanning(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly consecutiveFailureThreshold: number;
  readonly failureTags?: readonly string[];
  readonly majorContextShift?: ReplanningMajorContextShift;
}): ReplanningDecision {
  assertPositiveInteger(input.consecutiveFailureThreshold, 'consecutiveFailureThreshold');

  const failedResults = input.simulationResults.filter(
    (result): result is Extract<ActionWithRepairResult, { status: 'needs-replan' }> =>
      result.status === 'needs-replan',
  );
  const failedActions = failedResults.map((result) => result.action);
  const failedActionIds = failedActions.map((action) => action.id);
  const evidenceRecordIds = findMatchingFailureEvidence({
    selectedSubtask: input.selectedSubtask,
    failedActions,
    records: input.shortTermMemoryContext,
    failureTags: input.failureTags ?? [],
  }).map((record) => record.id);

  if (input.majorContextShift !== undefined) {
    return {
      kind: 'full-replan',
      trigger: 'major-context-shift',
      reason: input.majorContextShift.reason,
      failedActionIds,
      evidenceRecordIds,
      matchingFailureCount: evidenceRecordIds.length,
    };
  }

  const firstFailure = failedResults[0];
  if (firstFailure === undefined) {
    return { kind: 'none' };
  }

  if (evidenceRecordIds.length >= input.consecutiveFailureThreshold) {
    return {
      kind: 'full-replan',
      trigger: 'repeated-failure',
      reason: firstFailure.reason,
      failedActionIds,
      evidenceRecordIds,
      matchingFailureCount: evidenceRecordIds.length,
    };
  }

  return {
    kind: 'memory-guided-correction',
    trigger: 'simulator-rejection',
    reason: firstFailure.reason,
    failedActionIds,
    evidenceRecordIds,
  };
}

export function applyReplanningDecisionToProgress(input: {
  readonly progress: BranchPlanProgress;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly decision: ReplanningDecision;
  readonly completionDecision?: SubtaskCompletionDecision;
  readonly at: number;
}): BranchPlanProgress | undefined {
  if (input.decision.kind === 'none') {
    if (input.completionDecision?.status === 'in-progress') {
      return undefined;
    }

    return markSubtaskCompleted(input.progress, {
      subtaskId: input.selectedSubtask.subtaskId,
      completedAt: input.at,
    });
  }

  if (input.decision.kind !== 'full-replan') {
    return undefined;
  }

  return markSubtaskBlocked(input.progress, {
    subtaskId: input.selectedSubtask.subtaskId,
    reason: `${input.decision.trigger}: ${input.decision.reason}`,
    blockedAt: input.at,
  });
}

function findMatchingFailureEvidence(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly failedActions: readonly AtomicActionProposal[];
  readonly records: readonly ShortTermMemoryRecord[];
  readonly failureTags: readonly string[];
}): readonly ShortTermMemoryRecord[] {
  const terms = buildFailureTerms(input);
  return input.records
    .filter((record) => record.status === 'failed')
    .filter((record) => recordMatchesAnyTerm(record, terms))
    .sort(compareMemoryRecords);
}

function buildFailureTerms(input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly failedActions: readonly AtomicActionProposal[];
  readonly failureTags: readonly string[];
}): readonly string[] {
  return [
    ...tokenize(input.selectedSubtask.subtaskId),
    ...tokenize(input.selectedSubtask.description),
    ...input.failedActions.flatMap((action) => [
      ...tokenize(action.id),
      ...tokenize(action.description),
      ...tokenize(action.commandType),
    ]),
    ...input.failureTags.flatMap((tag) => tokenize(tag)),
  ];
}

function recordMatchesAnyTerm(record: ShortTermMemoryRecord, terms: readonly string[]): boolean {
  const summary = normalize(record.summary);
  const tags = record.tags.map(normalize);
  return terms.some(
    (term) =>
      summary.includes(term) || tags.some((tag) => tag.includes(term) || term.includes(tag)),
  );
}

function tokenize(value: string): readonly string[] {
  return [
    ...new Set(
      normalize(value)
        .split(/[^a-z0-9]+/u)
        .filter((part) => part.length >= 3),
    ),
  ];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function compareMemoryRecords(left: ShortTermMemoryRecord, right: ShortTermMemoryRecord): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.id.localeCompare(right.id);
}

function mapWorldDecisionContextTrace(
  context: WorldDecisionContext | undefined,
): Pick<ReplanningDecisionTrace, 'worldDecisionContext'> {
  return context === undefined
    ? {}
    : { worldDecisionContext: createWorldDecisionContextTrace(context) };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
