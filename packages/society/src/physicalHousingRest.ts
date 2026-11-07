/** Explicit simulation assumption, independent of rent, identity, permission and reputation. */
export const PHYSICAL_HOUSING_REST_POLICY = {
  version: 'resident-physical-housing-rest-v1',
  outdoorMultiplier: 0.5,
  initialResidenceMultiplier: 1,
  conditionMaximum: 1000,
} as const;
export type PhysicalHousingRestPolicy = typeof PHYSICAL_HOUSING_REST_POLICY;
export type PhysicalRestSource =
  | { readonly kind: 'unsheltered'; readonly locationId: string }
  | { readonly kind: 'initial-world-residence'; readonly locationId: string }
  | {
      readonly kind: 'resident-built-residence';
      readonly locationId: string;
      readonly buildingId: string;
      readonly revision: number;
      readonly condition: number;
    };
export type PhysicalHousingRestEvidence = {
  readonly policyVersion: PhysicalHousingRestPolicy['version'];
  readonly at: number;
  readonly source: PhysicalRestSource;
  readonly multiplier: number;
  readonly energyPerSecond: number;
};
export function assertPhysicalHousingRestPolicy(p: PhysicalHousingRestPolicy) {
  if (
    Object.keys(p).length !== Object.keys(PHYSICAL_HOUSING_REST_POLICY).length ||
    Object.entries(PHYSICAL_HOUSING_REST_POLICY).some(
      ([k, v]) => p[k as keyof PhysicalHousingRestPolicy] !== v,
    )
  )
    throw Error('unsupported-physical-housing-rest-policy');
}
export function physicalHousingRestEffect(input: {
  readonly policy: PhysicalHousingRestPolicy;
  readonly source: PhysicalRestSource;
  readonly at: number;
  readonly baseEnergyPerSecond: number;
}): PhysicalHousingRestEvidence {
  const { policy: p, source, at, baseEnergyPerSecond } = input;
  assertPhysicalHousingRestPolicy(p);
  const id = (s: string) =>
    /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(s) &&
    !['__proto__', 'constructor', 'prototype'].includes(s);
  if (
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !Number.isFinite(baseEnergyPerSecond) ||
    baseEnergyPerSecond < 0 ||
    !id(source.locationId) ||
    !['unsheltered', 'initial-world-residence', 'resident-built-residence'].includes(source.kind) ||
    (source.kind === 'resident-built-residence' &&
      (!id(source.buildingId) ||
        !Number.isSafeInteger(source.revision) ||
        source.revision < 1 ||
        !Number.isSafeInteger(source.condition) ||
        source.condition <= 0 ||
        source.condition > p.conditionMaximum))
  )
    throw Error('invalid-physical-rest-source-or-rate');
  const multiplier =
    source.kind === 'initial-world-residence'
      ? p.initialResidenceMultiplier
      : source.kind === 'resident-built-residence'
        ? p.outdoorMultiplier + ((1 - p.outdoorMultiplier) * source.condition) / p.conditionMaximum
        : p.outdoorMultiplier;
  const energyPerSecond = baseEnergyPerSecond * multiplier;
  if (!Number.isFinite(energyPerSecond)) throw Error('invalid-physical-rest-rate');
  return { policyVersion: p.version, at, source: { ...source }, multiplier, energyPerSecond };
}
