import { createBranchPlan, type WorldDecisionContext } from '@aivilization/agent-runtime';
import { asAgentId, asLocationId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type TownConflictPolicy,
  type WorldAgentState,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { resolveAutonomousConflictIntent, resolveConflictActionProposal } from './conflictPlanning';
import type { WorkerDomainRuntimeFactoryInput } from './domainRuntimeRegistry';

const actorId = asAgentId('agent-a');
const targetId = asAgentId('agent-b');
const witnessId = asAgentId('agent-c');
const square = asLocationId('square');

const conflictPolicy: TownConflictPolicy = {
  policyVersion: 'town-conflict-v2',
  grievanceRelationThreshold: 0,
  baseDamage: 15,
  attackerEnergyDamageFactor: 0.05,
  targetEnergyDefenseFactor: 0.02,
  minDamage: 1,
  maxDamage: 40,
  attackerEnergyCost: 10,
  minHealthAfterAttack: 0,
  witnessAttitudePenaltyScale: 0.5,
  wellbeingGrievanceShift: { maxShift: 0.2 },
};

describe('conflict action planning', () => {
  test('escalates a distressed strained relation from confrontation to attack intent', () => {
    const strained = createDecisionContext({ agentId: actorId, wellbeing: 10 });
    expect(
      resolveAutonomousConflictIntent({ agentId: actorId, context: strained, now: 100 }),
    ).toMatchObject({ kind: 'confront', targetAgentId: targetId, relationScore: -0.5 });

    const afterConfrontation: WorldDecisionContext = {
      ...strained,
      conflicts: [
        {
          conflictId: 'conflict-1',
          kind: 'confrontation',
          role: 'actor',
          actorAgentId: actorId,
          targetAgentId: targetId,
          locationId: square,
          summary: 'Unresolved confrontation',
          recordedAt: 90,
        },
      ],
    };
    expect(
      resolveAutonomousConflictIntent({ agentId: actorId, context: afterConfrontation, now: 100 }),
    ).toMatchObject({ kind: 'attack', targetAgentId: targetId });

    expect(
      resolveAutonomousConflictIntent({
        agentId: actorId,
        context: {
          ...afterConfrontation,
          conflicts: [
            {
              conflictId: 'conflict-2',
              kind: 'attack',
              role: 'actor',
              actorAgentId: actorId,
              targetAgentId: targetId,
              locationId: square,
              damage: 8,
              summary: 'Attack already settled',
              recordedAt: 95,
            },
            ...(afterConfrontation.conflicts ?? []),
          ],
        },
        now: 100,
      }),
    ).toBeUndefined();

    expect(
      resolveAutonomousConflictIntent({
        agentId: actorId,
        context: {
          ...afterConfrontation,
          conflicts: [
            {
              conflictId: 'conflict-2',
              kind: 'attack',
              role: 'actor',
              actorAgentId: actorId,
              targetAgentId: targetId,
              locationId: square,
              damage: 8,
              summary: 'Old settled attack',
              recordedAt: 95,
            },
            ...(afterConfrontation.conflicts ?? []),
          ],
        },
        now: 86_400_096,
      }),
    ).toMatchObject({ kind: 'confront', targetAgentId: targetId });
  });

  test('makes a recent co-located attack salient to a third-party intervener', () => {
    const context: WorldDecisionContext = {
      ...createDecisionContext({ agentId: witnessId, wellbeing: 70, includeRelation: false }),
      conflicts: [
        {
          conflictId: 'conflict-attack',
          kind: 'attack',
          role: 'witness',
          actorAgentId: actorId,
          targetAgentId: targetId,
          locationId: square,
          damage: 8,
          summary: 'Recent attack',
          recordedAt: 90,
        },
      ],
    };

    expect(resolveAutonomousConflictIntent({ agentId: witnessId, context, now: 100 })).toEqual({
      kind: 'intervene',
      attackerAgentId: actorId,
      targetAgentId: targetId,
      conflictId: 'conflict-attack',
    });
    expect(
      resolveAutonomousConflictIntent({
        agentId: witnessId,
        context: {
          ...context,
          conflicts: [
            {
              conflictId: 'conflict-intervention',
              kind: 'intervention',
              role: 'actor',
              actorAgentId: witnessId,
              targetAgentId: targetId,
              counterpartyAgentId: actorId,
              locationId: square,
              summary: 'Already intervened',
              recordedAt: 95,
            },
            ...(context.conflicts ?? []),
          ],
        },
        now: 100,
      }),
    ).toBeUndefined();
  });

  test('proposes an attack only for explicit intent with a world-resolvable grievance', () => {
    const runtime = createRuntimeContext('conflict-attack');
    const selectedSubtask = {
      branchId: 'social',
      subtaskId: 'respond',
      description: 'Respond to unresolved conflict.',
      score: 74,
    };

    expect(
      resolveConflictActionProposal({
        context: runtime,
        selectedSubtask,
        conflictPolicy,
        actionId: 'action-conflict',
      }),
    ).toMatchObject({
      commandType: 'AgentAttack',
      payload: { targetAgentId: targetId },
    });
    expect(
      resolveConflictActionProposal({
        context: {
          ...runtime,
          activeObjective: { ...runtime.activeObjective, affinityTags: ['social'] },
        },
        selectedSubtask,
        conflictPolicy,
        actionId: 'action-conflict',
      }),
    ).toBeUndefined();
  });
});

function createRuntimeContext(conflictAffinity: string): WorkerDomainRuntimeFactoryInput {
  const actor = createAgent(actorId, 10);
  const target = createAgent(targetId, 50);
  const projection = {
    ...createWorldProjection({
      locations: [
        {
          locationId: square,
          name: 'Square',
          kind: 'social',
          activityAffinities: ['socialize'],
          capacity: null,
        },
      ],
      agents: [actor, target],
      socialRelations: [
        {
          sourceAgentId: actorId,
          targetAgentId: targetId,
          relationScore: -0.5,
          attitudeScore: -0.5,
          relationLabel: 'hostile',
          interactionCount: 1,
          lastInteractionSummary: 'Unresolved confrontation',
        },
      ],
    }),
    clock: { now: 100, tickDurationMs: 1_000 },
    conflictRecords: [
      {
        conflictId: 'conflict-1',
        kind: 'confrontation' as const,
        actorAgentId: actorId,
        targetAgentId: targetId,
        locationId: square,
        summary: 'Unresolved confrontation',
        recordedAt: 90,
      },
    ],
  };
  return {
    agentId: actorId,
    agent: actor,
    projection,
    activeObjective: {
      id: 'objective-conflict',
      agentId: actorId,
      statement: 'Respond to the unresolved conflict.',
      priority: 3,
      source: 'agent',
      affinityTags: ['social', conflictAffinity],
      createdAt: 100,
      updatedAt: 100,
    },
    planRecord: {
      planId: 'objective-conflict',
      agentId: actorId,
      plan: createBranchPlan({
        objective: 'Respond to the unresolved conflict.',
        branches: [
          {
            id: 'social',
            objective: 'Address the conflict.',
            subtasks: [{ id: 'respond', description: 'Respond.', basePriority: 74 }],
          },
        ],
      }),
      createdAt: 100,
      updatedAt: 100,
    },
    worldDecisionContext: {
      ...createDecisionContext({ agentId: actorId, wellbeing: 10 }),
      conflicts: [
        {
          conflictId: 'conflict-1',
          kind: 'confrontation',
          role: 'actor',
          actorAgentId: actorId,
          targetAgentId: targetId,
          locationId: square,
          summary: 'Unresolved confrontation',
          recordedAt: 90,
        },
      ],
    },
  };
}

function createDecisionContext(input: {
  readonly agentId: typeof actorId;
  readonly wellbeing: number;
  readonly includeRelation?: boolean;
}): WorldDecisionContext {
  return {
    agent: {
      agentId: input.agentId,
      locationId: square,
      physiology: { energy: 70, satiety: 70, health: 100 },
      educationScore: 0,
      balance: 100,
      residentialTier: 1,
      job: null,
      inventory: {},
      wellbeing: { value: input.wellbeing, band: input.wellbeing < 20 ? 'distressed' : 'thriving' },
      ...(input.includeRelation === false
        ? {}
        : {
            relations: [
              {
                agentId: targetId,
                direction: 'outgoing' as const,
                relationLabel: 'hostile',
                relationScore: -0.5,
                attitudeScore: -0.5,
                interactionCount: 1,
              },
            ],
          }),
    },
    market: { spotPrices: [] },
    society: {
      directoryId: 'directory-1',
      simulationId: 'simulation-1',
      partitionBoundaries: [],
      agents: [actorId, targetId, witnessId].map((agentId) => ({
        agentId,
        ownerPartitionKey: 'world-main',
        ownerLastAppliedSequence: 1,
        locationId: square,
        job: null,
        residentialTier: 1,
        educationScore: 0,
      })),
    },
    conflicts: [],
  };
}

function createAgent(agentId: typeof actorId, wellbeing: number): WorldAgentState {
  return {
    agentId,
    locationId: square,
    physiology: { energy: 70, satiety: 70, health: 100 },
    educationScore: 0,
    balance: 100,
    residentialTier: 1,
    job: null,
    inventory: {},
    wellbeing,
  };
}
