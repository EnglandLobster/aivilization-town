import {
  aivilizationSocialMattersPolicyDefaults,
  aivilizationTownBulletinPolicyDefaults,
  aivilizationTownConditionsPolicyDefaults,
  aivilizationTownConflictPolicyDefaults,
  aivilizationTownWeatherPolicyDefaults,
} from '@aivilization/content';
import { assertTownConditionsPolicy, type TownConditionsPolicy } from '@aivilization/society';
import {
  assertTownWeatherPolicy,
  type SocialMattersPolicy,
  type TownBulletinPolicy,
  type TownConflictPolicy,
  type TownWeatherPolicy,
  type WorldCommandPolicies,
} from '@aivilization/world';

export type AivilizationExperimentalFeatureKey =
  | 'townWeather'
  | 'townConditions'
  | 'townBulletin'
  | 'socialMatters'
  | 'townConflict';

/**
 * One registration row per opt-in experimental feature. CLI flag/env parsing,
 * the resolved-run-manifest policy declaration, the provenance registry, and
 * the command-policies factory are all driven from this table — adding a
 * feature means adding one row here (plus its policy defaults in content, its
 * settlement wiring, and a runtime.env.example comment).
 */
export type AivilizationExperimentalFeatureSpec = {
  /** camelCase key shared by the CLI option, manifest input, and switches. */
  readonly key: AivilizationExperimentalFeatureKey;
  readonly policyVersion: string;
  readonly cliFlag: string;
  readonly envVar: string;
  /** One-line help label for the flag row. */
  readonly helpTitle: string;
  /** Help paragraph lines, verbatim. */
  readonly helpLines: readonly string[];
  /** Provenance registry source blurb. */
  readonly registrySource: string;
  /** Deep-copied manifest parameters chunk for this feature. */
  readonly createManifestParameters: () => Record<string, unknown>;
  /**
   * Adds the feature's policy to the world command policies. Undefined for
   * authority-scoped features (town weather settles only on the
   * simulation-wide authority so partition-local advances never run divergent
   * weather chains) — those are injected by the authority instead.
   */
  readonly withCommandPolicy?: (policies: WorldCommandPolicies) => WorldCommandPolicies;
};

export function createAivilizationTownWeatherPolicy(): TownWeatherPolicy {
  const policy: TownWeatherPolicy = {
    policyVersion: aivilizationTownWeatherPolicyDefaults.policyVersion,
    initialWeather: aivilizationTownWeatherPolicyDefaults.initialWeather,
    transitionCadenceMs: aivilizationTownWeatherPolicyDefaults.transitionCadenceMs,
    transitions: aivilizationTownWeatherPolicyDefaults.transitions,
  };
  assertTownWeatherPolicy(policy);
  return policy;
}

export function createAivilizationTownConditionsPolicy(): TownConditionsPolicy {
  const policy: TownConditionsPolicy = {
    policyVersion: aivilizationTownConditionsPolicyDefaults.policyVersion,
    soaked: {
      outdoorSeverityByWeather: {
        ...aivilizationTownConditionsPolicyDefaults.soaked.outdoorSeverityByWeather,
      },
      need: aivilizationTownConditionsPolicyDefaults.soaked.need,
    },
    cold: {
      outdoorSeverityByWeather: {
        ...aivilizationTownConditionsPolicyDefaults.cold.outdoorSeverityByWeather,
      },
      shelteredSeverity: aivilizationTownConditionsPolicyDefaults.cold.shelteredSeverity,
      shelteredMaxResidentialTier:
        aivilizationTownConditionsPolicyDefaults.cold.shelteredMaxResidentialTier,
      need: aivilizationTownConditionsPolicyDefaults.cold.need,
    },
    overtired: { ...aivilizationTownConditionsPolicyDefaults.overtired },
    hungry: { ...aivilizationTownConditionsPolicyDefaults.hungry },
    stressed: { ...aivilizationTownConditionsPolicyDefaults.stressed },
  };
  assertTownConditionsPolicy(policy);
  return policy;
}

export function createAivilizationTownBulletinPolicy(): TownBulletinPolicy {
  return {
    policyVersion: aivilizationTownBulletinPolicyDefaults.policyVersion,
    highPriorityIntentionPriority:
      aivilizationTownBulletinPolicyDefaults.highPriorityIntentionPriority,
    highPriorityReactionWindowMs:
      aivilizationTownBulletinPolicyDefaults.highPriorityReactionWindowMs,
  };
}

export function createAivilizationSocialMattersPolicy(): SocialMattersPolicy {
  return {
    policyVersion: aivilizationSocialMattersPolicyDefaults.policyVersion,
    defaultExpiryMs: aivilizationSocialMattersPolicyDefaults.defaultExpiryMs,
  };
}

export function createAivilizationTownConflictPolicy(): TownConflictPolicy {
  return {
    policyVersion: aivilizationTownConflictPolicyDefaults.policyVersion,
    grievanceRelationThreshold: aivilizationTownConflictPolicyDefaults.grievanceRelationThreshold,
    baseDamage: aivilizationTownConflictPolicyDefaults.baseDamage,
    attackerEnergyDamageFactor: aivilizationTownConflictPolicyDefaults.attackerEnergyDamageFactor,
    targetEnergyDefenseFactor: aivilizationTownConflictPolicyDefaults.targetEnergyDefenseFactor,
    minDamage: aivilizationTownConflictPolicyDefaults.minDamage,
    maxDamage: aivilizationTownConflictPolicyDefaults.maxDamage,
    attackerEnergyCost: aivilizationTownConflictPolicyDefaults.attackerEnergyCost,
    minHealthAfterAttack: aivilizationTownConflictPolicyDefaults.minHealthAfterAttack,
    witnessAttitudePenaltyScale:
      aivilizationTownConflictPolicyDefaults.witnessAttitudePenaltyScale,
  };
}

export const AIVILIZATION_EXPERIMENTAL_FEATURE_SPECS: readonly AivilizationExperimentalFeatureSpec[] =
  [
    {
      key: 'townWeather',
      policyVersion: aivilizationTownWeatherPolicyDefaults.policyVersion,
      cliFlag: '--town-weather',
      envVar: 'AIVILIZATION_TOWN_WEATHER',
      helpTitle: 'Authoritative town weather Markov chain',
      helpLines: [
        'Town weather is a repository-specific extension (not a paper mechanism): pass',
        '--town-weather on or AIVILIZATION_TOWN_WEATHER=1 to let the simulation-wide authority',
        'settle the town-weather-v1 Markov chain during time advancement. Disabled by default.',
      ],
      registrySource:
        'Authoritative town weather is not a paper mechanism; states, matrix, and cadence are repository-defined.',
      createManifestParameters: () => ({
        ...aivilizationTownWeatherPolicyDefaults,
        transitions: Object.fromEntries(
          Object.entries(aivilizationTownWeatherPolicyDefaults.transitions).map(([from, row]) => [
            from,
            { ...row },
          ]),
        ),
      }),
      // Authority-scoped (no withCommandPolicy): injected by the
      // simulation-wide authority, never by the shared policies factory
      // (per-partition weather chains would diverge).
    },
    {
      key: 'townConditions',
      policyVersion: aivilizationTownConditionsPolicyDefaults.policyVersion,
      cliFlag: '--town-conditions',
      envVar: 'AIVILIZATION_TOWN_CONDITIONS',
      helpTitle: 'Derived agent condition catalog',
      helpLines: [
        'Town conditions are a repository-specific extension (not a paper mechanism): pass',
        '--town-conditions on or AIVILIZATION_TOWN_CONDITIONS=1 to derive the town-conditions-v1',
        'catalog into planning contexts and the society projection. Disabled by default.',
      ],
      registrySource:
        'The town condition catalog is not a paper mechanism; conditions, thresholds, and implied needs are repository-defined.',
      createManifestParameters: () => ({
        ...aivilizationTownConditionsPolicyDefaults,
        soaked: {
          ...aivilizationTownConditionsPolicyDefaults.soaked,
          outdoorSeverityByWeather: {
            ...aivilizationTownConditionsPolicyDefaults.soaked.outdoorSeverityByWeather,
          },
        },
        cold: {
          ...aivilizationTownConditionsPolicyDefaults.cold,
          outdoorSeverityByWeather: {
            ...aivilizationTownConditionsPolicyDefaults.cold.outdoorSeverityByWeather,
          },
        },
        overtired: { ...aivilizationTownConditionsPolicyDefaults.overtired },
        hungry: { ...aivilizationTownConditionsPolicyDefaults.hungry },
        stressed: { ...aivilizationTownConditionsPolicyDefaults.stressed },
      }),
      withCommandPolicy: (policies) => ({
        ...policies,
        conditions: createAivilizationTownConditionsPolicy(),
      }),
    },
    {
      key: 'townBulletin',
      policyVersion: aivilizationTownBulletinPolicyDefaults.policyVersion,
      cliFlag: '--town-bulletin',
      envVar: 'AIVILIZATION_TOWN_BULLETIN',
      helpTitle: 'Authoritative town bulletin board',
      helpLines: [
        'The town bulletin board is a repository-specific extension (not a paper mechanism): pass',
        '--town-bulletin on or AIVILIZATION_TOWN_BULLETIN=1 to let agents post and operators issue',
        'town bulletins against the authoritative board. Disabled by default.',
      ],
      registrySource:
        'The town bulletin board is not a paper mechanism; priority and preemption parameters are repository-defined.',
      createManifestParameters: () => ({ ...aivilizationTownBulletinPolicyDefaults }),
      withCommandPolicy: (policies) => ({
        ...policies,
        bulletin: createAivilizationTownBulletinPolicy(),
      }),
    },
    {
      key: 'socialMatters',
      policyVersion: aivilizationSocialMattersPolicyDefaults.policyVersion,
      cliFlag: '--social-matters',
      envVar: 'AIVILIZATION_SOCIAL_MATTERS',
      helpTitle: 'Social matters state machine',
      helpLines: [
        'Social matters are a repository-specific extension (not a paper mechanism): pass',
        '--social-matters on or AIVILIZATION_SOCIAL_MATTERS=1 to escalate commitments into the',
        'town-matter state machine with world-verified fulfillment. Disabled by default.',
      ],
      registrySource:
        'The social matters state machine is not a paper mechanism; lifecycle and expiry parameters are repository-defined.',
      createManifestParameters: () => ({ ...aivilizationSocialMattersPolicyDefaults }),
      withCommandPolicy: (policies) => ({
        ...policies,
        socialMatters: createAivilizationSocialMattersPolicy(),
      }),
    },
    {
      key: 'townConflict',
      policyVersion: aivilizationTownConflictPolicyDefaults.policyVersion,
      cliFlag: '--town-conflict',
      envVar: 'AIVILIZATION_TOWN_CONFLICT',
      helpTitle: 'Conflict system (confront/attack/intervene)',
      helpLines: [
        'The conflict system is a repository-specific extension (not a paper mechanism): pass',
        '--town-conflict on or AIVILIZATION_TOWN_CONFLICT=1 to enable confront/attack/intervene',
        'with world-issued grievances and deterministic damage. Disabled by default.',
      ],
      registrySource:
        'The conflict system is not a paper mechanism; grievance and damage parameters are repository-defined.',
      createManifestParameters: () => ({ ...aivilizationTownConflictPolicyDefaults }),
      withCommandPolicy: (policies) => ({
        ...policies,
        conflict: createAivilizationTownConflictPolicy(),
      }),
    },
  ];
