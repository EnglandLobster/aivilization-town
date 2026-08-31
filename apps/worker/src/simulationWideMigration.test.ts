import { asAgentId, asLocationId, asSimulationId, type PartitionKey } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createAivilizationWorldCommandPoliciesSnapshot } from './aivilizationWorldPolicies';
import { settleDemandDrivenArrivals } from './simulationWideMigration';

const simulationId = asSimulationId('unified-town');
const partitionKey = 'world-main' as PartitionKey;
const policy = {
  settlementCadenceMs: 86_400_000,
  maximumArrivalsPerCadence: 1,
  minimumAttractiveWellbeing: 0,
  housingDemandWeight: 1,
  jobDemandWeight: 0,
} as const;

describe('simulation-wide migration settlement', () => {
  test('uses the experiment seed while replaying the same seed identically', () => {
    const projection = createWorldProjection({
      clock: { now: 0, tickDurationMs: 1_000 },
      locations: [
        {
          locationId: asLocationId('residential-block'),
          name: 'Residential block',
          kind: 'residence',
          activityAffinities: ['sleep'],
          capacity: 4,
        },
      ],
      agents: [createAgent('agent-a'), createAgent('agent-b')],
      moneySupply: 1_000,
    });
    const settle = (randomSeed: string) =>
      settleDemandDrivenArrivals({
        simulationId,
        previousSimulationTime: 0,
        nextSimulationTime: 86_400_000,
        revision: 0,
        projection,
        existingEvents: [],
        ownerPartitionKeyByAgentId: {
          'agent-a': partitionKey,
          'agent-b': partitionKey,
        },
        partitionKeys: [partitionKey],
        commandPolicies: createAivilizationWorldCommandPoliciesSnapshot([], randomSeed, undefined, {
          townMigration: true,
        }),
        migrationPolicyVersion: 'town-migration-seed-test-v3',
        fallbackWellbeing: 100,
        policy,
      });

    const noArrival = settle('migration-seed-0');
    const replay = settle('migration-seed-0');
    const arrival = settle('migration-seed-1');

    expect(noArrival.events).toEqual([]);
    expect(replay).toEqual(noArrival);
    expect(arrival.events.map((event) => event.type)).toEqual(['AgentRegistered']);
    expect(arrival.events[0]).toMatchObject({
      payload: {
        initialState: { residenceLocationId: 'residential-block' },
        migrationArrival: {
          residenceLocationId: 'residential-block',
          residentialAssignmentPolicyVersion: 'residential-assignment-v1',
        },
      },
    });
    expect(arrival.registeredAgents).toHaveLength(1);
  });
});

function createAgent(agentId: string) {
  return {
    agentId: asAgentId(agentId),
    locationId: asLocationId('residential-block'),
    physiology: { energy: 100, satiety: 100, health: 100 },
    educationScore: 0,
    balance: 500,
    residentialTier: 1,
    job: null,
    inventory: {},
    wellbeing: 100,
  };
}
