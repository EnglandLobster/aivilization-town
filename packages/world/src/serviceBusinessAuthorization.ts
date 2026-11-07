import type { ControlAuthorizationPort } from '@aivilization/authority';
import { applyServiceWagePaid } from './serviceWages';
import {
  applyEnterpriseDomainEvent,
  decideAuthorizeServiceBusiness,
  decideEnableEarnedPayroll,
  decideRevokeServiceBusiness,
  type ServiceWageBasis,
} from '@aivilization/enterprise';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import {
  cumulativeProviderPay,
  serviceMoneyMicros,
  SERVICE_ENGAGEMENTS_POLICY,
  type ServiceEngagement,
} from '@aivilization/services';
import {
  SERVICE_EMPLOYMENT_VERSION,
  SERVICE_CLEARING_ORDER,
  type ServiceBusinessAuthorizationPayload,
} from './serviceEmploymentModel';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';

export function serviceBusinessRoles(e: ServiceEngagement, enterpriseId: string) {
  const payer = e.payer.sector === 'enterprise' && e.payer.id === enterpriseId;
  const revenueRecipient = e.revenue.sector === 'enterprise' && e.revenue.id === enterpriseId;
  return {
    payer,
    revenueRecipient,
    debitLimitMicros: payer ? serviceMoneyMicros(e.maximumCharge) : 0,
    revenueLimitMicros: revenueRecipient
      ? serviceMoneyMicros(e.maximumCharge) -
        serviceMoneyMicros(cumulativeProviderPay(e.maximumCharge, e.providerShareBps))
      : 0,
  };
}
function activation(w: WorldProjection) {
  if (
    w.serviceEmployment ||
    !w.serviceTime ||
    !w.residentLabor ||
    Object.values(w.serviceEngagements?.engagements ?? {}).some((e) => e.status === 'funded')
  )
    throw Error('service-employment-needs-actual-time-labor-and-no-funded-legacy-services');
}
export function enableServiceEmploymentEvent(input: {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  activation(input.projection);
  return createEventEnvelope({
    id: `${input.requestId}:enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentServiceEmploymentEnabled',
    payload: {
      policyVersion: SERVICE_EMPLOYMENT_VERSION,
      clearingOrder: SERVICE_CLEARING_ORDER,
      claims: {},
    } as const,
  });
}
export function serviceBusinessAuthorizationEvent(input: {
  projection: WorldProjection;
  actorId: string;
  enterpriseId: string;
  serviceId: string;
  expectedServiceRevision: number;
  operation: 'authorize' | 'revoke';
  authorize?: ControlAuthorizationPort;
  wageBasis?: ServiceWageBasis;
  expectedAuthorizationRevision?: number;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}) {
  try {
    const w = input.projection,
      service = w.serviceEngagements?.engagements[input.serviceId];
    let enterprise = w.enterprises[input.enterpriseId];
    if (
      !w.serviceEmployment ||
      !enterprise ||
      !service ||
      service.revision !== input.expectedServiceRevision
    )
      throw Error('service-business-source-or-revision-required');
    const events: ServiceBusinessAuthorizationPayload['events'][number][] = [];
    if (input.operation === 'authorize') {
      if (!['offered', 'accepted'].includes(service.status) || input.wageBasis === undefined)
        throw Error('service-business-authorization-before-funding-required');
      if (input.wageBasis !== 'none') {
        if (
          Object.values(w.enterprises).some((e) => {
            const c = e.serviceBusiness?.contracts[service.id];
            return c && c.phase !== 'revoked' && c.authorization.wageBasis !== 'none';
          })
        )
          throw Error('service-employer-already-authorized');
        if (!enterprise.earnedPayroll) {
          const d = decideEnableEarnedPayroll(enterprise);
          if (!d.accepted) throw Error(d.reason);
          events.push(d.event);
          enterprise = applyEnterpriseDomainEvent(enterprise, d.event);
        }
      }
      const d = decideAuthorizeServiceBusiness({
        ...(w.residentLabor?.configuration.compensationSource ===
        'accepted-enterprise-labor-terms-v1'
          ? { agreedRates: true as const }
          : {}),
        enterprise,
        ...(input.authorize ? { authorize: input.authorize } : {}),
        actorId: asAgentId(input.actorId),
        at: w.clock.now,
        terms: {
          serviceId: service.id,
          sourceRevision: service.revision,
          providerId: asAgentId(service.providerId),
          ...serviceBusinessRoles(service, enterprise.enterpriseId),
          maxWorkMs:
            input.wageBasis === 'attendance'
              ? Math.min(service.endAt - service.startAt, SERVICE_ENGAGEMENTS_POLICY.maxDurationMs)
              : service.maxDurationMs,
          wageBasis: input.wageBasis,
        },
      });
      if (!d.accepted) throw Error(d.reason);
      events.push(d.event);
    } else {
      if (input.expectedAuthorizationRevision === undefined)
        throw Error('service-authorization-revision-required');
      const d = decideRevokeServiceBusiness(
        enterprise,
        asAgentId(input.actorId),
        service.id,
        input.expectedAuthorizationRevision,
        w.clock.now,
        input.authorize,
      );
      if (!d.accepted) throw Error(d.reason);
      events.push(d.event);
    }
    return {
      accepted: true as const,
      events: [
        createEventEnvelope({
          id: `${input.requestId}:authorization`,
          simulationId: input.simulationId,
          sequence: input.nextSequence,
          occurredAt: w.clock.now,
          type: 'ResidentServiceBusinessAuthorized',
          payload: {
            actorId: input.actorId,
            enterpriseId: enterprise.enterpriseId,
            serviceId: service.id,
            expectedServiceRevision: service.revision,
            events,
          },
        }),
      ],
    };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-service-business-authorization',
    };
  }
}
export function applyServiceBusinessAuthorization(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  const paid = applyServiceWagePaid(w, e);
  if (paid) return paid;
  if (e.type === 'ResidentServiceEmploymentEnabled') {
    activation(w);
    if (
      Object.keys(e.payload.claims).length ||
      e.occurredAt !== w.clock.now ||
      e.payload.policyVersion !== SERVICE_EMPLOYMENT_VERSION ||
      e.payload.clearingOrder !== SERVICE_CLEARING_ORDER
    )
      throw Error('invalid-service-employment-activation');
    return { ...w, serviceEmployment: { ...e.payload } };
  }
  if (e.type !== 'ResidentServiceBusinessAuthorized') return undefined;
  const p = e.payload,
    service = w.serviceEngagements?.engagements[p.serviceId];
  let enterprise = w.enterprises[p.enterpriseId];
  if (
    !w.serviceEmployment ||
    !enterprise ||
    !service ||
    service.revision !== p.expectedServiceRevision ||
    e.occurredAt !== w.clock.now ||
    (!enterprise.control && p.actorId !== enterprise.ownerAgentId) ||
    p.events.length < 1 ||
    p.events.length > 2
  )
    throw Error('invalid-service-authorization-source');
  let authorizations = 0;
  for (const event of p.events) {
    if (event.type === 'EnterpriseEarnedPayrollEnabled') {
      if (
        enterprise.earnedPayroll ||
        p.events.length !== 2 ||
        p.events[0] !== event ||
        p.events[1]?.type !== 'EnterpriseServiceAuthorized' ||
        p.events[1].authorization.wageBasis === 'none'
      )
        throw Error('unrelated-service-payroll-enabling');
    } else if (event.type === 'EnterpriseServiceAuthorized') {
      authorizations++;
      const a = event.authorization,
        roles = serviceBusinessRoles(service, enterprise.enterpriseId);
      if (
        !['offered', 'accepted'].includes(service.status) ||
        a.serviceId !== service.id ||
        a.sourceRevision !== service.revision ||
        a.at !== e.occurredAt ||
        a.authorizedBy !== p.actorId ||
        a.providerId !== service.providerId ||
        a.payer !== roles.payer ||
        a.revenueRecipient !== roles.revenueRecipient ||
        a.debitLimitMicros !== roles.debitLimitMicros ||
        a.revenueLimitMicros !== roles.revenueLimitMicros ||
        a.maxWorkMs !==
          (a.wageBasis === 'attendance'
            ? Math.min(service.endAt - service.startAt, SERVICE_ENGAGEMENTS_POLICY.maxDurationMs)
            : service.maxDurationMs)
      )
        throw Error('service-authorization-terms-mismatch');
      if (
        a.wageBasis !== 'none' &&
        Object.values(w.enterprises).some((other) => {
          const c = other.serviceBusiness?.contracts[service.id];
          return c && c.phase !== 'revoked' && c.authorization.wageBasis !== 'none';
        })
      )
        throw Error('service-employer-already-authorized');
    } else if (event.type === 'EnterpriseServiceAuthorizationRevoked') {
      authorizations++;
      if (
        p.events.length !== 1 ||
        event.serviceId !== service.id ||
        event.actorId !== p.actorId ||
        event.at !== e.occurredAt
      )
        throw Error('service-revocation-source-mismatch');
    } else throw Error('unrelated-service-authorization-event');
    enterprise = applyEnterpriseDomainEvent(enterprise, event);
  }
  if (authorizations !== 1) throw Error('one-service-authorization-required');
  return { ...w, enterprises: { ...w.enterprises, [enterprise.enterpriseId]: enterprise } };
}
