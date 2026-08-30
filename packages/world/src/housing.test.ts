import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import type { HousingConstructionPolicy } from '@aivilization/society';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  handleAgentBuildHousingCommand,
} from './index';

const policy: HousingConstructionPolicy = {
  policyVersion: 'housing-construction-test-v1',
  minimumOccupancyRatio: 1,
  capacityPerProject: 2,
  maximumLocationCapacity: 3,
  inventoryCosts: { Wood: 2 },
  builderSelection: 'lowest-agent-id-with-materials-per-partition',
  locationSelection: 'lowest-capacity-then-id',
};

function createProjection(inventory: Readonly<Record<string, number>> = { Wood: 3 }) {
  return createWorldProjection({
    agents: [
      {
        agentId: asAgentId('builder-1'),
        locationId: asLocationId('residence-1'),
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory,
      },
    ],
    locations: [
      {
        locationId: asLocationId('residence-1'),
        name: 'First Residence',
        kind: 'residence',
        activityAffinities: ['residential'],
        capacity: 1,
      },
    ],
  });
}

function createCommand() {
  return createCommandEnvelope({
    id: 'build-housing-1',
    simulationId: 'sim-1',
    actorId: 'builder-1',
    type: 'AgentBuildHousing',
    payload: { locationId: 'residence-1' },
    issuedAt: 100,
  });
}

describe('AgentBuildHousing', () => {
  test('atomically consumes material and expands replayable residential capacity', () => {
    const projection = createProjection();
    const events = handleAgentBuildHousingCommand({
      command: createCommand(),
      projection,
      policy,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'InventoryChanged',
      'HousingCapacityExpanded',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[1]).toMatchObject({
      type: 'HousingCapacityExpanded',
      payload: {
        builderAgentId: 'builder-1',
        locationId: 'residence-1',
        previousCapacity: 1,
        nextCapacity: 3,
        addedCapacity: 2,
        populationAtDecision: 1,
        townResidentialCapacityAtDecision: 1,
        occupancyRatioAtDecision: 1,
        consumedInventory: { Wood: 2 },
        policyVersion: 'housing-construction-test-v1',
      },
    });

    const replayed = events.reduce(applyWorldEvent, projection);
    expect(replayed.agents['builder-1']?.inventory).toEqual({ Wood: 1 });
    expect(replayed.locations['residence-1']?.capacity).toBe(3);
    expect(() => applyWorldEvent(replayed, events[1]!)).toThrow('expected 1, available 3');
  });

  test('rejects material-free construction and dispatches only when policy is enabled', () => {
    const projection = createProjection({ Wood: 1 });
    const rejected = handleAgentBuildHousingCommand({
      command: createCommand(),
      projection,
      policy,
      nextSequence: 1,
    });
    const rejection = rejected[0];
    if (rejection?.type !== 'ActionRejected') throw new Error('expected rejection');
    expect(rejection.payload.commandType).toBe('AgentBuildHousing');
    expect(rejection.payload.reason).toContain('Wood');

    const missingPolicy = dispatchWorldCommand({
      command: createCommand(),
      projection: createProjection(),
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 1,
        laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
        criticalThresholds: { energy: 1, health: 1 },
      },
      nextSequence: 1,
    });
    expect(missingPolicy[0]).toMatchObject({
      type: 'ActionRejected',
      payload: { reason: 'missing housing construction policy' },
    });
  });
});
