import {
  CAPITAL_AGREEMENTS_POLICY,
  enterpriseController,
  enterpriseControlVersion,
  capitalHeldMicros,
  parseCapitalAllocation,
  type CapitalAccount,
  type EnterpriseState,
} from '@aivilization/enterprise';
import { residentCapitalCommand, type CapitalEnterpriseCommand } from '@aivilization/world';
import { sameController, type ControlAuthorizationPort } from '@aivilization/authority';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import { validateOpenToolArguments } from '@aivilization/agent-runtime';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { controllerVisibleTo, controllerAvailable } from './resourceControlAccess';
import { capitalAccountVisibleTo as visibleAccount } from './capitalAccess';
import { CAPITAL_TOOLS } from './capitalCatalog';
import { stringArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
const manages = (s: OpenSocietyState, e: EnterpriseState, actor: string) =>
  controllerVisibleTo(s, enterpriseController(e), actor);
const visibleAgreement = (s: OpenSocietyState, e: EnterpriseState, id: string, actor: string) =>
  manages(s, e, actor) ||
  (!!e.capital?.agreements[id] &&
    controllerVisibleTo(s, e.capital.agreements[id].proposerAuthority.controller, actor)) ||
  !!e.capital?.agreements[id]?.participants.some((a) => visibleAccount(s, a, actor));
const visibleFirm = (s: OpenSocietyState, e: EnterpriseState, actor: string) =>
  manages(s, e, actor) ||
  e.capital?.positions.some((p) => visibleAccount(s, p.account, actor)) ||
  Object.keys(e.capital?.agreements ?? {}).some((id) => visibleAgreement(s, e, id, actor));
export function executeCapitalTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actor: string,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
  authorize?: ControlAuthorizationPort,
): ToolExecution {
  if (!s.world.capitalAgreements) throw new ToolRefusal('capital-agreements-not-enabled');
  const result = (data: unknown): ToolExecution => ({ effects: {}, data });
  if (name === 'capital.list')
    return result(
      pageItems(
        Object.values(s.world.enterprises)
          .filter((e) => visibleFirm(s, e, actor))
          .sort((a, b) => a.enterpriseId.localeCompare(b.enterpriseId, 'en'))
          .map((e) => ({
            enterpriseId: e.enterpriseId,
            name: e.name,
            status: e.status,
            initialized: !!e.capital,
            equityVersion: e.capital?.equityVersion ?? null,
            readWith: 'town capital rights',
          })),
        args,
      ),
    );
  const enterpriseId = stringArg(args, 'enterpriseId'),
    e = s.world.enterprises[enterpriseId];
  if (!e || !visibleFirm(s, e, actor)) throw new ToolRefusal('capital-enterprise-not-visible');
  if (name === 'capital.rights')
    return result({
      enterpriseId,
      status: e.status,
      initialized: !!e.capital,
      controller: enterpriseController(e),
      controlVersion: enterpriseControlVersion(e),
      equityVersion: e.capital?.equityVersion ?? null,
      positions: pageItems(e.capital?.positions ?? [], args),
      source: {
        kind: 'inherited-enterprise-rights',
        positions: e.capital?.initialPositions ?? null,
      },
      ...(manages(s, e, actor)
        ? { companyBalance: e.balance, retainedEarnings: e.retainedEarnings ?? 0 }
        : {}),
      lastDeferredDistribution:
        s.world.capitalAgreements.deferredDistributions?.[enterpriseId] ?? null,
      agreementsWith: 'town capital agreements',
      scope:
        'Capital rights alone do not authorize management, employment, salary or automatic forgiveness of obligations.',
    });
  if (name === 'capital.agreements')
    return result(
      pageItems(
        Object.values(e.capital?.agreements ?? {})
          .filter((a) => visibleAgreement(s, e, a.id, actor))
          .sort((a, b) => b.proposedAt - a.proposedAt || a.id.localeCompare(b.id, 'en'))
          .map((a) => ({
            id: a.id,
            revision: a.revision,
            status: a.status,
            proposedBy: a.proposedBy,
            equityVersion: a.equityVersion,
            expiresAt: a.expiresAt,
            consentCount: Object.keys(a.consents).length,
            participantCount: a.participants.length,
            readWith: 'town capital read',
          })),
        args,
      ),
    );
  const id = stringArg(args, 'id');
  if (name === 'capital.read') {
    const a = e.capital?.agreements[id];
    if (!a || !visibleAgreement(s, e, id, actor))
      throw new ToolRefusal('capital-agreement-not-visible');
    return result({
      ...a,
      contributions: a.contributions.map((c) => ({
        account: c.account,
        amount: c.amountMicros / CAPITAL_AGREEMENTS_POLICY.moneyScale,
      })),
      disbursements: a.disbursements.map((d) => ({
        account: d.account,
        amount: d.amountMicros / CAPITAL_AGREEMENTS_POLICY.moneyScale,
      })),
      heldAmount: capitalHeldMicros(a) / CAPITAL_AGREEMENTS_POLICY.moneyScale,
      capitalVersionStale: a.equityVersion !== e.capital.equityVersion,
      expired: s.world.clock.now >= a.expiresAt,
    });
  }
  let command: CapitalEnterpriseCommand;
  if (name === 'capital.close')
    command = {
      type: 'close',
      expectedEquityVersion: numberArg(args, 'expectedEquityVersion'),
      expectedControlVersion: numberArg(args, 'expectedControlVersion'),
    };
  else if (name === 'capital.initialize') command = { type: 'initialize' };
  else if (name === 'capital.propose') {
    const allocation = parseCapitalAllocation(args.allocation);
    if (!allocation) throw new ToolRefusal('invalid-capital-allocation');
    command = {
      type: 'propose',
      id,
      terms: stringArg(args, 'terms'),
      expiresAt: numberArg(args, 'expiresAt'),
      expectedEquityVersion: numberArg(args, 'expectedEquityVersion'),
      ...allocation,
    };
  } else if (name === 'capital.accept') {
    const sector = stringArg(args, 'accountSector');
    if (sector !== 'agent' && sector !== 'collective')
      throw new ToolRefusal('invalid-capital-account');
    command = {
      type: 'accept',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
      account: { sector, id: stringArg(args, 'accountId') },
    };
  } else if (name === 'capital.authorize')
    command = {
      type: 'authorize',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
      expectedControlVersion: numberArg(args, 'expectedControlVersion'),
    };
  else if (name === 'capital.execute' || name === 'capital.cancel')
    command = {
      type: name === 'capital.execute' ? 'execute' : 'cancel',
      id,
      expectedRevision: numberArg(args, 'expectedRevision'),
    };
  else throw new ToolRefusal('unknown-capital-capability');
  const auth: ControlAuthorizationPort = (c) =>
    !controllerAvailable(s, c)
      ? undefined
      : authorize
        ? authorize(c)
        : c.kind === 'resident' && c.id === actor
          ? { actorId: actor }
          : undefined;
  const d = residentCapitalCommand({
    projection: s.world,
    ...(s.services ? { directory: s.services } : {}),
    actorId: actor,
    enterpriseId,
    command,
    authorize: auth,
    requestId: `capital-${digest([actor, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    effects: { worldEvents: d.events },
    data: {
      enterpriseId,
      ...(id ? { id } : {}),
      events: d.events.map((e) => ({ id: e.id, type: e.type })),
      readWith: id ? 'town capital read' : 'town capital rights',
    },
  };
}
function resourceParameters(a: CollectiveResourceAction) {
  if (Object.hasOwn(a.arguments, 'enterpriseId')) return undefined;
  const t = CAPITAL_TOOLS.find((t) => t.name === a.capability && t.mutates),
    args: Record<string, unknown> = { ...a.arguments, enterpriseId: a.resourceId };
  return t && !validateOpenToolArguments(t, args) ? args : undefined;
}
export function validateCapitalResource(
  s: OpenSocietyState,
  collectiveId: string,
  a: CollectiveResourceAction,
): string | undefined {
  const args = resourceParameters(a),
    e = s.world.enterprises[a.resourceId];
  if (!s.world.capitalAgreements || !args || !e || !s.collectives?.charters[collectiveId])
    return 'invalid-capital-resource-action';
  const own = (account: CapitalAccount) =>
    account.sector === 'collective' &&
    s.world.commonAccounts?.accounts[account.id]?.collectiveId === collectiveId;
  const manager = sameController(enterpriseController(e), { kind: 'collective', id: collectiveId });
  if (
    a.capability === 'capital.initialize' ||
    a.capability === 'capital.authorize' ||
    a.capability === 'capital.close'
  )
    return manager ? undefined : 'collective-does-not-control-enterprise';
  if (a.capability === 'capital.propose')
    return manager || e.capital?.positions.some((p) => own(p.account))
      ? undefined
      : 'collective-capital-holder-required';
  const agreement = e.capital?.agreements[stringArg(args, 'id')];
  if (!agreement) return 'capital-agreement-not-found';
  if (a.capability === 'capital.accept')
    return args.accountSector === 'collective' &&
      own({ sector: 'collective', id: stringArg(args, 'accountId') })
      ? undefined
      : 'collective-does-not-control-capital-account';
  if (
    a.capability === 'capital.cancel' &&
    sameController(agreement.proposerAuthority.controller, { kind: 'collective', id: collectiveId })
  )
    return undefined;
  return agreement.participants.some(own) ? undefined : 'collective-capital-participant-required';
}
export function executeApprovedCapital(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actor: string,
  collectiveId: string,
  decisionId: string,
  a: CollectiveResourceAction,
  requestId: string,
): ToolExecution {
  const error = validateCapitalResource(s, collectiveId, a);
  if (error) throw new ToolRefusal(error);
  return executeCapitalTool(s, m, actor, a.capability, resourceParameters(a)!, requestId, (c) =>
    sameController(c, { kind: 'collective', id: collectiveId })
      ? { actorId: actor, decisionId }
      : undefined,
  );
}
