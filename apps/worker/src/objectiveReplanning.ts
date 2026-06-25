import {
  compileStrategicObjectiveToBranchPlan,
  createBranchPlanProgress,
  normalizeStrategicPlanCompilerOutput,
  type BranchPlanRecord,
  type BranchPlanRepository,
  type BranchPlanProgressRepository,
  type ReplanningDecision,
  type StrategicPlanCompiler,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type { AgentIntentionRepository, LongTermAgentProfile } from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';

export type WorkerFullReplanMaterializationInput = {
  readonly agentId: AgentId;
  readonly planId: string;
  readonly issuedAt: number;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly worldDecisionContext?: WorldDecisionContext;
  readonly intentionRepository: AgentIntentionRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly replanningDecision: Extract<ReplanningDecision, { readonly kind: 'full-replan' }>;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly resetProgress?: boolean;
};

export type WorkerFullReplanMaterializationResult =
  | {
      readonly status: 'replanned';
      readonly agentId: AgentId;
      readonly objectiveId: string;
      readonly planId: string;
      readonly progressReset: boolean;
      readonly trigger: Extract<ReplanningDecision, { readonly kind: 'full-replan' }>['trigger'];
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly string[];
      readonly matchingFailureCount: number;
    }
  | {
      readonly status: 'skipped';
      readonly agentId: AgentId;
      readonly planId: string;
      readonly reason: 'missing-active-objective' | 'plan-id-mismatch';
      readonly objectiveId?: string;
    };

export async function materializeFullReplanForActiveObjective(
  input: WorkerFullReplanMaterializationInput,
): Promise<WorkerFullReplanMaterializationResult> {
  assertNonEmpty(input.planId, 'planId');
  assertFinite(input.issuedAt, 'issuedAt');

  const intentionState = await input.intentionRepository.getOrCreate(input.agentId);
  const objective = intentionState.activeObjective;
  if (objective === undefined) {
    return {
      status: 'skipped',
      agentId: input.agentId,
      planId: input.planId,
      reason: 'missing-active-objective',
    };
  }
  if (objective.id !== input.planId) {
    return {
      status: 'skipped',
      agentId: input.agentId,
      planId: input.planId,
      reason: 'plan-id-mismatch',
      objectiveId: objective.id,
    };
  }

  const existingRecord = await input.planRepository.get({
    planId: input.planId,
    agentId: input.agentId,
  });
  const compile = input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;
  const compiled = normalizeStrategicPlanCompilerOutput(
    await compile({
      objective,
      issuedAt: input.issuedAt,
      ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
      ...(input.worldDecisionContext === undefined
        ? {}
        : { worldDecisionContext: input.worldDecisionContext }),
    }),
  );
  const planRecord: BranchPlanRecord = {
    planId: input.planId,
    agentId: input.agentId,
    plan: compiled.plan,
    ...(compiled.planningTrace === undefined ? {} : { planningTrace: compiled.planningTrace }),
    createdAt: existingRecord?.createdAt ?? input.issuedAt,
    updatedAt: input.issuedAt,
  };
  await input.planRepository.save(planRecord);

  const planProgressRepository = input.planProgressRepository;
  const progressReset = planProgressRepository !== undefined && input.resetProgress !== false;
  if (progressReset) {
    const progress = createBranchPlanProgress({
      planId: input.planId,
      agentId: input.agentId,
      createdAt: input.issuedAt,
    });
    await planProgressRepository.save(progress);
  }

  return {
    status: 'replanned',
    agentId: input.agentId,
    objectiveId: objective.id,
    planId: input.planId,
    progressReset,
    trigger: input.replanningDecision.trigger,
    failedActionIds: input.replanningDecision.failedActionIds,
    evidenceRecordIds: input.replanningDecision.evidenceRecordIds,
    matchingFailureCount: input.replanningDecision.matchingFailureCount,
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
