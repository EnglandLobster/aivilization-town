import type { OpenToolDefinition } from '@aivilization/agent-runtime';
import type { OpenSocietyManifest, OpenSocietyState } from './types';
import { pageItems, stringArg, ToolRefusal } from './arguments';
import type { ToolExecution } from './informationTools';
import { SOCIETY_RULEBOOK_VERSION, SOCIETY_RULES, capabilityRuleIds } from './ruleDefinitions';
import { capabilityBoundary, boundaryAvailability } from './capabilityBoundaries';
/** Rules that apply only when their mechanism exists in this town; all others always apply. */
const RULE_AVAILABILITY: Readonly<Record<string, (state: OpenSocietyState) => boolean>> = {
  'resource-principals': (s) => !!s.world.materials?.resourcePrincipals,
  'public-employment': (s) => !!s.world.publicEmployment,
  'public-procedures': (s) => !!s.world.publicGovernance,
  'physical-facility-use': (s) => !!s.world.premises?.facilityUsePolicy,
  'physical-premises': (s) => !!s.world.premises,
  'public-construction-use': (s) => !!s.world.premises,
  'material-production': (s) => !!s.world.materials,
  'group-control': (s) => !!s.communication?.groupControlPolicy,
  'resource-control': (s) => !!s.resourceControlPolicy,
  'enterprise-management-control': (s) => !!s.resourceControlPolicy,
  'resident-program-actions': (s) => !!s.coordination?.actionsPolicy,
  'resident-program-conditions': (s) => !!s.coordination?.conditionsPolicy,
  'common-accounts': (s) => !!s.world.commonAccounts,
  'resident-collectives': (s) => !!s.collectives,
  'shared-records': (s) => !!s.sharedRecords,
  'resident-programs': (s) => !!s.coordination,
  agreements: (s) => !!s.collaboration,
  exchange: (s) => !!s.world.residentCommerce,
};
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
  const enabled = RULE_AVAILABILITY[r.id]?.(state) ?? true;
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
