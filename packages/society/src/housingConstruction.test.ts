import { describe, expect, test } from 'vitest';
import {
  assertValidHousingConstructionPolicy,
  evaluateHousingConstruction,
  type HousingConstructionPolicy,
} from './index';

const policy: HousingConstructionPolicy = {
  policyVersion: 'housing-construction-test-v1',
  minimumOccupancyRatio: 0.8,
  capacityPerProject: 5,
  maximumLocationCapacity: 20,
  inventoryCosts: { Wood: 2 },
  builderSelection: 'lowest-agent-id-with-materials-per-partition',
  locationSelection: 'lowest-capacity-then-id',
};

describe('housing construction', () => {
  test('accepts material-backed capacity expansion under housing pressure', () => {
    expect(
      evaluateHousingConstruction({
        locationCapacity: 10,
        totalResidentialCapacity: 10,
        population: 8,
        builderInventory: { Wood: 3 },
        policy,
      }),
    ).toEqual({
      status: 'accepted',
      previousCapacity: 10,
      nextCapacity: 15,
      addedCapacity: 5,
      population: 8,
      totalResidentialCapacity: 10,
      occupancyRatio: 0.8,
      consumedInventory: { Wood: 2 },
      policyVersion: 'housing-construction-test-v1',
    });
  });

  test('rejects low demand and insufficient material without inventing capacity', () => {
    expect(
      evaluateHousingConstruction({
        locationCapacity: 10,
        totalResidentialCapacity: 10,
        population: 7,
        builderInventory: { Wood: 2 },
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'demand-too-low' });
    expect(
      evaluateHousingConstruction({
        locationCapacity: 10,
        totalResidentialCapacity: 10,
        population: 8,
        builderInventory: { Wood: 1 },
        policy,
      }),
    ).toMatchObject({ status: 'rejected', reason: 'insufficient-inventory' });
  });

  test('clamps the final project at the versioned location capacity limit', () => {
    expect(
      evaluateHousingConstruction({
        locationCapacity: 18,
        totalResidentialCapacity: 18,
        population: 18,
        builderInventory: { Wood: 2 },
        policy,
      }),
    ).toMatchObject({
      status: 'accepted',
      previousCapacity: 18,
      nextCapacity: 20,
      addedCapacity: 2,
    });
  });

  test('validates policy inputs at the composition boundary', () => {
    expect(() => assertValidHousingConstructionPolicy(policy)).not.toThrow();
    expect(() =>
      assertValidHousingConstructionPolicy({ ...policy, minimumOccupancyRatio: 1.1 }),
    ).toThrow('minimumOccupancyRatio');
    expect(() => assertValidHousingConstructionPolicy({ ...policy, inventoryCosts: {} })).toThrow(
      'inventoryCosts',
    );
  });
});
