import {
  createBranchPlanProgress,
  type BranchPlanProgress,
  type BranchPlanProgressRepository,
  type BranchPlanRecord,
  type BranchPlanRepository,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  AgentIntentionState,
  LongHorizonObjective,
} from '@aivilization/memory';

export const PLANNING_SESSION_PUBLICATION_POLICY_VERSION = 'planning-session-publication-v1';

export type PublishedPlanningSession = {
  readonly intentionState: AgentIntentionState;
  readonly planRecord?: BranchPlanRecord;
  readonly initialProgress?: BranchPlanProgress;
};

/**
 * Publishes an active objective only after its optional plan and initial progress
 * are durable. The active intention is the commit marker used by the scheduler.
 * A crash before that final write may leave auditable orphan support rows, but it
 * cannot expose an objective whose execution dependencies are missing.
 */
export async function publishPlanningSession(input: {
  readonly objective: LongHorizonObjective;
  readonly publishedAt: number;
  readonly intentionRepository: AgentIntentionRepository;
  readonly planRecord?: BranchPlanRecord;
  readonly planRepository?: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
}): Promise<PublishedPlanningSession> {
  assertFiniteTimestamp(input.publishedAt, 'publishedAt');
  assertPublicationDependencies(input);

  let initialProgress: BranchPlanProgress | undefined;
  if (input.planRecord !== undefined && input.planRepository !== undefined) {
    await input.planRepository.save(input.planRecord);
    if (input.planProgressRepository !== undefined) {
      initialProgress = createBranchPlanProgress({
        planId: input.planRecord.planId,
        agentId: input.planRecord.agentId,
        createdAt: input.publishedAt,
      });
      await input.planProgressRepository.save(initialProgress);
    }
  }

  const intentionState = await input.intentionRepository.setObjective(
    input.objective.agentId,
    input.objective,
  );
  return {
    intentionState,
    ...(input.planRecord === undefined ? {} : { planRecord: input.planRecord }),
    ...(initialProgress === undefined ? {} : { initialProgress }),
  };
}

export function createPlanningSessionPublicationPolicyManifest() {
  return {
    policyVersion: PLANNING_SESSION_PUBLICATION_POLICY_VERSION,
    source: 'repository-design' as const,
    commitMarker: 'active-objective-intention-write' as const,
    dependencyOrder: 'plan-then-initial-progress-then-active-objective' as const,
    initialProgressRule: 'materialize-with-new-durable-plan-when-repository-configured' as const,
    preCommitFailureRule: 'active-objective-remains-unpublished' as const,
    orphanSupportRowRule: 'auditable-and-ignored-without-active-objective-reference' as const,
    crossFileAtomicityClaimed: false as const,
  };
}

function assertPublicationDependencies(input: {
  readonly objective: LongHorizonObjective;
  readonly planRecord?: BranchPlanRecord;
  readonly planRepository?: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
}): void {
  if (input.planRecord === undefined) {
    if (input.planRepository !== undefined || input.planProgressRepository !== undefined) {
      throw new Error('planning repositories require a planRecord');
    }
    return;
  }
  if (input.planRepository === undefined) {
    throw new Error('planRepository is required when planRecord is provided');
  }
  if (
    input.planRecord.planId !== input.objective.id ||
    input.planRecord.agentId !== input.objective.agentId
  ) {
    throw new Error('planRecord identity must match the published objective');
  }
}

function assertFiniteTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
