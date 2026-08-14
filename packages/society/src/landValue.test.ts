import { describe, expect, it } from 'vitest';

import {
  assertValidLandValuePolicy,
  evaluateRegionalLandValue,
  type LandValuePolicy,
} from './landValue';

const policy: LandValuePolicy = {
  policyVersion: 'land-value-v1',
  updateCadenceMs: 86_400_000,
  baseline: 0,
  populationWeight: 0.5,
  liquidityWeight: 0.1,
  smoothingFactor: 0.4,
  minIndex: 0,
  maxIndex: 100,
};

describe('regional land value', () => {
  it('computes the raw target from population and liquidity with diminishing returns', () => {
    const result = evaluateRegionalLandValue({
      previousIndex: 0,
      inputs: { agentCount: 16, marketLiquidity: 0 },
      policy,
    });
    // raw = 0.5 * sqrt(16) = 2; next = 0 + (2 - 0) * 0.4 = 0.8
    expect(result.rawIndex).toBeCloseTo(2);
    expect(result.nextIndex).toBeCloseTo(0.8);
  });

  it('adds the liquidity term via log1p', () => {
    const result = evaluateRegionalLandValue({
      previousIndex: 10,
      inputs: { agentCount: 0, marketLiquidity: Math.E - 1 },
      policy,
    });
    // raw = 0.1 * log1p(e-1) = 0.1; next = 10 + (0.1 - 10) * 0.4 = 6.04
    expect(result.rawIndex).toBeCloseTo(0.1);
    expect(result.nextIndex).toBeCloseTo(6.04);
  });

  it('respects the baseline when inputs are zero', () => {
    const result = evaluateRegionalLandValue({
      previousIndex: 0,
      inputs: { agentCount: 0, marketLiquidity: 0 },
      policy: { ...policy, baseline: 5 },
    });
    expect(result.rawIndex).toBe(5);
    expect(result.nextIndex).toBeCloseTo(2);
  });

  it('clamps the raw target to the configured bounds', () => {
    const high = evaluateRegionalLandValue({
      previousIndex: 0,
      inputs: { agentCount: 1_000_000, marketLiquidity: 1e12 },
      policy,
    });
    expect(high.rawIndex).toBe(100);

    const low = evaluateRegionalLandValue({
      previousIndex: 0,
      inputs: { agentCount: 0, marketLiquidity: 0 },
      policy: { ...policy, minIndex: 3 },
    });
    expect(low.rawIndex).toBe(3);
  });

  it('converges toward the raw target over repeated cadence steps', () => {
    let index = 0;
    for (let step = 0; step < 50; step += 1) {
      index = evaluateRegionalLandValue({
        previousIndex: index,
        inputs: { agentCount: 25, marketLiquidity: 0 },
        policy,
      }).nextIndex;
    }
    expect(index).toBeCloseTo(2.5, 5);
  });

  it('jumps directly to the target when smoothingFactor is 1', () => {
    const result = evaluateRegionalLandValue({
      previousIndex: 42,
      inputs: { agentCount: 9, marketLiquidity: 0 },
      policy: { ...policy, smoothingFactor: 1 },
    });
    expect(result.nextIndex).toBeCloseTo(result.rawIndex);
  });

  it('is deterministic for identical inputs', () => {
    const first = evaluateRegionalLandValue({
      previousIndex: 1.5,
      inputs: { agentCount: 7, marketLiquidity: 1234 },
      policy,
    });
    const second = evaluateRegionalLandValue({
      previousIndex: 1.5,
      inputs: { agentCount: 7, marketLiquidity: 1234 },
      policy,
    });
    expect(first).toEqual(second);
  });

  it('rejects negative inputs', () => {
    expect(() =>
      evaluateRegionalLandValue({
        previousIndex: -1,
        inputs: { agentCount: 0, marketLiquidity: 0 },
        policy,
      }),
    ).toThrow('previousIndex must be non-negative');
    expect(() =>
      evaluateRegionalLandValue({
        previousIndex: 0,
        inputs: { agentCount: -2, marketLiquidity: 0 },
        policy,
      }),
    ).toThrow('agentCount must be a non-negative integer');
    expect(() =>
      evaluateRegionalLandValue({
        previousIndex: 0,
        inputs: { agentCount: 0, marketLiquidity: Number.NaN },
        policy,
      }),
    ).toThrow('marketLiquidity must be non-negative');
  });
});

describe('assertValidLandValuePolicy', () => {
  it('accepts the canonical policy', () => {
    expect(() => assertValidLandValuePolicy(policy)).not.toThrow();
  });

  it('rejects an empty policyVersion', () => {
    expect(() => assertValidLandValuePolicy({ ...policy, policyVersion: ' ' })).toThrow(
      'policyVersion must not be empty',
    );
  });

  it('rejects a non-positive cadence', () => {
    expect(() => assertValidLandValuePolicy({ ...policy, updateCadenceMs: 0 })).toThrow(
      'updateCadenceMs must be positive',
    );
  });

  it('rejects a smoothing factor outside (0, 1]', () => {
    expect(() => assertValidLandValuePolicy({ ...policy, smoothingFactor: 0 })).toThrow(
      'smoothingFactor must be in (0, 1]',
    );
    expect(() => assertValidLandValuePolicy({ ...policy, smoothingFactor: 1.5 })).toThrow(
      'smoothingFactor must be in (0, 1]',
    );
  });

  it('rejects inverted clamp bounds', () => {
    expect(() => assertValidLandValuePolicy({ ...policy, minIndex: 10, maxIndex: 5 })).toThrow(
      'minIndex must not exceed maxIndex',
    );
  });

  it('rejects negative weights', () => {
    expect(() => assertValidLandValuePolicy({ ...policy, populationWeight: -1 })).toThrow(
      'populationWeight must be non-negative',
    );
    expect(() => assertValidLandValuePolicy({ ...policy, liquidityWeight: -1 })).toThrow(
      'liquidityWeight must be non-negative',
    );
  });
});
