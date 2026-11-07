import {
  applyEnterpriseDomainEvent,
  decideRecordServiceAccounting,
} from '@aivilization/enterprise';
import {
  serviceMoneyMicros,
  serviceFactsEqual,
  type ServiceEngagementEvent,
} from '@aivilization/services';
import type { WorldProjection } from './projection';
import type { ServiceEnterpriseAccounting } from './serviceEmploymentModel';
import { serviceBusinessRoles } from './serviceBusinessAuthorization';

/** Derive correlated cumulative ledger facts from authoritative service events, never from prose or caller amounts. */
export function serviceEnterpriseAccountingFacts(
  w: WorldProjection,
  events: readonly ServiceEngagementEvent[],
): readonly ServiceEnterpriseAccounting[] {
  const result: ServiceEnterpriseAccounting[] = [];
  for (const change of events) {
    if (change.type !== 'ServiceEngagementChanged') continue;
    const e = change.engagement,
      before = w.serviceEngagements?.engagements[e.id];
    const corporate = [e.payer, e.revenue].filter((a) => a.sector === 'enterprise');
    if (corporate.length && !w.serviceEmployment) throw Error('service-enterprise-mode-required');
    if (!w.serviceEmployment || !before) continue;
    if (e.fundedBy) {
      for (const account of corporate) {
        const c = w.enterprises[account.id]?.serviceBusiness?.contracts[e.id];
        if (!c || !['authorized', 'funded'].includes(c.phase))
          throw Error('exact-enterprise-service-authorization-required');
      }
    }
    for (const enterprise of Object.values(w.enterprises).sort((a, b) =>
      a.enterpriseId < b.enterpriseId ? -1 : a.enterpriseId > b.enterpriseId ? 1 : 0,
    )) {
      const c = enterprise.serviceBusiness?.contracts[e.id];
      if (!c || ['ended', 'revoked'].includes(c.phase)) continue;
      if (!e.fundedBy && e.status !== 'ended') continue;
      if (
        c.phase === 'authorized' &&
        e.fundedBy &&
        !['active', 'insolvent'].includes(enterprise.status)
      )
        throw Error('service-enterprise-no-longer-operational');
      const a = c.authorization,
        roles = serviceBusinessRoles(e, enterprise.enterpriseId);
      if (
        a.providerId !== e.providerId ||
        a.sourceRevision > before.revision ||
        a.payer !== roles.payer ||
        a.revenueRecipient !== roles.revenueRecipient ||
        a.debitLimitMicros !== roles.debitLimitMicros ||
        a.revenueLimitMicros !== roles.revenueLimitMicros
      )
        throw Error('enterprise-service-accounting-source-mismatch');
      const facts = {
        phase: e.status === 'ended' ? ('ended' as const) : ('funded' as const),
        fundedMicros: e.fundedBy && roles.payer ? serviceMoneyMicros(e.maximumCharge) : 0,
        costMicros: roles.payer ? serviceMoneyMicros(e.charged) : 0,
        refundMicros: roles.payer ? serviceMoneyMicros(e.refunded) : 0,
        revenueMicros: roles.revenueRecipient ? serviceMoneyMicros(e.revenuePaid) : 0,
      };
      if (Object.entries(facts).every(([key, value]) => c[key as keyof typeof facts] === value))
        continue;
      result.push({
        enterpriseId: enterprise.enterpriseId,
        event: {
          type: 'EnterpriseServiceAccountingRecorded',
          serviceId: e.id,
          previousRevision: c.revision,
          sourceRevision: e.revision,
          at: e.at,
          ...facts,
        },
      });
    }
  }
  return result;
}
export function prepareServiceEnterpriseAccounting(
  w: WorldProjection,
  events: readonly ServiceEngagementEvent[],
) {
  const facts = serviceEnterpriseAccountingFacts(w, events),
    enterprises = { ...w.enterprises };
  for (const fact of facts) {
    const d = decideRecordServiceAccounting(enterprises[fact.enterpriseId]!, fact.event);
    if (!d.accepted) throw Error(d.reason);
    enterprises[fact.enterpriseId] = applyEnterpriseDomainEvent(
      enterprises[fact.enterpriseId],
      d.event,
    );
  }
  return facts;
}
export function assertServiceEnterpriseAccounting(
  w: WorldProjection,
  events: readonly ServiceEngagementEvent[],
  facts: readonly ServiceEnterpriseAccounting[],
) {
  if (!serviceFactsEqual(serviceEnterpriseAccountingFacts(w, events), facts))
    throw Error('service-enterprise-source-proof-mismatch');
}
