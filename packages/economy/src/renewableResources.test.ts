import { describe, expect, test } from 'vitest';
import {
  assertValidRenewableResourcePolicy,
  evaluateRenewableResourceExtraction,
  evaluateRenewableResourceRegeneration,
  type RenewableResourcePolicy,
} from './index';

const policy: RenewableResourcePolicy = {
  policyVersion: 'renewable-resources-v1',
  regenerationCadenceMs: 3_600_000,
  resources: [
    {
      commodityName: 'Apple',
      initialStock: 10,
      carryingCapacity: 12,
      regenerationPerCadence: 2,
      extractionPerOutputUnit: 1,
    },
  ],
};

describe('renewable resources', () => {
  test('extracts managed stock without creating output from nothing', () => {
    expect(
      evaluateRenewableResourceExtraction({
        commodityName: 'Apple',
        outputQuantity: 3,
        policy,
      }),
    ).toEqual({
      status: 'accepted',
      commodityName: 'Apple',
      outputQuantity: 3,
      extractedStock: 3,
      previousStock: 10,
      nextStock: 7,
      carryingCapacity: 12,
      policyVersion: 'renewable-resources-v1',
    });
  });

  test('rejects extraction above the remaining stock and leaves unmanaged goods alone', () => {
    expect(
      evaluateRenewableResourceExtraction({
        commodityName: 'Apple',
        outputQuantity: 3,
        currentStock: 2,
        policy,
      }),
    ).toMatchObject({
      status: 'rejected',
      reason: 'insufficient-renewable-resource',
      requiredStock: 3,
      availableStock: 2,
    });
    expect(
      evaluateRenewableResourceExtraction({
        commodityName: 'Bread',
        outputQuantity: 1,
        policy,
      }),
    ).toEqual({ status: 'unmanaged' });
  });

  test('regenerates one cadence at a time and clamps at carrying capacity', () => {
    const resource = policy.resources[0]!;
    const first = evaluateRenewableResourceRegeneration({
      resource,
      currentStock: 9,
      policyVersion: policy.policyVersion,
    });
    const second = evaluateRenewableResourceRegeneration({
      resource,
      currentStock: first.nextStock,
      policyVersion: policy.policyVersion,
    });
    expect(first).toMatchObject({ previousStock: 9, nextStock: 11, regeneratedStock: 2 });
    expect(second).toMatchObject({ previousStock: 11, nextStock: 12, regeneratedStock: 1 });
  });

  test('validates duplicate resources and stock bounds', () => {
    expect(() =>
      assertValidRenewableResourcePolicy({
        ...policy,
        resources: [policy.resources[0]!, policy.resources[0]!],
      }),
    ).toThrow(/duplicate renewable resource Apple/u);
    expect(() =>
      assertValidRenewableResourcePolicy({
        ...policy,
        resources: [{ ...policy.resources[0]!, initialStock: 13 }],
      }),
    ).toThrow(/initialStock must not exceed carryingCapacity/u);
  });
});
