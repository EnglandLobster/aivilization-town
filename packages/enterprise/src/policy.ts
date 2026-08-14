export type EnterpriseSolvencyPolicy = {
  readonly evaluationCadenceMs: number;
  readonly minimumCashBalance: number;
  readonly gracePeriodMs: number;
};

export type EnterpriseDividendPolicy = {
  readonly paymentCadenceMs: number;
  readonly minimumCashReserve: number;
  readonly payoutRatio: number;
};

export type EnterprisePolicy = {
  readonly policyVersion: string;
  readonly minimumInitialCapital: number;
  readonly maximumInitialCapital: number;
  readonly maximumEmployees: number;
  readonly solvency?: EnterpriseSolvencyPolicy;
  readonly dividend?: EnterpriseDividendPolicy;
};

export function assertValidEnterprisePolicy(policy: EnterprisePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('enterprise policyVersion must not be empty');
  }
  assertNonNegativeFinite(policy.minimumInitialCapital, 'minimumInitialCapital');
  assertNonNegativeFinite(policy.maximumInitialCapital, 'maximumInitialCapital');
  if (policy.maximumInitialCapital < policy.minimumInitialCapital) {
    throw new Error('maximumInitialCapital must be at least minimumInitialCapital');
  }
  if (!Number.isInteger(policy.maximumEmployees) || policy.maximumEmployees < 1) {
    throw new Error('maximumEmployees must be a positive integer');
  }
  if (policy.solvency !== undefined) {
    assertPositiveInteger(policy.solvency.evaluationCadenceMs, 'solvency evaluationCadenceMs');
    assertNonNegativeFinite(policy.solvency.minimumCashBalance, 'minimumCashBalance');
    assertNonNegativeFinite(policy.solvency.gracePeriodMs, 'gracePeriodMs');
  }
  if (policy.dividend !== undefined) {
    assertPositiveInteger(policy.dividend.paymentCadenceMs, 'dividend paymentCadenceMs');
    assertNonNegativeFinite(policy.dividend.minimumCashReserve, 'minimumCashReserve');
    if (
      !Number.isFinite(policy.dividend.payoutRatio) ||
      policy.dividend.payoutRatio < 0 ||
      policy.dividend.payoutRatio > 1
    ) {
      throw new Error('dividend payoutRatio must be in [0, 1]');
    }
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}
