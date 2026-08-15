import { describe, expect, it } from 'vitest';
import {
  assertValidCollectiveActionPolicy,
  evaluatePetitionThreshold,
  type CollectiveActionPolicy,
} from './collectiveAction';

const policy: CollectiveActionPolicy = {
  policyVersion: 'collective-action-v1',
  petitionSignatureThreshold: 3,
  petitionExpiryMs: 86_400_000,
};

describe('evaluatePetitionThreshold', () => {
  it('reaches the threshold at and above the configured signature count', () => {
    expect(evaluatePetitionThreshold({ signatureCount: 2, policy })).toBe(false);
    expect(evaluatePetitionThreshold({ signatureCount: 3, policy })).toBe(true);
    expect(evaluatePetitionThreshold({ signatureCount: 7, policy })).toBe(true);
  });

  it('is deterministic and rejects invalid counts', () => {
    expect(evaluatePetitionThreshold({ signatureCount: 3, policy })).toBe(true);
    expect(() => evaluatePetitionThreshold({ signatureCount: -1, policy })).toThrow(
      'non-negative integer',
    );
    expect(() => evaluatePetitionThreshold({ signatureCount: 1.5, policy })).toThrow();
  });
});

describe('assertValidCollectiveActionPolicy', () => {
  it('accepts the canonical policy and rejects invalid fields', () => {
    expect(() => assertValidCollectiveActionPolicy(policy)).not.toThrow();
    expect(() => assertValidCollectiveActionPolicy({ ...policy, policyVersion: ' ' })).toThrow(
      'policyVersion must not be empty',
    );
    expect(() =>
      assertValidCollectiveActionPolicy({ ...policy, petitionSignatureThreshold: 0 }),
    ).toThrow('positive integer');
    expect(() => assertValidCollectiveActionPolicy({ ...policy, petitionExpiryMs: 0 })).toThrow(
      'positive finite',
    );
  });
});
