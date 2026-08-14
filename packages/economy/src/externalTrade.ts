/**
 * External trade pricing (town ↔ external sector), benchmarked against the CS2
 * TradeSystem: a rolling per-commodity net-export balance (positive = net
 * exports) decays every cadence, and imbalanced trade moves the external price
 * against the trader — a town that keeps exporting a commodity gets a worse
 * export price, a town that keeps importing pays more for the next import.
 *
 * The price impact factor is `priceImpactRatio × min(1, √|imbalance| /
 * balanceScale)`, so the impact saturates at `priceImpactRatio` for large
 * imbalances. Only the imbalance in the traded direction bites: exporting into
 * a net-import balance (or importing into a net-export balance) settles at the
 * domestic spot price.
 *
 * Monetary semantics: an export is an injection from the external sector (the
 * trader's circulating account is credited, moneySupply rises); an import is a
 * burn to the external sector. The accounting counterpart is the `external`
 * sector in `accounting.ts`; the functions here stay pure pricing/balance math.
 */
export type ExternalTradePolicy = {
  readonly policyVersion: string;
  /** Fraction of the rolling balance forgotten per cadence (CS2 uses 1%). */
  readonly balanceDecayRatioPerCadence: number;
  /** Simulation ms per balance-decay cadence boundary. */
  readonly cadenceMs: number;
  /** Maximum relative price impact once the √balance term saturates. */
  readonly priceImpactRatio: number;
  /** Normalization scale of the √|balance| impact term. */
  readonly balanceScale: number;
  readonly source: string;
};

export type ExternalTradePriceQuote = {
  readonly unitPrice: number;
  readonly total: number;
  readonly impactRatio: number;
};

/**
 * Unit price the external sector pays the town for `quantity` units exported at
 * `spotPrice` while the rolling net-export balance is `netExportBalance`. The
 * more the town has already net-exported, the lower the price:
 * `spot × (1 − impact)`, floored at zero.
 */
export function evaluateExternalExportPrice(input: {
  readonly spotPrice: number;
  readonly quantity: number;
  readonly netExportBalance: number;
  readonly policy: ExternalTradePolicy;
}): ExternalTradePriceQuote {
  validateExternalTradePolicy(input.policy);
  assertPositiveFinite(input.spotPrice, 'spotPrice');
  assertPositiveFinite(input.quantity, 'quantity');
  assertFinite(input.netExportBalance, 'netExportBalance');
  const impactRatio = externalTradeImpactRatio({
    imbalance: Math.max(0, input.netExportBalance),
    policy: input.policy,
  });
  const unitPrice = Math.max(0, input.spotPrice * (1 - impactRatio));
  return { unitPrice, total: unitPrice * input.quantity, impactRatio };
}

/**
 * Unit price the town pays the external sector for `quantity` units imported at
 * `spotPrice` while the rolling net-export balance is `netExportBalance`. The
 * more the town has already net-imported (negative balance), the higher the
 * price: `spot × (1 + impact)`.
 */
export function evaluateExternalImportPrice(input: {
  readonly spotPrice: number;
  readonly quantity: number;
  readonly netExportBalance: number;
  readonly policy: ExternalTradePolicy;
}): ExternalTradePriceQuote {
  validateExternalTradePolicy(input.policy);
  assertPositiveFinite(input.spotPrice, 'spotPrice');
  assertPositiveFinite(input.quantity, 'quantity');
  assertFinite(input.netExportBalance, 'netExportBalance');
  const impactRatio = externalTradeImpactRatio({
    imbalance: Math.max(0, -input.netExportBalance),
    policy: input.policy,
  });
  const unitPrice = input.spotPrice * (1 + impactRatio);
  return { unitPrice, total: unitPrice * input.quantity, impactRatio };
}

/** One decay cadence of the rolling balance: `balance × (1 − decayRatio)`. */
export function decayExternalTradeBalance(input: {
  readonly balance: number;
  readonly policy: ExternalTradePolicy;
}): number {
  validateExternalTradePolicy(input.policy);
  assertFinite(input.balance, 'balance');
  return input.balance * (1 - input.policy.balanceDecayRatioPerCadence);
}

export function validateExternalTradePolicy(policy: ExternalTradePolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('external trade policyVersion must not be empty');
  }
  if (
    !Number.isFinite(policy.balanceDecayRatioPerCadence) ||
    policy.balanceDecayRatioPerCadence < 0 ||
    policy.balanceDecayRatioPerCadence >= 1
  ) {
    throw new Error('balanceDecayRatioPerCadence must be in [0, 1)');
  }
  if (!Number.isInteger(policy.cadenceMs) || policy.cadenceMs < 1) {
    throw new Error('external trade cadenceMs must be a positive integer');
  }
  if (
    !Number.isFinite(policy.priceImpactRatio) ||
    policy.priceImpactRatio < 0 ||
    policy.priceImpactRatio > 1
  ) {
    throw new Error('priceImpactRatio must be in [0, 1]');
  }
  assertPositiveFinite(policy.balanceScale, 'balanceScale');
  if (policy.source.trim().length === 0) {
    throw new Error('external trade source must not be empty');
  }
}

function externalTradeImpactRatio(input: {
  readonly imbalance: number;
  readonly policy: ExternalTradePolicy;
}): number {
  return (
    input.policy.priceImpactRatio *
    Math.min(1, Math.sqrt(input.imbalance) / input.policy.balanceScale)
  );
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
