import { messageWakeAt, residentBusyUntil } from './attention';
import { plannableCapabilities, resolveActionPlanArguments } from './actionPlans';
import { enableCollectiveFreightCustodyEvent } from '@aivilization/world';
import { FREIGHT_CUSTODY_COLLECTIVE_VERSION } from '@aivilization/logistics';
import { enableResidentFreightCustodyEvent } from '@aivilization/world';
import { FREIGHT_CUSTODY_HANDOFF_VERSION } from '@aivilization/logistics';
import { applyServicePrincipalEvent } from '@aivilization/services';
import { enableServiceClosureEvent } from '@aivilization/world';
import { enablePeriodicAccessEvent, assertPeriodicAccessState } from '@aivilization/world';
import {
  enableResourceAdaptersEvent,
  parseResourceAdapterKinds,
  assertResourceAdapterState,
} from '@aivilization/world';
import {
  registerServiceFacilitiesEvent,
  parseDeclaredServiceFacilities,
} from '@aivilization/world';
import { executeLaborTermsTool } from './laborTermsTools';
import { decideServicePolicyUpgrade } from '@aivilization/services';
import {
  enableResidentConstructionTradeEvent,
  advanceResidentConstructionTrade,
} from '@aivilization/world';
import {
  CONSTRUCTION_TRADE_POLICY,
  nextConstructionTradeBoundary,
  tradeFactsEqual,
} from '@aivilization/commerce';
import { assertResourceSalesPolicy } from '@aivilization/commerce';
import { enablePeriodicObligationsEvent, nextPeriodicBoundary } from '@aivilization/world';
import { assertPeriodicObligationsState } from '@aivilization/commerce';
import {
  enableResourceSalesEvent,
  extendResourceSalesEvent,
  advanceResourceSales,
} from '@aivilization/world';
import { enablePhysicalHousingRestEvent } from '@aivilization/world';
import {
  assertPhysicalHousingRestPolicy,
  PHYSICAL_HOUSING_REST_POLICY,
} from '@aivilization/society';
import { enableServiceSupplyRelationsEvent } from '@aivilization/world';
import { assertServiceSupplyRelationPolicy } from '@aivilization/services';
import { enableServiceAffiliationsEvent } from '@aivilization/world';
import { assertServiceAffiliationPolicy } from '@aivilization/services';
import { enableServicePrincipalsEvent, separateServiceAuthorityEvent } from '@aivilization/world';
import { enableServiceSupplyEvent } from '@aivilization/world';
import { assertServiceSupplyPolicy } from '@aivilization/services';
import { assertServicePrincipalsPolicy } from '@aivilization/services';
import { enableVehiclePrincipalsEvent } from '@aivilization/world';
import {
  enablePrincipalEvidenceTradeEvent,
  advanceResidentPrincipalEvidenceTrade,
} from '@aivilization/world';
import {
  PRINCIPAL_EVIDENCE_TRADE_POLICY,
  assertPrincipalTradePolicy,
  nextPrincipalTradeBoundary,
} from '@aivilization/commerce';
import { enablePrincipalPremisesRightsEvent } from '@aivilization/world';
import { enablePremisesPrincipalsEvent } from '@aivilization/world';
import { executeResourcePrincipalTool } from './resourcePrincipalTools';
import { enableResourcePrincipalsEvent } from '@aivilization/world';
import { RESOURCE_PRINCIPAL_POLICY, assertResourcePrincipalPolicy } from '@aivilization/authority';
import { executeHousingOccupancyTool } from './housingOccupancyTools';
import { enableHousingOccupancyEvent } from '@aivilization/world';
import { assertHousingOccupancyState, HOUSING_OCCUPANCY_POLICY } from '@aivilization/society';
import { enablePublicHousingEvent } from '@aivilization/world';
import { assertPublicHousingState, PUBLIC_HOUSING_POLICY } from '@aivilization/society';
import { executeHousingChoiceTool } from './housingChoiceTools';
import { enableHousingChoiceEvent } from '@aivilization/world';
import { assertHousingChoiceState, HOUSING_CHOICE_POLICY } from '@aivilization/society';
import { enableResidentCapitalEvent } from '@aivilization/world';
import { CAPITAL_AGREEMENTS_POLICY, assertEnterpriseCapitalState } from '@aivilization/enterprise';
import { enablePublicEmploymentEvent } from '@aivilization/world';
import { assertPublicEmploymentState } from '@aivilization/society';
import { enablePublicLaborEvent } from '@aivilization/world';
import {
  enableResidentExtractionEvent,
  assertResidentExtractionCompatibility,
} from '@aivilization/world';
import { MATERIAL_EXTRACTION_POLICY } from '@aivilization/materials';
import { seedOpenMaterialSources, parseMaterialEndowment } from './extractionPolicy';
import {
  PREMISES_RIGHTS_POLICY,
  assertPremisesRightsPolicy,
  nextPremisesRightsBoundary,
} from '@aivilization/premises';
import {
  enableResidentPremisesRightsEvent,
  enableResidentRestEvent,
  enableResidentStudyEvent,
  assertResidentStudyConfiguration,
  enableResidentLaborEvent,
  enableProductiveEmploymentEvent,
  enableEducationAuthorityEvent,
  enableServiceTimeEvent,
  enableServiceEmploymentEvent,
  assertServiceTimePolicy,
  assertEducationAuthorityState,
  assertResidentLaborConfiguration,
  assertResidentRestTimeCompatibility,
  advanceResidentPremisesRights,
  settleResidentPremisesProvisions,
} from '@aivilization/world';
import {
  EVIDENCE_TRADE_POLICY,
  TRADE_PUBLIC_FUNDING_POLICY,
  EVIDENCE_TRADE_POLICY_V2,
  assertEvidenceTradePolicy,
  nextEvidenceTradeBoundary,
} from '@aivilization/commerce';
import {
  enableResidentEvidenceTradeEvent,
  upgradeResidentEvidenceTradeEvent,
  advanceResidentEvidenceTrade,
} from '@aivilization/world';
import {
  LOGISTICS_POLICY,
  nextLogisticsBoundary,
  assertLogisticsPolicy,
} from '@aivilization/logistics';
import { enableResidentLogisticsEvent, advanceResidentLogistics } from '@aivilization/world';

import { SERVICE_ENGAGEMENTS_POLICY, nextServiceEngagementBoundary } from '@aivilization/services';
import {
  enableResidentServiceEngagementsEvent,
  advanceResidentServiceEngagements,
} from '@aivilization/world';
import {
  nextConstructionBoundary,
  nextPremisesWearBoundary,
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  PREMISES_FACILITY_USE_POLICY,
} from '@aivilization/premises';
import {
  enableResidentPremisesEvent,
  registerConstructionSiteEvent,
  enableResidentFacilityUseEvent,
} from '@aivilization/world';
import {
  executePremisesTool,
  advanceOpenPremises,
  nextOpenPremisesBoundary,
} from './premisesTools';
import { RESOURCE_CONTROL_POLICY } from '@aivilization/authority';
import { nextMaterialBoundary } from '@aivilization/materials';
import { enableResidentMaterialsEvent } from '@aivilization/world';
import { MATERIALS_POLICY } from './materialPolicy';
import { executeMaterialTool, advanceOpenMaterials } from './materialTools';
import { GROUP_CONTROL_POLICY } from '@aivilization/information';
import { executeResourceControlTool } from './resourceControlTools';
import { PROGRAM_REACTIONS_POLICY, nextReactionBoundary } from '@aivilization/collaboration';
import {
  PROGRAM_CONDITIONS_POLICY,
  PROGRAM_ACTIONS_POLICY,
  ENTERPRISE_PROGRAM_ACTIONS_POLICY,
} from '@aivilization/collaboration';
import { executeCommonAccountTool } from './commonAccountTools';
import { COMMON_ACCOUNTS_POLICY } from '@aivilization/economy';
import { enableCommonAccountsEvent } from '@aivilization/world';
import {
  COLLECTIVES_POLICY,
  nextCollectiveBoundary,
  advanceCollectives,
} from '@aivilization/collaboration';
import { executeCollectiveTool } from './collectiveTools';
import { nextMobilityBoundary, validateMobilityPolicy } from '@aivilization/mobility';
import { nextProgramBoundary, programAdvanceWithinBudget } from '@aivilization/collaboration';
import { executeCoordinationTool } from './coordinationTools';
import { executeSharedRecordTool } from './sharedRecordTools';
import { executeDuePrograms, mergeProgramEffects } from './programExecution';
import { executeRulebookTool } from './rulebook';
import { SOCIETY_KERNEL_POLICY } from './kernelPolicy';
import { RECORD_VIEWS_POLICY } from '@aivilization/information';
import {
  assertCapabilityEffects,
  validateCapabilityBoundaries,
  boundaryAvailability,
} from './capabilityBoundaries';
import { advanceResidentMobility } from '@aivilization/world';
import { experiencePeople, readingExperiences, ORIGINAL_READS } from './readingExperiences';
import { RESIDENT_LIFE_POLICIES } from './lifeState';
import type { WorldEvent } from '@aivilization/world';
import { COMMUNICATION_POLICY } from '@aivilization/information';
import { COLLABORATION_POLICY } from '@aivilization/collaboration';
import { COMMERCE_POLICY } from '@aivilization/commerce';
import { SERVICES_POLICY, SERVICE_CONTROL_POLICY } from '@aivilization/services';
import { enableResidentCommerceEvent } from '@aivilization/world';
import { advanceCare, assertResidentRestPolicy } from '@aivilization/society';
import { nextResidentLeaseBoundary, advanceResidentLeases } from '@aivilization/world';
import { executeLifeTool } from './lifeTools';
import { advanceServices, personalServiceAdministrator } from '@aivilization/services';
import { executeCommerceTool } from './commerceTools';
import { expireProposals } from '@aivilization/collaboration';
import { executeCollaborationTool } from './collaborationTools';
import {
  validateOpenToolArguments,
  type OpenToolRequest,
  type OpenToolResult,
} from '@aivilization/agent-runtime';
import { validInformationId, DEFAULT_DISTRIBUTION_POLICY } from '@aivilization/information';
import { executeCommunicationTool } from './communicationTools';
import { CITY_APPS_VERSION } from '@aivilization/content';
import { prepareCityAppInstallation } from './cityApps';
import { OPEN_SOCIETY_TOOLS, OPEN_CAPABILITY_CATALOG_VERSION } from './catalog';
import { buildOpenResidentContext, observeResidentWorld } from './context';
import { readFiscalObservation } from './fiscalObservation';
import { executeCognitionTool } from './cognitionTools';
import { executeInformationTool, type ToolExecution } from './informationTools';
import { digest, OpenSocietyJournal } from './journal';
import { openWorldPolicies, serializableWorldPolicy } from './manifest';
import { executeScheduleTool } from './scheduleTools';
import { applyOpenSocietyEffects, hasExperience } from './state';
import { dispatchOpenWorldCommand, executeOpenWorldTool, worldExperiences } from './worldTools';
import { ToolRefusal, stringArg } from './arguments';
import type {
  OpenSocietyEffects,
  OpenSocietyManifest,
  ResidentRuntimeState,
  ResidentTurn,
} from './types';

export class OpenSocietyRuntime {
  readonly journal: OpenSocietyJournal;
  constructor(rootDir: string, manifest?: OpenSocietyManifest) {
    validateCapabilityBoundaries(OPEN_SOCIETY_TOOLS);
    this.journal = new OpenSocietyJournal(rootDir, manifest);
    try {
      if (
        this.manifest.canonicalPolicyContinuation &&
        this.manifest.provenance.worldPolicyAdapter !== 'canonical-policy-continuation-v1'
      )
        throw new Error('canonical-policy-adapter-provenance-mismatch');
      if (
        digest(
          serializableWorldPolicy(
            this.manifest.seed,
            this.manifest.initialWorld,
            this.manifest.rhythm,
            this.manifest.canonicalPolicyContinuation,
          ),
        ) !== digest(this.manifest.worldPolicies)
      ) {
        throw new Error('world-policy-version-mismatch');
      }
      if (this.state.world.materials?.extraction) {
        assertResidentExtractionCompatibility(this.state.world, this.policies());
        if (!publicEqual(this.state.world.materials.extraction.policy, MATERIAL_EXTRACTION_POLICY))
          throw Error('unsupported-material-extraction-policy');
      }
      if (
        this.state.world.residentTrade?.publicFunding &&
        !publicEqual(this.state.world.residentTrade.publicFunding, TRADE_PUBLIC_FUNDING_POLICY)
      )
        throw Error('unsupported-trade-public-funding-policy');
      if (
        !!this.state.world.publicGovernance?.authority.grant.goodsProcurement !==
        !!this.state.world.residentTrade?.publicFunding
      )
        throw Error('inconsistent-public-goods-procurement-state');
      if (
        this.state.world.serviceEngagements?.publicFunding &&
        !publicEqual(
          this.state.world.serviceEngagements.publicFunding,
          SERVICE_PUBLIC_FUNDING_POLICY,
        )
      )
        throw Error('unsupported-service-public-funding-policy');
      if (
        !!this.state.world.publicGovernance?.authority.grant.procurement !==
        !!this.state.world.serviceEngagements?.publicFunding
      )
        throw Error('inconsistent-public-procurement-state');
      if (
        !!this.state.world.publicEmployment !==
        !!this.state.world.publicGovernance?.authority.grant.employment
      )
        throw Error('inconsistent-public-employment-state');
      if (this.state.world.publicEmployment)
        assertPublicEmploymentState(this.state.world.publicEmployment);
      if (
        this.state.world.capitalAgreements &&
        !publicEqual(this.state.world.capitalAgreements.policy, CAPITAL_AGREEMENTS_POLICY)
      )
        throw Error('unsupported-capital-agreements-policy');
      for (const e of Object.values(this.state.world.enterprises))
        if (e.capital) {
          if (!this.state.world.capitalAgreements)
            throw Error('enterprise-capital-policy-required');
          assertEnterpriseCapitalState(e.capital);
        }
      if (
        !!this.state.world.publicHousing !==
        !!this.state.world.publicGovernance?.authority.grant.housing
      )
        throw Error('inconsistent-public-housing-state');
      if (this.state.world.publicHousing) {
        if (!this.state.world.housingChoice) throw Error('public-housing-requires-housing-choice');
        assertPublicHousingState(this.state.world.publicHousing);
      }
      if (
        !this.state.world.resourceAdapters?.kinds.includes('stock') &&
        !!this.state.world.materials?.resourcePrincipals !==
          !!this.state.world.publicGovernance?.authority.grant.resourceCustody
      )
        throw Error('inconsistent-resource-principals-state');
      if (
        !this.state.world.resourceAdapters?.kinds.includes('premises') &&
        !!this.state.world.premises?.resourcePrincipals !==
          !!this.state.world.publicGovernance?.authority.grant.construction
      )
        throw Error('inconsistent-premises-principals-state');
      if (
        !this.state.world.resourceAdapters &&
        !!this.state.world.resourceSales !==
          !!this.state.world.publicGovernance?.authority.grant.resourceSales
      )
        throw Error('inconsistent-resource-sales-state');
      if (
        !this.state.world.periodicAccess &&
        !!this.state.world.periodicObligations !==
          !!this.state.world.publicGovernance?.authority.grant.periodicObligations
      )
        throw Error('inconsistent-periodic-obligations-state');
      if (this.state.world.periodicObligations)
        assertPeriodicObligationsState(this.state.world.periodicObligations);
      assertResourceAdapterState(this.state.world);
      assertPeriodicAccessState(this.state.world);
      if (this.state.world.resourceSales) {
        assertResourceSalesPolicy(this.state.world.resourceSales.policy);
        const v2 = this.state.world.resourceSales.policy.version === 'resident-resource-sales-v2';
        if (
          !this.state.world.resourceAdapters &&
          (this.state.world.publicGovernance?.authority.grant.resourceSales?.version !==
            (v2 ? 'public-paid-resource-control-v2' : 'public-paid-resource-control-v1') ||
            (v2 && !this.state.world.residentMobility?.principalPolicy))
        )
          throw Error('inconsistent-resource-sales-scope-version');
      }
      if (
        !this.state.world.resourceAdapters?.kinds.includes('premises') &&
        this.state.world.premises?.resourcePrincipals &&
        !this.state.world.materials?.resourcePrincipals
      )
        throw Error('premises-principals-require-material-principals');
      if (
        !!this.state.world.premisesRights?.principalPolicy !==
        !!this.state.world.publicGovernance?.authority.grant.principalPermits
      )
        throw Error('inconsistent-principal-permits-state');
      if (
        !this.state.world.resourceAdapters?.kinds.includes('vehicle') &&
        !!this.state.world.residentMobility?.principalPolicy !==
          !!this.state.world.publicGovernance?.authority.grant.vehicles
      )
        throw Error('inconsistent-vehicle-principals-state');
      if (
        this.state.services?.principalPolicy?.version !== 'resident-service-principals-v3' &&
        !!this.state.services?.principalPolicy !==
          !!this.state.world.publicGovernance?.authority.grant.services
      )
        throw Error('inconsistent-service-principals-state');
      if (this.state.services?.principalPolicy)
        assertServicePrincipalsPolicy(this.state.services.principalPolicy);
      if (
        (this.state.services?.principalPolicy?.version !== 'resident-service-principals-v3' &&
          !!this.state.services?.registration !==
            !!this.state.world.publicGovernance?.authority.grant.serviceCreation) ||
        (!!this.state.world.publicGovernance?.authority.grant.serviceCreation &&
          !this.state.services?.registration)
      )
        throw Error('inconsistent-service-supply-state');
      if (this.state.services?.registration)
        assertServiceSupplyPolicy(this.state.services.registration.policy);
      if (this.state.services?.relationPolicy) {
        if (!this.state.services.affiliations)
          throw Error('inconsistent-service-supply-relations-state');
        assertServiceSupplyRelationPolicy(this.state.services.relationPolicy);
      }
      if (this.state.services?.affiliations) {
        if (!this.state.services.registration || !this.state.services.principalPolicy)
          throw Error('inconsistent-service-affiliations-state');
        assertServiceAffiliationPolicy(this.state.services.affiliations.policy);
      }
      const constructionTrade = this.state.world.residentTrade?.constructionOrders;
      if (
        (constructionTrade &&
          !tradeFactsEqual(constructionTrade.policy, CONSTRUCTION_TRADE_POLICY)) ||
        !!constructionTrade !==
          !!this.state.world.publicGovernance?.authority.grant.constructionTrade
      )
        throw Error('construction-trade-authority-migration-mismatch');
      if (this.state.world.residentTrade?.principalOrders)
        assertPrincipalTradePolicy(this.state.world.residentTrade.principalOrders.policy);
      if (
        !!this.state.world.residentTrade?.principalOrders !==
        !!this.state.world.publicGovernance?.authority.grant.principalTrade
      )
        throw Error('principal-trade-authority-migration-mismatch');

      if (
        this.state.world.premisesRights?.principalPolicy &&
        !this.state.world.premises?.resourcePrincipals
      )
        throw Error('principal-permits-require-premises-principals');
      if (this.state.world.materials?.resourcePrincipals)
        assertResourcePrincipalPolicy(this.state.world.materials.resourcePrincipals);
      if (this.state.world.physicalHousingRest)
        assertPhysicalHousingRestPolicy(this.state.world.physicalHousingRest);
      if (this.state.world.housingOccupancy)
        assertHousingOccupancyState(this.state.world.housingOccupancy);
      if (this.state.world.housingChoice) assertHousingChoiceState(this.state.world.housingChoice);
      const publicGov = this.state.world.publicGovernance;
      if (publicGov) {
        if (!publicEqual(publicGov.authority.policy, PUBLIC_GOVERNANCE_POLICY))
          throw Error('unsupported-public-governance-policy');
        assertPublicGrant(publicGov.authority.grant);
        assertPublicProcedure(publicGov.authority.procedure, publicGov.authority.grant);
        assertValidTownGovernancePolicy(publicGov.institutionPolicy);
        if (
          !!publicGov.authority.grant.procurement !==
            !!this.state.world.serviceEngagements?.publicFunding ||
          (publicGov.authority.grant.procurement &&
            this.state.world.governance?.publicBudget?.allocations.length)
        )
          throw Error('inconsistent-public-procurement-state');
      }
      assertEducationAuthorityState(this.state.world);
      assertServiceTimePolicy(this.state.world, this.policies());
      if (this.state.world.residentRest) {
        assertResidentRestPolicy(this.state.world.residentRest.policy);
        assertResidentRestTimeCompatibility(this.policies());
      }
      if (this.state.world.residentStudy)
        assertResidentStudyConfiguration(
          this.state.world,
          this.state.world.residentStudy.configuration,
        );
      if (this.state.world.residentLabor)
        assertResidentLaborConfiguration(
          this.state.world,
          this.state.world.residentLabor.configuration,
        );
      if (this.manifest.initialWorld.premisesRights)
        assertPremisesRightsPolicy(this.manifest.initialWorld.premisesRights.policy);
      if (this.manifest.initialWorld.residentTrade)
        assertEvidenceTradePolicy(this.manifest.initialWorld.residentTrade.policy);
      if (this.manifest.initialWorld.logistics)
        assertLogisticsPolicy(this.manifest.initialWorld.logistics.policy);
      if (this.manifest.initialWorld.residentMobility)
        validateMobilityPolicy(this.manifest.initialWorld.residentMobility.policy);
      if (
        !['resident-cognition-v1', 'resident-cognition-v2'].includes(this.manifest.cognitionVersion)
      )
        throw new Error('unsupported-cognition-version');
      if (
        this.manifest.lifePolicies &&
        digest(this.manifest.lifePolicies) !== digest(RESIDENT_LIFE_POLICIES)
      )
        throw new Error('resident-life-policy-mismatch');
      if (this.manifest.provenance.cityApps !== undefined) {
        if (this.manifest.provenance.cityApps !== CITY_APPS_VERSION)
          throw new Error('unsupported-city-apps-version');
        this.installCityApps();
      }
    } catch (error) {
      this.journal.close();
      throw error;
    }
  }
  get manifest() {
    return this.journal.manifest;
  }
  get state() {
    return this.journal.state;
  }
  close() {
    this.journal.close();
  }
  registerConstructionSite(site: {
    id: string;
    parentLocationId: string;
    usableFloorArea: number;
    accessTravelMs: number;
    sourceId: string;
  }): OpenToolResult {
    const requestId = `register-site-${digest(site).slice(0, 32)}`;
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    try {
      const d = registerConstructionSiteEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
        site: {
          ...site,
          source: 'authorized-extension',
          revision: 1,
          occupiedFloorArea: 0,
          reservedFloorArea: 0,
        },
      });
      if (!d.accepted) return this.failure(d.reason);
      return this.systemCommit(
        'system',
        requestId,
        'system.register-construction-site',
        { worldEvents: d.events },
        { siteId: site.id, sourceId: site.sourceId },
      );
    } catch (e) {
      return this.failure(e instanceof Error ? e.message : 'invalid-construction-site-extension');
    }
  }
  registerServiceFacilities(declaration: unknown): OpenToolResult {
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    try {
      const facilities = parseDeclaredServiceFacilities(declaration);
      const requestId = `register-service-facilities-${digest(facilities).slice(0, 32)}`;
      const cached = this.journal.lookup('system', requestId);
      if (cached) return cached.result;
      const event = registerServiceFacilitiesEvent({
        projection: this.state.world,
        declaration,
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.register-service-facilities',
        { worldEvents: [event] },
        { registered: facilities },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-facility-declaration',
      );
    }
  }
  enableServiceEngagements(): OpenToolResult {
    const requestId = 'enable-service-engagements-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.serviceEngagements)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentServiceEngagementsEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
      policy: SERVICE_ENGAGEMENTS_POLICY,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-service-engagements',
      { worldEvents: d.events },
      { enabled: true, version: SERVICE_ENGAGEMENTS_POLICY.version, endowedFacilities: 0 },
    );
  }
  enableEvidenceTrade(): OpenToolResult {
    const requestId = 'enable-evidence-trade-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.residentTrade)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentEvidenceTradeEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
      policy: EVIDENCE_TRADE_POLICY,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-evidence-trade',
      { worldEvents: d.events },
      { enabled: true, version: EVIDENCE_TRADE_POLICY.version },
    );
  }
  enablePaidPermits(): OpenToolResult {
    const requestId = 'enable-paid-permits-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.residentTrade?.policy.version === EVIDENCE_TRADE_POLICY_V2.version)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const context = {
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
    };
    const d = this.state.world.residentTrade
      ? upgradeResidentEvidenceTradeEvent(context)
      : enableResidentEvidenceTradeEvent({ ...context, policy: EVIDENCE_TRADE_POLICY_V2 });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-paid-permits',
      { worldEvents: d.events },
      { enabled: true, version: EVIDENCE_TRADE_POLICY_V2.version, existingRightsUnchanged: true },
    );
  }
  enablePremisesRights(): OpenToolResult {
    const requestId = 'enable-premises-rights-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.premisesRights)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentPremisesRightsEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
      policy: PREMISES_RIGHTS_POLICY,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-premises-rights',
      { worldEvents: d.events },
      { enabled: true, version: PREMISES_RIGHTS_POLICY.version },
    );
  }
  enableCollectiveFreightCustody(): OpenToolResult {
    const requestId = 'enable-collective-freight-custody-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (!this.state.collectives || !this.state.world.logistics?.custody)
      return this.failure('freight-custody-and-collectives-required');
    if (this.state.world.logistics.custody.collectiveGrantsVersion)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const event = enableCollectiveFreightCustodyEvent({
      projection: this.state.world,
      actorId: 'system',
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
    });
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-collective-freight-custody',
      { worldEvents: [event] },
      { enabled: true, version: FREIGHT_CUSTODY_COLLECTIVE_VERSION },
    );
  }
  enableFreightCustody(): OpenToolResult {
    const requestId = 'enable-freight-custody-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (!this.state.world.logistics) return this.failure('logistics-not-enabled');
    if (this.state.world.logistics.custody)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const event = enableResidentFreightCustodyEvent({
      projection: this.state.world,
      actorId: 'system',
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
    });
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-freight-custody',
      { worldEvents: [event] },
      {
        enabled: true,
        version: FREIGHT_CUSTODY_HANDOFF_VERSION,
        scope: 'personal-stationary-handoff',
      },
    );
  }
  enableLogistics(): OpenToolResult {
    const requestId = 'enable-logistics-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.logistics)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentLogisticsEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
      policy: LOGISTICS_POLICY,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-logistics',
      { worldEvents: d.events },
      { enabled: true, version: LOGISTICS_POLICY.version, endowedVehicles: 0 },
    );
  }
  enableFacilityUse(): OpenToolResult {
    const requestId = 'enable-premises-facility-use-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.premises?.facilityUsePolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentFacilityUseEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId,
      nextSequence: this.state.worldSequence + 1,
      policy: PREMISES_FACILITY_USE_POLICY,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      requestId,
      'system.enable-facility-use',
      { worldEvents: d.events },
      { enabled: true, version: PREMISES_FACILITY_USE_POLICY.version },
    );
  }
  enablePremises(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-premises-v1');
    if (cached) return cached.result;
    if (this.state.world.premises)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentPremisesEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId: 'enable-premises-v1',
      nextSequence: this.state.worldSequence + 1,
      policy: PREMISES_POLICY,
      landUsePolicy: PUBLIC_LAND_USE_POLICY,
      sites: [],
      facilityUsePolicy: PREMISES_FACILITY_USE_POLICY,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      'enable-premises-v1',
      'system.enable-premises',
      { worldEvents: d.events },
      { enabled: true, version: PREMISES_POLICY.version, seededSites: 0 },
    );
  }
  enableMaterials(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-materials-v1');
    if (cached) return cached.result;
    if (this.state.world.materials)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const event = enableResidentMaterialsEvent({
      simulationId: this.manifest.simulationId,
      requestId: 'enable-materials-v1',
      nextSequence: this.state.worldSequence + 1,
      at: this.state.world.clock.now,
      policy: MATERIALS_POLICY,
    });
    return this.systemCommit(
      'system',
      'enable-materials-v1',
      'system.enable-materials',
      { worldEvents: [event] },
      { enabled: true, version: MATERIALS_POLICY.version },
    );
  }
  enableGroupControl(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-group-control-v1');
    if (cached) return cached.result;
    if (!this.state.communication || !this.state.resourceControlPolicy)
      return this.failure('group-control-requires-communication-and-resource-control');
    if (this.state.communication.groupControlPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-group-control-v1',
      'system.enable-group-control',
      { communicationEvents: [{ type: 'GroupControlEnabled', policy: GROUP_CONTROL_POLICY }] },
      { enabled: true, version: GROUP_CONTROL_POLICY.version },
    );
  }
  enableResourceControl(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-resource-control-v1');
    if (cached) return cached.result;
    if (this.state.resourceControlPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-resource-control-v1',
      'system.enable-resource-control',
      { resourceControlEnabled: RESOURCE_CONTROL_POLICY },
      { enabled: true, version: RESOURCE_CONTROL_POLICY.version },
    );
  }
  enableProgramReactions(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-program-reactions-v1');
    if (cached) return cached.result;
    if (!this.state.coordination?.conditionsPolicy)
      return this.failure('program-conditions-not-enabled');
    if (this.state.coordination.reactions)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-program-reactions-v1',
      'system.enable-program-reactions',
      {
        coordinationEvents: [{ type: 'ProgramReactionsEnabled', policy: PROGRAM_REACTIONS_POLICY }],
      },
      { enabled: true, version: PROGRAM_REACTIONS_POLICY.version },
    );
  }
  enableProgramConditions(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-program-conditions-v1');
    if (cached) return cached.result;
    if (!this.state.coordination) return this.failure('coordination-not-enabled');
    if (this.state.coordination.conditionsPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-program-conditions-v1',
      'system.enable-program-conditions',
      {
        coordinationEvents: [
          { type: 'ProgramConditionsEnabled', policy: PROGRAM_CONDITIONS_POLICY },
        ],
      },
      { enabled: true, version: PROGRAM_CONDITIONS_POLICY.version },
    );
  }
  enableProgramActions(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-program-actions-v2');
    if (cached) return cached.result;
    if (!this.state.coordination) return this.failure('coordination-not-enabled');
    if (this.state.coordination.actionsPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-program-actions-v2',
      'system.enable-program-actions',
      { coordinationEvents: [{ type: 'ProgramActionsEnabled', policy: PROGRAM_ACTIONS_POLICY }] },
      {
        enabled: true,
        version: PROGRAM_ACTIONS_POLICY.version,
        execution: PROGRAM_ACTIONS_POLICY.execution,
      },
    );
  }
  enableEnterprisePrograms(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-program-actions-v3');
    if (cached) return cached.result;
    if (!this.state.coordination) return this.failure('coordination-not-enabled');
    if (!this.state.resourceControlPolicy) return this.failure('resource-control-not-enabled');
    const prior = this.state.coordination.actionsPolicy;
    if (prior?.version === ENTERPRISE_PROGRAM_ACTIONS_POLICY.version)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-program-actions-v3',
      'system.enable-enterprise-programs',
      {
        coordinationEvents: [
          prior
            ? {
                type: 'ProgramActionsUpgraded',
                fromVersion: prior.version,
                policy: ENTERPRISE_PROGRAM_ACTIONS_POLICY,
              }
            : { type: 'ProgramActionsEnabled', policy: ENTERPRISE_PROGRAM_ACTIONS_POLICY },
        ],
      },
      {
        enabled: true,
        version: ENTERPRISE_PROGRAM_ACTIONS_POLICY.version,
        preservesPriorPrograms: true,
      },
    );
  }
  enablePhysicalProduction(declaration?: unknown): OpenToolResult {
    let declared: ReturnType<typeof parseMaterialEndowment> | undefined;
    try {
      if (declaration !== undefined) declared = parseMaterialEndowment(declaration);
      if (
        this.manifest.canonicalPolicyContinuation &&
        !declared &&
        !this.state.world.materials?.extraction
      )
        return this.failure('canonical-material-endowment-declaration-required');
      if (declared && this.state.world.materials?.extraction) {
        const old = this.state.world.materials.extraction;
        const initialSources = Object.values(old.sources)
          .map((s) => ({
            id: s.id,
            locationId: s.locationId,
            commodity: s.commodity,
            initialQuantity: s.initialQuantity,
            workMs: s.workMs,
            energyCost: s.energyCost,
            satietyCost: s.satietyCost,
            capacity: s.capacity,
          }))
          .sort((a, b) => a.id.localeCompare(b.id, 'en'));
        if (
          !publicEqual(old.origin, declared.origin) ||
          !publicEqual(
            initialSources,
            [...declared.sources].sort((a, b) => a.id.localeCompare(b.id, 'en')),
          )
        )
          return this.failure('material-endowment-declaration-conflict');
      }
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-material-endowment-declaration',
      );
    }
    const cached = this.journal.lookup('system', 'enable-physical-production-v1');
    if (cached) return cached.result;
    if (this.state.world.materials?.extraction)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    try {
      const event = enableResidentExtractionEvent({
        projection: this.state.world,
        policies: this.policies(),
        sources: declared?.sources ?? seedOpenMaterialSources(this.state.world),
        ...(declared ? { origin: declared.origin } : {}),
        requestId: 'enable-physical-production-v1',
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        'enable-physical-production-v1',
        'system.enable-physical-production',
        { worldEvents: [event] },
        { enabled: true, version: MATERIAL_EXTRACTION_POLICY.version },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-physical-production-activation',
      );
    }
  }
  enableElapsedRest(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-elapsed-rest-v1');
    if (cached) return cached.result;
    if (this.state.world.residentRest)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    let event: WorldEvent;
    try {
      event = enableResidentRestEvent({
        projection: this.state.world,
        policies: this.policies(),
        simulationId: this.manifest.simulationId,
        requestId: 'enable-elapsed-rest-v1',
        nextSequence: this.state.worldSequence + 1,
      });
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'invalid-rest-activation');
    }
    return this.systemCommit(
      'system',
      'enable-elapsed-rest-v1',
      'system.enable-elapsed-rest',
      { worldEvents: [event] },
      { enabled: true, version: 'resident-rest-v1' },
    );
  }
  enableElapsedStudy(): OpenToolResult {
    const requestId = 'enable-elapsed-study-v1';
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.residentStudy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableResidentStudyEvent({
        projection: this.state.world,
        policies: this.policies(),
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-elapsed-study',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-elapsed-study-v1' },
      );
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'invalid-study-activation');
    }
  }
  enablePublicLabor(): OpenToolResult {
    const requestId = 'enable-public-labor-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.publicLabor)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enablePublicLaborEvent({
        projection: this.state.world,
        policies: this.policies(),
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-public-labor',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-public-labor-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-public-labor-activation',
      );
    }
  }
  enableServiceEmployment(): OpenToolResult {
    const requestId = 'enable-service-employment-v1',
      cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.serviceEmployment)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableServiceEmploymentEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-service-employment',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-service-employment-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-employment-activation',
      );
    }
  }
  enableServiceTime(): OpenToolResult {
    const requestId = 'enable-service-time-v1';
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.serviceTime)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableServiceTimeEvent({
        projection: this.state.world,
        policies: this.policies(),
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-service-time',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-service-time-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-time-activation',
      );
    }
  }
  enableEducationAuthority(): OpenToolResult {
    const requestId = 'enable-education-authority-v1';
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.educationAuthority)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableEducationAuthorityEvent({
        projection: this.state.world,
        policies: this.policies(),
        mode: 'legacy',
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-education-authority',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-education-authority-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-education-authority-activation',
      );
    }
  }
  enableProductiveEmployment(): OpenToolResult {
    const requestId = 'enable-productive-employment-v1';
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (this.state.world.productiveEmployment)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableProductiveEmploymentEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-productive-employment',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-productive-employment-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-productive-employment-activation',
      );
    }
  }
  enableAgreedLabor(): OpenToolResult {
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    return this.enableElapsedLabor(true);
  }
  enableElapsedLabor(agreed = false): OpenToolResult {
    const requestId = agreed ? 'enable-agreed-labor-v1' : 'enable-elapsed-labor-v1';
    const cached = this.journal.lookup('system', requestId);
    if (cached) return cached.result;
    if (
      agreed &&
      this.state.world.residentLabor &&
      this.state.world.residentLabor.configuration.compensationSource !==
        'accepted-enterprise-labor-terms-v1'
    )
      return this.failure('existing-labor-mode-requires-explicit-transition');
    if (this.state.world.residentLabor)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableResidentLaborEvent({
        projection: this.state.world,
        policies: this.policies(),
        ...(agreed ? { compensationSource: 'accepted-enterprise-labor-terms-v1' as const } : {}),
        simulationId: this.manifest.simulationId,
        requestId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-elapsed-labor',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-enterprise-labor-v1' },
      );
    } catch (error) {
      return this.failure(error instanceof Error ? error.message : 'invalid-labor-activation');
    }
  }
  enableResourceAdapters(declaration: unknown): OpenToolResult {
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    try {
      const kinds = parseResourceAdapterKinds(declaration);
      if (kinds.every((k) => this.state.world.resourceAdapters?.kinds.includes(k)))
        return {
          ok: true,
          data: { alreadyEnabled: true, policy: this.state.world.resourceAdapters },
          revision: this.state.revision,
          simulationTime: this.state.world.clock.now,
        };
      const requestId = `enable-resource-adapters-${digest(kinds).slice(0, 32)}`;
      const event = enableResourceAdaptersEvent({
        projection: this.state.world,
        kinds,
        requestId,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        requestId,
        'system.enable-resource-adapters',
        { worldEvents: [event] },
        { policy: event.type === 'ResidentResourceAdaptersEnabled' ? event.payload : null },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-resource-adapters-activation',
      );
    }
  }
  enableResourcePrincipals(): OpenToolResult {
    const id = 'enable-resource-principals-v2',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.materials?.resourcePrincipals)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableResourcePrincipalsEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId: id,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-resource-principals',
        { worldEvents: [event] },
        { enabled: true, version: RESOURCE_PRINCIPAL_POLICY.version },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-resource-principals-activation',
      );
    }
  }
  enableServicePrincipals(): OpenToolResult {
    const id = 'enable-service-principals-v2',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.services?.principalPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (!this.state.services) return this.failure('services-not-enabled');
    try {
      const event = enableServicePrincipalsEvent({
        projection: this.state.world,
        directory: this.state.services,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-service-principals',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-service-principals-v2' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-principals-activation',
      );
    }
  }
  enableServiceClosure(): OpenToolResult {
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    const id = 'enable-independent-service-closure-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.serviceClosurePolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true, policy: this.state.world.serviceClosurePolicy },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (!this.state.services) return this.failure('services-not-enabled');
    try {
      const event = enableServiceClosureEvent({
        projection: this.state.world,
        directory: this.state.services,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-service-closure',
        { worldEvents: [event] },
        { enabled: true, version: 'independent-service-closure-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-closure-activation',
      );
    }
  }
  enableIndependentServicePrincipals(): OpenToolResult {
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    const id = 'enable-independent-service-principals-v3';
    const cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (!this.state.services) return this.failure('services-not-enabled');
    if (this.state.services.principalPolicy?.version === 'resident-service-principals-v3')
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = separateServiceAuthorityEvent({
        projection: this.state.world,
        directory: this.state.services,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      if (event.type !== 'ResidentServicePrincipalsCommitted')
        throw Error('invalid-service-separation-event');
      const nextDirectory = event.payload.events.reduce(
        applyServicePrincipalEvent,
        this.state.services,
      );
      const closure = this.state.world.serviceClosurePolicy
        ? []
        : [
            enableServiceClosureEvent({
              projection: this.state.world,
              directory: nextDirectory,
              requestId: id,
              simulationId: this.manifest.simulationId,
              nextSequence: this.state.worldSequence + 2,
            }),
          ];
      return this.systemCommit(
        'system',
        id,
        'system.enable-independent-service-principals',
        { worldEvents: [event, ...closure] },
        { enabled: true, version: 'resident-service-principals-v3' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error
          ? error.message
          : 'invalid-independent-service-principals-activation',
      );
    }
  }
  enableServiceSupply(): OpenToolResult {
    const id = 'enable-service-supply-v3',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.services?.registration)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (!this.state.services) return this.failure('services-not-enabled');
    try {
      const event = enableServiceSupplyEvent({
        projection: this.state.world,
        directory: this.state.services,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-service-supply',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-service-supply-v3' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-supply-activation',
      );
    }
  }
  enableServiceAffiliations(): OpenToolResult {
    const id = 'enable-service-affiliations-v4',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.services?.affiliations)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (!this.state.services) return this.failure('services-not-enabled');
    try {
      const event = enableServiceAffiliationsEvent({
        projection: this.state.world,
        directory: this.state.services,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-service-affiliations',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-service-affiliation-v4' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-affiliations-activation',
      );
    }
  }
  enableServiceSupplyRelations(): OpenToolResult {
    const id = 'enable-service-supply-relations-v5',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.services?.relationPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (!this.state.services) return this.failure('services-not-enabled');
    try {
      const event = enableServiceSupplyRelationsEvent({
        projection: this.state.world,
        directory: this.state.services,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-service-supply-relations',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-service-supply-relations-v5' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-service-supply-relations-activation',
      );
    }
  }
  enableVehiclePrincipals(): OpenToolResult {
    const id = 'enable-vehicle-principals-v2',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.residentMobility?.principalPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableVehiclePrincipalsEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId: id,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-vehicle-principals',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-vehicle-principals-v2' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-vehicle-principals-activation',
      );
    }
  }
  enablePeriodicAccess(): OpenToolResult {
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    const id = 'enable-independent-periodic-access-v1';
    const cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.periodicAccess)
      return {
        ok: true,
        data: { alreadyEnabled: true, policy: this.state.world.periodicAccess },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enablePeriodicAccessEvent({
        projection: this.state.world,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-periodic-access',
        { worldEvents: [event] },
        { enabled: true, version: 'independent-periodic-access-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-periodic-access-activation',
      );
    }
  }
  enablePeriodicObligations(): OpenToolResult {
    const id = 'enable-periodic-obligations-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.periodicObligations)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enablePeriodicObligationsEvent({
      projection: this.state.world,
      requestId: id,
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      id,
      'system.enable-periodic-obligations',
      { worldEvents: d.events },
      { enabled: true, version: 'resident-periodic-obligations-v1' },
    );
  }
  enableResourceSales(): OpenToolResult {
    const id = 'enable-resource-sales-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.resourceSales)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResourceSalesEvent({
      projection: this.state.world,
      requestId: id,
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      id,
      'system.enable-resource-sales',
      { worldEvents: d.events },
      { enabled: true, version: 'resident-resource-sales-v1' },
    );
  }
  enableResourceSalesV2(): OpenToolResult {
    const id = 'enable-resource-sales-v2',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.resourceSales?.policy.version === 'resident-resource-sales-v2')
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = extendResourceSalesEvent({
      projection: this.state.world,
      requestId: id,
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      id,
      'system.enable-resource-sales-v2',
      { worldEvents: d.events },
      { enabled: true, version: 'resident-resource-sales-v2' },
    );
  }
  enableConstructionTrade(): OpenToolResult {
    const id = 'enable-construction-trade-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.residentTrade?.constructionOrders)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enableResidentConstructionTradeEvent({
      projection: this.state.world,
      requestId: id,
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
      enablePublicAuthority: true,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      id,
      'system.enable-construction-trade',
      { worldEvents: d.events },
      { enabled: true, version: CONSTRUCTION_TRADE_POLICY.version },
    );
  }
  enablePrincipalTrade(): OpenToolResult {
    const id = 'enable-principal-trade-v3',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.residentTrade?.principalOrders)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const d = enablePrincipalEvidenceTradeEvent({
      projection: this.state.world,
      requestId: id,
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
    });
    if (!d.accepted) return this.failure(d.reason);
    return this.systemCommit(
      'system',
      id,
      'system.enable-principal-trade',
      { worldEvents: d.events },
      { enabled: true, version: PRINCIPAL_EVIDENCE_TRADE_POLICY.version },
    );
  }
  enablePrincipalPermits(): OpenToolResult {
    const id = 'enable-principal-permits-v2',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.premisesRights?.principalPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const e = enablePrincipalPremisesRightsEvent({
        projection: this.state.world,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-principal-permits',
        { worldEvents: [e] },
        { enabled: true, version: 'resident-premises-principal-permits-v2' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-principal-permits-activation',
      );
    }
  }
  enablePremisesPrincipals(): OpenToolResult {
    const id = 'enable-premises-principals-v2',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.premises?.resourcePrincipals)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const e = enablePremisesPrincipalsEvent({
        projection: this.state.world,
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-premises-principals',
        { worldEvents: [e] },
        { enabled: true, version: 'premises-resource-principals-v2' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-premises-principals-activation',
      );
    }
  }
  enablePhysicalHousingRest(): OpenToolResult {
    const id = 'enable-physical-housing-rest-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.physicalHousingRest)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enablePhysicalHousingRestEvent({
        projection: this.state.world,
        simulationId: this.manifest.simulationId,
        requestId: id,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-physical-housing-rest',
        { worldEvents: [event] },
        { enabled: true, version: PHYSICAL_HOUSING_REST_POLICY.version },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-physical-housing-activation',
      );
    }
  }
  enableHousingOccupancy(): OpenToolResult {
    const id = 'enable-housing-occupancy-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.housingOccupancy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const event = enableHousingOccupancyEvent({
      projection: this.state.world,
      simulationId: this.manifest.simulationId,
      requestId: id,
      nextSequence: this.state.worldSequence + 1,
    });
    return this.systemCommit(
      'system',
      id,
      'system.enable-housing-occupancy',
      { worldEvents: [event] },
      { enabled: true, version: HOUSING_OCCUPANCY_POLICY.version },
    );
  }
  enablePublicHousing(): OpenToolResult {
    const id = 'enable-public-housing-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.publicHousing)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enablePublicHousingEvent({
        projection: this.state.world,
        policies: this.policies(),
        simulationId: this.manifest.simulationId,
        requestId: id,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-public-housing',
        { worldEvents: [event] },
        { enabled: true, version: PUBLIC_HOUSING_POLICY.version },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-public-housing-activation',
      );
    }
  }
  enableHousingChoice(): OpenToolResult {
    const id = 'enable-housing-choice-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.housingChoice)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableHousingChoiceEvent({
        projection: this.state.world,
        policies: this.policies(),
        simulationId: this.manifest.simulationId,
        requestId: id,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-housing-choice',
        { worldEvents: [event] },
        { enabled: true, version: HOUSING_CHOICE_POLICY.version },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-housing-choice-activation',
      );
    }
  }
  enableCapitalAgreements(): OpenToolResult {
    const id = 'enable-capital-agreements-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.capitalAgreements)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const event = enableResidentCapitalEvent({
      projection: this.state.world,
      requestId: id,
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
    });
    return this.systemCommit(
      'system',
      id,
      'system.enable-capital-agreements',
      { worldEvents: [event] },
      { enabled: true, version: CAPITAL_AGREEMENTS_POLICY.version },
    );
  }
  enablePublicEmployment(): OpenToolResult {
    const id = 'enable-public-employment-v1',
      cached = this.journal.lookup('system', id);
    if (cached) return cached.result;
    if (this.state.world.publicEmployment)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enablePublicEmploymentEvent({
        projection: this.state.world,
        policies: openWorldPolicies(
          this.manifest.seed,
          this.state.world,
          this.manifest.rhythm,
          this.manifest.canonicalPolicyContinuation,
        ),
        requestId: id,
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        id,
        'system.enable-public-employment',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-public-employment-rules-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-public-employment-activation',
      );
    }
  }
  enablePublicGovernance(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-public-governance-v1');
    if (cached) return cached.result;
    if (this.state.world.publicGovernance)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const seed = seedPublicGovernance(this.state.world);
    const event = enableResidentPublicGovernanceEvent({
      projection: this.state.world,
      requestId: 'enable-public-governance-v1',
      simulationId: this.manifest.simulationId,
      nextSequence: this.state.worldSequence + 1,
      grant: seed.authority.grant,
      procedure: seed.authority.procedure,
      institutionPolicy: seed.institutionPolicy,
    });
    return this.systemCommit(
      'system',
      'enable-public-governance-v1',
      'system.enable-public-governance',
      { worldEvents: [event] },
      { enabled: true, version: PUBLIC_GOVERNANCE_POLICY.version },
    );
  }
  enablePublicProcurement(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-public-procurement-v1');
    if (cached) return cached.result;
    if (this.state.world.publicGovernance?.authority.grant.procurement)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableResidentPublicProcurementEvent({
        projection: this.state.world,
        requestId: 'enable-public-procurement-v1',
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        'enable-public-procurement-v1',
        'system.enable-public-procurement',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-public-procurement-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-public-procurement-activation',
      );
    }
  }
  enablePublicGoodsProcurement(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-public-goods-procurement-v1');
    if (cached) return cached.result;
    if (this.state.world.publicGovernance?.authority.grant.goodsProcurement)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    try {
      const event = enableResidentPublicGoodsProcurementEvent({
        projection: this.state.world,
        requestId: 'enable-public-goods-procurement-v1',
        simulationId: this.manifest.simulationId,
        nextSequence: this.state.worldSequence + 1,
      });
      return this.systemCommit(
        'system',
        'enable-public-goods-procurement-v1',
        'system.enable-public-goods-procurement',
        { worldEvents: [event] },
        { enabled: true, version: 'resident-public-goods-procurement-v1' },
      );
    } catch (error) {
      return this.failure(
        error instanceof Error ? error.message : 'invalid-public-goods-procurement-activation',
      );
    }
  }
  upgradeServiceProviders(): OpenToolResult {
    const cached = this.journal.lookup('system', 'upgrade-service-providers-v1');
    if (cached) return cached.result;
    if (
      Object.values(this.state.residents).some(
        (r) =>
          r.activeTurnId !== undefined &&
          !this.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
      )
    )
      return this.failure('resident-turn-active');
    if (!this.state.services) return this.failure('services-not-enabled');
    const d = decideServicePolicyUpgrade(this.state.services, this.state.world.clock.now);
    if (!d.accepted) return this.failure(d.reason);
    if (!d.events.length)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'upgrade-service-providers-v1',
      'system.upgrade-service-providers',
      { servicesEvents: d.events },
      { enabled: true, version: 'resident-services-v3' },
    );
  }
  enableServiceControl(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-service-control-v1');
    if (cached) return cached.result;
    if (!this.state.services || !this.state.resourceControlPolicy)
      return this.failure('service-control-requires-services-and-resource-control');
    if (this.state.services.policy.version !== 'resident-services-v3')
      return this.failure('service-control-requires-recorded-providers');
    if (this.state.services.controlPolicy)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-service-control-v1',
      'system.enable-service-control',
      { servicesEvents: [{ type: 'ServiceControlEnabled', policy: SERVICE_CONTROL_POLICY }] },
      { enabled: true, version: SERVICE_CONTROL_POLICY.version },
    );
  }
  enableCommonAccounts(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-common-accounts-v1');
    if (cached) return cached.result;
    if (!this.state.collectives) return this.failure('collectives-not-enabled');
    if (this.state.world.commonAccounts)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-common-accounts-v1',
      'system.enable-common-accounts',
      {
        worldEvents: [
          enableCommonAccountsEvent({
            simulationId: this.manifest.simulationId,
            requestId: 'enable-common-accounts-v1',
            nextSequence: this.state.worldSequence + 1,
            at: this.state.world.clock.now,
            policy: COMMON_ACCOUNTS_POLICY,
          }),
        ],
      },
      { enabled: true, version: COMMON_ACCOUNTS_POLICY.version },
    );
  }
  enableCollectives(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-collectives-v1');
    if (cached) return cached.result;
    if (this.state.collectives)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-collectives-v1',
      'system.enable-collectives',
      { collectiveEvents: [{ type: 'CollectivesEnabled', policy: COLLECTIVES_POLICY }] },
      { enabled: true, version: COLLECTIVES_POLICY.version },
    );
  }
  enableRecordViews(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-record-views-v1');
    if (cached) return cached.result;
    if (!this.state.sharedRecords) return this.failure('shared-records-not-enabled');
    if (this.state.recordViews)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.systemCommit(
      'system',
      'enable-record-views-v1',
      'system.enable-record-views',
      { recordViewEvents: [{ type: 'RecordViewsEnabled', policy: RECORD_VIEWS_POLICY }] },
      { enabled: true, version: RECORD_VIEWS_POLICY.version },
    );
  }
  enableSocietyKernel(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-society-kernel-v1');
    if (cached) return cached.result;
    if (this.state.sharedRecords && this.state.coordination)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    if (this.state.sharedRecords || this.state.coordination)
      throw new Error('partial-society-kernel-state');
    return this.systemCommit(
      'system',
      'enable-society-kernel-v1',
      'system.enable-society-kernel',
      {
        sharedRecordsEvents: [
          { type: 'SharedRecordsEnabled', policy: SOCIETY_KERNEL_POLICY.records },
        ],
        coordinationEvents: [
          { type: 'CoordinationEnabled', policy: SOCIETY_KERNEL_POLICY.coordination },
        ],
      },
      { enabled: true, version: SOCIETY_KERNEL_POLICY.version },
    );
  }
  enableLife(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-life-v1');
    if (cached) return cached.result;
    if (this.state.life)
      return {
        ok: true,
        data: { alreadyEnabled: true },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    const effects: OpenSocietyEffects = {
      lifeEnabled: 'resident-life-v1',
      ...(this.state.distribution
        ? {}
        : {
            distributionEvents: [
              { type: 'DistributionEnabled', policy: DEFAULT_DISTRIBUTION_POLICY },
            ],
          }),
      ...(this.state.communication
        ? {}
        : {
            communicationEvents: [{ type: 'CommunicationEnabled', policy: COMMUNICATION_POLICY }],
          }),
      ...(this.state.collaboration
        ? {}
        : {
            collaborationEvents: [{ type: 'CollaborationEnabled', policy: COLLABORATION_POLICY }],
          }),
      ...(this.state.services
        ? {}
        : { servicesEvents: [{ type: 'ServicesEnabled', policy: SERVICES_POLICY }] }),
      ...(this.state.world.residentCommerce
        ? {}
        : {
            worldEvents: [
              enableResidentCommerceEvent({
                simulationId: this.manifest.simulationId,
                requestId: 'enable-life-v1',
                nextSequence: this.state.worldSequence + 1,
                at: this.state.world.clock.now,
                policy: COMMERCE_POLICY,
              }),
            ],
          }),
    };
    const next = applyOpenSocietyEffects(this.state, effects);
    return this.journal.commit({
      actorId: 'system',
      requestId: 'enable-life-v1',
      fingerprint: digest(effects),
      capability: 'system.enable-life',
      effects,
      result: {
        ok: true,
        data: {
          enabled: 'resident-life-v1',
          lifePolicies: RESIDENT_LIFE_POLICIES,
          worldPolicies: serializableWorldPolicy(
            this.manifest.seed,
            next.world,
            this.manifest.rhythm,
            this.manifest.canonicalPolicyContinuation,
          ),
        },
        revision: this.state.revision + 1,
        simulationTime: next.world.clock.now,
      },
    });
  }
  enableDistribution(): OpenToolResult {
    const cached = this.journal.lookup('system', 'enable-distribution-v1');
    if (cached !== undefined) return cached.result;
    if (this.state.distribution !== undefined)
      return {
        ok: true,
        data: { alreadyEnabled: true, version: this.state.distribution.policy.version },
        revision: this.state.revision,
        simulationTime: this.state.world.clock.now,
      };
    return this.journal.commit({
      actorId: 'system',
      requestId: 'enable-distribution-v1',
      fingerprint: digest(DEFAULT_DISTRIBUTION_POLICY),
      capability: 'system.enable-distribution',
      effects: {
        distributionEvents: [{ type: 'DistributionEnabled', policy: DEFAULT_DISTRIBUTION_POLICY }],
      },
      result: {
        ok: true,
        data: { enabled: true, version: DEFAULT_DISTRIBUTION_POLICY.version },
        revision: this.state.revision + 1,
        simulationTime: this.state.world.clock.now,
      },
    });
  }
  installCityApps(): OpenToolResult {
    const requestId = `install-${CITY_APPS_VERSION}`;
    const cached = this.journal.lookup('city-services', requestId);
    if (cached !== undefined) return cached.result;
    if (this.state.cityApps !== undefined) throw new Error('city-app-upgrade-requires-migration');
    const effects = prepareCityAppInstallation(this.state, this.manifest);
    return this.journal.commit({
      actorId: 'city-services',
      requestId,
      fingerprint: digest({ version: CITY_APPS_VERSION, effects }),
      capability: 'system.install-city-apps',
      effects,
      result: {
        ok: true,
        data: { ...effects.cityApps, sourceDigest: digest(effects.informationEvents) },
        revision: this.state.revision + 1,
        simulationTime: this.state.world.clock.now,
      },
    });
  }
  context(actorId: string) {
    return buildOpenResidentContext(this.state, this.manifest, actorId, this.policies());
  }
  discover(query = '') {
    const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matching = OPEN_SOCIETY_TOOLS.filter((tool) =>
      words.every((word) =>
        `${tool.name} ${tool.category} ${tool.description}`.toLocaleLowerCase().includes(word),
      ),
    );
    return {
      catalogVersion: OPEN_CAPABILITY_CATALOG_VERSION,
      total: matching.length,
      tools: matching.map((tool) => ({
        ...tool,
        availability: boundaryAvailability(tool, this.state),
      })),
      note: 'Schemas describe registered contracts, including disabled adapters. Check availability.adapterEnabled; permission, policy and resource checks still occur on each call.',
    };
  }
  beginTurn(actorId: string, reason?: string): ResidentTurn {
    this.requireResident(actorId);
    const resident = this.state.residents[actorId]!;
    const previous =
      resident.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (previous?.status === 'running') return previous;
    const id = `turn-${this.state.revision + 1}-${actorId}`;
    const at = this.state.world.clock.now;
    const turn: ResidentTurn = {
      id,
      actorId,
      startedAt: at,
      reason: reason ?? resident.wakeReason,
      calls: 0,
      status: 'running',
      summary: '',
      nextWakeAt:
        at + (resident.freeActivityIntervalMs ?? this.manifest.policy.freeActivityIntervalMs),
    };
    this.systemCommit(
      actorId,
      id,
      'turn.started',
      {
        turns: [turn],
        residents: [
          {
            ...resident,
            activeTurnId: id,
            lastTurnOrdinal: this.state.revision + 1,
            wakeReason: 'turn-active',
          },
        ],
      },
      turn,
    );
    return turn;
  }
  finishTurn(
    actorId: string,
    input: {
      summary: string;
      status?: 'completed' | 'provider-error';
      sessionId?: string;
      /**
       * The provider failed before the resident made any call: keep their wake time and reason so
       * the same opportunity is retried, instead of pushing them a whole interval later. Callers
       * that pass this must back off between retries themselves.
       */
      requeue?: true;
    },
  ): ResidentTurn {
    const resident = this.state.residents[actorId];
    const turn =
      resident?.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (resident === undefined || turn === undefined) throw new ToolRefusal('no-active-turn');
    if (input.requeue && input.status === 'provider-error' && turn.calls === 0) {
      const failed: ResidentTurn = {
        ...turn,
        status: 'provider-error',
        summary: input.summary.slice(0, 4000),
        nextWakeAt: resident.nextWakeAt,
        requeued: true,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      };
      // beginTurn marked the resident `turn-active`; restore why they were woken, unless a
      // message arrived meanwhile (it keeps its own reason, as in a normal finish).
      const restored = {
        ...resident,
        wakeReason: resident.wakeReason === 'turn-active' ? turn.reason : resident.wakeReason,
      };
      this.systemCommit(
        actorId,
        `${turn.id}-finished`,
        'turn.finished',
        { turns: [failed], residents: [restored] },
        failed,
      );
      return failed;
    }
    const status =
      input.status === 'provider-error'
        ? 'provider-error'
        : turn.status === 'waiting' || turn.status === 'budget-exhausted'
          ? turn.status
          : (input.status ?? 'completed');
    const plannedWakeAt =
      turn.status === 'waiting'
        ? turn.nextWakeAt
        : Math.max(
            this.state.world.clock.now +
              (resident.freeActivityIntervalMs ?? this.manifest.policy.freeActivityIntervalMs),
            // With attention pacing, nobody is polled in the middle of their own sleep, work or
            // journey; its completion wakes them anyway.
            this.manifest.policy.messageWake?.deferDuringActivity
              ? residentBusyUntil(this.state, actorId)
              : 0,
          );
    // A message that arrived during this opportunity wakes the resident again: immediately in
    // historical manifests, or paced (never later than their own planned wake) when enabled.
    const nextWakeAt = resident.wakeReason.startsWith('message:')
      ? this.manifest.policy.messageWake
        ? Math.min(
            plannedWakeAt,
            messageWakeAt(this.state, this.manifest.policy, resident, this.state.world.clock.now),
          )
        : this.state.world.clock.now
      : plannedWakeAt;
    const next: ResidentTurn = {
      ...turn,
      status,
      summary: (input.status === 'provider-error' && turn.status === 'waiting' && turn.summary
        ? turn.summary
        : input.summary || turn.summary
      ).slice(0, 4000),
      ...(input.status === 'provider-error' &&
      turn.status === 'waiting' &&
      turn.summary &&
      input.summary
        ? { providerSummary: input.summary.slice(0, 4000) }
        : {}),
      nextWakeAt,
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    };
    this.systemCommit(
      actorId,
      `${turn.id}-finished`,
      'turn.finished',
      {
        turns: [next],
        residents: [
          {
            ...resident,
            nextWakeAt,
            wakeReason: resident.wakeReason.startsWith('message:')
              ? resident.wakeReason
              : 'free-activity',
          },
        ],
      },
      next,
    );
    this.runDuePlans();
    return next;
  }
  /**
   * Carry out queued action-plan steps for every resident who is idle, not in a live opportunity
   * and not holding an unanswered paced message. Each step is an ordinary authorized call committed
   * under the resident's identity; plan progress is committed separately. Deterministic request IDs
   * make a retried run reuse the journaled results instead of acting twice.
   */
  runDuePlans(): void {
    if (!this.state.actionPlans) return;
    const ids = Object.keys(this.state.residents).sort((a, b) => a.localeCompare(b, 'en'));
    for (const actorId of ids) this.runPlan(actorId);
  }
  private runPlan(actorId: string) {
    for (let guard = 0; guard <= (this.state.actionPlans?.maxSteps ?? 0); guard++) {
      const resident = this.state.residents[actorId]!;
      const plan = resident.plan;
      const now = this.state.world.clock.now;
      if (plan?.status !== 'active') return;
      const live = resident.activeTurnId && this.state.turns[resident.activeTurnId];
      if (live && live.status === 'running') return;
      if (residentBusyUntil(this.state, actorId) > now) return;
      if (resident.wakeReason.startsWith('message:') && resident.nextWakeAt <= now) return;
      const index = plan.next;
      const step = plan.steps[index]!;
      const requestId = `plan-${digest([actorId, plan.id, plan.createdRevision, index]).slice(0, 32)}`;
      let result: OpenToolResult;
      try {
        result = this.invoke(
          actorId,
          {
            name: step.capability,
            arguments: resolveActionPlanArguments(this.state, step, now),
            requestId,
          },
          { plan: true },
        );
      } catch (error) {
        if (!(error instanceof ToolRefusal)) throw error;
        result = this.failure(error.reason);
      }
      const after = this.state.residents[actorId]!;
      const done = index + 1 >= plan.steps.length;
      const stopped = !result.ok;
      const updated = {
        ...plan,
        next: stopped ? index : index + 1,
        status: stopped
          ? ('stopped' as const)
          : done
            ? ('completed' as const)
            : ('active' as const),
        lastResult: {
          step: index,
          capability: step.capability,
          ok: result.ok,
          ...(result.error === undefined ? {} : { error: result.error }),
          at: now,
        },
      };
      const busyUntil = residentBusyUntil(this.state, actorId);
      // Finishing or failing wakes the resident once they are free; a pending paced message keeps
      // its own earlier time. Otherwise the next step waits for the current activity to end.
      const wake =
        stopped || done
          ? {
              nextWakeAt: Math.min(
                after.wakeReason.startsWith('message:') ? after.nextWakeAt : Infinity,
                Math.max(now, busyUntil),
              ),
              wakeReason: stopped ? `plan-stopped:${result.error ?? 'refused'}` : 'plan-completed',
            }
          : after.wakeReason.startsWith('message:')
            ? {}
            : { nextWakeAt: Math.max(now, busyUntil), wakeReason: 'plan-step' };
      this.systemCommit(
        actorId,
        `${requestId}-progress`,
        'plan.progressed',
        { residents: [{ ...after, ...wake, plan: updated }] },
        { planId: plan.id, step: index, ok: result.ok, status: updated.status },
      );
      if (updated.status !== 'active' || busyUntil > now) return;
    }
  }
  nextResident(eligible?: ReadonlySet<string>): string | undefined {
    return Object.values(this.state.residents)
      .filter(
        (resident) =>
          (eligible === undefined || eligible.has(resident.actorId)) &&
          resident.nextWakeAt <= this.state.world.clock.now &&
          this.state.world.agents[resident.actorId] !== undefined,
      )
      .sort(
        (a, b) => a.lastTurnOrdinal - b.lastTurnOrdinal || a.actorId.localeCompare(b.actorId),
      )[0]?.actorId;
  }
  invoke(
    actorId: string,
    request: OpenToolRequest,
    /** `plan`: a queued step of the resident's own action plan, run without an opportunity. */
    options: { readonly plan?: true } = {},
  ): OpenToolResult {
    this.requireResident(actorId);
    if (!validInformationId(request.requestId)) return this.failure('invalid-request-id');
    if (this.journal.isHistoricalRequest(request.requestId))
      return this.failure('historical-request-id');
    const fingerprint = digest({ name: request.name, arguments: request.arguments });
    const cached = this.journal.lookup(actorId, request.requestId);
    if (cached !== undefined)
      return cached.fingerprint === fingerprint
        ? cached.result
        : this.failure('request-id-conflict');
    const resident = this.state.residents[actorId]!;
    const activeTurn =
      resident.activeTurnId === undefined ? undefined : this.state.turns[resident.activeTurnId];
    if (
      options.plan &&
      (!this.state.actionPlans ||
        !plannableCapabilities(this.state.actionPlans.version).has(request.name))
    )
      return this.failure('plan-step-not-plannable');
    const turn = options.plan ? undefined : activeTurn;
    if (!options.plan && (turn === undefined || turn.status !== 'running'))
      return this.failure('no-active-turn');
    if (turn !== undefined && turn.calls >= this.manifest.policy.maxCallsPerTurn) {
      this.systemCommit(
        actorId,
        `${turn.id}-budget`,
        'turn.budget-exhausted',
        { turns: [{ ...turn, status: 'budget-exhausted' }] },
        { status: 'budget-exhausted' },
      );
      return this.failure('turn-budget-exhausted');
    }
    let execution: ToolExecution = { data: null, effects: {} };
    let error: string | undefined;
    try {
      const definition = OPEN_SOCIETY_TOOLS.find((tool) => tool.name === request.name);
      if (definition === undefined) throw new ToolRefusal('unknown-capability');
      for (const [key, value] of Object.entries(request.arguments))
        if (
          (key === 'id' || key.endsWith('Id')) &&
          typeof value === 'string' &&
          Object.hasOwn(Object.prototype, value)
        )
          throw new ToolRefusal('reserved-record-id');
      const invalid = validateOpenToolArguments(definition, request.arguments);
      if (invalid !== undefined) throw new ToolRefusal(invalid);
      const args =
        definition.inputSchema.properties.limit === undefined
          ? request.arguments
          : {
              ...request.arguments,
              limit: Math.min(
                Number(request.arguments.limit ?? 10),
                this.manifest.policy.maxQueryItems,
              ),
            };
      if (request.name.startsWith('rules.'))
        execution = executeRulebookTool(
          this.state,
          this.manifest,
          OPEN_SOCIETY_TOOLS,
          request.name,
          args,
        );
      else if (request.name.startsWith('principals.'))
        execution = executeResourcePrincipalTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (['housing.occupancy', 'housing.leave'].includes(request.name))
        execution = executeHousingOccupancyTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (['housing.standard', 'housing.lower'].includes(request.name))
        execution = executeHousingChoiceTool(
          this.state,
          this.manifest,
          this.policies(),
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('governance.'))
        execution = executePublicGovernanceTool(
          this.state,
          this.manifest,
          this.policies(),
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (['business.labor-terms', 'business.change-labor-terms'].includes(request.name))
        execution = executeLaborTermsTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        ['sites.', 'construction.', 'premises.', 'materials.'].some((prefix) =>
          request.name.startsWith(prefix),
        )
      )
        execution = executePremisesTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        request.name.startsWith('stocks.') ||
        request.name.startsWith('production.') ||
        request.name.startsWith('sources.')
      )
        execution = executeMaterialTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('resources.'))
        execution = executeResourceControlTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('funds.'))
        execution = executeCommonAccountTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('collectives.'))
        execution = executeCollectiveTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('registers.') || request.name.startsWith('records.'))
        execution = executeSharedRecordTool(
          this.state,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('programs.') || request.name.startsWith('mandates.')) {
        const program = executeCoordinationTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
        execution = program;
        error = program.error;
      } else if (request.name === 'world.observe') {
        if (args.cursor !== undefined && args.view !== 'fiscal')
          throw new ToolRefusal('cursor-only-supported-for-fiscal-observation');
        if (
          args.view === 'fiscal' &&
          ['section', 'offset', 'limit'].some((key) => request.arguments[key] !== undefined)
        )
          throw new ToolRefusal('fiscal-observation-use-cursor');
        execution = {
          data:
            args.view === 'fiscal'
              ? readFiscalObservation({
                  treasury: this.state.world.treasury,
                  revision: this.state.revision,
                  commits: {
                    length: this.journal.commitCount,
                    at: (index) => this.journal.commitAt(index + 1),
                  },
                  ...(args.cursor === undefined ? {} : { cursor: stringArg(args, 'cursor') }),
                })
              : observeResidentWorld(this.state, this.manifest, actorId, this.policies(), args),
          effects: {},
        };
      } else if (request.name.startsWith('world.')) {
        const world = executeOpenWorldTool({
          state: this.state,
          manifest: this.manifest,
          policies: this.policies(),
          actorId,
          requestId: request.requestId,
          name: request.name,
          args,
        });
        execution = world;
        error = world.error;
      } else if (request.name.startsWith('memory.') || request.name.startsWith('cognition.'))
        execution = executeCognitionTool(
          this.state,
          actorId,
          request.name,
          args,
          this.manifest.cognitionVersion,
        );
      else if (request.name === 'housing.list')
        execution = executeLifeTool(this.state, actorId, request.name, args);
      else if (
        ['offers.', 'orders.', 'payments.', 'deposits.'].some((p) => request.name.startsWith(p))
      )
        execution = executeCommerceTool(
          this.state,
          this.manifest,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('proposals.') || request.name.startsWith('commitments.'))
        execution = executeCollaborationTool(
          this.state,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (
        request.name.startsWith('groups.') ||
        request.name.startsWith('blocks.') ||
        request.name === 'notifications.configure' ||
        request.name === 'notifications.settings'
      )
        execution = executeCommunicationTool(
          this.state,
          actorId,
          request.name,
          args,
          request.requestId,
        );
      else if (request.name.startsWith('schedule.'))
        execution = executeScheduleTool(this.state, actorId, request.name, args);
      else
        execution = executeInformationTool({
          state: this.state,
          manifest: this.manifest,
          actorId,
          requestId: request.requestId,
          name: request.name,
          args,
        });
      assertCapabilityEffects(definition, execution.effects);
      if (execution.effects.worldEvents?.length) {
        const after = applyOpenSocietyEffects(this.state, execution.effects),
          expired = advanceResourceSales({
            projection: after.world,
            simulationId: this.manifest.simulationId,
            requestId: `resource-sales-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
            nextSequence: after.worldSequence + 1,
          });
        if (expired.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...expired],
            },
          };
      }

      if (execution.effects.worldEvents?.length) {
        const next = applyOpenSocietyEffects(this.state, execution.effects);
        const completed = advanceResidentServiceEngagements({
          projection: next.world,
          simulationId: this.manifest.simulationId,
          requestId: `service-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
          nextSequence: next.worldSequence + 1,
        });
        if (completed.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...completed],
            },
          };
      }
      if (execution.effects.worldEvents?.length) {
        const after = applyOpenSocietyEffects(this.state, execution.effects);
        const completedTrades = advanceResidentEvidenceTrade({
          projection: after.world,
          simulationId: this.manifest.simulationId,
          requestId: `trade-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
          nextSequence: after.worldSequence + 1,
        });
        if (completedTrades.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...completedTrades],
              experiences: [
                ...(execution.effects.experiences ?? []),
                ...worldExperiences(after, completedTrades),
              ],
            },
          };
      }
      if (execution.effects.worldEvents?.length) {
        const after = applyOpenSocietyEffects(this.state, execution.effects),
          completed = advanceResidentPrincipalEvidenceTrade({
            projection: after.world,
            simulationId: this.manifest.simulationId,
            requestId: `principal-trade-after-${digest([actorId, request.requestId]).slice(0, 24)}`,
            nextSequence: after.worldSequence + 1,
          });
        if (completed.length)
          execution = {
            ...execution,
            effects: {
              ...execution.effects,
              worldEvents: [...execution.effects.worldEvents, ...completed],
              experiences: [
                ...(execution.effects.experiences ?? []),
                ...worldExperiences(after, completed),
              ],
            },
          };
      }
      assertCapabilityEffects(definition, execution.effects);
    } catch (caught) {
      if (!(caught instanceof ToolRefusal)) throw caught;
      error = caught.reason;
    }
    // A hidden/truncated original must not be marked read or enter personal memory.
    if (
      ORIGINAL_READS.has(request.name) &&
      JSON.stringify(execution.data).length > this.manifest.policy.maxResultChars
    ) {
      execution = {
        data: { instruction: 'Reduce --limit; no originals were marked read.' },
        effects: {},
      };
      error = 'read-result-too-large';
    }
    const changedTurn =
      turn === undefined
        ? undefined
        : (execution.effects.turns?.find((entry) => entry.id === turn.id) ?? turn);
    const automaticExperience = this.toolExperience(actorId, request, execution, error);
    const effects = {
      ...execution.effects,
      experiences: [
        ...(execution.effects.experiences ?? []),
        ...(execution.effects.worldEvents && !request.name.startsWith('world.')
          ? worldExperiences(this.state, execution.effects.worldEvents).filter(
              (e) => !execution.effects.experiences?.some((existing) => existing.id === e.id),
            )
          : []),
        ...automaticExperience,
      ],
      ...(turn === undefined || changedTurn === undefined
        ? execution.effects.turns
          ? { turns: execution.effects.turns }
          : {}
        : {
            turns: [
              ...(execution.effects.turns ?? []).filter((entry) => entry.id !== turn.id),
              { ...changedTurn, calls: turn.calls + 1 },
            ],
          }),
    };
    const after = applyOpenSocietyEffects(this.state, effects);
    let data = execution.data;
    if (JSON.stringify(data).length > this.manifest.policy.maxResultChars) {
      data = {
        truncated: true,
        instruction: 'Result exceeds the configured budget. Reduce limit or read one record.',
        originalCharacters: JSON.stringify(data).length,
      };
    }
    const result: OpenToolResult = {
      ok: error === undefined,
      data,
      ...(error === undefined ? {} : { error }),
      revision: this.state.revision + 1,
      simulationTime: after.world.clock.now,
    };
    return this.journal.commit({
      actorId,
      requestId: request.requestId,
      fingerprint,
      capability: request.name,
      result,
      effects,
    });
  }
  advanceTime(deltaMs: number, requestId: string): OpenToolResult {
    if (this.journal.isHistoricalRequest(requestId)) return this.failure('historical-request-id');
    if (
      !Number.isSafeInteger(deltaMs) ||
      deltaMs < 1 ||
      deltaMs > 86_400_000 ||
      !validInformationId(requestId)
    )
      return this.failure('invalid-time-advance');
    const cached = this.journal.lookup('system', requestId);
    const fingerprint = digest({ deltaMs });
    if (cached !== undefined)
      return cached.fingerprint === fingerprint
        ? cached.result
        : this.failure('request-id-conflict');
    const events: WorldEvent[] = [];
    let working = this.state;
    const target = working.world.clock.now + deltaMs;
    if (!Number.isSafeInteger(target)) return this.failure('invalid-time-target');
    if (!programAdvanceWithinBudget(working.coordination, target))
      return this.failure('program-advance-budget-exceeded');
    let advanceEffects: OpenSocietyEffects = working.coordination?.actionsPolicy
      ? { effectOrder: { version: 'ordered-society-effects-v1', entries: [] } }
      : {};
    const appendEffects = (batch: OpenSocietyEffects) => {
      advanceEffects = mergeProgramEffects(advanceEffects, batch);
      events.push(...(batch.worldEvents ?? []));
      working = applyOpenSocietyEffects(working, batch);
    };
    while (working.world.clock.now < target) {
      const boundary = nextResidentLeaseBoundary(working.world);
      const until = Math.min(
        target,
        boundary ?? target,
        nextPeriodicBoundary(working.world) ?? target,
        nextLogisticsBoundary(working.world.logistics, working.world.clock.now) ?? target,
        nextEvidenceTradeBoundary(working.world.residentTrade, working.world.clock.now) ?? target,
        nextPrincipalTradeBoundary(working.world.residentTrade, working.world.clock.now) ?? target,
        nextConstructionTradeBoundary(
          working.world.residentTrade?.constructionOrders,
          working.world.clock.now,
        ) ?? target,
        nextPremisesRightsBoundary(working.world.premisesRights, working.world.clock.now) ?? target,
        (working.world.serviceEngagements
          ? nextServiceEngagementBoundary(working.world.serviceEngagements, working.world.clock.now)
          : undefined) ?? target,
        (working.world.materials
          ? nextMaterialBoundary(working.world.materials, working.world.clock.now)
          : undefined) ?? target,
        (working.world.premises
          ? nextConstructionBoundary(working.world.premises, working.world.clock.now)
          : undefined) ?? target,
        (working.world.premises
          ? nextPremisesWearBoundary(working.world.premises, working.world.clock.now)
          : undefined) ?? target,
        nextOpenPremisesBoundary(working) ?? target,
        nextMobilityBoundary(working.world.residentMobility, working.world.clock.now) ?? target,
        nextProgramBoundary(working.coordination) ?? target,
        nextReactionBoundary(working.coordination?.reactions) ?? target,
        nextCollectiveBoundary(working.collectives) ?? target,
      );
      if (until > working.world.clock.now) {
        const step = dispatchOpenWorldCommand({
          state: working,
          manifest: this.manifest,
          policies: openWorldPolicies(
            this.manifest.seed,
            working.world,
            this.manifest.rhythm,
            this.manifest.canonicalPolicyContinuation,
          ),
          actorId: 'system',
          requestId: `${requestId}-step-${events.length}`,
          commandType: 'AdvanceSimulationTime',
          payload: { deltaMs: until - working.world.clock.now },
        });
        appendEffects({ worldEvents: step });
      }
      const materialEvents = advanceOpenMaterials(
        working,
        this.manifest,
        `${requestId}-materials-${events.length}`,
      );
      appendEffects({ worldEvents: materialEvents });
      const serviceEvents = advanceResidentServiceEngagements({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `service-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: serviceEvents });
      const provisionEvents = settleResidentPremisesProvisions({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `provision-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: provisionEvents });
      const premisesEvents = advanceOpenPremises(
        working,
        this.manifest,
        `${requestId}-premises-${events.length}`,
      );
      appendEffects({ worldEvents: premisesEvents });
      if (premisesEvents.length) {
        const endedServices = advanceResidentServiceEngagements({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `service-facility-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        });
        appendEffects({ worldEvents: endedServices });
      }
      const leaseEvents = advanceResidentLeases({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-leases-${events.length}`,
        nextSequence: working.worldSequence + 1,
        policies: openWorldPolicies(
          this.manifest.seed,
          working.world,
          this.manifest.rhythm,
          this.manifest.canonicalPolicyContinuation,
        ),
      });
      appendEffects({ worldEvents: leaseEvents });
      const mobilityEvents = advanceResidentMobility({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-mobility-${events.length}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: mobilityEvents });
      const freightEvents = advanceResidentLogistics({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `${requestId}-freight-${events.length}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: freightEvents });
      const permitEvents = advanceResidentPremisesRights({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `permit-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: permitEvents });
      appendEffects({
        worldEvents: advanceResidentConstructionTrade({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `construction-trade-tick-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        }),
      });
      const tradeEvents = advanceResidentEvidenceTrade({
        projection: working.world,
        simulationId: this.manifest.simulationId,
        requestId: `trade-tick-${digest([requestId, events.length]).slice(0, 24)}`,
        nextSequence: working.worldSequence + 1,
      });
      appendEffects({ worldEvents: tradeEvents });
      appendEffects({
        worldEvents: advanceResidentPrincipalEvidenceTrade({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `principal-trade-tick-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        }),
      });
      appendEffects({
        worldEvents: advanceResourceSales({
          projection: working.world,
          simulationId: this.manifest.simulationId,
          requestId: `resource-sales-tick-${digest([requestId, events.length]).slice(0, 24)}`,
          nextSequence: working.worldSequence + 1,
        }),
      });
      const dueCollectives = working.collectives
        ? advanceCollectives(working.collectives, working.world.clock.now)
        : [];
      appendEffects({ collectiveEvents: dueCollectives });
      const dueEffects = executeDuePrograms(working, this.manifest);
      appendEffects(dueEffects);
      if (until <= this.state.world.clock.now && leaseEvents.length === 0)
        throw new Error('lease-clock-stalled');
    }
    const next = working;
    const experiences = [
      ...worldExperiences(this.state, events),
      ...(advanceEffects.experiences ?? []),
    ];
    const residents = new Map<string, ResidentRuntimeState>(
      (advanceEffects.residents ?? []).map((r) => [r.actorId, r]),
    );
    for (const actorId of Object.keys(next.residents)) {
      const oldActivity = this.state.world.activityTimeByAgent[actorId];
      if (
        oldActivity !== undefined &&
        oldActivity.availableAt > this.state.world.clock.now &&
        oldActivity.availableAt <= next.world.clock.now
      ) {
        const resident = next.residents[actorId]!;
        residents.set(actorId, {
          ...resident,
          nextWakeAt: next.world.clock.now,
          wakeReason: 'activity-completed',
        });
      }
    }
    const reminders = Object.values(next.reminders)
      .filter((reminder) => !reminder.done && reminder.at <= next.world.clock.now)
      .map((reminder) => ({ ...reminder, done: true }));
    for (const reminder of reminders) {
      const resident = residents.get(reminder.ownerId) ?? next.residents[reminder.ownerId];
      if (resident !== undefined)
        residents.set(reminder.ownerId, {
          ...resident,
          nextWakeAt: next.world.clock.now,
          wakeReason: `reminder:${reminder.text}`,
        });
      experiences.push({
        id: `reminder-${reminder.id}`,
        ownerId: reminder.ownerId,
        at: reminder.at,
        kind: 'observation',
        summary: `Your reminder: ${reminder.text}`,
        sourceIds: [reminder.id],
        people: [],
        provenance: 'firsthand',
      });
    }
    const serviceEvents = next.services ? advanceServices(next.services, next.world.clock.now) : [];
    for (const event of serviceEvents) {
      if (event.type !== 'BookingChanged') continue;
      const booking = event.booking;
      const slot = next.services!.slots[booking.slotId]!;
      const service = next.services!.services[slot.serviceId]!;
      const administrator = personalServiceAdministrator(service);
      const people = [...new Set([booking.residentId, ...(administrator ? [administrator] : [])])];
      for (const ownerId of people)
        experiences.push({
          id: `experience-booking-${booking.id}-${booking.revision}-${ownerId}`,
          ownerId,
          at: booking.endedAt ?? slot.end,
          kind: 'observation',
          summary: JSON.stringify({
            kind: 'attendance-ended',
            booking,
            serviceId: service.id,
            locationId: service.locationId,
          }),
          sourceIds: [booking.id, slot.id, service.id],
          people,
          locationIds: [service.locationId],
          provenance: 'firsthand',
        });
    }
    const advanced = this.journal.commit({
      actorId: 'system',
      requestId,
      fingerprint,
      capability: 'system.advance-time',
      effects: {
        ...mergeProgramEffects(advanceEffects, {
          ...(next.collaboration
            ? { collaborationEvents: expireProposals(next.collaboration, next.world.clock.now) }
            : {}),
          ...(next.services ? { servicesEvents: serviceEvents } : {}),
          ...(next.life ? { careEvents: advanceCare(next.life.care, next.world.clock.now) } : {}),
        }),
        experiences,
        residents: [...residents.values()],
        reminders,
      },
      result: {
        ok: true,
        data: { eventCount: events.length },
        revision: this.state.revision + 1,
        simulationTime: next.world.clock.now,
      },
    });
    this.runDuePlans();
    return advanced;
  }
  private requireResident(actorId: string) {
    if (
      this.state.residents[actorId] === undefined ||
      this.state.world.agents[actorId] === undefined
    )
      throw new ToolRefusal('unknown-resident');
  }
  private toolExperience(
    actorId: string,
    request: OpenToolRequest,
    execution: ToolExecution,
    error?: string,
  ) {
    if (ORIGINAL_READS.has(request.name))
      return error === undefined
        ? readingExperiences(this.state, actorId, request.name, execution.data)
        : [];
    const definition = OPEN_SOCIETY_TOOLS.find((tool) => tool.name === request.name);
    if (
      request.name.startsWith('world.') ||
      request.name.startsWith('messages.') ||
      (!definition?.mutates && request.name !== 'files.read')
    )
      return [];
    const data = execution.data;
    const document =
      data !== null && typeof data === 'object' && 'id' in data && 'revision' in data
        ? data
        : undefined;
    // Re-reading an unchanged document does not manufacture another experience.
    const source =
      request.name === 'files.read' && document !== undefined
        ? `document-${digest([document.id, document.revision])}`
        : `tool-${digest([actorId, request.requestId])}`;
    const id = `experience-${source}-${actorId}`;
    if (hasExperience(this.state, actorId, id)) return [];
    return [
      {
        id,
        ownerId: actorId,
        at: this.state.world.clock.now,
        kind: request.name.startsWith('cognition.') ? ('cognition' as const) : ('action' as const),
        summary: `${request.name} ${error === undefined ? 'succeeded' : `rejected: ${error}`}: ${JSON.stringify(data).slice(0, 8500)}`,
        sourceIds: [
          source,
          ...(error === undefined
            ? (execution.effects.communicationEvents ?? []).flatMap((event) =>
                event.type === 'GroupMessageSent' && event.message.authorId === actorId
                  ? [event.message.id]
                  : [],
              )
            : []),
        ],
        people: experiencePeople(this.state, data),
        provenance: request.name.startsWith('cognition.')
          ? ('self-belief' as const)
          : ('firsthand' as const),
      },
    ];
  }
  private policies() {
    return openWorldPolicies(
      this.manifest.seed,
      this.state.world,
      this.manifest.rhythm,
      this.manifest.canonicalPolicyContinuation,
    );
  }
  private failure(error: string): OpenToolResult {
    return {
      ok: false,
      error,
      revision: this.state.revision,
      simulationTime: this.state.world.clock.now,
    };
  }
  private systemCommit(
    actorId: string,
    requestId: string,
    capability: string,
    effects: OpenSocietyEffects,
    data: unknown,
  ) {
    return this.journal.commit({
      actorId,
      requestId,
      fingerprint: digest({ capability, effects }),
      capability,
      effects,
      result: {
        ok: true,
        data,
        revision: this.state.revision + 1,
        simulationTime: this.state.world.clock.now,
      },
    });
  }
}
import {
  PUBLIC_GOVERNANCE_POLICY,
  assertPublicGrant,
  assertPublicProcedure,
  publicEqual,
} from '@aivilization/governance';
import { assertValidTownGovernancePolicy } from '@aivilization/society';
import {
  enableResidentPublicGovernanceEvent,
  enableResidentPublicProcurementEvent,
  enableResidentPublicGoodsProcurementEvent,
} from '@aivilization/world';
import { seedPublicGovernance } from './publicGovernancePolicy';
import { executePublicGovernanceTool } from './publicGovernanceTools';
import { SERVICE_PUBLIC_FUNDING_POLICY } from '@aivilization/services';
