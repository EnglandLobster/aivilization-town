import type { PhysiologicalState } from './physiology';

export type TownConditionKind = 'soaked' | 'cold' | 'overtired' | 'hungry' | 'stressed';

export type TownConditionSeverity = 'mild' | 'moderate' | 'severe';

export type TownConditionNeed = 'eat' | 'sleep' | 'shelter' | 'warm-up' | 'see-doctor';

/**
 * Physiology-axis condition rule (town-conditions-v1). The condition triggers
 * at `moderate` severity when the axis drops below `triggerBelow`, and escalates
 * to `severe` below `severeBelow`. Derivation is a pure threshold read of the
 * durable physiology axes, so no events or stored state are involved.
 */
export type TownPhysiologyConditionConfig = {
  readonly triggerBelow: number;
  readonly severeBelow: number;
  readonly need: TownConditionNeed;
};

/**
 * Weather-exposure condition rule. `outdoorSeverityByWeather` maps a weather
 * kind to the severity an agent outdoors catches; the optional sheltered
 * variant applies to agents inside a low-tier residence (poor insulation)
 * while the listed weather holds.
 */
export type TownWeatherConditionConfig = {
  readonly outdoorSeverityByWeather: Readonly<Record<string, TownConditionSeverity>>;
  readonly shelteredSeverity?: TownConditionSeverity;
  readonly shelteredMaxResidentialTier?: number;
  readonly need: TownConditionNeed;
};

/**
 * Versioned town-condition catalog.
 * Conditions are a DERIVED view over durable physiology axes, the simulation
 * weather, and the agent's location exposure — never authoritative state.
 */
export type TownConditionsPolicy = {
  readonly policyVersion: string;
  readonly soaked: TownWeatherConditionConfig;
  readonly cold: TownWeatherConditionConfig;
  readonly overtired: TownPhysiologyConditionConfig;
  readonly hungry: TownPhysiologyConditionConfig;
  readonly stressed: TownPhysiologyConditionConfig;
};

export type DerivedAgentCondition = {
  readonly kind: TownConditionKind;
  readonly severity: TownConditionSeverity;
  readonly need: TownConditionNeed;
};

export function assertTownConditionsPolicy(policy: TownConditionsPolicy): void {
  assertPhysiologyConditionConfig('overtired', policy.overtired);
  assertPhysiologyConditionConfig('hungry', policy.hungry);
  assertPhysiologyConditionConfig('stressed', policy.stressed);
  assertWeatherConditionConfig('soaked', policy.soaked);
  assertWeatherConditionConfig('cold', policy.cold);
}

/**
 * Derive the agent's current conditions from durable state. Pure and total:
 * same inputs always yield the same conditions, in canonical kind order.
 * Weather-exposure conditions only apply while the world carries a weather
 * state (the town-weather switch); without weather they never trigger.
 */
export function deriveAgentConditions(input: {
  readonly physiology: PhysiologicalState;
  readonly residentialTier: number;
  readonly outdoors: boolean;
  readonly weather?: string;
  readonly policy: TownConditionsPolicy;
}): readonly DerivedAgentCondition[] {
  assertTownConditionsPolicy(input.policy);
  const conditions: DerivedAgentCondition[] = [];

  const soaked = deriveWeatherExposureCondition({
    kind: 'soaked',
    config: input.policy.soaked,
    outdoors: input.outdoors,
    residentialTier: input.residentialTier,
    weather: input.weather,
  });
  if (soaked !== undefined) {
    conditions.push(soaked);
  }

  const cold = deriveWeatherExposureCondition({
    kind: 'cold',
    config: input.policy.cold,
    outdoors: input.outdoors,
    residentialTier: input.residentialTier,
    weather: input.weather,
  });
  if (cold !== undefined) {
    conditions.push(cold);
  }

  const overtired = derivePhysiologyCondition({
    kind: 'overtired',
    config: input.policy.overtired,
    value: input.physiology.energy,
  });
  if (overtired !== undefined) {
    conditions.push(overtired);
  }

  const hungry = derivePhysiologyCondition({
    kind: 'hungry',
    config: input.policy.hungry,
    value: input.physiology.satiety,
  });
  if (hungry !== undefined) {
    conditions.push(hungry);
  }

  const stressed = derivePhysiologyCondition({
    kind: 'stressed',
    config: input.policy.stressed,
    value: input.physiology.health,
  });
  if (stressed !== undefined) {
    conditions.push(stressed);
  }

  return conditions;
}

function derivePhysiologyCondition(input: {
  readonly kind: TownConditionKind;
  readonly config: TownPhysiologyConditionConfig;
  readonly value: number;
}): DerivedAgentCondition | undefined {
  if (input.value < input.config.severeBelow) {
    return { kind: input.kind, severity: 'severe', need: input.config.need };
  }
  if (input.value < input.config.triggerBelow) {
    return { kind: input.kind, severity: 'moderate', need: input.config.need };
  }
  return undefined;
}

function deriveWeatherExposureCondition(input: {
  readonly kind: TownConditionKind;
  readonly config: TownWeatherConditionConfig;
  readonly outdoors: boolean;
  readonly residentialTier: number;
  readonly weather: string | undefined;
}): DerivedAgentCondition | undefined {
  if (input.weather === undefined) {
    return undefined;
  }
  const outdoorSeverity = input.config.outdoorSeverityByWeather[input.weather];
  if (outdoorSeverity === undefined) {
    return undefined;
  }
  if (input.outdoors) {
    return { kind: input.kind, severity: outdoorSeverity, need: input.config.need };
  }
  if (
    input.config.shelteredSeverity !== undefined &&
    input.config.shelteredMaxResidentialTier !== undefined &&
    input.residentialTier <= input.config.shelteredMaxResidentialTier
  ) {
    return { kind: input.kind, severity: input.config.shelteredSeverity, need: input.config.need };
  }
  return undefined;
}

function assertPhysiologyConditionConfig(
  kind: TownConditionKind,
  config: TownPhysiologyConditionConfig,
): void {
  if (!Number.isFinite(config.triggerBelow) || config.triggerBelow < 0) {
    throw new Error(
      `town condition ${kind} triggerBelow must be a non-negative finite number, received ${config.triggerBelow}`,
    );
  }
  if (
    !Number.isFinite(config.severeBelow) ||
    config.severeBelow < 0 ||
    config.severeBelow > config.triggerBelow
  ) {
    throw new Error(
      `town condition ${kind} severeBelow must be a non-negative finite number at most triggerBelow, received ${config.severeBelow}`,
    );
  }
}

function assertWeatherConditionConfig(
  kind: TownConditionKind,
  config: TownWeatherConditionConfig,
): void {
  const entries = Object.entries(config.outdoorSeverityByWeather);
  if (entries.length === 0) {
    throw new Error(`town condition ${kind} must list at least one trigger weather`);
  }
  for (const [weather, severity] of entries) {
    if (!isTownConditionSeverity(severity)) {
      throw new Error(`town condition ${kind} weather ${weather} has an invalid severity`);
    }
  }
  if (
    (config.shelteredSeverity === undefined) !==
    (config.shelteredMaxResidentialTier === undefined)
  ) {
    throw new Error(
      `town condition ${kind} sheltered variant requires both shelteredSeverity and shelteredMaxResidentialTier`,
    );
  }
  if (
    config.shelteredMaxResidentialTier !== undefined &&
    (!Number.isInteger(config.shelteredMaxResidentialTier) || config.shelteredMaxResidentialTier < 1)
  ) {
    throw new Error(
      `town condition ${kind} shelteredMaxResidentialTier must be a positive integer, received ${config.shelteredMaxResidentialTier}`,
    );
  }
}

function isTownConditionSeverity(value: unknown): value is TownConditionSeverity {
  return value === 'mild' || value === 'moderate' || value === 'severe';
}
