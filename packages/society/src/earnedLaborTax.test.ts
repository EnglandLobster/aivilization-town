import { expect, test } from 'vitest';
import { quoteEarnedLaborCompensation, earnedLaborWithholding } from './wage';
import type { TaxPolicy } from './tax';
const tax: TaxPolicy = {
  policyVersion: 'test-progressive-v1',
  neutralRate: 0.1,
  tradeTaxRate: 0,
  source: 'declared-test-institution',
  incomeTaxBrackets: [
    { upToAmount: 100, rate: 0.1 },
    { upToAmount: null, rate: 0.2 },
  ],
};
const pay = { version: 'labor-proportional-pay-v1', referenceSeconds: 28800 } as const;
test('reference-period brackets cannot be avoided with shorter shifts or smaller payment chunks', () => {
  const whole = quoteEarnedLaborCompensation({ quotedWage: 500, laborSeconds: 28800, pay, tax });
  const half = quoteEarnedLaborCompensation({ quotedWage: 500, laborSeconds: 14400, pay, tax });
  expect(whole.grossMicros).toBe(500e6);
  expect(whole.taxMicros).toBe(90e6);
  expect(half.taxMicros * 2).toBe(whole.taxMicros);
  let prior = 0,
    charged = 0;
  for (const received of [1, 1234567, 100000001, 300000007, 500000000]) {
    const cumulative = earnedLaborWithholding(whole, received);
    charged += cumulative - prior;
    prior = cumulative;
  }
  expect(charged).toBe(90e6);
  expect(earnedLaborWithholding(whole, 250e6)).toBe(45e6);
  expect(whole.withholdingVersion).toBe('labor-reference-period-withholding-v1');
});
test('zero pay, missing tax and invalid units have explicit bounded outcomes', () => {
  expect(
    quoteEarnedLaborCompensation({ quotedWage: 0, laborSeconds: 60, pay, tax }).taxMicros,
  ).toBe(0);
  expect(
    quoteEarnedLaborCompensation({ quotedWage: 500, laborSeconds: 60, pay }).taxPolicyVersion,
  ).toBe('no-income-tax');
  expect(earnedLaborWithholding({ grossMicros: 0, taxMicros: 0 }, 0)).toBe(0);
  for (const quotedWage of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER, 1e-9])
    expect(() =>
      quoteEarnedLaborCompensation({ quotedWage, laborSeconds: 28800, pay, tax }),
    ).toThrow();
  expect(() => earnedLaborWithholding({ grossMicros: 10, taxMicros: 11 }, 1)).toThrow();
  expect(() => earnedLaborWithholding({ grossMicros: 10, taxMicros: 2 }, 11)).toThrow();
});
