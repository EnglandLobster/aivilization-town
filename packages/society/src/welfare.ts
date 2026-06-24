export type SafetyNetSubsidyPolicy = {
  readonly minimumBalance: number;
  readonly maxSubsidy: number;
};

export type SafetyNetSubsidyDecision =
  | {
      readonly status: 'eligible';
      readonly amount: number;
      readonly previousBalance: number;
      readonly nextBalance: number;
    }
  | {
      readonly status: 'ineligible';
      readonly reason: 'balance-at-or-above-minimum';
    };

export function evaluateSafetyNetSubsidy(
  input: SafetyNetSubsidyPolicy & {
    readonly balance: number;
  },
): SafetyNetSubsidyDecision {
  assertNonNegativeFinite(input.balance, 'balance');
  assertNonNegativeFinite(input.minimumBalance, 'minimumBalance');
  assertNonNegativeFinite(input.maxSubsidy, 'maxSubsidy');

  const gap = input.minimumBalance - input.balance;
  if (gap <= 0 || input.maxSubsidy === 0) {
    return { status: 'ineligible', reason: 'balance-at-or-above-minimum' };
  }

  const amount = Math.min(gap, input.maxSubsidy);
  return {
    status: 'eligible',
    amount,
    previousBalance: input.balance,
    nextBalance: input.balance + amount,
  };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
