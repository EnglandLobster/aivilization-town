import { createCommandEnvelope, asAgentId, asLocationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';

import { dispatchWorldCommand, type WorldCommandPolicies } from './agentActions';
import { applyWorldEvent, createWorldProjection } from './projection';

const assignmentPolicy = {
  policyVersion: 'residential-assignment-test-v1',
  arrivalSelection: 'most-vacancies-then-location-id',
} as const;

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  residentialAssignment: assignmentPolicy,
};

function createProjection(existingResidents = 0) {
  return createWorldProjection({
    locations: [
      {
        locationId: asLocationId('homes'),
        name: 'Homes',
        kind: 'residence',
        activityAffinities: [],
        capacity: 2,
      },
    ],
    agents: [
      {
        agentId: asAgentId('agent-a'),
        locationId: asLocationId('homes'),
        residenceLocationId: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      ...Array.from({ length: existingResidents }, (_, index) => ({
        agentId: asAgentId(`agent-${String.fromCharCode(98 + index)}`),
        locationId: asLocationId('homes'),
        residenceLocationId: asLocationId('homes'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 0,
        residentialTier: 1,
        job: null,
        inventory: {},
      })),
    ],
  });
}

function chooseResidence(projection: ReturnType<typeof createProjection>) {
  return dispatchWorldCommand({
    command: createCommandEnvelope({
      id: 'choose-home',
      simulationId: 'simulation',
      actorId: 'agent-a',
      source: 'agent-runtime',
      type: 'AgentChooseResidence',
      payload: { locationId: 'homes' },
      issuedAt: 0,
    }),
    projection,
    policies,
    nextSequence: 1,
  });
}

describe('AgentChooseResidence', () => {
  test('records frozen occupancy evidence and replays the durable home', () => {
    const projection = createProjection(1);
    const events = chooseResidence(projection);
    expect(events.map((event) => event.type)).toEqual([
      'AgentResidenceChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]).toMatchObject({
      payload: { occupancyBefore: 1, occupancyAfter: 2, capacityAtDecision: 2 },
    });
    const replayed = events.reduce(applyWorldEvent, projection);
    expect(replayed.agents['agent-a']?.residenceLocationId).toBe('homes');
  });

  test('rejects when the globally counted residence has no vacancy', () => {
    const full = createProjection(2);
    const rejected = chooseResidence(full)[0];
    expect(rejected?.type).toBe('ActionRejected');
    if (rejected?.type !== 'ActionRejected') throw new Error('expected rejection');
    expect(rejected.payload.reason).toContain('residence-full');
  });

  test('prices upkeep from the durable home region while the agent is away', () => {
    const base = createWorldProjection({
      locations: [
        {
          locationId: asLocationId('home'),
          name: 'Home',
          kind: 'residence',
          activityAffinities: [],
          capacity: 1,
          regionId: 'low-rent',
        },
        {
          locationId: asLocationId('work'),
          name: 'Work',
          kind: 'production',
          activityAffinities: [],
          capacity: null,
          regionId: 'high-rent',
        },
      ],
      agents: [
        {
          agentId: asAgentId('agent-a'),
          locationId: asLocationId('work'),
          residenceLocationId: asLocationId('home'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 0,
          balance: 100,
          residentialTier: 2,
          job: null,
          inventory: {},
        },
      ],
      moneySupply: 100,
    });
    const projection = {
      ...base,
      regionalLandValues: { 'low-rent': 2, 'high-rent': 50 },
    };
    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'advance-home-upkeep',
        simulationId: 'simulation',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 3_600_000 },
        issuedAt: 0,
      }),
      projection,
      policies: {
        ...policies,
        residentialUpkeep: {
          policyVersion: 'residential-upkeep-test-v2',
          costs: [{ residentialTier: 2, currencyCostPerHour: 0 }],
          landValueCoefficientPerHour: 1,
        },
        landValue: {
          policyVersion: 'land-value-test-v1',
          updateCadenceMs: 86_400_000,
          baseline: 0,
          populationWeight: 0,
          liquidityWeight: 0,
          smoothingFactor: 1,
          minIndex: 0,
          maxIndex: 100,
        },
      },
      nextSequence: 1,
    });
    expect(events.find((event) => event.type === 'ResidentialUpkeepCharged')).toMatchObject({
      payload: { amount: 2, previousBalance: 100, nextBalance: 98 },
    });
  });
});
