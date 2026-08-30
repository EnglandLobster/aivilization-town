export { TOWN_SERVICE_QUALITY_POLICY_VERSION } from '@aivilization/content';

export type TownPublicService = 'education' | 'healthcare';

export type ServiceQualityRule = {
  /** Public-budget funding required for full budget efficiency each cadence. */
  readonly requiredFundingPerCadence: number;
  /** Occupancy ratio at or below which capacity does not reduce quality. */
  readonly pressureStartsAtOccupancyRatio: number;
  /** Capacity-side quality at occupancy ratio 1. */
  readonly qualityAtFullOccupancy: number;
};

export type ServiceQualityPolicy = {
  readonly policyVersion: string;
  readonly cadenceMs: number;
  readonly services: Readonly<Record<TownPublicService, ServiceQualityRule>>;
  /** Maximum regional land-value contribution at quality 1. */
  readonly landValueWeight: number;
  /** Negative wellbeing contribution magnitude at quality 0. */
  readonly wellbeingPenaltyAtZeroQuality: number;
};

export type ServiceQualityInputs = {
  readonly service: TownPublicService;
  readonly fundedAmount: number;
  readonly occupancy: number;
  readonly capacity: number;
};

export type ServiceQualityEvaluation = {
  readonly service: TownPublicService;
  readonly fundedAmount: number;
  readonly occupancy: number;
  readonly capacity: number;
  readonly budgetEfficiency: number;
  readonly occupancyRatio: number;
  readonly capacityEfficiency: number;
  readonly quality: number;
  readonly landValueContribution: number;
  readonly wellbeingContribution: number;
};

export type RegionalServiceQualitySummary = {
  readonly quality: number;
  readonly landValueContribution: number;
  readonly wellbeingContribution: number;
};

/** Average service channels so adding a service cannot increase the cap. */
export function summarizeRegionalServiceQuality(
  services: readonly Pick<
    ServiceQualityEvaluation,
    'quality' | 'landValueContribution' | 'wellbeingContribution'
  >[],
): RegionalServiceQualitySummary | undefined {
  if (services.length === 0) return undefined;
  for (const [index, service] of services.entries()) {
    assertUnitInterval(service.quality, `services[${index}].quality`);
    assertNonNegativeFinite(
      service.landValueContribution,
      `services[${index}].landValueContribution`,
    );
    if (!Number.isFinite(service.wellbeingContribution)) {
      throw new Error(`services[${index}].wellbeingContribution must be finite`);
    }
  }
  const divisor = services.length;
  const wellbeingContribution =
    services.reduce((total, service) => total + service.wellbeingContribution, 0) / divisor;
  return {
    quality: services.reduce((total, service) => total + service.quality, 0) / divisor,
    landValueContribution:
      services.reduce((total, service) => total + service.landValueContribution, 0) / divisor,
    wellbeingContribution: wellbeingContribution === 0 ? 0 : wellbeingContribution,
  };
}

/**
 * Pure service-shortage decision. Budget transmission and congestion are
 * deliberately separate and multiplicative: a half-funded empty clinic and a
 * fully-funded clinic at severe capacity pressure can both degrade service,
 * while a region without a matching facility has zero coverage.
 */
export function evaluateServiceQuality(input: {
  readonly inputs: ServiceQualityInputs;
  readonly policy: ServiceQualityPolicy;
}): ServiceQualityEvaluation {
  assertValidServiceQualityPolicy(input.policy);
  const { inputs, policy } = input;
  assertNonNegativeFinite(inputs.fundedAmount, 'fundedAmount');
  assertNonNegativeInteger(inputs.occupancy, 'occupancy');
  assertNonNegativeFinite(inputs.capacity, 'capacity');
  const rule = policy.services[inputs.service];

  const budgetEfficiency = clamp01(inputs.fundedAmount / rule.requiredFundingPerCadence);
  const occupancyRatio = inputs.capacity === 0 ? 0 : inputs.occupancy / inputs.capacity;
  const capacityEfficiency =
    inputs.capacity === 0
      ? 0
      : evaluateCapacityEfficiency({
          occupancyRatio,
          pressureStartsAtOccupancyRatio: rule.pressureStartsAtOccupancyRatio,
          qualityAtFullOccupancy: rule.qualityAtFullOccupancy,
        });
  const quality = clamp01(budgetEfficiency * capacityEfficiency);
  const wellbeingContribution = -(1 - quality) * policy.wellbeingPenaltyAtZeroQuality;
  return {
    service: inputs.service,
    fundedAmount: inputs.fundedAmount,
    occupancy: inputs.occupancy,
    capacity: inputs.capacity,
    budgetEfficiency,
    occupancyRatio,
    capacityEfficiency,
    quality,
    landValueContribution: quality * policy.landValueWeight,
    wellbeingContribution: wellbeingContribution === 0 ? 0 : wellbeingContribution,
  };
}

/** Applies an authoritative quality scalar to a positive service effect. */
export function applyServiceQuality(effect: number, quality: number): number {
  assertNonNegativeFinite(effect, 'effect');
  assertUnitInterval(quality, 'quality');
  return effect * quality;
}

export function assertValidServiceQualityPolicy(policy: ServiceQualityPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('service quality policyVersion must not be empty');
  }
  if (!Number.isInteger(policy.cadenceMs) || policy.cadenceMs < 1) {
    throw new Error('service quality cadenceMs must be a positive integer');
  }
  for (const service of ['education', 'healthcare'] as const) {
    const rule = policy.services[service];
    if (!Number.isFinite(rule.requiredFundingPerCadence) || rule.requiredFundingPerCadence <= 0) {
      throw new Error(`${service} requiredFundingPerCadence must be positive finite`);
    }
    assertUnitInterval(
      rule.pressureStartsAtOccupancyRatio,
      `${service} pressureStartsAtOccupancyRatio`,
    );
    if (rule.pressureStartsAtOccupancyRatio >= 1) {
      throw new Error(`${service} pressureStartsAtOccupancyRatio must be less than 1`);
    }
    assertUnitInterval(rule.qualityAtFullOccupancy, `${service} qualityAtFullOccupancy`);
  }
  assertNonNegativeFinite(policy.landValueWeight, 'landValueWeight');
  assertNonNegativeFinite(policy.wellbeingPenaltyAtZeroQuality, 'wellbeingPenaltyAtZeroQuality');
}

function evaluateCapacityEfficiency(input: {
  readonly occupancyRatio: number;
  readonly pressureStartsAtOccupancyRatio: number;
  readonly qualityAtFullOccupancy: number;
}): number {
  if (input.occupancyRatio <= input.pressureStartsAtOccupancyRatio) return 1;
  if (input.occupancyRatio >= 1) return input.qualityAtFullOccupancy;
  const pressureProgress =
    (input.occupancyRatio - input.pressureStartsAtOccupancyRatio) /
    (1 - input.pressureStartsAtOccupancyRatio);
  return 1 - pressureProgress * (1 - input.qualityAtFullOccupancy);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be in [0, 1]`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
