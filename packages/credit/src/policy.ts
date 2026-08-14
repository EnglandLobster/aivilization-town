import type { CreditHistory } from './model';

/**
 * Versioned town-bank policy. One accrual cadence (`accrualCadenceMs`) is one
 * loan "day": daily interest rates apply once per cadence and `loanTermDays`
 * counts cadences. Changing any settlement semantic requires a new
 * `policyVersion` and a replay boundary.
 */
export type CreditPolicy = {
  readonly policyVersion: string;
  /** Daily interest rate paid on deposits, settled from the bank cash account. */
  readonly depositDailyInterestRate: number;
  /** Daily interest rate charged on outstanding loan principal. */
  readonly loanDailyInterestRate: number;
  readonly loanTermDays: number;
  /** Simulation ms per credit "day" (accrual cadence boundary spacing). */
  readonly accrualCadenceMs: number;
  /** Fraction of total deposits the bank must keep as cash after issuing a loan. */
  readonly reserveRatio: number;
  readonly maxLoansPerAgent: number;
  /** Consecutive under-covered daily settlements tolerated before default. */
  readonly graceMissedPayments: number;
  /** Credit limit for a borrower with no history. */
  readonly baseLoanLimit: number;
  /** Each repaid loan scales the limit by (1 + this ratio). */
  readonly creditLimitRepaidBonusRatio: number;
  /** Each default scales the limit by this ratio (e.g. 0.5 halves it). */
  readonly creditLimitDefaultPenaltyRatio: number;
  /** Clamp bounds for the history multiplier. */
  readonly creditLimitMinMultiplier: number;
  readonly creditLimitMaxMultiplier: number;
  readonly source: string;
};

export function validateCreditPolicy(policy: CreditPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('credit policyVersion must not be empty');
  }
  assertNonNegativeFinite(policy.depositDailyInterestRate, 'depositDailyInterestRate');
  assertNonNegativeFinite(policy.loanDailyInterestRate, 'loanDailyInterestRate');
  if (!Number.isInteger(policy.loanTermDays) || policy.loanTermDays < 1) {
    throw new Error('loanTermDays must be a positive integer');
  }
  if (!Number.isInteger(policy.accrualCadenceMs) || policy.accrualCadenceMs < 1) {
    throw new Error('accrualCadenceMs must be a positive integer');
  }
  if (
    !Number.isFinite(policy.reserveRatio) ||
    policy.reserveRatio < 0 ||
    policy.reserveRatio > 1
  ) {
    throw new Error('reserveRatio must be in [0, 1]');
  }
  if (!Number.isInteger(policy.maxLoansPerAgent) || policy.maxLoansPerAgent < 1) {
    throw new Error('maxLoansPerAgent must be a positive integer');
  }
  if (!Number.isInteger(policy.graceMissedPayments) || policy.graceMissedPayments < 0) {
    throw new Error('graceMissedPayments must be a non-negative integer');
  }
  assertPositiveFinite(policy.baseLoanLimit, 'baseLoanLimit');
  assertNonNegativeFinite(policy.creditLimitRepaidBonusRatio, 'creditLimitRepaidBonusRatio');
  if (
    !Number.isFinite(policy.creditLimitDefaultPenaltyRatio) ||
    policy.creditLimitDefaultPenaltyRatio < 0 ||
    policy.creditLimitDefaultPenaltyRatio > 1
  ) {
    throw new Error('creditLimitDefaultPenaltyRatio must be in [0, 1]');
  }
  assertNonNegativeFinite(policy.creditLimitMinMultiplier, 'creditLimitMinMultiplier');
  assertNonNegativeFinite(policy.creditLimitMaxMultiplier, 'creditLimitMaxMultiplier');
  if (policy.creditLimitMinMultiplier > policy.creditLimitMaxMultiplier) {
    throw new Error('creditLimitMinMultiplier must not exceed creditLimitMaxMultiplier');
  }
  if (policy.source.trim().length === 0) {
    throw new Error('credit policy source must not be empty');
  }
}

/**
 * Credit-limit schedule: the base limit scaled by the borrower's history —
 * each repayment compounds a bonus, each default compounds a penalty, and the
 * multiplier is clamped to the policy bounds so limits stay finite and
 * non-negative under any history.
 */
export function resolveCreditLimit(input: {
  readonly history: CreditHistory | undefined;
  readonly policy: CreditPolicy;
}): number {
  const history = input.history ?? { repaidCount: 0, defaultedCount: 0 };
  const rawMultiplier =
    Math.pow(1 + input.policy.creditLimitRepaidBonusRatio, history.repaidCount) *
    Math.pow(input.policy.creditLimitDefaultPenaltyRatio, history.defaultedCount);
  const multiplier = Math.min(
    input.policy.creditLimitMaxMultiplier,
    Math.max(input.policy.creditLimitMinMultiplier, rawMultiplier),
  );
  return input.policy.baseLoanLimit * multiplier;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}
