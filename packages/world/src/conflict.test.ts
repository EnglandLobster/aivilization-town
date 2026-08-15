import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { isIncapacitated } from '@aivilization/society';
import { createDirectedSocialRelationKey } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  evaluateAttackDamage,
  type TownConflictPolicy,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

const conflictPolicy: TownConflictPolicy = {
  policyVersion: 'town-conflict-v1',
  grievanceRelationThreshold: 0,
  baseDamage: 15,
  attackerEnergyDamageFactor: 0.05,
  targetEnergyDefenseFactor: 0.02,
  minDamage: 1,
  maxDamage: 40,
  attackerEnergyCost: 10,
  minHealthAfterAttack: 0,
  witnessAttitudePenaltyScale: 0.5,
};

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 1, health: 1 },
  conflict: conflictPolicy,
};

const legacyPolicies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 1, health: 1 },
};

function createProjection(input: {
  readonly targetHealth?: number;
  readonly withStrainedRelation?: boolean;
  readonly withBreachedCommitment?: boolean;
  readonly witnessAtSquare?: boolean;
} = {}): WorldProjection {
  const agent = (agentId: string, inventory: Readonly<Record<string, number>> = {}) => ({
    agentId: asAgentId(agentId),
    locationId: asLocationId('square'),
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 0,
    balance: 0,
    residentialTier: 1,
    job: null,
    inventory,
  });
  const target = agent('agent-2');
  return createWorldProjection({
    agents: [
      agent('agent-1'),
      {
        ...target,
        physiology: { ...target.physiology, health: input.targetHealth ?? 100 },
      },
      ...(input.witnessAtSquare === false ? [] : [agent('agent-3')]),
    ],
    locations: [
      {
        locationId: asLocationId('square'),
        name: 'Square',
        kind: 'social',
        activityAffinities: ['socialize'],
        capacity: null,
      },
    ],
    socialRelations:
      input.withStrainedRelation === true
        ? [
            {
              sourceAgentId: asAgentId('agent-1'),
              targetAgentId: asAgentId('agent-2'),
              relationScore: -0.1,
              attitudeScore: -0.1,
              relationLabel: 'strained' as const,
              interactionCount: 2,
              lastInteractionSummary: 'They argued.',
            },
          ]
        : [],
    clock: { now: 0, tickDurationMs: 1_000 },
    ...(input.withBreachedCommitment === true
      ? {}
      : {}),
  });
}

function createBreachedCommitmentProjection(): WorldProjection {
  const projection = createProjection();
  return {
    ...projection,
    socialCommitments: {
      'conversation-past:0': {
        commitmentId: 'conversation-past:0',
        promisorAgentId: asAgentId('agent-2'),
        beneficiaryAgentId: asAgentId('agent-1'),
        topic: 'apples',
        statement: 'I promised apples.',
        status: 'breached',
        createdAt: 10,
        resolvedAt: 20,
      },
    },
  };
}

function run(
  projection: WorldProjection,
  input: { readonly id?: string; readonly agentId: string; readonly type: string; readonly payload: unknown },
  activePolicies: WorldCommandPolicies = policies,
): WorldEvent[] {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: input.id ?? `cmd-${input.type.toLowerCase()}`,
      simulationId: 'sim-1',
      actorId: input.agentId,
      source: 'agent-runtime',
      type: input.type as 'AgentAttack',
      payload: input.payload,
      issuedAt: 100,
    }),
    projection,
    policies: activePolicies,
    nextSequence: 1,
  });
}

function rejection(events: readonly WorldEvent[]): string | undefined {
  const first = events[0];
  return first?.type === 'ActionRejected' ? first.payload.reason : undefined;
}

describe('town conflict commands', () => {
  test('confront requires co-location and applies the hostility signal with witness memories', () => {
    const projection = createProjection();
    const events = run(projection, {
      agentId: 'agent-1',
      type: 'AgentConfront',
      payload: { targetAgentId: 'agent-2', statement: 'You cheated me.' },
    });
    const types = events.map((event) => event.type);
    expect(types).toContain('ConfrontationRecorded');
    expect(types).toContain('SocialInteractionCompleted');
    const social = events.find((event) => event.type === 'SocialInteractionCompleted');
    expect(social?.payload).toMatchObject({
      sourceAgentId: 'agent-1',
      targetAgentId: 'agent-2',
      outcomeSignals: ['hostility'],
      relationDelta: -0.12,
    });
    const updated = events.reduce(applyWorldEvent, projection);
    // The initiator's relation with the target dropped into strained.
    expect(
      Object.values(updated.socialRelations).find(
        (relation) =>
          relation.sourceAgentId === 'agent-1' && relation.targetAgentId === 'agent-2',
      )?.relationLabel,
    ).toBe('strained');
    // The co-located witness (agent-3) got a firsthand observation memory.
    const witnessMemory = events.find(
      (event) =>
        event.type === 'ShortTermMemoryRecorded' &&
        event.payload.record.agentId === 'agent-3',
    );
    expect(witnessMemory?.type === 'ShortTermMemoryRecorded' && witnessMemory.payload.record.provenance)
      .toEqual({ kind: 'firsthand', status: 'influencing' });
    expect(updated.conflictRecords).toHaveLength(1);
    expect(updated.conflictRecords?.[0]).toMatchObject({ kind: 'confrontation' });

    // Co-location is enforced.
    const apart = createProjection();
    const moved = {
      ...apart,
      agents: {
        ...apart.agents,
        'agent-2': { ...apart.agents['agent-2']!, locationId: null },
      },
    };
    expect(
      rejection(
        run(moved, {
          agentId: 'agent-1',
          type: 'AgentConfront',
          payload: { targetAgentId: 'agent-2', statement: 'x' },
        }),
      ),
    ).toContain('co-location');
  });

  test('attack requires a world-issued grievance', () => {
    // Friendly strangers: no relation, no betrayal evidence — rejected.
    expect(
      rejection(
        run(createProjection(), {
          agentId: 'agent-1',
          type: 'AgentAttack',
          payload: { targetAgentId: 'agent-2' },
        }),
      ),
    ).toContain('grievance');

    // Strained relation issues the grievance.
    const strained = run(createProjection({ withStrainedRelation: true }), {
      agentId: 'agent-1',
      type: 'AgentAttack',
      payload: { targetAgentId: 'agent-2' },
    });
    const attack = strained.find((event) => event.type === 'AttackRecorded');
    expect(attack?.payload).toMatchObject({
      grievance: { kind: 'strained-relation', relationScore: -0.1 },
    });

    // Betrayal evidence (a breached commitment by the target) issues it too.
    const betrayed = run(createBreachedCommitmentProjection(), {
      agentId: 'agent-1',
      type: 'AgentAttack',
      payload: { targetAgentId: 'agent-2' },
    });
    const betrayalAttack = betrayed.find((event) => event.type === 'AttackRecorded');
    expect(betrayalAttack?.payload).toMatchObject({
      grievance: { kind: 'betrayal-evidence', referenceId: 'conversation-past:0' },
    });
  });

  test('attack settles deterministic damage, costs, witness fallout, and incapacitation without death', () => {
    const projection = createProjection({ withStrainedRelation: true, targetHealth: 15 });
    const first = run(projection, {
      id: 'cmd-attack-1',
      agentId: 'agent-1',
      type: 'AgentAttack',
      payload: { targetAgentId: 'agent-2' },
    });
    const replay = run(projection, {
      id: 'cmd-attack-1',
      agentId: 'agent-1',
      type: 'AgentAttack',
      payload: { targetAgentId: 'agent-2' },
    });
    // Determinism: identical inputs, byte-identical events.
    expect(replay).toEqual(first);

    const attack = first.find((event) => event.type === 'AttackRecorded');
    // base 15 + attacker energy 100*0.05 - target energy 100*0.02 = 18.
    expect(attack?.payload).toMatchObject({
      damage: 18,
      targetPreviousHealth: 15,
      targetNextHealth: 0,
      attackerEnergyCost: 10,
    });
    const updated = first.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-2']?.physiology.health).toBe(0);
    expect(updated.agents['agent-1']?.physiology.energy).toBe(90);
    // Incapacitated (health below the critical threshold), but never dead.
    expect(
      isIncapacitated({
        energy: updated.agents['agent-2']!.physiology.energy,
        health: updated.agents['agent-2']!.physiology.health,
        energyCriticalThreshold: 1,
        healthCriticalThreshold: 1,
      }),
    ).toBe(true);

    // Witness fallout: the witness's attitude toward the attacker worsens by
    // the scaled hostility deltas (0.5 * -0.12 / -0.18).
    const witnessRelation = Object.values(updated.socialRelations).find(
      (relation) => relation.sourceAgentId === 'agent-3' && relation.targetAgentId === 'agent-1',
    );
    expect(witnessRelation).toMatchObject({ relationScore: -0.06, attitudeScore: -0.09 });
    // The attacker takes the betrayal hit toward the target.
    const attackerRelation = Object.values(updated.socialRelations).find(
      (relation) => relation.sourceAgentId === 'agent-1' && relation.targetAgentId === 'agent-2',
    );
    expect(attackerRelation?.relationScore).toBeCloseTo(-0.4, 6);

    // Snapshot round-trip.
    expect(JSON.parse(JSON.stringify(updated))).toEqual(updated);
  });

  test('damage evaluation clamps to the policy band', () => {
    expect(
      evaluateAttackDamage({ policy: conflictPolicy, attackerEnergy: 100, targetEnergy: 100 }),
    ).toBe(18);
    expect(
      evaluateAttackDamage({
        policy: { ...conflictPolicy, maxDamage: 10 },
        attackerEnergy: 100,
        targetEnergy: 0,
      }),
    ).toBe(10);
    expect(
      evaluateAttackDamage({
        policy: conflictPolicy,
        attackerEnergy: 0,
        targetEnergy: 500,
      }),
    ).toBe(5);
    expect(
      evaluateAttackDamage({
        policy: { ...conflictPolicy, minDamage: 8 },
        attackerEnergy: 0,
        targetEnergy: 500,
      }),
    ).toBe(8);
  });

  test('intervention mediates only an active conflict and repairs the attacker side', () => {
    // No hostility between the pair: rejected.
    expect(
      rejection(
        run(createProjection(), {
          agentId: 'agent-3',
          type: 'AgentIntervene',
          payload: {
            attackerAgentId: 'agent-1',
            targetAgentId: 'agent-2',
            statement: 'Calm down.',
          },
        }),
      ),
    ).toContain('no active conflict');

    const projection = createProjection({ withStrainedRelation: true });
    const events = run(projection, {
      agentId: 'agent-3',
      type: 'AgentIntervene',
      payload: {
        attackerAgentId: 'agent-1',
        targetAgentId: 'agent-2',
        statement: 'Calm down, both of you.',
      },
    });
    expect(events.map((event) => event.type)).toContain('InterventionRecorded');
    const social = events.find((event) => event.type === 'SocialInteractionCompleted');
    expect(social?.payload).toMatchObject({
      sourceAgentId: 'agent-1',
      targetAgentId: 'agent-2',
      outcomeSignals: ['repair'],
      relationDelta: 0.02,
      attitudeDelta: 0.08,
    });
    const updated = events.reduce(applyWorldEvent, projection);
    const relation = Object.values(updated.socialRelations).find(
      (candidate) =>
        candidate.sourceAgentId === 'agent-1' && candidate.targetAgentId === 'agent-2',
    );
    expect(relation?.relationScore).toBeCloseTo(-0.08, 6);
    expect(updated.conflictRecords?.[0]).toMatchObject({
      kind: 'intervention',
      actorAgentId: 'agent-3',
      counterpartyAgentId: 'agent-1',
    });
  });

  test('flag off: all conflict commands are rejected and no records appear', () => {
    const projection = createProjection({ withStrainedRelation: true });
    for (const [type, payload] of [
      ['AgentConfront', { targetAgentId: 'agent-2', statement: 'x' }],
      ['AgentAttack', { targetAgentId: 'agent-2' }],
      [
        'AgentIntervene',
        { attackerAgentId: 'agent-1', targetAgentId: 'agent-2', statement: 'x' },
      ],
    ] as const) {
      expect(
        rejection(
          run(projection, { agentId: 'agent-1', type, payload }, legacyPolicies),
        ),
      ).toBe('missing conflict policy');
    }
    const updated = run(
      projection,
      { agentId: 'agent-1', type: 'AgentConfront', payload: { targetAgentId: 'agent-2', statement: 'x' } },
      legacyPolicies,
    ).reduce(applyWorldEvent, projection);
    expect(updated.conflictRecords).toBeUndefined();
  });
});

describe('town conflict wellbeing grievance shift', () => {
  const wellbeingPolicy = {
    policyVersion: 'town-wellbeing-v1',
    initialValue: 50,
    minValue: 0,
    maxValue: 100,
    baseline: 50,
    convergencePerHour: 2,
    coefficients: {
      health: 10,
      energy: 6,
      satiety: 6,
      employed: 4,
      unemployed: -6,
      residentialTier: [0, -4, -2, 0, 2, 4, 6],
      lifestyleTier: [-6, -2, 2, 6],
      upkeepArrearsPerUnit: -0.05,
      distress: -8,
      positiveRelation: 6,
      negativeRelation: -8,
    },
  };
  const shiftPolicies: WorldCommandPolicies = {
    ...policies,
    conflict: { ...conflictPolicy, wellbeingGrievanceShift: { maxShift: 0.2 } },
    wellbeing: wellbeingPolicy,
  };

  function attackerWith(input: {
    readonly wellbeing?: number;
    readonly relationScore: number;
  }): WorldProjection {
    const projection = createProjection();
    return {
      ...projection,
      agents: {
        ...projection.agents,
        ...(input.wellbeing === undefined
          ? {}
          : {
              'agent-1': {
                ...projection.agents['agent-1']!,
                wellbeing: input.wellbeing,
              },
            }),
      },
      socialRelations: {
        [createDirectedSocialRelationKey({
          sourceAgentId: asAgentId('agent-1'),
          targetAgentId: asAgentId('agent-2'),
        })]: {
          sourceAgentId: asAgentId('agent-1'),
          targetAgentId: asAgentId('agent-2'),
          relationScore: input.relationScore,
          attitudeScore: input.relationScore,
          relationLabel: 'strained' as const,
          interactionCount: 2,
          lastInteractionSummary: 'They talked.',
        },
      },
    };
  }

  test('a distressed attacker lashes out at a merely neutral relation', () => {
    // Effective threshold = 0 + 0.2 × (50 − 10)/50 = +0.16 → relation +0.1 counts.
    const events = run(
      attackerWith({ wellbeing: 10, relationScore: 0.1 }),
      { agentId: 'agent-1', type: 'AgentAttack', payload: { targetAgentId: 'agent-2' } },
      shiftPolicies,
    );
    expect(events.some((event) => event.type === 'AttackRecorded')).toBe(true);
  });

  test('a thriving attacker needs genuine hostility', () => {
    // Effective threshold = 0 + 0.2 × (50 − 90)/50 = −0.16 → relation −0.1 is
    // NOT below it: mild friction no longer licenses an attack.
    const events = run(
      attackerWith({ wellbeing: 90, relationScore: -0.1 }),
      { agentId: 'agent-1', type: 'AgentAttack', payload: { targetAgentId: 'agent-2' } },
      shiftPolicies,
    );
    expect(rejection(events)).toContain('grievance');
  });

  test('without the wellbeing policy the static threshold is byte-for-byte legacy', () => {
    // Same mildly positive relation, no wellbeing policy → still rejected
    // exactly as before the interlock existed.
    const events = run(
      attackerWith({ relationScore: 0.1 }),
      { agentId: 'agent-1', type: 'AgentAttack', payload: { targetAgentId: 'agent-2' } },
      { ...policies, conflict: { ...conflictPolicy, wellbeingGrievanceShift: { maxShift: 0.2 } } },
    );
    expect(rejection(events)).toContain('grievance');
  });
});
