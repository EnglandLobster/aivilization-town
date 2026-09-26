import { emptyMobilityState, MOBILITY_POLICY } from '@aivilization/mobility';
import { RESIDENT_RHYTHM_POLICY, type ResidentRhythmPolicy } from '@aivilization/society';
import { applyResidentRhythm } from './rhythmPolicy';
import { RESIDENT_LIFE_POLICIES } from './lifeState';
import { SERVICES_POLICY, STAFFED_SERVICES_POLICY } from '@aivilization/services';
import { COMMERCE_POLICY, emptyCommerceState } from '@aivilization/commerce';
import { COLLABORATION_POLICY } from '@aivilization/collaboration';
import {
  CITY_APPS_VERSION,
  initializeResidentPopulation,
  RESIDENT_INITIALIZATION_VERSION,
  createAivilizationPopulationScenarioPreset,
  createCommodityMarketPoolSeeds,
} from '@aivilization/content';
import { DEFAULT_OPEN_AGENT_POLICY, type OpenAgentPolicy } from '@aivilization/agent-runtime';
import {
  COMMUNICATION_POLICY,
  DEFAULT_INFORMATION_POLICY,
  DOCUMENT_METADATA_POLICY,
  DEFAULT_DISTRIBUTION_POLICY,
} from '@aivilization/information';
import { COGNITION_POLICY_VERSION, CONTINUOUS_COGNITION_VERSION } from '@aivilization/memory';
import { asLocationId } from '@aivilization/sim-core';
import type { WorldProjection } from '@aivilization/world';
import { createAivilizationWorldCommandPolicies } from '../aivilizationWorldPolicies';
import { createWorldProjectionFromScenario } from '../scenarioProjection';
import { OPEN_SOCIETY_SCHEMA_VERSION, type OpenSocietyManifest } from './types';
import { OPEN_CAPABILITY_CATALOG_VERSION } from './catalog';

export function openWorldPolicies(
  seed: string,
  world: WorldProjection,
  rhythm?: ResidentRhythmPolicy,
) {
  return applyResidentRhythm(
    createAivilizationWorldCommandPolicies(
      seed,
      undefined,
      world.residentCommerce
        ? { socialMatters: true, townCollectiveAction: true, townBulletin: true }
        : undefined,
    )(world),
    rhythm,
  );
}
export function serializableWorldPolicy(
  seed: string,
  world: WorldProjection,
  rhythm?: ResidentRhythmPolicy,
): Readonly<Record<string, unknown>> {
  // Callback implementations are pinned by worldPolicyAdapter below; data parameters are recorded in full.
  return JSON.parse(JSON.stringify(openWorldPolicies(seed, world, rhythm))) as Record<
    string,
    unknown
  >;
}
export function createOpenSocietyManifest(input: {
  simulationId?: string;
  count?: number;
  seed?: string;
  policy?: OpenAgentPolicy;
  cityApps?: boolean;
  distribution?: boolean;
  life?: boolean;
  continuity?: boolean;
  mobility?: boolean;
  initialization?: 'settled' | 'newcomers';
}): OpenSocietyManifest {
  const count = input.count ?? 3;
  if (!Number.isSafeInteger(count) || count < 1 || count > 50)
    throw new Error('open-experiment-count-must-be-1-to-50');
  const seed = input.seed ?? 'open-residents-v1';
  const continuity = input.continuity === true;
  const initialization = input.initialization ?? (continuity ? 'settled' : 'newcomers');
  const rhythm = continuity ? RESIDENT_RHYTHM_POLICY : undefined;
  const servicesPolicy = continuity ? STAFFED_SERVICES_POLICY : SERVICES_POLICY;
  const cognitionVersion = continuity ? CONTINUOUS_COGNITION_VERSION : COGNITION_POLICY_VERSION;
  const rawPreset = createAivilizationPopulationScenarioPreset({
    id: 'open-residents-v1',
    name: 'Open residents',
    description: 'Open agent experiment; initial backgrounds are not lived events.',
    agentCount: count,
    idPrefix: 'resident',
    displayNamePrefix: '市民',
    ...(initialization === 'newcomers'
      ? { initialLocationIds: Array.from({ length: count }, () => asLocationId('town-square')) }
      : {}),
  });
  const initialized = continuity
    ? initializeResidentPopulation(rawPreset, seed, initialization, rhythm!.physiologyMaximum)
    : undefined;
  const preset = initialized?.preset ?? rawPreset;
  const treasury = 50_000;
  const bankReserves = 200_000;
  const baseWorld = createWorldProjectionFromScenario({
    preset,
    treasury,
    bankReserves,
    marketPools: createCommodityMarketPoolSeeds({ commodityReserve: 100, currencyReserve: 1000 }),
    moneySupply:
      treasury + bankReserves + preset.agentSeeds.reduce((sum, agent) => sum + agent.balance, 0),
  });
  const world =
    input.life === false
      ? baseWorld
      : {
          ...baseWorld,
          residentCommerce: emptyCommerceState(COMMERCE_POLICY),
          ...(continuity && input.mobility !== false
            ? {
                residentMobility: emptyMobilityState([
                  {
                    id: 'seed-car-1',
                    ownerId: preset.agentSeeds[0]!.agentId,
                    authorized: [],
                    seats: 2,
                    locationId: baseWorld.agents[preset.agentSeeds[0]!.agentId]!.locationId!,
                    revision: 1,
                  },
                ]),
              }
            : {}),
        };
  const backgrounds = [
    '初始化背景：你对新地方和生活方式感兴趣，也重视自己作决定。你尚未决定今天做什么；这不是要求你必须探索或旅游。',
    '初始化背景：你喜欢倾听与记录，对人的不同看法感到好奇。你可以改变兴趣，也可以独处，不必承担固定任务。',
    '初始化背景：你愿意尝试动手做事情，珍惜已有的生活经验。你可以重新考虑自己的目标，没有预设的赚钱指标。',
  ];
  return {
    schemaVersion: OPEN_SOCIETY_SCHEMA_VERSION,
    simulationId: input.simulationId ?? 'open-town',
    seed,
    policy:
      input.policy ??
      (rhythm
        ? {
            ...DEFAULT_OPEN_AGENT_POLICY,
            freeActivityIntervalMs: rhythm.freeActivityIntervalMs,
            opportunityCadenceMs: rhythm.opportunityCadenceMs,
          }
        : DEFAULT_OPEN_AGENT_POLICY),
    ...(rhythm ? { rhythm, initialization } : {}),
    informationPolicy: DEFAULT_INFORMATION_POLICY,
    ...(input.distribution === false ? {} : { distributionPolicy: DEFAULT_DISTRIBUTION_POLICY }),
    ...(input.life === false
      ? {}
      : {
          communicationPolicy: COMMUNICATION_POLICY,
          collaborationPolicy: COLLABORATION_POLICY,
          servicesPolicy,
        }),
    ...(input.life === false
      ? {}
      : { lifeVersion: 'resident-life-v1' as const, lifePolicies: RESIDENT_LIFE_POLICIES }),
    cognitionVersion,
    worldPolicies: serializableWorldPolicy(seed, world, rhythm),
    initialWorld: world,
    residents: preset.agentSeeds.map((agent, index) => ({
      id: agent.agentId,
      displayName: agent.displayName,
      background:
        initialized?.backgrounds[agent.agentId] ?? backgrounds[index % backgrounds.length]!,
      ...(initialized ? { acquaintances: initialized.acquaintances[agent.agentId] ?? [] } : {}),
    })),
    provenance: {
      mode: 'experimental-open-agent',
      ...(world.residentMobility
        ? { mobility: MOBILITY_POLICY.version, vehicleSeed: 'explicit-one-owned-car-v1' }
        : {}),
      worldPolicyAdapter: rhythm ? 'resident-natural-day-adapter-v1' : 'canonical-world-adapter-v1',
      ...(input.life !== false && servicesPolicy.version === 'resident-services-v3'
        ? { serviceSupply: 'service-supply-v1' }
        : {}),
      ...(rhythm
        ? {
            rhythm: rhythm.version,
            initialization: RESIDENT_INITIALIZATION_VERSION,
            laborPay: 'labor-proportional-pay-v1',
          }
        : {}),
      attention: 'resident-attention-v2',
      reading: 'resident-original-reading-v2',
      settlement: 'order-settlement-v1',
      context: 'open-agent-context-v1',
      capabilityCatalog: OPEN_CAPABILITY_CATALOG_VERSION,
      cognition: cognitionVersion,
      information: DEFAULT_INFORMATION_POLICY.version,
      ...(input.life === false
        ? {}
        : {
            communication: COMMUNICATION_POLICY.version,
            collaboration: COLLABORATION_POLICY.version,
            commerce: COMMERCE_POLICY.version,
            services: servicesPolicy.version,
            life: 'resident-life-v1',
            leases: 'resident-leases-v1',
          }),
      scheduler: 'open-simulation-round-robin-v1',
      initialBackground: initialized
        ? RESIDENT_INITIALIZATION_VERSION
        : 'explicit-template-v1-not-lived-memory',
      transport: 'resident-cli-v4',
      residentSkill: 'town-resident-skill-v5',
      ...(input.cityApps === false ? {} : { cityApps: CITY_APPS_VERSION }),
      ...(input.distribution === false
        ? {}
        : { distribution: DEFAULT_DISTRIBUTION_POLICY.version }),
      documentIndex: 'document-index-v1',
      documentMetadata: DOCUMENT_METADATA_POLICY.version,
    },
  };
}
