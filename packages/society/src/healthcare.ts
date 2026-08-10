export type MedicalTreatmentCostPolicy = {
  readonly currencyCostPerSecond: number;
};

export type MedicalTreatmentCostDecision =
  | {
      readonly status: 'charged';
      readonly amount: number;
      readonly previousBalance: number;
      readonly nextBalance: number;
    }
  | {
      readonly status: 'uncharged';
      readonly reason: 'zero-cost';
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'insufficient-balance' | 'policy-invalid';
      readonly detail: string;
    };

export function evaluateMedicalTreatmentCost(input: {
  readonly balance: number;
  readonly durationSeconds: number;
  readonly policy: MedicalTreatmentCostPolicy;
}): MedicalTreatmentCostDecision {
  if (!isNonNegativeFinite(input.balance)) {
    return reject('policy-invalid', 'balance must be non-negative');
  }
  if (!isNonNegativeFinite(input.durationSeconds)) {
    return reject('policy-invalid', 'durationSeconds must be non-negative');
  }
  if (!isNonNegativeFinite(input.policy.currencyCostPerSecond)) {
    return reject('policy-invalid', 'currencyCostPerSecond must be non-negative');
  }

  const amount = input.durationSeconds * input.policy.currencyCostPerSecond;
  if (amount === 0) {
    return { status: 'uncharged', reason: 'zero-cost' };
  }
  if (input.balance < amount) {
    return reject('insufficient-balance', `balance requires ${amount}, available ${input.balance}`);
  }

  return {
    status: 'charged',
    amount,
    previousBalance: input.balance,
    nextBalance: input.balance - amount,
  };
}

function reject(
  reason: 'insufficient-balance' | 'policy-invalid',
  detail: string,
): MedicalTreatmentCostDecision {
  return { status: 'rejected', reason, detail };
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
