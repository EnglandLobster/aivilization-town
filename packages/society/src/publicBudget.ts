export type PublicBudgetAllocation = {
  readonly service: string;
  readonly amountPerCadence: number;
};

export type PublicBudgetPolicy = {
  readonly policyVersion: string;
  readonly cadenceMs: number;
  readonly minimumTreasuryReserve: number;
  readonly allocations: readonly PublicBudgetAllocation[];
};

export type PublicBudgetDecision = {
  readonly service: string;
  readonly amount: number;
  readonly previousTreasury: number;
  readonly nextTreasury: number;
};

export function settlePublicBudget(input: {
  readonly treasury: number;
  readonly policy: PublicBudgetPolicy;
}): readonly PublicBudgetDecision[] {
  assertValidPublicBudgetPolicy(input.policy);
  assertNonNegativeFinite(input.treasury, 'treasury');
  let treasury = input.treasury;
  const decisions: PublicBudgetDecision[] = [];
  for (const allocation of input.policy.allocations) {
    const spendable = Math.max(0, treasury - input.policy.minimumTreasuryReserve);
    const amount = Math.min(allocation.amountPerCadence, spendable);
    if (amount <= 0) {
      continue;
    }
    decisions.push({
      service: allocation.service,
      amount,
      previousTreasury: treasury,
      nextTreasury: treasury - amount,
    });
    treasury -= amount;
  }
  return decisions;
}

export function assertValidPublicBudgetPolicy(policy: PublicBudgetPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('public budget policyVersion must not be empty');
  }
  if (!Number.isInteger(policy.cadenceMs) || policy.cadenceMs < 1) {
    throw new Error('public budget cadenceMs must be a positive integer');
  }
  assertNonNegativeFinite(policy.minimumTreasuryReserve, 'minimumTreasuryReserve');
  const services = new Set<string>();
  for (const allocation of policy.allocations) {
    if (allocation.service.trim().length === 0) {
      throw new Error('public budget service must not be empty');
    }
    if (services.has(allocation.service)) {
      throw new Error(`duplicate public budget service ${allocation.service}`);
    }
    services.add(allocation.service);
    assertNonNegativeFinite(allocation.amountPerCadence, `${allocation.service} amountPerCadence`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}
