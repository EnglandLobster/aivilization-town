import { hasEnterprisePrincipalAssets } from './principalResourceObligations';
import { enterpriseServiceEstateRefusal } from './servicePrincipalEstate';
import type { ServicesState } from '@aivilization/services';
import type { CapitalEnterpriseCommand } from './capitalModel';
import {
  CAPITAL_AGREEMENTS_POLICY,
  decideCapitalAgreement,
  enterpriseController,
  enterpriseControlVersion,
  enterpriseManagementAuthority,
  inheritedEnterpriseCapital,
  enterpriseCapitalPayments,
  type EnterpriseCapitalEvent,
} from '@aivilization/enterprise';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { applyWorldEvent, type WorldProjection } from './projection';
import { resolveCapitalInvocation } from './capitalAuthority';
import { residentFinancialAccount } from './residentFinancialAccounts';
import { capitalCommit } from './capitalSettlement';
import { advanceResidentCapital } from './capitalLifecycle';
export { enableResidentCapitalEvent, capitalCommit } from './capitalSettlement';
type Context = {
  projection: WorldProjection;
  actorId: string;
  enterpriseId: string;
  requestId: string;
  simulationId: string;
  nextSequence: number;
};
export function residentCapitalCommand(
  input: Context & {
    command: CapitalEnterpriseCommand;
    directory?: ServicesState;
    authorize?: ControlAuthorizationPort;
  },
) {
  const w = input.projection,
    e = w.enterprises[input.enterpriseId],
    c = input.command,
    authorize = input.authorize ?? personalControlAuthorization(input.actorId);
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!w.capitalAgreements || !e || !w.agents[input.actorId])
    return no('capital-enterprise-or-actor-unavailable');
  if (e.status === 'closed') return no('capital-enterprise-closed');
  const invocation = resolveCapitalInvocation(w, e, input.actorId, c, authorize);
  if (!invocation) return no('capital-authority-required');
  let events: readonly EnterpriseCapitalEvent[];
  if (c.type === 'close') {
    const serviceRefusal = enterpriseServiceEstateRefusal(w, e.enterpriseId, input.directory);
    if (serviceRefusal) return no(serviceRefusal);
    if (hasEnterprisePrincipalAssets(w, e.enterpriseId))
      return no('enterprise-resource-estate-unsettled');
    if (!e.capital || c.expectedEquityVersion !== e.capital.equityVersion)
      return no('capital-equity-version-conflict');
    if (c.expectedControlVersion !== enterpriseControlVersion(e))
      return no('enterprise-control-revision-conflict');
    const authority = enterpriseManagementAuthority(e, input.actorId, 'close', authorize);
    if (!authority) return no('capital-management-authority-required');
    events = [
      {
        type: 'EnterpriseCapitalClosed',
        at: w.clock.now,
        equityVersion: e.capital.equityVersion,
        totalAmount: e.balance,
        payments: enterpriseCapitalPayments(e, e.balance),
        authority,
      },
    ];
  } else if (c.type === 'initialize') {
    if (e.capital) return no('enterprise-capital-already-enabled');
    const authority = enterpriseManagementAuthority(
      e,
      input.actorId,
      'activate-capital',
      authorize,
    );
    if (!authority) return no('capital-management-authority-required');
    events = [
      {
        type: 'EnterpriseCapitalEnabled',
        policyVersion: CAPITAL_AGREEMENTS_POLICY.version,
        at: w.clock.now,
        initialPositions: inheritedEnterpriseCapital(e),
        authority,
      },
    ];
  } else {
    if (!e.capital) return no('enterprise-capital-not-initialized');
    const d = decideCapitalAgreement({
      state: e.capital,
      at: w.clock.now,
      actorId: input.actorId,
      command: c,
      management: {
        controller: enterpriseController(e),
        controlVersion: enterpriseControlVersion(e),
      },
      account: (a) => {
        const p = residentFinancialAccount(w, a);
        return p
          ? {
              controller: p.controller,
              balanceMicros: Math.floor(p.balance * CAPITAL_AGREEMENTS_POLICY.moneyScale),
              open: p.status === 'open',
            }
          : undefined;
      },
      authorize,
    });
    if (!d.accepted) return d;
    events = d.events.map((event) => ({ type: 'EnterpriseCapitalAgreementCommitted', event }));
  }
  const result = capitalCommit({ ...input, events, invocation });
  if (!result.accepted || c.type !== 'execute') return result;
  const working = result.events.reduce(applyWorldEvent, w);
  const refunds = advanceResidentCapital({
    projection: working,
    at: w.clock.now,
    simulationId: input.simulationId,
    requestId: `${input.requestId}-refund`,
    nextSequence: input.nextSequence + result.events.length,
  });
  return { accepted: true as const, events: [...result.events, ...refunds] };
}
