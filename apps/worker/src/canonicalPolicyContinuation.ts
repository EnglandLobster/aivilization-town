import { validateEducationSystemPolicy } from '@aivilization/society';
import { isDeepStrictEqual } from 'node:util';
import type { WorldProjection } from '@aivilization/world';
import {
  createAivilizationWorldCommandPolicies,
  createAivilizationWorldPolicyManifest,
} from './aivilizationWorldPolicies';
import {
  AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS,
  createAivilizationTownWeatherPolicy,
  createAivilizationTownServiceQualityPolicy,
} from './experimentalFeatures';

type Configuration = NonNullable<Parameters<typeof createAivilizationWorldPolicyManifest>[0]>;
/** Explicit source recipe. This is not proof of source retirement or permission to activate. */
export type CanonicalPolicyContinuation = {
  readonly version: 'canonical-policy-continuation-v1';
  readonly seed: string;
  readonly configuration: Configuration;
  readonly sourcePolicyManifest: Readonly<Record<string, unknown>>;
};
export function resolveCanonicalPolicyContinuation(
  source: CanonicalPolicyContinuation,
  seed: string,
  world: WorldProjection,
) {
  if (source.version !== 'canonical-policy-continuation-v1' || source.seed !== seed)
    throw new Error('canonical-policy-source-identity-mismatch');
  const configuration = source.configuration;
  const features = new Set<string>(AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS.map((s) => s.key));
  for (const [key, value] of Object.entries(configuration)) {
    if (features.has(key)) {
      if (typeof value !== 'boolean') throw new Error('canonical-policy-switch-invalid');
    } else if (key !== 'educationSystem' && key !== 'agentRegistration') {
      throw new Error(`canonical-policy-configuration-unmapped:${key}`);
    }
  }
  if (configuration.educationSystem) validateEducationSystemPolicy(configuration.educationSystem);
  const expected: unknown = JSON.parse(
    JSON.stringify(createAivilizationWorldPolicyManifest(configuration)),
  );
  if (!isDeepStrictEqual(expected, source.sourcePolicyManifest))
    throw new Error('canonical-policy-source-manifest-mismatch');
  const policies = createAivilizationWorldCommandPolicies(
    seed,
    configuration.agentRegistration,
    configuration,
    configuration.educationSystem ? { educationSystem: configuration.educationSystem } : undefined,
  )(world);
  // The migrated journal is the whole-world authority. These must never run once per compute partition.
  return {
    ...policies,
    ...(configuration.townWeather ? { weather: createAivilizationTownWeatherPolicy() } : {}),
    ...(configuration.townServiceQuality
      ? { serviceQuality: createAivilizationTownServiceQualityPolicy() }
      : {}),
  };
}
