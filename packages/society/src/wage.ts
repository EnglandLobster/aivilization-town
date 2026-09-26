import type { OccupationConfig } from '@aivilization/content';
import { resolveOccupation } from './occupation-catalog';
import { calculateEffectiveKnowledgeThreshold } from './occupation';

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
