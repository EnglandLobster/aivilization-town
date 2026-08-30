/**
 * Tax policy and pure evaluators for the public treasury. Income tax is
 * progressive across per-payment wage brackets; trade tax is a flat rate on
 * sale proceeds; dividend tax is an optional flat rate on enterprise dividend
 * payouts. All tax settlement in the world is a transfer between an agent or
 * enterprise balance and the treasury — it never mints or burns currency.
 */
export type IncomeTaxBracket = {
  // Inclusive upper bound of the single wage payment this bracket covers;
  // null marks the top (uncapped) bracket.
  readonly upToAmount: number | null;
  readonly rate: number; // 0..1
};

export type TaxPolicy = {
  readonly policyVersion: string;
  // Neutral rate (CS2 convention 10%): shown in decision contexts only;
  // settlement always uses incomeTaxBrackets.
  readonly neutralRate: number;
  readonly incomeTaxBrackets: readonly IncomeTaxBracket[];
  readonly tradeTaxRate: number; // 0..1, charged on sale proceeds
  /**
   * Optional flat rate (0..1) charged on enterprise dividend payouts and
   * credited to the treasury. Absent keeps dividends untaxed, byte-for-byte
   * compatible with legacy policies.
   */
  readonly dividendTaxRate?: number;
  readonly source: string;
};

export function evaluateIncomeTax(input: { wageAmount: number; policy: TaxPolicy }): number {
  assertNonNegativeFinite(input.wageAmount, 'wageAmount');
  assertValidTaxPolicy(input.policy);

  let tax = 0;
  let bracketFloor = 0;
  for (const bracket of input.policy.incomeTaxBrackets) {
    const bracketCeiling = bracket.upToAmount ?? Number.POSITIVE_INFINITY;
    const taxableInBracket = Math.max(0, Math.min(input.wageAmount, bracketCeiling) - bracketFloor);
    tax += taxableInBracket * bracket.rate;
    if (input.wageAmount <= bracketCeiling) {
      break;
    }
    bracketFloor = bracketCeiling;
  }
  return tax;
}

export function evaluateTradeTax(input: { saleProceeds: number; policy: TaxPolicy }): number {
  assertNonNegativeFinite(input.saleProceeds, 'saleProceeds');
  assertValidTaxPolicy(input.policy);
  return input.saleProceeds * input.policy.tradeTaxRate;
}

export function evaluateDividendTax(input: { amount: number; policy: TaxPolicy }): number {
  assertNonNegativeFinite(input.amount, 'amount');
  assertValidTaxPolicy(input.policy);
  return input.amount * (input.policy.dividendTaxRate ?? 0);
}

export function assertValidTaxPolicy(policy: TaxPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('tax policyVersion must not be empty');
  }
  assertRate(policy.neutralRate, 'neutralRate');
  assertRate(policy.tradeTaxRate, 'tradeTaxRate');
  if (policy.dividendTaxRate !== undefined) {
    assertRate(policy.dividendTaxRate, 'dividendTaxRate');
  }
  let previousUpToAmount = 0;
  policy.incomeTaxBrackets.forEach((bracket, index) => {
    assertRate(bracket.rate, `incomeTaxBrackets[${index}].rate`);
    if (bracket.upToAmount === null) {
      if (index !== policy.incomeTaxBrackets.length - 1) {
        throw new Error('only the last income tax bracket may be uncapped');
      }
      return;
    }
    if (!Number.isFinite(bracket.upToAmount) || bracket.upToAmount <= previousUpToAmount) {
      throw new Error('income tax bracket upToAmount values must be positive and increasing');
    }
    previousUpToAmount = bracket.upToAmount;
  });
}

function assertRate(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
