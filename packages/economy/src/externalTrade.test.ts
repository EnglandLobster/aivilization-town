import { describe, expect, test } from 'vitest';
import {
  decayExternalTradeBalance,
  evaluateExternalExportPrice,
  evaluateExternalImportPrice,
  validateExternalTradePolicy,
  type ExternalTradePolicy,
} from './externalTrade';

const policy: ExternalTradePolicy = {
  policyVersion: 'external-trade-v1',
  balanceDecayRatioPerCadence: 0.01,
  cadenceMs: 3_600_000,
  priceImpactRatio: 0.2,
  balanceScale: 50,
  source: 'external trade unit test fixture',
};

describe('external trade pricing', () => {
  test('export at zero balance settles at the spot price with no impact', () => {
    const quote = evaluateExternalExportPrice({
      spotPrice: 10,
      quantity: 5,
      netExportBalance: 0,
      policy,
    });
    expect(quote).toEqual({ unitPrice: 10, total: 50, impactRatio: 0 });
  });

  test('export price falls as the net-export balance grows', () => {
    // √25 / 50 = 0.1 → impact 0.2 × 0.1 = 0.02 → 2% below spot.
    const quote = evaluateExternalExportPrice({
      spotPrice: 10,
      quantity: 4,
      netExportBalance: 25,
      policy,
    });
    expect(quote.impactRatio).toBeCloseTo(0.02);
    expect(quote.unitPrice).toBeCloseTo(9.8);
    expect(quote.total).toBeCloseTo(39.2);
  });

  test('export impact saturates at priceImpactRatio for large balances', () => {
    // √2500 / 50 = 1 → exactly at the cap.
    const atCap = evaluateExternalExportPrice({
      spotPrice: 10,
      quantity: 1,
      netExportBalance: 2500,
      policy,
    });
    expect(atCap.impactRatio).toBeCloseTo(0.2);
    expect(atCap.unitPrice).toBeCloseTo(8);
    // Beyond the cap the impact stays capped.
    const beyondCap = evaluateExternalExportPrice({
      spotPrice: 10,
      quantity: 1,
      netExportBalance: 10_000,
      policy,
    });
    expect(beyondCap.impactRatio).toBeCloseTo(0.2);
    expect(beyondCap.unitPrice).toBeCloseTo(8);
  });

  test('export into a net-import balance carries no impact', () => {
    const quote = evaluateExternalExportPrice({
      spotPrice: 10,
      quantity: 2,
      netExportBalance: -25,
      policy,
    });
    expect(quote).toEqual({ unitPrice: 10, total: 20, impactRatio: 0 });
  });

  test('export unit price is floored at zero', () => {
    const quote = evaluateExternalExportPrice({
      spotPrice: 10,
      quantity: 3,
      netExportBalance: 2500,
      policy: { ...policy, priceImpactRatio: 1 },
    });
    expect(quote.impactRatio).toBe(1);
    expect(quote.unitPrice).toBe(0);
    expect(quote.total).toBe(0);
  });

  test('import at zero balance settles at the spot price with no impact', () => {
    const quote = evaluateExternalImportPrice({
      spotPrice: 10,
      quantity: 5,
      netExportBalance: 0,
      policy,
    });
    expect(quote).toEqual({ unitPrice: 10, total: 50, impactRatio: 0 });
  });

  test('import price rises as the net-import balance grows', () => {
    // Net imports 25 → √25 / 50 = 0.1 → impact 0.02 → 2% above spot.
    const quote = evaluateExternalImportPrice({
      spotPrice: 10,
      quantity: 4,
      netExportBalance: -25,
      policy,
    });
    expect(quote.impactRatio).toBeCloseTo(0.02);
    expect(quote.unitPrice).toBeCloseTo(10.2);
    expect(quote.total).toBeCloseTo(40.8);
  });

  test('import impact saturates at priceImpactRatio for large net-import balances', () => {
    const quote = evaluateExternalImportPrice({
      spotPrice: 10,
      quantity: 1,
      netExportBalance: -10_000,
      policy,
    });
    expect(quote.impactRatio).toBeCloseTo(0.2);
    expect(quote.unitPrice).toBeCloseTo(12);
  });

  test('import into a net-export balance carries no impact', () => {
    const quote = evaluateExternalImportPrice({
      spotPrice: 10,
      quantity: 2,
      netExportBalance: 25,
      policy,
    });
    expect(quote).toEqual({ unitPrice: 10, total: 20, impactRatio: 0 });
  });

  test('rejects non-positive or non-finite prices, quantities and balances', () => {
    expect(() =>
      evaluateExternalExportPrice({ spotPrice: 0, quantity: 1, netExportBalance: 0, policy }),
    ).toThrow('spotPrice must be positive finite');
    expect(() =>
      evaluateExternalImportPrice({
        spotPrice: Number.NaN,
        quantity: 1,
        netExportBalance: 0,
        policy,
      }),
    ).toThrow('spotPrice must be positive finite');
    expect(() =>
      evaluateExternalExportPrice({ spotPrice: 10, quantity: 0, netExportBalance: 0, policy }),
    ).toThrow('quantity must be positive finite');
    expect(() =>
      evaluateExternalImportPrice({
        spotPrice: 10,
        quantity: 1,
        netExportBalance: Number.POSITIVE_INFINITY,
        policy,
      }),
    ).toThrow('netExportBalance must be finite');
  });
});

describe('external trade balance decay', () => {
  test('decays the balance by the policy ratio per cadence', () => {
    expect(decayExternalTradeBalance({ balance: 100, policy })).toBeCloseTo(99);
    expect(decayExternalTradeBalance({ balance: -50, policy })).toBeCloseTo(-49.5);
    expect(decayExternalTradeBalance({ balance: 0, policy })).toBe(0);
  });

  test('compounds when applied across consecutive cadences', () => {
    const once = decayExternalTradeBalance({ balance: 100, policy });
    const twice = decayExternalTradeBalance({ balance: once, policy });
    expect(twice).toBeCloseTo(98.01);
  });

  test('rejects non-finite balances', () => {
    expect(() => decayExternalTradeBalance({ balance: Number.NaN, policy })).toThrow(
      'balance must be finite',
    );
  });
});

describe('external trade policy validation', () => {
  test('accepts the default-shaped policy', () => {
    expect(() => validateExternalTradePolicy(policy)).not.toThrow();
  });

  test('rejects invalid policy fields', () => {
    expect(() => validateExternalTradePolicy({ ...policy, policyVersion: '' })).toThrow(
      'policyVersion must not be empty',
    );
    expect(() =>
      validateExternalTradePolicy({ ...policy, balanceDecayRatioPerCadence: -0.1 }),
    ).toThrow('balanceDecayRatioPerCadence must be in [0, 1)');
    expect(() =>
      validateExternalTradePolicy({ ...policy, balanceDecayRatioPerCadence: 1 }),
    ).toThrow('balanceDecayRatioPerCadence must be in [0, 1)');
    expect(() => validateExternalTradePolicy({ ...policy, cadenceMs: 0 })).toThrow(
      'cadenceMs must be a positive integer',
    );
    expect(() => validateExternalTradePolicy({ ...policy, cadenceMs: 1.5 })).toThrow(
      'cadenceMs must be a positive integer',
    );
    expect(() => validateExternalTradePolicy({ ...policy, priceImpactRatio: -0.1 })).toThrow(
      'priceImpactRatio must be in [0, 1]',
    );
    expect(() => validateExternalTradePolicy({ ...policy, priceImpactRatio: 1.1 })).toThrow(
      'priceImpactRatio must be in [0, 1]',
    );
    expect(() => validateExternalTradePolicy({ ...policy, balanceScale: 0 })).toThrow(
      'balanceScale must be positive finite',
    );
    expect(() => validateExternalTradePolicy({ ...policy, source: ' ' })).toThrow(
      'source must not be empty',
    );
  });

  test('evaluation re-validates the policy', () => {
    expect(() =>
      evaluateExternalExportPrice({
        spotPrice: 10,
        quantity: 1,
        netExportBalance: 0,
        policy: { ...policy, priceImpactRatio: 2 },
      }),
    ).toThrow('priceImpactRatio must be in [0, 1]');
  });
});
