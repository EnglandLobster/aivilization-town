import type {
  AtomicActionProposal,
  PrioritizedSubtask,
  WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type { AgentId } from '@aivilization/sim-core';
import {
  resolveConflictGrievance,
  type AgentAttackPayload,
  type AgentConfrontPayload,
  type AgentIntervenePayload,
  type TownConflictPolicy,
} from '@aivilization/world';
import type { WorkerDomainRuntimeFactoryInput } from './domainRuntimeRegistry';

export const CONFLICT_ACTION_PROPOSER_POLICY_VERSION = 'conflict-action-proposer-v1';

export type ConflictActionProposerPolicy = {
  readonly policyVersion: string;
  readonly confrontationRelationThreshold: number;
  readonly confrontationWellbeingCeiling: number;
  readonly attackWellbeingCeiling: number;
  readonly escalationCooldownMs: number;
  readonly interventionLookbackMs: number;
};

export const DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY: ConflictActionProposerPolicy = {
  policyVersion: CONFLICT_ACTION_PROPOSER_POLICY_VERSION,
  confrontationRelationThreshold: -0.1,
  confrontationWellbeingCeiling: 35,
  attackWellbeingCeiling: 15,
  escalationCooldownMs: 24 * 3_600_000,
  interventionLookbackMs: 6 * 3_600_000,
};

export type AutonomousConflictIntent =
  | {
      readonly kind: 'intervene';
      readonly attackerAgentId: AgentId;
      readonly targetAgentId: AgentId;
      readonly conflictId: string;
    }
  | {
      readonly kind: 'attack' | 'confront';
      readonly targetAgentId: AgentId;
      readonly relationScore: number;
    };

export type ConflictActionProposal =
  | AtomicActionProposal<'AgentConfront', AgentConfrontPayload>
  | AtomicActionProposal<'AgentAttack', AgentAttackPayload>
  | AtomicActionProposal<'AgentIntervene', AgentIntervenePayload>;

export function createConflictActionProposerPolicyManifest(
  policy: ConflictActionProposerPolicy = DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY,
) {
  assertValidConflictActionProposerPolicy(policy);
  return {
    ...policy,
    targetSelection: 'strongest-negative-outgoing-relation-then-agent-id',
    escalationRule:
      'cooldown-bounded-strained-relation-then-one-confrontation-then-at-most-one-world-grievance-gated-attack',
    interventionRule: 'one-intervention-per-recent-co-located-attack-with-three-distinct-agents',
  } as const;
}

export function assertValidConflictActionProposerPolicy(
  policy: ConflictActionProposerPolicy,
): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('conflict action proposer policyVersion must not be empty');
  }
  if (
    !Number.isFinite(policy.confrontationRelationThreshold) ||
    policy.confrontationRelationThreshold < -1 ||
    policy.confrontationRelationThreshold > 1
  ) {
    throw new Error(
      'conflict action proposer confrontationRelationThreshold must be within [-1, 1]',
    );
  }
  for (const [name, value] of [
    ['confrontationWellbeingCeiling', policy.confrontationWellbeingCeiling],
    ['attackWellbeingCeiling', policy.attackWellbeingCeiling],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`conflict action proposer ${name} must be within [0, 100]`);
    }
  }
  if (policy.attackWellbeingCeiling > policy.confrontationWellbeingCeiling) {
    throw new Error(
      'conflict action proposer attack ceiling must not exceed confrontation ceiling',
    );
  }
  for (const [name, value] of [
    ['escalationCooldownMs', policy.escalationCooldownMs],
    ['interventionLookbackMs', policy.interventionLookbackMs],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`conflict action proposer ${name} must be positive finite`);
    }
  }
}

export function resolveAutonomousConflictIntent(input: {
  readonly agentId: AgentId;
  readonly context: WorldDecisionContext;
  readonly now: number;
  readonly policy?: ConflictActionProposerPolicy;
}): AutonomousConflictIntent | undefined {
  const policy = input.policy ?? DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY;
  assertValidConflictActionProposerPolicy(policy);
  if (input.context.conflicts === undefined) {
    return undefined;
  }
  const agentLocationId = input.context.agent.locationId;
  const intervention = input.context.conflicts.find(
    (conflict) =>
      conflict.kind === 'attack' &&
      conflict.role === 'witness' &&
      conflict.locationId === agentLocationId &&
      conflict.recordedAt <= input.now &&
      input.now - conflict.recordedAt <= policy.interventionLookbackMs &&
      !input.context.conflicts?.some(
        (candidate) =>
          candidate.kind === 'intervention' &&
          candidate.recordedAt >= conflict.recordedAt &&
          candidate.counterpartyAgentId === conflict.actorAgentId &&
          candidate.targetAgentId === conflict.targetAgentId,
      ),
  );
  if (intervention !== undefined) {
    return {
      kind: 'intervene',
      attackerAgentId: intervention.actorAgentId,
      targetAgentId: intervention.targetAgentId,
      conflictId: intervention.conflictId,
    };
  }

  const wellbeing = input.context.agent.wellbeing?.value ?? 50;
  if (wellbeing > policy.confrontationWellbeingCeiling) {
    return undefined;
  }
  const coLocatedIds = new Set(
    (input.context.society?.agents ?? [])
      .filter((agent) => agent.locationId === agentLocationId)
      .map((agent) => agent.agentId),
  );
  const relation = (input.context.agent.relations ?? [])
    .filter((entry) => entry.direction === 'outgoing')
    .filter((entry) => entry.relationScore <= policy.confrontationRelationThreshold)
    .filter((entry) => coLocatedIds.has(entry.agentId))
    .sort(
      (left, right) =>
        left.relationScore - right.relationScore || left.agentId.localeCompare(right.agentId),
    )[0];
  if (relation === undefined) {
    return undefined;
  }
  const latestOwnEscalation = input.context.conflicts
    .filter(
      (conflict) =>
        (conflict.kind === 'confrontation' || conflict.kind === 'attack') &&
        conflict.actorAgentId === input.agentId &&
        conflict.targetAgentId === relation.agentId,
    )
    .sort(
      (left, right) =>
        right.recordedAt - left.recordedAt || right.conflictId.localeCompare(left.conflictId),
    )[0];
  const recentOwnEscalation =
    latestOwnEscalation !== undefined &&
    latestOwnEscalation.recordedAt <= input.now &&
    input.now - latestOwnEscalation.recordedAt <= policy.escalationCooldownMs
      ? latestOwnEscalation
      : undefined;
  if (recentOwnEscalation?.kind === 'attack') {
    return undefined;
  }
  if (recentOwnEscalation?.kind === 'confrontation' && wellbeing > policy.attackWellbeingCeiling) {
    return undefined;
  }
  return {
    kind: recentOwnEscalation?.kind === 'confrontation' ? 'attack' : 'confront',
    targetAgentId: relation.agentId,
    relationScore: relation.relationScore,
  };
}

export function resolveConflictActionProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly conflictPolicy: TownConflictPolicy;
  readonly proposerPolicy?: ConflictActionProposerPolicy;
  readonly actionId: string;
}): ConflictActionProposal | undefined {
  const intent = resolveAutonomousConflictIntent({
    agentId: input.context.agentId,
    context: input.context.worldDecisionContext ?? createMinimalDecisionContext(input.context),
    now: input.context.projection.clock.now,
    ...(input.proposerPolicy === undefined ? {} : { policy: input.proposerPolicy }),
  });
  if (intent === undefined || !objectiveRequestsConflict(input.context, intent.kind)) {
    return undefined;
  }
  const priority = input.selectedSubtask.score;
  if (intent.kind === 'intervene') {
    if (!areLocalCoLocatedAgents(input.context, [intent.attackerAgentId, intent.targetAgentId])) {
      return undefined;
    }
    return {
      id: `${input.actionId}-intervene`,
      description: `Intervene in conflict ${intent.conflictId}.`,
      commandType: 'AgentIntervene',
      priority,
      payload: {
        attackerAgentId: intent.attackerAgentId,
        targetAgentId: intent.targetAgentId,
        statement: 'Stop. We need to de-escalate this conflict before anyone is hurt further.',
      },
    };
  }
  const target = input.context.projection.agents[intent.targetAgentId];
  if (
    target === undefined ||
    input.context.agent.locationId === null ||
    target.locationId !== input.context.agent.locationId
  ) {
    return undefined;
  }
  if (intent.kind === 'attack') {
    const grievance = resolveConflictGrievance({
      relations: input.context.projection.socialRelations,
      commitments: input.context.projection.socialCommitments,
      ...(input.context.projection.socialMatters === undefined
        ? {}
        : { matters: input.context.projection.socialMatters }),
      attackerAgentId: input.context.agentId,
      targetAgentId: intent.targetAgentId,
      grievanceRelationThreshold: input.conflictPolicy.grievanceRelationThreshold,
      ...(input.conflictPolicy.wellbeingGrievanceShift === undefined
        ? {}
        : {
            attackerWellbeing: input.context.agent.wellbeing ?? 50,
            wellbeingGrievanceShift: input.conflictPolicy.wellbeingGrievanceShift,
          }),
    });
    if (grievance === undefined) {
      return undefined;
    }
    return {
      id: `${input.actionId}-attack`,
      description: `Attack ${intent.targetAgentId} after unresolved confrontation.`,
      commandType: 'AgentAttack',
      priority,
      payload: { targetAgentId: intent.targetAgentId },
    };
  }
  return {
    id: `${input.actionId}-confront`,
    description: `Confront ${intent.targetAgentId} about the damaged relationship.`,
    commandType: 'AgentConfront',
    priority,
    payload: {
      targetAgentId: intent.targetAgentId,
      statement:
        'Our conflict cannot continue unaddressed. I need you to answer for what happened.',
    },
  };
}

function objectiveRequestsConflict(
  context: WorkerDomainRuntimeFactoryInput,
  kind: AutonomousConflictIntent['kind'],
): boolean {
  const text = [context.activeObjective.statement, ...context.activeObjective.affinityTags]
    .join(' ')
    .toLowerCase();
  return text.includes(`conflict-${kind}`);
}

function areLocalCoLocatedAgents(
  context: WorkerDomainRuntimeFactoryInput,
  otherAgentIds: readonly AgentId[],
): boolean {
  const locationId = context.agent.locationId;
  return (
    locationId !== null &&
    otherAgentIds.every((agentId) => context.projection.agents[agentId]?.locationId === locationId)
  );
}

function createMinimalDecisionContext(
  context: WorkerDomainRuntimeFactoryInput,
): WorldDecisionContext {
  return {
    agent: {
      agentId: context.agentId,
      locationId: context.agent.locationId,
      physiology: { ...context.agent.physiology },
      educationScore: context.agent.educationScore,
      balance: context.agent.balance,
      residentialTier: context.agent.residentialTier,
      job: context.agent.job,
      inventory: { ...context.agent.inventory },
    },
    market: { spotPrices: [] },
  };
}
