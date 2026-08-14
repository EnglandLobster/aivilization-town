import { describe, expect, test } from 'vitest';
import { evaluateIncomeTax, evaluateTradeTax, type TaxPolicy } from './index';

const policy: TaxPolicy = {
  policyVersion: 'tax-regime-test',
  neutralRate: 0.1,
  incomeTaxBrackets: [
    { upToAmount: 300, rate: 0 },
    { upToAmount: 800, rate: 0.08 },
    { upToAmount: null, rate: 0.12 },
  ],
  tradeTaxRate: 0.05,
  source: 'test',
};

describe('income tax', () => {
  test('charges each bracket progressively over the wage amount', () => {
    // Fully inside the tax-free bracket.
    expect(evaluateIncomeTax({ wageAmount: 300, policy })).toBe(0);
    // 300 at 0% + 200 at 8%.
    expect(evaluateIncomeTax({ wageAmount: 500, policy })).toBeCloseTo(16);
    // 300 at 0% + 500 at 8% + 200 at 12%.
    expect(evaluateIncomeTax({ wageAmount: 1000, policy })).toBeCloseTo(64);
  });

  test('charges nothing for a zero wage', () => {
    expect(evaluateIncomeTax({ wageAmount: 0, policy })).toBe(0);
  });

  test('charges nothing when the policy has no brackets', () => {
    expect(
      evaluateIncomeTax({
        wageAmount: 1000,
        policy: { ...policy, incomeTaxBrackets: [] },
      }),
    ).toBe(0);
  });

  test('rejects invalid rates and wage amounts', () => {
    expect(() =>
      evaluateIncomeTax({
        wageAmount: 100,
        policy: { ...policy, incomeTaxBrackets: [{ upToAmount: null, rate: -0.1 }] },
      }),
    ).toThrow(/rate must be between 0 and 1/);
    expect(() =>
      evaluateIncomeTax({
        wageAmount: 100,
        policy: { ...policy, incomeTaxBrackets: [{ upToAmount: null, rate: 1.1 }] },
      }),
    ).toThrow(/rate must be between 0 and 1/);
    expect(() => evaluateIncomeTax({ wageAmount: -1, policy })).toThrow(
      /wageAmount must be non-negative/,
    );
    expect(() =>
      evaluateIncomeTax({
        wageAmount: 100,
        policy: { ...policy, neutralRate: 2 },
      }),
    ).toThrow(/neutralRate must be between 0 and 1/);
  });

  test('rejects non-increasing or misplaced bracket bounds', () => {
    expect(() =>
      evaluateIncomeTax({
        wageAmount: 100,
        policy: {
          ...policy,
          incomeTaxBrackets: [
            { upToAmount: 300, rate: 0.1 },
            { upToAmount: 200, rate: 0.2 },
          ],
        },
      }),
    ).toThrow(/upToAmount values must be positive and increasing/);
    expect(() =>
      evaluateIncomeTax({
        wageAmount: 100,
        policy: {
          ...policy,
          incomeTaxBrackets: [
            { upToAmount: null, rate: 0.1 },
            { upToAmount: 500, rate: 0.2 },
          ],
        },
      }),
    ).toThrow(/only the last income tax bracket may be uncapped/);
  });
});

describe('trade tax', () => {
  test('charges the flat rate on sale proceeds', () => {
    expect(evaluateTradeTax({ saleProceeds: 200, policy })).toBeCloseTo(10);
    expect(evaluateTradeTax({ saleProceeds: 0, policy })).toBe(0);
  });

  test('rejects invalid trade tax rates and proceeds', () => {
    expect(() =>
      evaluateTradeTax({ saleProceeds: 100, policy: { ...policy, tradeTaxRate: 1.5 } }),
    ).toThrow(/tradeTaxRate must be between 0 and 1/);
    expect(() =>
      evaluateTradeTax({ saleProceeds: 100, policy: { ...policy, tradeTaxRate: -0.01 } }),
    ).toThrow(/tradeTaxRate must be between 0 and 1/);
    expect(() => evaluateTradeTax({ saleProceeds: -5, policy })).toThrow(
      /saleProceeds must be non-negative/,
    );
  });
});
