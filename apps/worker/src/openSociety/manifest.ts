import {
  resolveCanonicalPolicyContinuation,
  type CanonicalPolicyContinuation,
} from '../canonicalPolicyContinuation';
import { enableResidentConstructionTradeEvent } from '@aivilization/world';
import { enableResourceSalesEvent, extendResourceSalesEvent } from '@aivilization/world';
import { enablePeriodicObligationsEvent } from '@aivilization/world';
import { enablePhysicalHousingRestEvent } from '@aivilization/world';
import { PHYSICAL_HOUSING_REST_POLICY } from '@aivilization/society';
import { SERVICE_SUPPLY_RELATION_POLICY } from '@aivilization/services';
import { SERVICE_AFFILIATION_POLICY } from '@aivilization/services';
import {
  enableServicePrincipalsEvent,
  enableServiceSupplyEvent,
  applyWorldEventWithPrincipalAuthority,
} from '@aivilization/world';
import {
  emptyServicesState,
  SERVICE_PRINCIPALS_POLICY,
  SERVICE_SUPPLY_POLICY,
  applyServicesEvent,
} from '@aivilization/services';
import { enableVehiclePrincipalsEvent } from '@aivilization/world';
import { enablePrincipalEvidenceTradeEvent } from '@aivilization/world';
import { enablePrincipalPremisesRightsEvent } from '@aivilization/world';
import { enablePremisesPrincipalsEvent } from '@aivilization/world';
import { enableResourcePrincipalsEvent } from '@aivilization/world';
import { enableHousingOccupancyEvent } from '@aivilization/world';
import { publicHousingWorldPolicies, enablePublicHousingEvent } from '@aivilization/world';
import { enableHousingChoiceEvent } from '@aivilization/world';
import { enableResidentCapitalEvent } from '@aivilization/world';
import { enablePublicEmploymentEvent, publicEmploymentWorldPolicies } from '@aivilization/world';
import { ENTERPRISE_CONTROL_VERSION } from '@aivilization/enterprise';
import { enablePublicLaborEvent } from '@aivilization/world';
import {
  enableResidentExtractionEvent,
  enableResidentMaterialGrowthEvent,
  enableResidentStudyEvent,
  enableResidentLaborEvent,
  enableProductiveEmploymentEvent,
  enableEducationAuthorityEvent,
  enableServiceTimeEvent,
  enableServiceEmploymentEvent,
  assertEducationAuthorityState,
} from '@aivilization/world';
import { seedOpenMaterialSources, EXTRACTION_SEED_VERSION } from './extractionPolicy';
import {
  emptyEvidenceTradeState,
  EVIDENCE_TRADE_POLICY,
  EVIDENCE_TRADE_POLICY_V2,
} from '@aivilization/commerce';
import {
  applyPremisesRightsEvent,
  PREMISES_RIGHTS_POLICY,
  PREMISES_PROVISION_POLICY,
} from '@aivilization/premises';
import { LOGISTICS_POLICY } from '@aivilization/logistics';
import { seedOpenLogistics, LOGISTICS_VEHICLE_SEED_VERSION } from './logisticsPolicy';

import { seedOpenServiceEngagements, SERVICE_FACILITY_SEED_VERSION } from './engagementPolicy';
import { SERVICE_ENGAGEMENTS_POLICY } from '@aivilization/services';
import {
  RESIDENT_SERVICE_EFFECTS_POLICY,
  emptyResidentRestState,
  RESIDENT_REST_POLICY,
} from '@aivilization/society';
import {
  assertResidentRestTimeCompatibility,
  enableResidentPublicProcurementEvent,
  enableResidentPublicGoodsProcurementEvent,
  applyWorldEvent,
} from '@aivilization/world';
import { seedOpenPremises, CONSTRUCTION_SITE_SEED_VERSION } from './premisesPolicy';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  PREMISES_FACILITY_USE_POLICY,
} from '@aivilization/premises';
import {
  emptyMaterialsState,
  MATERIAL_EXPERTISE_POLICY,
  MATERIAL_REGROWTH_POLICY,
} from '@aivilization/materials';
import { MATERIALS_POLICY } from './materialPolicy';
import { RESIDENT_CLI_VERSION, RESIDENT_SKILL_VERSION } from './capabilityRoutes';
import { SOCIETY_RULEBOOK_VERSION } from './ruleDefinitions';
import { RESOURCE_CONTROL_POLICY } from '@aivilization/authority';
import {
  PROGRAM_REACTIONS_POLICY,
  PROGRAM_CONDITIONS_POLICY,
  PROGRAM_ACTIONS_POLICY,
  ENTERPRISE_PROGRAM_ACTIONS_POLICY,
} from '@aivilization/collaboration';
import {
  COMMON_ACCOUNTS_POLICY,
  emptyCommonAccountsState,
  INVENTORY_REQUEST_PRECISION,
} from '@aivilization/economy';
import { COLLECTIVES_POLICY } from '@aivilization/collaboration';
import { emptyMobilityState, MOBILITY_POLICY } from '@aivilization/mobility';
import { RESIDENT_RHYTHM_POLICY, type ResidentRhythmPolicy } from '@aivilization/society';
import { applyResidentRhythm } from './rhythmPolicy';
import { RESIDENT_LIFE_POLICIES } from './lifeState';
import {
  SERVICES_POLICY,
  STAFFED_SERVICES_POLICY,
  SERVICE_CONTROL_POLICY,
} from '@aivilization/services';
import { COMMERCE_POLICY, emptyCommerceState } from '@aivilization/commerce';
import { COLLABORATION_POLICY } from '@aivilization/collaboration';
import { SOCIETY_KERNEL_POLICY } from './kernelPolicy';
import { RECORD_VIEWS_POLICY } from '@aivilization/information';
import {
  CITY_APPS_VERSION,
  initializeResidentPopulation,
  RESIDENT_INITIALIZATION_VERSION,
  createAivilizationPopulationScenarioPreset,
  createCommodityMarketPoolSeeds,
  productionRecipes,
} from '@aivilization/content';
import {
  DEFAULT_OPEN_AGENT_POLICY,
  RESIDENT_ACTION_PLANS_POLICY,
  RESIDENT_ACTION_PLANS_POLICY_V2,
  RESIDENT_MESSAGE_PACING_POLICY,
  type OpenAgentPolicy,
} from '@aivilization/agent-runtime';
import {
  GROUP_CONTROL_POLICY,
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

export const OPEN_SOCIETY_ECONOMY_SHAPE_VERSION = 'open-society-economy-shape-v1';
/**
 * Explicit economy shape for experiments about interdependence. `raw-materials-only` keeps the
 * outside market for extractable raw goods but leaves every processed good to residents.
 */
export type OpenSocietyEconomyShape = {
  readonly treasury: number;
  readonly outsideMarket: 'all-commodities' | 'raw-materials-only';
};
/** Goods some recipe makes from other goods; derived from content, not a hand-kept list. */
export const PROCESSED_COMMODITIES: ReadonlySet<string> = new Set(
  productionRecipes.filter((r) => Object.keys(r.inputs).length > 0).map((r) => r.output),
);

export function openWorldPolicies(
  seed: string,
  world: WorldProjection,
  rhythm?: ResidentRhythmPolicy,
  canonicalSource?: CanonicalPolicyContinuation,
) {
  assertEducationAuthorityState(world);
  if (canonicalSource && rhythm) throw new Error('canonical-policy-rhythm-transition-required');
  const policies = canonicalSource
    ? resolveCanonicalPolicyContinuation(canonicalSource, seed, world)
    : applyResidentRhythm(
        createAivilizationWorldCommandPolicies(
          seed,
          undefined,
          world.residentCommerce
            ? { socialMatters: true, townCollectiveAction: true, townBulletin: true }
            : undefined,
        )(world),
        rhythm,
      );
  return publicHousingWorldPolicies(
    world,
    publicEmploymentWorldPolicies(
      world,
      world.educationAuthority
        ? { ...policies, educationSystem: world.educationAuthority.institution }
        : policies,
    ),
  );
}
export function serializableWorldPolicy(
  seed: string,
  world: WorldProjection,
  rhythm?: ResidentRhythmPolicy,
  canonicalSource?: CanonicalPolicyContinuation,
): Readonly<Record<string, unknown>> {
  // Callback implementations are pinned by worldPolicyAdapter below; data parameters are recorded in full.
  return JSON.parse(
    JSON.stringify(openWorldPolicies(seed, world, rhythm, canonicalSource)),
  ) as Record<string, unknown>;
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
  societyKernel?: boolean;
  recordViews?: boolean;
  collectives?: boolean;
  commonAccounts?: boolean;
  programConditions?: boolean;
  programReactions?: boolean;
  programActions?: boolean;
  enterprisePrograms?: boolean;
  serviceControl?: boolean;
  elapsedRest?: boolean;
  elapsedStudy?: boolean;
  elapsedLabor?: boolean;
  productiveEmployment?: boolean;
  educationAuthority?: boolean;
  serviceTime?: boolean;
  publicLabor?: boolean;
  serviceEmployment?: boolean;
  physicalProduction?: boolean;
  publicGovernance?: boolean;
  publicEmployment?: boolean;
  capitalAgreements?: boolean;
  housingChoice?: boolean;
  housingOccupancy?: boolean;
  physicalHousingRest?: boolean;
  resourcePrincipals?: boolean;
  premisesPrincipals?: boolean;
  servicePrincipals?: boolean;
  serviceSupply?: boolean;
  serviceAffiliations?: boolean;
  serviceSupplyRelations?: boolean;
  vehiclePrincipals?: boolean;
  principalPermits?: boolean;
  resourceSales?: boolean;
  resourceSalesV2?: boolean;
  periodicObligations?: boolean;
  principalTrade?: boolean;
  constructionTrade?: boolean;
  publicHousing?: boolean;
  publicProcurement?: boolean;
  publicGoodsProcurement?: boolean;
  resourceControl?: boolean;
  groupControl?: boolean;
  materials?: boolean;
  premises?: boolean;
  facilityUse?: boolean;
  serviceEngagements?: boolean;
  logistics?: boolean;
  evidenceTrade?: boolean;
  premisesRights?: boolean;
  paidPermits?: boolean;
  /** Learning by doing plus natural source regrowth (versioned material growth policies). */
  materialGrowth?: boolean;
  /** Paced direct-message wakes (resident-message-pacing-v1); absent keeps immediate wakes. */
  messagePacing?: boolean;
  /**
   * Residents may queue their own action sequences. `true` is resident-action-plans-v1 (kept for
   * released profiles); later versions are named explicitly.
   */
  actionPlans?: boolean | 'resident-action-plans-v2';
  /** Economy shape for interdependence experiments; omitted keeps the historical defaults. */
  economy?: OpenSocietyEconomyShape;
  initialization?: 'settled' | 'newcomers';
}): OpenSocietyManifest {
  if (
    input.enterprisePrograms &&
    (input.societyKernel === false ||
      input.resourceControl === false ||
      input.programActions === false)
  )
    throw Error('enterprise-programs-require-resource-control-and-program-actions');
  const count = input.count ?? 3;
  if (!Number.isSafeInteger(count) || count < 1 || count > 50)
    throw new Error('open-experiment-count-must-be-1-to-50');
  const seed = input.seed ?? 'open-residents-v1';
  const continuity = input.continuity === true;
  const initialization = input.initialization ?? (continuity ? 'settled' : 'newcomers');
  const rhythm = continuity ? RESIDENT_RHYTHM_POLICY : undefined;
  const servicesPolicy = continuity ? STAFFED_SERVICES_POLICY : SERVICES_POLICY;
  if (input.periodicObligations && !input.publicGovernance)
    throw Error('periodic-obligations-require-explicit-public-governance');
  if (input.serviceSupplyRelations && !input.serviceAffiliations)
    throw Error('service-supply-relations-require-service-affiliations');
  if (input.serviceAffiliations && !input.serviceSupply)
    throw Error('service-affiliations-require-service-supply');
  if (
    input.serviceSupply &&
    (!input.servicePrincipals ||
      !continuity ||
      input.life === false ||
      input.publicGovernance === false)
  )
    throw Error('service-supply-requires-principal-directory-and-recorded-providers');
  if (
    input.serviceControl &&
    (!continuity ||
      input.life === false ||
      input.resourceControl === false ||
      input.societyKernel === false)
  )
    throw Error('service-control-requires-recorded-providers-and-resource-control');
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
  const treasury = input.economy?.treasury ?? 50_000;
  const bankReserves = 200_000;
  const pools = createCommodityMarketPoolSeeds({ commodityReserve: 100, currencyReserve: 1000 });
  const baseWorld = createWorldProjectionFromScenario({
    preset,
    treasury,
    bankReserves,
    marketPools:
      input.economy?.outsideMarket === 'raw-materials-only'
        ? pools.filter((pool) => !PROCESSED_COMMODITIES.has(pool.commodity))
        : pools,
    moneySupply:
      treasury + bankReserves + preset.agentSeeds.reduce((sum, agent) => sum + agent.balance, 0),
  });
  const lifeWorld =
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
  const groupControlEnabled =
    input.societyKernel !== false &&
    input.resourceControl !== false &&
    input.life !== false &&
    input.groupControl !== false;
  const commonAccountsEnabled =
    input.societyKernel !== false && input.collectives !== false && input.commonAccounts !== false;
  const materialsEnabled = input.societyKernel !== false && input.materials !== false;
  const premisesEnabled = materialsEnabled && input.premises !== false;
  const materialsWorld = {
    ...(materialsEnabled ? { materials: emptyMaterialsState(MATERIALS_POLICY) } : {}),
    ...lifeWorld,
    ...(commonAccountsEnabled
      ? { commonAccounts: emptyCommonAccountsState(COMMON_ACCOUNTS_POLICY) }
      : {}),
  };
  const premisesWorld = {
    ...materialsWorld,
    ...(premisesEnabled ? seedOpenPremises(materialsWorld, input.facilityUse !== false) : {}),
  };
  const serviceEngagementsEnabled = premisesEnabled && input.serviceEngagements !== false;
  const serviceWorld = {
    ...premisesWorld,
    ...(serviceEngagementsEnabled ? seedOpenServiceEngagements(premisesWorld) : {}),
  };
  const logisticsEnabled =
    premisesEnabled && input.facilityUse !== false && input.logistics !== false;
  const evidenceTradeEnabled =
    logisticsEnabled && serviceEngagementsEnabled && input.evidenceTrade !== false;
  const premisesRightsEnabled = premisesEnabled && input.premisesRights !== false;
  const paidPermitsEnabled =
    evidenceTradeEnabled && premisesRightsEnabled && input.paidPermits !== false;
  const tradePolicy = paidPermitsEnabled ? EVIDENCE_TRADE_POLICY_V2 : EVIDENCE_TRADE_POLICY;
  let world: WorldProjection = {
    ...serviceWorld,
    ...(input.publicGovernance ? { publicGovernance: seedPublicGovernance(serviceWorld) } : {}),
    ...(input.elapsedRest ? { residentRest: emptyResidentRestState() } : {}),
    ...(logisticsEnabled ? seedOpenLogistics(serviceWorld) : {}),
    ...(evidenceTradeEnabled ? { residentTrade: emptyEvidenceTradeState(tradePolicy) } : {}),
    ...(premisesRightsEnabled
      ? {
          premisesRights: applyPremisesRightsEvent(undefined, {
            type: 'PremisesRightsEnabled',
            policy: PREMISES_RIGHTS_POLICY,
          }),
        }
      : {}),
  };
  if (input.physicalProduction)
    world = applyWorldEvent(
      world,
      enableResidentExtractionEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        sources: seedOpenMaterialSources(world),
        requestId: 'seed-physical-production-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.materialGrowth) {
    if (!input.physicalProduction) throw Error('material-growth-requires-physical-production');
    world = applyWorldEvent(
      world,
      enableResidentMaterialGrowthEvent({
        simulationId: 'manifest-seed',
        requestId: 'seed-material-growth-v1',
        nextSequence: 1,
        at: world.clock.now,
        expertise: true,
        regrowth: true,
      }),
    );
  }
  if (input.serviceTime)
    world = applyWorldEvent(
      world,
      enableServiceTimeEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        simulationId: 'manifest-seed',
        requestId: 'seed-service-time-v1',
        nextSequence: 1,
      }),
    );
  if (input.elapsedStudy)
    world = applyWorldEvent(
      world,
      enableResidentStudyEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        requestId: 'seed-elapsed-study-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.educationAuthority)
    world = applyWorldEvent(
      world,
      enableEducationAuthorityEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        mode: 'scenario',
        requestId: 'seed-education-authority-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.elapsedLabor)
    world = applyWorldEvent(
      world,
      enableResidentLaborEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        requestId: 'seed-elapsed-labor-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.servicePrincipals)
    world = applyWorldEventWithPrincipalAuthority(
      world,
      enableServicePrincipalsEvent({
        projection: world,
        directory: emptyServicesState(servicesPolicy),
        requestId: 'seed-service-principals-v2',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
      undefined,
      emptyServicesState(servicesPolicy),
    );
  if (input.serviceSupply) {
    const directory = applyServicesEvent(emptyServicesState(servicesPolicy), {
      type: 'ServicePrincipalsEnabled',
      policy: SERVICE_PRINCIPALS_POLICY,
    });
    world = applyWorldEventWithPrincipalAuthority(
      world,
      enableServiceSupplyEvent({
        projection: world,
        directory,
        requestId: 'seed-service-supply-v3',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
      undefined,
      directory,
    );
  }
  if (input.vehiclePrincipals)
    world = applyWorldEvent(
      world,
      enableVehiclePrincipalsEvent({
        projection: world,
        requestId: 'seed-vehicle-principals-v2',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.resourcePrincipals)
    world = applyWorldEvent(
      world,
      enableResourcePrincipalsEvent({
        projection: world,
        requestId: 'seed-resource-principals-v2',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.premisesPrincipals)
    world = applyWorldEvent(
      world,
      enablePremisesPrincipalsEvent({
        projection: world,
        requestId: 'seed-premises-principals-v2',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.principalPermits)
    world = applyWorldEvent(
      world,
      enablePrincipalPremisesRightsEvent({
        projection: world,
        requestId: 'seed-principal-permits-v2',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.periodicObligations) {
    const d = enablePeriodicObligationsEvent({
      projection: world,
      requestId: 'seed-periodic-obligations-v1',
      simulationId: 'manifest-seed',
      nextSequence: 1,
    });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) world = applyWorldEvent(world, e);
  }
  if (input.resourceSales || input.resourceSalesV2) {
    const d = enableResourceSalesEvent({
      projection: world,
      requestId: 'seed-resource-sales-v1',
      simulationId: 'manifest-seed',
      nextSequence: 1,
    });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) world = applyWorldEvent(world, e);
  }
  if (input.resourceSalesV2) {
    const d = extendResourceSalesEvent({
      projection: world,
      requestId: 'seed-resource-sales-v2',
      simulationId: 'manifest-seed',
      nextSequence: 1,
    });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) world = applyWorldEvent(world, e);
  }
  if (input.constructionTrade) {
    const d = enableResidentConstructionTradeEvent({
      projection: world,
      requestId: 'seed-construction-trade-v1',
      simulationId: 'manifest-seed',
      nextSequence: 1,
      enablePublicAuthority: true,
    });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) world = applyWorldEvent(world, e);
  }
  if (input.principalTrade) {
    const d = enablePrincipalEvidenceTradeEvent({
      projection: world,
      requestId: 'seed-principal-trade-v3',
      simulationId: 'manifest-seed',
      nextSequence: 1,
    });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) world = applyWorldEvent(world, e);
  }
  if (input.housingOccupancy)
    world = applyWorldEvent(
      world,
      enableHousingOccupancyEvent({
        projection: world,
        requestId: 'seed-housing-occupancy-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.physicalHousingRest)
    world = applyWorldEvent(
      world,
      enablePhysicalHousingRestEvent({
        projection: world,
        requestId: 'seed-physical-housing-rest-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.housingChoice)
    world = applyWorldEvent(
      world,
      enableHousingChoiceEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        requestId: 'seed-housing-choice-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.publicHousing)
    world = applyWorldEvent(
      world,
      enablePublicHousingEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        requestId: 'seed-public-housing-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.capitalAgreements)
    world = applyWorldEvent(
      world,
      enableResidentCapitalEvent({
        projection: world,
        requestId: 'seed-capital-agreements-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.publicEmployment)
    world = applyWorldEvent(
      world,
      enablePublicEmploymentEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        requestId: 'seed-public-employment-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.publicLabor)
    world = applyWorldEvent(
      world,
      enablePublicLaborEvent({
        projection: world,
        policies: openWorldPolicies(seed, world, rhythm),
        requestId: 'seed-public-labor-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.serviceEmployment)
    world = applyWorldEvent(
      world,
      enableServiceEmploymentEvent({
        projection: world,
        requestId: 'seed-service-employment-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.productiveEmployment)
    world = applyWorldEvent(
      world,
      enableProductiveEmploymentEvent({
        projection: world,
        requestId: 'seed-productive-employment-v1',
        simulationId: 'manifest-seed',
        nextSequence: 1,
      }),
    );
  if (input.publicProcurement)
    world = applyWorldEvent(
      world,
      enableResidentPublicProcurementEvent({
        projection: world,
        simulationId: 'manifest-seed',
        requestId: 'seed-public-procurement-v1',
        nextSequence: 1,
      }),
    );
  if (input.publicGoodsProcurement)
    world = applyWorldEvent(
      world,
      enableResidentPublicGoodsProcurementEvent({
        projection: world,
        simulationId: 'manifest-seed',
        requestId: 'seed-public-goods-procurement-v1',
        nextSequence: 2,
      }),
    );
  if (input.elapsedRest)
    assertResidentRestTimeCompatibility(openWorldPolicies(seed, world, rhythm));
  const backgrounds = [
    '初始化背景：你对新地方和生活方式感兴趣，也重视自己作决定。你尚未决定今天做什么；这不是要求你必须探索或旅游。',
    '初始化背景：你喜欢倾听与记录，对人的不同看法感到好奇。你可以改变兴趣，也可以独处，不必承担固定任务。',
    '初始化背景：你愿意尝试动手做事情，珍惜已有的生活经验。你可以重新考虑自己的目标，没有预设的赚钱指标。',
  ];
  return {
    ...(groupControlEnabled ? { groupControlPolicy: GROUP_CONTROL_POLICY } : {}),
    ...(input.servicePrincipals ? { servicePrincipalPolicy: SERVICE_PRINCIPALS_POLICY } : {}),
    ...(input.serviceSupply ? { serviceSupplyPolicy: SERVICE_SUPPLY_POLICY } : {}),
    ...(input.serviceAffiliations ? { serviceAffiliationPolicy: SERVICE_AFFILIATION_POLICY } : {}),
    ...(input.serviceSupplyRelations
      ? { serviceSupplyRelationPolicy: SERVICE_SUPPLY_RELATION_POLICY }
      : {}),
    ...(input.serviceControl ? { serviceControlPolicy: SERVICE_CONTROL_POLICY } : {}),
    ...(input.societyKernel === false
      ? {}
      : {
          societyKernelPolicy: SOCIETY_KERNEL_POLICY,
          ...(input.enterprisePrograms === true || input.programActions === true
            ? {
                programActionsPolicy: input.enterprisePrograms
                  ? ENTERPRISE_PROGRAM_ACTIONS_POLICY
                  : PROGRAM_ACTIONS_POLICY,
              }
            : {}),
          ...(input.resourceControl === false
            ? {}
            : { resourceControlPolicy: RESOURCE_CONTROL_POLICY }),
          ...(input.programConditions === false
            ? {}
            : {
                programConditionsPolicy: PROGRAM_CONDITIONS_POLICY,
                ...(input.programReactions === false
                  ? {}
                  : { programReactionsPolicy: PROGRAM_REACTIONS_POLICY }),
              }),
          ...(input.collectives === false ? {} : { collectivesPolicy: COLLECTIVES_POLICY }),
          ...(input.recordViews === false ? {} : { recordViewsPolicy: RECORD_VIEWS_POLICY }),
        }),
    schemaVersion: OPEN_SOCIETY_SCHEMA_VERSION,
    simulationId: input.simulationId ?? 'open-town',
    seed,
    policy: {
      ...(input.policy ??
        (rhythm
          ? {
              ...DEFAULT_OPEN_AGENT_POLICY,
              freeActivityIntervalMs: rhythm.freeActivityIntervalMs,
              opportunityCadenceMs: rhythm.opportunityCadenceMs,
            }
          : DEFAULT_OPEN_AGENT_POLICY)),
      ...(input.messagePacing ? { messageWake: RESIDENT_MESSAGE_PACING_POLICY } : {}),
      ...(input.actionPlans === 'resident-action-plans-v2'
        ? { actionPlans: RESIDENT_ACTION_PLANS_POLICY_V2 }
        : input.actionPlans
          ? { actionPlans: RESIDENT_ACTION_PLANS_POLICY }
          : {}),
    },
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
      ...(input.materialGrowth
        ? {
            materialExpertise: MATERIAL_EXPERTISE_POLICY.version,
            materialRegrowth: MATERIAL_REGROWTH_POLICY.version,
          }
        : {}),
      ...(input.economy
        ? {
            economyShape: OPEN_SOCIETY_ECONOMY_SHAPE_VERSION,
            initialTreasury: String(treasury),
            outsideMarket: input.economy.outsideMarket,
          }
        : {}),
      ...(input.publicLabor
        ? {
            publicLabor: 'resident-public-labor-v1',
            publicLaborBody: 'resident-public-labor-body-v1',
            publicLaborFunding: 'treasury-prefunded-gross-wage',
          }
        : {}),
      ...(input.serviceEmployment
        ? {
            serviceEmployment: 'resident-service-employment-v1',
            enterpriseServiceBusiness: 'enterprise-service-business-v1',
            serviceAttendance: 'resident-service-attendance-v1',
          }
        : {}),
      inventoryRequestPrecision: INVENTORY_REQUEST_PRECISION.version,
      ...(evidenceTradeEnabled ? { evidenceTrade: tradePolicy.version } : {}),
      ...(premisesRightsEnabled ? { premisesRights: PREMISES_RIGHTS_POLICY.version } : {}),
      ...(paidPermitsEnabled ? { premisesProvision: PREMISES_PROVISION_POLICY.version } : {}),
      ...(logisticsEnabled
        ? {
            logistics: LOGISTICS_POLICY.version,
            physicalLoad: LOGISTICS_POLICY.loadModel,
            vehicleCargoSeed: LOGISTICS_VEHICLE_SEED_VERSION,
          }
        : {}),
      ...(serviceEngagementsEnabled
        ? {
            serviceEngagements: SERVICE_ENGAGEMENTS_POLICY.version,
            serviceEffects: RESIDENT_SERVICE_EFFECTS_POLICY.version,
            serviceFacilitySeed: SERVICE_FACILITY_SEED_VERSION,
          }
        : {}),
      ...(premisesEnabled && input.facilityUse !== false
        ? { facilityUse: PREMISES_FACILITY_USE_POLICY.version }
        : {}),
      ...(premisesEnabled
        ? {
            premises: PREMISES_POLICY.version,
            publicConstructionUse: PUBLIC_LAND_USE_POLICY.version,
            constructionSites: CONSTRUCTION_SITE_SEED_VERSION,
          }
        : {}),
      ...(materialsEnabled
        ? { materials: MATERIALS_POLICY.version, processing: 'resident-processing-v1' }
        : {}),
      ...(groupControlEnabled ? { groupControl: GROUP_CONTROL_POLICY.version } : {}),
      ...(input.serviceControl ? { serviceControl: SERVICE_CONTROL_POLICY.version } : {}),
      ...(input.publicHousing ? { publicHousing: 'resident-public-housing-v1' } : {}),
      ...(input.housingOccupancy ? { housingOccupancy: 'resident-housing-occupancy-v1' } : {}),
      ...(input.physicalHousingRest
        ? { physicalHousingRest: PHYSICAL_HOUSING_REST_POLICY.version }
        : {}),
      ...(input.servicePrincipals ? { servicePrincipals: 'resident-service-principals-v2' } : {}),
      ...(input.serviceSupply ? { serviceRegistration: 'resident-service-supply-v3' } : {}),
      ...(input.serviceAffiliations
        ? { serviceAffiliation: 'resident-service-affiliation-v4' }
        : {}),
      ...(input.serviceSupplyRelations
        ? { serviceSupplyRelationships: 'resident-service-supply-relations-v5' }
        : {}),
      ...(input.vehiclePrincipals ? { vehiclePrincipals: 'resident-vehicle-principals-v2' } : {}),
      ...(input.resourceSales || input.resourceSalesV2
        ? {
            resourceSales: input.resourceSalesV2
              ? 'resident-resource-sales-v2'
              : 'resident-resource-sales-v1',
            publicResourceSales: input.resourceSalesV2
              ? 'public-paid-resource-control-v2'
              : 'public-paid-resource-control-v1',
            enterpriseResourceSalesAccounting: input.resourceSalesV2
              ? 'enterprise-resource-sales-cash-accounting-v2'
              : 'enterprise-resource-sales-cash-accounting-v1',
          }
        : {}),
      ...(input.periodicObligations
        ? {
            periodicObligations: 'resident-periodic-obligations-v1',
            publicPeriodicObligations: 'public-finite-periodic-commitments-v1',
            enterprisePeriodicAccounting: 'enterprise-periodic-obligations-cash-v1',
          }
        : {}),
      ...(input.constructionTrade ? { constructionTrade: 'construction-trade-v1' } : {}),
      ...(input.principalTrade ? { principalTrade: 'resident-principal-evidence-trade-v3' } : {}),
      ...(input.principalPermits
        ? { principalPermits: 'resident-premises-principal-permits-v2' }
        : {}),
      ...(input.premisesPrincipals
        ? { premisesPrincipals: 'premises-resource-principals-v2' }
        : {}),
      ...(input.resourcePrincipals ? { resourcePrincipals: 'resource-principals-v2' } : {}),
      ...(input.housingChoice ? { housingChoice: 'resident-housing-choice-v1' } : {}),
      ...(input.capitalAgreements ? { capitalAgreements: 'enterprise-capital-agreements-v1' } : {}),
      ...(input.publicEmployment
        ? { publicEmployment: 'resident-public-employment-rules-v1' }
        : {}),
      ...(input.publicGovernance
        ? {
            publicGovernance: PUBLIC_GOVERNANCE_POLICY.version,
            publicGrant: 'open-town-public-grant-v1',
          }
        : {}),
      ...(input.publicGoodsProcurement
        ? {
            publicGoodsProcurement: 'resident-public-goods-procurement-v1',
            tradePublicFunding: 'resident-trade-public-funding-v1',
          }
        : {}),
      ...(input.publicProcurement
        ? {
            publicProcurement: 'resident-public-procurement-v1',
            servicePublicFunding: 'resident-service-public-funding-v1',
          }
        : {}),
      ...(input.physicalProduction
        ? {
            physicalProduction: 'resident-extraction-v1',
            materialSourceSeed: EXTRACTION_SEED_VERSION,
          }
        : {}),
      ...(input.elapsedRest
        ? {
            elapsedRest: RESIDENT_REST_POLICY.version,
            elapsedPhysiology: RESIDENT_REST_POLICY.physiologyVersion,
          }
        : {}),
      ...(input.elapsedLabor
        ? {
            elapsedLabor: 'resident-enterprise-labor-v1',
            earnedPayroll: 'enterprise-earned-payroll-v1',
            withholding: 'labor-reference-period-withholding-v1',
            employmentOpportunityCost: 'education-opportunity-cost-v3',
          }
        : {}),
      ...(input.serviceTime
        ? {
            serviceTime: 'resident-service-time-v1',
            servicePhysiology: 'resident-service-physiology-v2',
          }
        : {}),
      ...(input.educationAuthority
        ? { educationAuthority: 'resident-education-authority-v1' }
        : {}),
      ...(input.productiveEmployment
        ? {
            productiveEmployment: 'resident-productive-employment-v1',
            productivePhysiology: 'resident-productive-physiology-v1',
            productionEmployment: 'enterprise-production-employment-v1',
          }
        : {}),
      ...(input.elapsedStudy
        ? { elapsedStudy: 'resident-elapsed-study-v1', studySource: 'scenario-education-course-v1' }
        : {}),
      ...(input.societyKernel === false || input.resourceControl === false
        ? {}
        : {
            resourceControl: RESOURCE_CONTROL_POLICY.version,
            enterpriseControl: ENTERPRISE_CONTROL_VERSION,
          }),
      ...(input.societyKernel === false
        ? {}
        : {
            societyKernel: SOCIETY_KERNEL_POLICY.version,
            sharedRecords: SOCIETY_KERNEL_POLICY.records.version,
            coordination: SOCIETY_KERNEL_POLICY.coordination.version,
            rulebook: SOCIETY_RULEBOOK_VERSION,
          }),
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
      transport: RESIDENT_CLI_VERSION,
      residentSkill: RESIDENT_SKILL_VERSION,
      ...(input.societyKernel === false ||
      input.programConditions === false ||
      input.programReactions === false
        ? {}
        : { programReactions: PROGRAM_REACTIONS_POLICY.version }),
      ...(input.societyKernel === false || input.programConditions === false
        ? {}
        : { programConditions: PROGRAM_CONDITIONS_POLICY.version }),
      ...(input.societyKernel !== false &&
      (input.enterprisePrograms === true || input.programActions === true)
        ? {
            programActions: input.enterprisePrograms
              ? ENTERPRISE_PROGRAM_ACTIONS_POLICY.version
              : PROGRAM_ACTIONS_POLICY.version,
            programExecution: PROGRAM_ACTIONS_POLICY.execution,
          }
        : {}),
      ...(commonAccountsEnabled ? { commonAccounts: COMMON_ACCOUNTS_POLICY.version } : {}),
      ...(input.societyKernel === false || input.collectives === false
        ? {}
        : { collectives: COLLECTIVES_POLICY.version }),
      ...(input.societyKernel === false || input.recordViews === false
        ? {}
        : { recordViews: RECORD_VIEWS_POLICY.version }),
      capabilityBoundaries: 'resident-capability-boundaries-v1',
      ...(input.cityApps === false ? {} : { cityApps: CITY_APPS_VERSION }),
      ...(input.distribution === false
        ? {}
        : { distribution: DEFAULT_DISTRIBUTION_POLICY.version }),
      documentIndex: 'document-index-v1',
      documentMetadata: DOCUMENT_METADATA_POLICY.version,
    },
  };
}
import { PUBLIC_GOVERNANCE_POLICY } from '@aivilization/governance';
import { seedPublicGovernance } from './publicGovernancePolicy';
