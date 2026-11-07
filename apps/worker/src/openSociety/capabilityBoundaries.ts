import type { OpenToolDefinition } from '@aivilization/agent-runtime';
import type { OpenSocietyEffects, OpenSocietyState } from './types';
import { capabilityRuleIds, SOCIETY_RULES } from './ruleDefinitions';
import { residentCapabilityRoute } from './capabilityRoutes';

export const CAPABILITY_BOUNDARY_VERSION = 'resident-capability-boundaries-v2';
type EffectFamily = keyof OpenSocietyEffects;
type Meaning = 'world-fact' | 'attributed-claim' | 'consent' | 'authority' | 'interpretation';
type Feature =
  | 'base'
  | 'action-plans'
  | 'public-housing'
  | 'housing-occupancy'
  | 'resource-principals'
  | 'housing-choice'
  | 'public-employment'
  | 'public-governance'
  | 'communication'
  | 'collaboration'
  | 'commerce'
  | 'records'
  | 'collectives'
  | 'common-accounts'
  | 'program-conditions'
  | 'resource-control'
  | 'group-control'
  | 'materials'
  | 'finite-material-sources'
  | 'premises'
  | 'coordination';
type Boundary = {
  readonly domain: string;
  readonly feature: Feature;
  readonly records: readonly Meaning[];
  readonly effects: readonly EffectFamily[];
  readonly participation: 'none' | 'personal-authorization' | 'personal-physical-action';
  readonly changes: string;
  readonly neverImplies: string;
  readonly receiptOnly?: true;
};
type Declaration = Boundary & { readonly names: readonly string[] };
const declare = (names: string, boundary: Boundary): Declaration => ({
  names: names.split(' '),
  ...boundary,
});
const query = (domain: string, feature: Feature, records: readonly Meaning[]): Boundary => ({
  domain,
  feature,
  records,
  effects: [],
  participation: 'none',
  changes: 'Authorized observation only; the runtime may record the actual reading separately.',
  neverImplies: 'Visibility is not agreement, authority, truth of a claim, or permission to act.',
});
const claim = (domain: string, feature: Feature, effects: readonly EffectFamily[]): Boundary => ({
  domain,
  feature,
  effects,
  records: ['attributed-claim'],
  participation: 'personal-authorization',
  changes: 'Attributed original statements, versions and their explicit publication state.',
  neverImplies:
    'No objective satisfaction, title, money, bodily effect, qualification or public authority is created by the statement.',
});
const authority = (
  domain: string,
  feature: Feature,
  effects: readonly EffectFamily[],
): Boundary => ({
  domain,
  feature,
  effects,
  records: ['consent', 'authority'],
  participation: 'personal-authorization',
  changes:
    'Only the named resource permission or independently attributed agreement under its domain protocol.',
  neverImplies:
    'No consent by another identity, unlimited delegation, bodily participation, or consent to a future revision.',
});
const physical = (
  domain: string,
  feature: Feature,
  effects: readonly EffectFamily[],
): Boundary => ({
  domain,
  feature,
  effects,
  records: ['world-fact'],
  participation: 'personal-physical-action',
  changes:
    'An action checked against actual location, activity time, resources and the active world policy; completion may require later simulation time.',
  neverImplies:
    'Starting or reserving is not completion, subjective success or another person participating.',
});
const resource = (domain: string, feature: Feature): Boundary => ({
  domain,
  feature,
  effects: ['worldEvents'],
  records: ['world-fact', 'authority'],
  participation: 'personal-authorization',
  changes:
    'Domain-authorized resource or institutional state, including any balanced settlement and reservations specified by that operation.',
  neverImplies:
    'No unrestricted policy editing, free assets, right to operate someone else, or objective social reputation.',
});

// Names are explicit: adding a command without a reviewed boundary fails at startup and in tests.
// Families bound adapter writes; the owning domain still enforces event semantics and authorization.
const declarations: readonly Declaration[] = [
  declare(
    'principals.list principals.read',
    query('authority/materials/premises/mobility/services/world', 'resource-principals', [
      'world-fact',
      'authority',
    ]),
  ),
  declare(
    'principals.control principals.operate',
    resource('authority/materials/premises/mobility/services/world', 'resource-principals'),
  ),
  declare(
    'governance.housing',
    query('governance/society/world', 'public-housing', ['world-fact', 'authority']),
  ),
  declare(
    'housing.occupancy',
    query('society/world', 'housing-occupancy', ['world-fact', 'authority']),
  ),
  declare('housing.leave', {
    ...resource('society/world', 'housing-occupancy'),
    changes:
      'Only the authenticated resident releases their exact registered home. Physical location, contracts, debts, deposits and personal standard remain unchanged.',
  }),
  declare('housing.standard', query('society/world', 'housing-choice', ['world-fact'])),
  declare('housing.lower', {
    ...resource('society/world', 'housing-choice'),
    changes:
      'Only the authenticated resident selects a lower supported personal service standard. Existing debt, assets, body, residence, jobs and private contracts remain unchanged.',
  }),
  declare(
    'governance.employment',
    query('governance/society/world', 'public-employment', ['world-fact', 'authority']),
  ),
  declare(
    'governance.status governance.list governance.read governance.votes governance.objections',
    query('governance/world', 'public-governance', [
      'world-fact',
      'attributed-claim',
      'consent',
      'authority',
    ]),
  ),
  declare(
    'governance.propose governance.vote governance.close governance.withdraw governance.execute governance.object',
    {
      ...authority('governance/world/society', 'public-governance', ['worldEvents']),
      records: ['attributed-claim', 'consent', 'authority', 'world-fact'],
      changes:
        'Explicit public jurisdiction, exact original proposal, independently attributed ballots, and atomically enacted approved policy or procedure.',
      neverImplies:
        'No private group becomes a government; approval is not truth, arbitrary policy permission, new physical rules, retroactive history changes or invented public money.',
    },
  ),

  declare(
    'sites.list sites.read construction.plan construction.list construction.read premises.list premises.read materials.list materials.read',
    query('premises/materials/world', 'premises', ['world-fact', 'authority', 'attributed-claim']),
  ),
  declare(
    'construction.start construction.leave premises.collect-salvage',
    physical('premises/world', 'premises', ['worldEvents']),
  ),
  declare(
    'construction.create construction.cancel construction.finish premises.configure premises.close premises.reopen premises.offer premises.accept premises.cancel-offer materials.reserve materials.withdraw',
    resource('premises/materials/world', 'premises'),
  ),

  declare(
    'stocks.list stocks.read stocks.ledger production.list production.read production.recipes',
    query('materials/world', 'materials', ['world-fact', 'authority', 'attributed-claim']),
  ),
  declare(
    'stocks.create stocks.deposit stocks.withdraw',
    physical('materials/world', 'materials', ['worldEvents']),
  ),
  declare(
    'stocks.configure stocks.offer stocks.accept stocks.cancel-offer stocks.settle stocks.close',
    resource('materials/world', 'materials'),
  ),
  declare('production.start production.leave', {
    ...physical('materials/society/enterprise/economy/world', 'materials', ['worldEvents']),
    changes:
      'Actual personal production and, only under explicit employer authorization, personal earned wage debt/payment from the same work receipts.',
    neverImplies:
      'No second body reservation or effort charge, invented output, forced participation, automatic stock ownership transfer, or wages for unperformed time.',
  }),
  declare(
    'sources.list sources.read',
    query('materials/world', 'finite-material-sources', ['world-fact', 'authority']),
  ),
  declare('production.gather', resource('materials/enterprise/world', 'finite-material-sources')),
  declare('production.create production.cancel', {
    ...resource('materials/enterprise/world', 'materials'),
    changes:
      'Exact material task and resource authorization; an explicit employer may bind real contracted workers and its wage funding to the task.',
    neverImplies:
      'A task, employer name or payment is not actual attendance, completed output or transfer of stock ownership. Each worker starts personally.',
  }),

  declare(
    'programs.check',
    query('collaboration/conditions', 'program-conditions', [
      'world-fact',
      'attributed-claim',
      'interpretation',
      'authority',
    ]),
  ),
  declare(
    'funds.list funds.read funds.ledger',
    query('economy/common-accounts', 'common-accounts', ['world-fact', 'authority']),
  ),
  declare('funds.open funds.contribute', resource('economy/common-accounts', 'common-accounts')),
  declare('collectives.execute', {
    ...authority('collaboration/world-common-resources', 'collectives', [
      'collectiveEvents',
      'worldEvents',
      'informationEvents',
      'sharedRecordsEvents',
      'communicationEvents',
    ]),
    records: ['authority', 'world-fact'],
    changes:
      'Execute only the exact passed amendment or supported owned-resource action, atomically consuming its finite authority proof.',
  }),
  declare(
    'collectives.list collectives.read collectives.history collectives.decisions collectives.decision',
    query('collaboration/collectives', 'collectives', ['authority', 'consent', 'attributed-claim']),
  ),
  declare(
    'collectives.create collectives.respond collectives.withdraw collectives.leave collectives.propose collectives.vote collectives.decide collectives.join',
    authority('collaboration/collectives', 'collectives', ['collectiveEvents']),
  ),
  declare(
    'rules.list rules.read rules.capabilities rules.capability',
    query('integration', 'base', ['world-fact']),
  ),
  declare('world.observe', query('world', 'base', ['world-fact'])),
  declare('memory.search memory.read', query('memory', 'base', ['world-fact', 'attributed-claim'])),
  declare('cognition.list', query('memory', 'base', ['interpretation'])),
  declare('cognition.update', {
    ...claim('memory', 'base', ['cognitiveEvents']),
    records: ['interpretation'],
    changes:
      'Only this resident personal interpretations and goals; cited experiences remain separate.',
  }),
  declare(
    'files.index files.read files.list files.search files.history spaces.list messages.list',
    query('information', 'base', ['attributed-claim', 'authority']),
  ),
  declare('spaces.create', authority('information', 'base', ['informationEvents'])),
  declare(
    'files.create files.update files.delete',
    claim('information', 'base', ['informationEvents']),
  ),
  declare('messages.send', claim('information', 'base', ['informationEvents', 'residents'])),
  declare('messages.read', {
    ...query('information', 'base', ['attributed-claim']),
    effects: ['informationEvents', 'residents'],
    receiptOnly: true,
  }),
  declare('schedule.list', query('scheduling', 'base', ['world-fact'])),
  declare('schedule.wait schedule.configure', {
    ...authority('scheduling', 'base', ['residents', 'turns']),
    changes: 'Your own next opportunity or waiting state; does not itself advance simulation time.',
  }),
  declare('schedule.remind schedule.cancel', authority('scheduling', 'base', ['reminders'])),
  declare('schedule.plan schedule.plan-cancel', {
    ...authority('scheduling', 'action-plans', ['residents']),
    changes:
      'Only your own queued actions; each step later runs as your ordinary authorized command and can be refused.',
  }),
  declare(
    'notifications.settings groups.list groups.invitations groups.members blocks.list',
    query('information', 'communication', ['authority', 'consent']),
  ),
  declare('groups.messages', {
    ...query('information', 'communication', ['attributed-claim']),
    effects: ['communicationEvents'],
    receiptOnly: true,
  }),
  declare(
    'groups.create groups.invite groups.join-request groups.accept groups.reject groups.transfer groups.leave groups.close blocks.add blocks.remove notifications.configure',
    authority('information', 'communication', ['communicationEvents']),
  ),
  declare(
    'groups.withdraw-request groups.withdraw-invitation',
    authority('information', 'group-control', ['communicationEvents']),
  ),
  declare('groups.send', claim('information', 'communication', ['communicationEvents'])),
  declare(
    'proposals.list proposals.read proposals.history commitments.list commitments.read',
    query('collaboration', 'collaboration', ['attributed-claim', 'consent']),
  ),
  declare(
    'proposals.create proposals.revise proposals.respond proposals.withdraw',
    authority('collaboration', 'collaboration', ['collaborationEvents']),
  ),
  declare('commitments.declare', claim('collaboration', 'collaboration', ['collaborationEvents'])),
  declare(
    'offers.list offers.read orders.list orders.read payments.list payments.read deposits.list deposits.read',
    query('commerce', 'commerce', ['world-fact', 'attributed-claim', 'consent']),
  ),
  declare(
    'offers.publish offers.withdraw orders.create orders.accept orders.pay orders.confirm orders.cancel orders.refund orders.propose-settlement orders.respond-settlement payments.transfer payments.request payments.pay payments.cancel deposits.lock deposits.release deposits.settle',
    resource('commerce', 'commerce'),
  ),
  declare('orders.dispute', {
    ...resource('commerce', 'commerce'),
    records: ['attributed-claim'],
    changes:
      'A signed dispute and the domain-defined suspension of settlement; no automatic verdict.',
  }),
  declare('orders.deliver', {
    ...physical('commerce', 'commerce', ['worldEvents']),
    records: ['world-fact', 'attributed-claim'],
    changes:
      'Real co-located goods delivery, or an attributed service delivery statement under its order protocol.',
  }),
  declare('housing.list', query('society', 'base', ['world-fact', 'attributed-claim'])),
  declare(
    'registers.list registers.read',
    query('information/shared-records', 'records', ['authority']),
  ),
  declare(
    'records.list records.read records.history',
    query('information/shared-records', 'records', ['attributed-claim']),
  ),
  declare(
    'registers.create registers.configure registers.nominate registers.accept',
    authority('information/shared-records', 'records', ['sharedRecordsEvents']),
  ),
  declare(
    'records.put records.append records.delete',
    claim('information/shared-records', 'records', ['sharedRecordsEvents']),
  ),
  declare(
    'programs.list programs.read programs.history mandates.list mandates.read programs.schedules programs.runs',
    query('collaboration/programs', 'coordination', [
      'attributed-claim',
      'authority',
      'world-fact',
    ]),
  ),
  declare(
    'resources.list resources.read',
    query('authority/information/services/enterprise', 'resource-control', ['authority']),
  ),
  declare(
    'resources.offer resources.accept resources.cancel resources.manage',
    authority('authority/information/services/enterprise', 'resource-control', [
      'worldEvents',
      'informationEvents',
      'sharedRecordsEvents',
      'communicationEvents',
    ]),
  ),
  declare('programs.publish programs.revise programs.disable', {
    ...claim('collaboration/programs', 'coordination', ['coordinationEvents']),
    changes:
      'An exact procedure definition or its availability. Publishing or revising grants no resource authority.',
  }),
  declare(
    'mandates.grant mandates.revoke programs.schedule programs.cancel',
    authority('collaboration/programs', 'coordination', ['coordinationEvents']),
  ),
  declare('programs.run', {
    ...authority('collaboration/programs', 'coordination', [
      'coordinationEvents',
      'sharedRecordsEvents',
      'informationEvents',
      'worldEvents',
      'residents',
      'communicationEvents',
      'effectOrder',
    ]),
    records: ['world-fact', 'attributed-claim'],
    changes:
      'Only the fixed approved steps under independently valid mandates, atomically; failed execution has an attributed record.',
  }),
  declare(
    'world.move world.eat world.consume world.sleep world.stop_rest world.stop_study world.stop_work world.doctor world.study world.work world.produce world.give world.build_housing world.choose_residence',
    physical('world/society/economy', 'base', ['worldEvents', 'residents']),
  ),
  declare(
    'world.claim_wage world.trade world.apply_job world.found_enterprise world.join_enterprise world.leave_enterprise world.layoff_employee world.fund_enterprise world.close_enterprise world.post_job world.deposit world.withdraw world.borrow world.export world.import world.upgrade_home world.apply_exam',
    {
      ...resource('world/economy/enterprise/credit/society', 'base'),
      effects: ['worldEvents', 'residents'],
    },
  ),
];
const contracts = new Map<string, Boundary>();
for (const { names, ...boundary } of declarations)
  for (const name of names) {
    if (contracts.has(name)) throw new Error(`duplicate-capability-boundary:${name}`);
    contracts.set(name, boundary);
  }
const delegated = new Set(['payments.transfer', 'records.put', 'records.append', 'messages.send']);

export function capabilityBoundary(tool: OpenToolDefinition) {
  const boundary = contracts.get(tool.name);
  if (!boundary) throw new Error(`missing-capability-boundary:${tool.name}`);
  if (tool.mutates !== boundary.effects.length > 0 && !boundary.receiptOnly)
    throw new Error(`capability-mutation-boundary-mismatch:${tool.name}`);
  return {
    version: CAPABILITY_BOUNDARY_VERSION,
    name: tool.name,
    cli: `town ${residentCapabilityRoute(tool.name)}`,
    ...boundary,
    governingRules: capabilityRuleIds(tool).map((id) => {
      const r = SOCIETY_RULES.find((r) => r.id === id)!;
      return { id, source: r.kind, changeAuthority: r.changeAuthority };
    }),
    choosesPurpose: 'resident' as const,
    executionAuthority: 'domain-validated-command' as const,
    delegation: delegated.has(tool.name)
      ? ('exact-version-limited-mandate' as const)
      : ('not-enabled' as const),
    automation:
      tool.name === 'programs.run'
        ? ('explicit-bounded-program-schedule' as const)
        : ('no-independent-automatic-execution' as const),
  };
}
export function validateCapabilityBoundaries(tools: readonly OpenToolDefinition[]) {
  const names = new Set(tools.map((t) => t.name));
  if (names.size !== tools.length) throw new Error('duplicate-capability-name');
  for (const tool of tools) capabilityBoundary(tool);
  for (const name of contracts.keys())
    if (!names.has(name)) throw new Error(`orphan-capability-boundary:${name}`);
}
export function boundaryAvailability(tool: OpenToolDefinition, state: OpenSocietyState) {
  const { feature } = capabilityBoundary(tool);
  const enabled: Record<Feature, boolean> = {
    base: true,
    'action-plans': !!state.actionPlans,
    'public-housing': !!state.world.publicHousing,
    'housing-occupancy': !!state.world.housingOccupancy,
    'resource-principals': !!state.world.materials?.resourcePrincipals,
    'housing-choice': !!state.world.housingChoice,
    'public-employment': !!state.world.publicEmployment,
    'public-governance': !!state.world.publicGovernance,
    communication: !!state.communication,
    collaboration: !!state.collaboration,
    commerce: !!state.world.residentCommerce,
    records: !!state.sharedRecords,
    collectives: !!state.collectives,
    'common-accounts': !!state.world.commonAccounts,
    'resource-control': !!state.resourceControlPolicy,
    materials: !!state.world.materials,
    'finite-material-sources': !!state.world.materials?.extraction,
    premises: !!state.world.premises,
    'group-control': !!state.communication?.groupControlPolicy,
    'program-conditions': !!state.coordination?.conditionsPolicy,
    coordination: !!state.coordination,
  };
  return {
    feature,
    adapterEnabled: enabled[feature],
    authorization: 'checked-on-each-call',
    note: 'Adapter availability does not guarantee permission, domain policy activation, sufficient resources, correct location or successful execution.',
  };
}

/** Guard adapter separation before durable commit. Does not replace domain event validation. */
export function assertCapabilityEffects(tool: OpenToolDefinition, effects: OpenSocietyEffects) {
  const boundary = capabilityBoundary(tool);
  for (const [key, value] of Object.entries(effects)) {
    if (value === undefined || (Array.isArray(value) && !value.length)) continue;
    if (key === 'experiences') continue;
    if (!boundary.effects.includes(key as EffectFamily))
      throw new Error(`capability-effect-boundary-violation:${tool.name}:${key}`);
  }
  if (
    tool.name.startsWith('resources.') &&
    effects.worldEvents?.some((e) => e.type !== 'ResidentEnterpriseControlCommitted')
  )
    throw new Error(`capability-resource-authority-only:${tool.name}`);
  if (boundary.receiptOnly) {
    const events = [...(effects.informationEvents ?? []), ...(effects.communicationEvents ?? [])];
    const allowed = new Set(['MessageRead', 'GroupMessagesRead', 'PublicationRead']);
    for (const event of events)
      if (!allowed.has(event.type))
        throw new Error(`capability-receipt-boundary-violation:${tool.name}:${event.type}`);
  }
}
