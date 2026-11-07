import {
  resolveCanonicalPolicyContinuation,
  type CanonicalPolicyContinuation,
} from '../canonicalPolicyContinuation';
import { enablePhysicalHousingRestEvent } from '@aivilization/world';
import { PHYSICAL_HOUSING_REST_POLICY } from '@aivilization/society';
import { enablePremisesPrincipalsEvent } from '@aivilization/world';
import { enableResourcePrincipalsEvent } from '@aivilization/world';
import { enableHousingOccupancyEvent } from '@aivilization/world';
import { publicHousingWorldPolicies, enablePublicHousingEvent } from '@aivilization/world';
import { enableHousingChoiceEvent } from '@aivilization/world';
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
  assertEducationAuthorityState,
} from '@aivilization/world';
import { seedOpenMaterialSources, EXTRACTION_SEED_VERSION } from './extractionPolicy';
import { applyPremisesRightsEvent, PREMISES_RIGHTS_POLICY } from '@aivilization/premises';

import { emptyResidentRestState, RESIDENT_REST_POLICY } from '@aivilization/society';
import { assertResidentRestTimeCompatibility, applyWorldEvent } from '@aivilization/world';
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
import { RESIDENT_RHYTHM_POLICY, type ResidentRhythmPolicy } from '@aivilization/society';
import { applyResidentRhythm } from './rhythmPolicy';
import { COMMERCE_POLICY, emptyCommerceState } from '@aivilization/commerce';
import { COLLABORATION_POLICY } from '@aivilization/collaboration';
import { SOCIETY_KERNEL_POLICY } from './kernelPolicy';
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
  life?: boolean;
  continuity?: boolean;
  societyKernel?: boolean;
  collectives?: boolean;
  commonAccounts?: boolean;
  programConditions?: boolean;
  programActions?: boolean;
  enterprisePrograms?: boolean;
  elapsedRest?: boolean;
  elapsedStudy?: boolean;
  elapsedLabor?: boolean;
  productiveEmployment?: boolean;
  educationAuthority?: boolean;
  publicLabor?: boolean;
  physicalProduction?: boolean;
  publicGovernance?: boolean;
  publicEmployment?: boolean;
  housingChoice?: boolean;
  housingOccupancy?: boolean;
  physicalHousingRest?: boolean;
  resourcePrincipals?: boolean;
  premisesPrincipals?: boolean;
  publicHousing?: boolean;
  resourceControl?: boolean;
  groupControl?: boolean;
  materials?: boolean;
  premises?: boolean;
  facilityUse?: boolean;
  premisesRights?: boolean;
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
  const premisesRightsEnabled = premisesEnabled && input.premisesRights !== false;
  let world: WorldProjection = {
    ...premisesWorld,
    ...(input.publicGovernance ? { publicGovernance: seedPublicGovernance(premisesWorld) } : {}),
    ...(input.elapsedRest ? { residentRest: emptyResidentRestState() } : {}),
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
  if (input.elapsedRest)
    assertResidentRestTimeCompatibility(openWorldPolicies(seed, world, rhythm));
  const backgrounds = [
    '初始化背景：你对新地方和生活方式感兴趣，也重视自己作决定。你尚未决定今天做什么；这不是要求你必须探索或旅游。',
    '初始化背景：你喜欢倾听与记录，对人的不同看法感到好奇。你可以改变兴趣，也可以独处，不必承担固定任务。',
    '初始化背景：你愿意尝试动手做事情，珍惜已有的生活经验。你可以重新考虑自己的目标，没有预设的赚钱指标。',
  ];
  return {
    ...(groupControlEnabled ? { groupControlPolicy: GROUP_CONTROL_POLICY } : {}),
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
            : { programConditionsPolicy: PROGRAM_CONDITIONS_POLICY }),
          ...(input.collectives === false ? {} : { collectivesPolicy: COLLECTIVES_POLICY }),
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
    ...(input.life === false
      ? {}
      : {
          communicationPolicy: COMMUNICATION_POLICY,
          collaborationPolicy: COLLABORATION_POLICY,
        }),
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
      inventoryRequestPrecision: INVENTORY_REQUEST_PRECISION.version,
      ...(premisesRightsEnabled ? { premisesRights: PREMISES_RIGHTS_POLICY.version } : {}),
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
      ...(input.publicHousing ? { publicHousing: 'resident-public-housing-v1' } : {}),
      ...(input.housingOccupancy ? { housingOccupancy: 'resident-housing-occupancy-v1' } : {}),
      ...(input.physicalHousingRest
        ? { physicalHousingRest: PHYSICAL_HOUSING_REST_POLICY.version }
        : {}),
      ...(input.premisesPrincipals
        ? { premisesPrincipals: 'premises-resource-principals-v2' }
        : {}),
      ...(input.resourcePrincipals ? { resourcePrincipals: 'resource-principals-v2' } : {}),
      ...(input.housingChoice ? { housingChoice: 'resident-housing-choice-v1' } : {}),
      ...(input.publicEmployment
        ? { publicEmployment: 'resident-public-employment-rules-v1' }
        : {}),
      ...(input.publicGovernance
        ? {
            publicGovernance: PUBLIC_GOVERNANCE_POLICY.version,
            publicGrant: 'open-town-public-grant-v1',
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
      worldPolicyAdapter: rhythm ? 'resident-natural-day-adapter-v1' : 'canonical-world-adapter-v1',
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
          }),
      scheduler: 'open-simulation-round-robin-v1',
      initialBackground: initialized
        ? RESIDENT_INITIALIZATION_VERSION
        : 'explicit-template-v1-not-lived-memory',
      transport: RESIDENT_CLI_VERSION,
      residentSkill: RESIDENT_SKILL_VERSION,
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
      capabilityBoundaries: 'resident-capability-boundaries-v1',
      ...(input.cityApps === false ? {} : { cityApps: CITY_APPS_VERSION }),
      documentIndex: 'document-index-v1',
      documentMetadata: DOCUMENT_METADATA_POLICY.version,
    },
  };
}
import { PUBLIC_GOVERNANCE_POLICY } from '@aivilization/governance';
import { seedPublicGovernance } from './publicGovernancePolicy';
