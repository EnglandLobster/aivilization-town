import type { OpenToolDefinition } from '@aivilization/agent-runtime';
import type { OpenSocietyManifest, OpenSocietyState } from './types';
import { pageItems, stringArg, ToolRefusal } from './arguments';
import type { ToolExecution } from './informationTools';
import { SOCIETY_RULEBOOK_VERSION, SOCIETY_RULES, capabilityRuleIds } from './ruleDefinitions';
import { capabilityBoundary, boundaryAvailability } from './capabilityBoundaries';
export { SOCIETY_RULEBOOK_VERSION, SOCIETY_RULES, capabilityRuleIds } from './ruleDefinitions';

export function executeRulebookTool(
  state: OpenSocietyState,
  manifest: OpenSocietyManifest,
  tools: readonly OpenToolDefinition[],
  name: string,
  args: Readonly<Record<string, unknown>>,
): ToolExecution {
  if (name === 'rules.capabilities') {
    const category = stringArg(args, 'category');
    return {
      data: pageItems(
        tools
          .filter((t) => !category || t.category === category)
          .map((t) => {
            const c = capabilityBoundary(t);
            return {
              name: c.name,
              cli: c.cli,
              domain: c.domain,
              records: c.records,
              participation: c.participation,
              delegation: c.delegation,
              adapterEnabled: boundaryAvailability(t, state).adapterEnabled,
              readWith: `town rules capability --name ${t.name}`,
            };
          }),
        args,
      ),
      effects: {},
    };
  }
  if (name === 'rules.capability') {
    const t = tools.find((t) => t.name === stringArg(args, 'name'));
    if (!t) throw new ToolRefusal('capability-not-found');
    return {
      data: {
        ...capabilityBoundary(t),
        availability: boundaryAvailability(t, state),
        description: t.description,
        inputSchema: t.inputSchema,
        policySources: manifest.provenance,
        domainPolicyQuery: 'town city observe --view rules',
        interpretation:
          'Declared adapter boundary, not a replacement for current domain rules or a promise of success.',
      },
      effects: {},
    };
  }
  if (name === 'rules.list')
    return {
      data: {
        version: SOCIETY_RULEBOOK_VERSION,
        ...pageItems(
          SOCIETY_RULES.map(({ id, kind, description }) => ({ id, kind, description })),
          args,
        ),
      },
      effects: {},
    };
  const r = SOCIETY_RULES.find((r) => r.id === stringArg(args, 'id'));
  if (!r) throw new ToolRefusal('rule-not-found');
  const enabled =
    r.id === 'agreed-labor'
      ? state.world.residentLabor?.configuration.compensationSource ===
        'accepted-enterprise-labor-terms-v1'
      : r.id === 'construction-procurement'
        ? !!state.world.residentTrade?.constructionOrders
        : r.id === 'resource-principals'
          ? !!state.world.materials?.resourcePrincipals
          : r.id === 'capital-agreements'
            ? !!state.world.capitalAgreements
            : r.id === 'public-employment'
              ? !!state.world.publicEmployment
              : r.id === 'public-procedures'
                ? !!state.world.publicGovernance
                : r.id === 'evidence-trade'
                  ? !!state.world.residentTrade
                  : r.id === 'physical-freight'
                    ? !!state.world.logistics
                    : r.id === 'physical-service-delivery'
                      ? !!state.world.serviceEngagements
                      : r.id === 'physical-facility-use'
                        ? !!state.world.premises?.facilityUsePolicy
                        : ['physical-premises', 'public-construction-use'].includes(r.id)
                          ? !!state.world.premises
                          : r.id === 'material-production'
                            ? !!state.world.materials
                            : r.id === 'group-control'
                              ? !!state.communication?.groupControlPolicy
                              : ['resource-control', 'enterprise-management-control'].includes(r.id)
                                ? !!state.resourceControlPolicy
                                : r.id === 'service-control'
                                  ? !!state.services?.controlPolicy
                                  : r.id === 'resident-program-actions'
                                    ? !!state.coordination?.actionsPolicy
                                    : r.id === 'resident-program-reactions'
                                      ? !!state.coordination?.reactions
                                      : r.id === 'resident-program-conditions'
                                        ? !!state.coordination?.conditionsPolicy
                                        : r.id === 'common-accounts'
                                          ? !!state.world.commonAccounts
                                          : r.id === 'resident-collectives'
                                            ? !!state.collectives
                                            : r.id === 'resident-data-views'
                                              ? !!state.recordViews
                                              : r.id === 'shared-records'
                                                ? !!state.sharedRecords
                                                : r.id === 'resident-programs'
                                                  ? !!state.coordination
                                                  : r.id === 'mobility'
                                                    ? !!state.world.residentMobility
                                                    : r.id === 'agreements'
                                                      ? !!state.collaboration
                                                      : r.id === 'services'
                                                        ? !!state.services
                                                        : r.id === 'exchange'
                                                          ? !!state.world.residentCommerce
                                                          : r.id === 'personal-life'
                                                            ? !!state.life
                                                            : true;
  return {
    data: {
      ...r,
      enabled,
      version: SOCIETY_RULEBOOK_VERSION,
      capabilities: tools
        .filter((t) => capabilityRuleIds(t).includes(r.id))
        .map((t) => ({ name: t.name, mutates: t.mutates })),
      policySources: {
        labor: state.world.residentLabor?.configuration ?? null,
        provenance: manifest.provenance,
        records: state.sharedRecords?.policy ?? null,
        recordViews: state.recordViews?.policy ?? null,
        collectives: state.collectives?.policy ?? null,
        commonAccounts: state.world.commonAccounts?.policy ?? null,
        coordination: state.coordination?.policy ?? null,
        materials: state.world.materials?.policy ?? null,
        materialSources: state.world.materials?.extraction?.policy ?? null,
        serviceEngagements: state.world.serviceEngagements?.policy ?? null,
        logistics: state.world.logistics?.policy ?? null,
        evidenceTrade: state.world.residentTrade?.policy ?? null,
        premises: state.world.premises?.policy ?? null,
        vehiclePrincipals: state.world.residentMobility?.principalPolicy ?? null,
        constructionTrade: state.world.residentTrade?.constructionOrders?.policy ?? null,
        publicConstructionTrade:
          state.world.publicGovernance?.authority.grant.constructionTrade ?? null,
        premisesPrincipals: state.world.premises?.resourcePrincipals ?? null,
        resourcePrincipals: state.world.materials?.resourcePrincipals ?? null,
        facilityUse: state.world.premises?.facilityUsePolicy ?? null,
        publicConstructionUse: state.world.premises?.landUsePolicy ?? null,
        groupControl: state.communication?.groupControlPolicy ?? null,
        resourceControl: state.resourceControlPolicy ?? null,
        programReactions: state.coordination?.reactions?.policy ?? null,
        programConditions: state.coordination?.conditionsPolicy ?? null,
        programActions: state.coordination?.actionsPolicy ?? null,
        serviceControl: state.services?.controlPolicy ?? null,
        services: state.services?.policy.version ?? null,
        elapsedRest: state.world.residentRest?.policy ?? null,
        physicalHousingRest: state.world.physicalHousingRest ?? null,
        capitalAgreements: state.world.capitalAgreements?.policy ?? null,
        publicEmployment: state.world.publicEmployment
          ? {
              policyVersion: state.world.publicEmployment.policyVersion,
              readWith: 'town governance employment',
            }
          : null,
        resourceSales: state.world.resourceSales?.policy ?? null,
        resourceAdapters: state.world.resourceAdapters ?? null,
        periodicAccess: state.world.periodicAccess ?? null,
        serviceClosurePolicy: state.world.serviceClosurePolicy ?? null,
        publicGovernance: state.world.publicGovernance?.authority.policy ?? null,
        publicProcurement: state.world.publicGovernance?.authority.grant.procurement ?? null,
        publicGoodsProcurement:
          state.world.publicGovernance?.authority.grant.goodsProcurement ?? null,
        tradePublicFunding: state.world.residentTrade?.publicFunding ?? null,
        publicGrant: state.world.publicGovernance?.authority.grant.source ?? null,
        worldParameters:
          'town city observe --view rules; only currently exposed rule groups are readable',
      },
      scope: 'independent-open-resident-runtime',
      availabilityNote:
        'Directory membership is not permission or guaranteed executability. Individual world commands still check their active policies, location, resources and identity.',
    },
    effects: {},
  };
}
