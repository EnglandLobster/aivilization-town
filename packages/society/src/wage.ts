import { cumulativeUnitAllocation } from '@aivilization/economy';
import type { OccupationConfig } from '@aivilization/content';
import { resolveOccupation } from './occupation-catalog';
import { calculateEffectiveKnowledgeThreshold } from './occupation';
import { evaluateIncomeTax, type TaxPolicy } from './tax';

export type KnowledgePremiumFunction = (effectiveKnowledgeThreshold: number) => number;

export function calculateStaticWage(input: {
  readonly occupationName: string;
  readonly overallPriceChangeRatio: number;
  readonly occupationCatalog?: readonly OccupationConfig[];
}): number {
  assertPositiveFinite(input.overallPriceChangeRatio, 'overallPriceChangeRatio');

  const occupation = resolveOccupation(input);
  if (occupation.jobTier > 3) {
    throw new Error(`${occupation.name} uses dynamic wage regime`);
  }

  return occupation.baseWage * input.overallPriceChangeRatio;
}

export function calculateDynamicWage(input: {
  readonly occupationName: string;
  readonly populationEducationScores: readonly number[];
  readonly overallPriceChangeRatio: number;
  readonly shortTermAdjustment: number;
  readonly maxShortTermAdjustment: number;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly occupationCatalog?: readonly OccupationConfig[];
}): number {
  assertPositiveFinite(input.overallPriceChangeRatio, 'overallPriceChangeRatio');
  assertNonNegativeFinite(input.maxShortTermAdjustment, 'maxShortTermAdjustment');
  assertFinite(input.shortTermAdjustment, 'shortTermAdjustment');

  if (Math.abs(input.shortTermAdjustment) > input.maxShortTermAdjustment) {
    throw new Error(
      'shortTermAdjustment must be within [-maxShortTermAdjustment, maxShortTermAdjustment]',
    );
  }
  if (1 + input.shortTermAdjustment < 0) {
    throw new Error('shortTermAdjustment must not make the wage multiplier negative');
  }

  const occupation = resolveOccupation(input);
  if (occupation.jobTier <= 3) {
    throw new Error(`${occupation.name} uses static wage regime`);
  }

  const effectiveKnowledgeThreshold = calculateEffectiveKnowledgeThreshold({
    educationScores: input.populationEducationScores,
    educationFloor: occupation.educationFloor,
    eligibilityShare: occupation.eligibilityShare,
  });
  const premium = input.knowledgePremium(effectiveKnowledgeThreshold);
  assertNonNegativeFinite(premium, 'knowledgePremium result');

  return (
    occupation.baseWage * premium * input.overallPriceChangeRatio * (1 + input.shortTermAdjustment)
  );
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

export type LaborPayPolicy = {
  readonly version: 'labor-proportional-pay-v1';
  readonly referenceSeconds: number;
};
/** Existing quoted wages remain intact; an opted-in regime states the time period of that quote. */
export function calculateLaborPay(
  quotedWage: number,
  laborSeconds: number,
  policy: LaborPayPolicy,
): number {
  if (
    policy.version !== 'labor-proportional-pay-v1' ||
    !Number.isFinite(policy.referenceSeconds) ||
    policy.referenceSeconds <= 0
  )
    throw new Error('invalid-labor-pay-policy');
  if (
    !Number.isFinite(quotedWage) ||
    quotedWage < 0 ||
    !Number.isFinite(laborSeconds) ||
    laborSeconds <= 0
  )
    throw new Error('invalid-labor-pay-input');
  return quotedWage * (laborSeconds / policy.referenceSeconds);
}

export const EARNED_LABOR_WITHHOLDING_VERSION = 'labor-reference-period-withholding-v1';
export type EarnedLaborCompensation = {
  readonly grossMicros: number;
  readonly taxMicros: number;
  readonly taxPolicyVersion: string;
  readonly withholdingVersion: typeof EARNED_LABOR_WITHHOLDING_VERSION;
};

/** Opted-in institution: brackets apply to the declared reference-period wage, not each clock slice. */
export function quoteEarnedLaborCompensation(input: {
  readonly quotedWage: number;
  readonly laborSeconds: number;
  readonly pay: LaborPayPolicy;
  readonly tax?: TaxPolicy;
}): EarnedLaborCompensation {
  const grossMicros = Math.round(
    calculateLaborPay(input.quotedWage, input.laborSeconds, input.pay) * 1e6,
  );
  const referenceGross = Math.round(input.quotedWage * 1e6);
  const referenceTax = input.tax
    ? Math.round(evaluateIncomeTax({ wageAmount: input.quotedWage, policy: input.tax }) * 1e6)
    : 0;
  if (
    ![grossMicros, referenceGross, referenceTax].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    (input.quotedWage > 0 && referenceGross === 0) ||
    referenceTax > referenceGross
  )
    throw Error('invalid-earned-labor-compensation');
  return {
    grossMicros,
    taxMicros:
      referenceGross === 0
        ? 0
        : cumulativeUnitAllocation(grossMicros, referenceTax, referenceGross),
    taxPolicyVersion: input.tax?.policyVersion ?? 'no-income-tax',
    withholdingVersion: EARNED_LABOR_WITHHOLDING_VERSION,
  };
}

/** Cumulative withholding is invariant under splitting an earned claim into payments. */
export function earnedLaborWithholding(
  terms: Pick<EarnedLaborCompensation, 'grossMicros' | 'taxMicros'>,
  paidMicros: number,
): number {
  if (
    ![terms.grossMicros, terms.taxMicros, paidMicros].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    terms.taxMicros > terms.grossMicros ||
    paidMicros > terms.grossMicros
  )
    throw Error('invalid-labor-withholding-proof');
  return terms.grossMicros === 0
    ? 0
    : cumulativeUnitAllocation(terms.taxMicros, paidMicros, terms.grossMicros);
}
