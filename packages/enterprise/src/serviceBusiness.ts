import {
  enterpriseLaborRateReference,
  assertEnterpriseLaborRateReference,
  matchesEnterpriseLaborRate,
  type EnterpriseLaborRateReference,
} from './laborTerms';
import { enterpriseRequiresManagement } from './control';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import {
  enterpriseManagementAuthority,
  assertEnterpriseManagementAuthority,
  type EnterpriseManagementAuthority,
} from './control';
import type { AgentId } from '@aivilization/sim-core';
import type { EnterpriseState } from './model';

export const SERVICE_BUSINESS_POLICY = {
  version: 'enterprise-service-business-v1',
  maxContracts: 10000,
  maxAmountMicros: 1_000_000_000_000_000,
  maxWorkMs: 86400000,
} as const;
export type ServiceWageBasis = 'none' | 'attendance' | 'effective-service';
/** Financial permission, not a service, attendance record, qualification, or facility permission. */
export type EnterpriseServiceAuthorization = {
  readonly authority?: EnterpriseManagementAuthority;
  readonly serviceId: string;
  readonly sourceRevision: number;
  readonly authorizedBy: AgentId;
  readonly at: number;
  readonly providerId: AgentId;
  readonly payer: boolean;
  readonly revenueRecipient: boolean;
  readonly debitLimitMicros: number;
  readonly revenueLimitMicros: number;
  readonly maxWorkMs: number;
  readonly wageBasis: ServiceWageBasis;
  readonly wageOffer?: number;
  readonly wageTerms?: EnterpriseLaborRateReference;
};
export type EnterpriseServiceContract = {
  readonly authorization: EnterpriseServiceAuthorization;
  readonly revision: number;
  readonly sourceRevision: number;
  readonly at: number;
  readonly phase: 'authorized' | 'funded' | 'ended' | 'revoked';
  readonly fundedMicros: number;
  readonly costMicros: number;
  readonly refundMicros: number;
  readonly revenueMicros: number;
};
export type EnterpriseServiceBusinessState = {
  readonly policyVersion: typeof SERVICE_BUSINESS_POLICY.version;
  readonly contracts: Readonly<Record<string, EnterpriseServiceContract>>;
};
export type ServiceAccountingFacts = Pick<
  EnterpriseServiceContract,
  'sourceRevision' | 'fundedMicros' | 'costMicros' | 'refundMicros' | 'revenueMicros' | 'at'
> & {
  readonly serviceId: string;
  readonly previousRevision: number;
  readonly phase: 'funded' | 'ended';
};
export type EnterpriseServiceBusinessEvent =
  | {
      readonly type: 'EnterpriseServiceAuthorized';
      readonly policyVersion: typeof SERVICE_BUSINESS_POLICY.version;
      readonly authorization: EnterpriseServiceAuthorization;
    }
  | {
      readonly type: 'EnterpriseServiceAuthorizationRevoked';
      readonly authority?: EnterpriseManagementAuthority;
      readonly serviceId: string;
      readonly previousRevision: number;
      readonly actorId: AgentId;
      readonly at: number;
    }
  | ({ readonly type: 'EnterpriseServiceAccountingRecorded' } & ServiceAccountingFacts);
type Decision =
  | { readonly accepted: true; readonly event: EnterpriseServiceBusinessEvent }
  | { readonly accepted: false; readonly reason: string };
const key = (s: string) =>
  typeof s === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(s) &&
  !['constructor', 'prototype', '__proto__'].includes(s);
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const micros = (n: number) => integer(n) && n <= SERVICE_BUSINESS_POLICY.maxAmountMicros;
export function assertServiceBusiness(s: EnterpriseServiceBusinessState): void {
  if (
    s.policyVersion !== SERVICE_BUSINESS_POLICY.version ||
    Object.keys(s.contracts).length > SERVICE_BUSINESS_POLICY.maxContracts
  )
    throw Error('invalid-service-business-state');
  for (const [id, c] of Object.entries(s.contracts)) {
    const a = c.authorization;
    if (a.wageTerms) {
      assertEnterpriseLaborRateReference(a.wageTerms);
      if (a.wageBasis === 'none' || a.wageTerms.wageMicros / 1e6 !== a.wageOffer)
        throw Error('invalid-service-wage-terms');
    }
    if (
      !key(id) ||
      id !== a.serviceId ||
      !key(a.authorizedBy) ||
      !key(a.providerId) ||
      !integer(a.at) ||
      !integer(a.sourceRevision) ||
      a.sourceRevision < 1 ||
      !integer(c.revision) ||
      c.revision < 1 ||
      !integer(c.sourceRevision) ||
      c.sourceRevision < a.sourceRevision ||
      !integer(c.at) ||
      c.at < a.at ||
      !integer(a.maxWorkMs) ||
      a.maxWorkMs < 1 ||
      a.maxWorkMs > SERVICE_BUSINESS_POLICY.maxWorkMs ||
      typeof a.payer !== 'boolean' ||
      typeof a.revenueRecipient !== 'boolean' ||
      !['none', 'attendance', 'effective-service'].includes(a.wageBasis) ||
      (!a.payer && !a.revenueRecipient && a.wageBasis === 'none') ||
      (!a.payer && a.debitLimitMicros !== 0) ||
      (!a.revenueRecipient && a.revenueLimitMicros !== 0) ||
      [
        a.debitLimitMicros,
        a.revenueLimitMicros,
        c.fundedMicros,
        c.costMicros,
        c.refundMicros,
        c.revenueMicros,
      ].some((n) => !micros(n)) ||
      c.fundedMicros > a.debitLimitMicros ||
      c.costMicros + c.refundMicros > c.fundedMicros ||
      c.revenueMicros > a.revenueLimitMicros ||
      !['authorized', 'funded', 'ended', 'revoked'].includes(c.phase) ||
      (c.phase === 'funded' && c.fundedMicros !== a.debitLimitMicros) ||
      (c.phase === 'ended' && c.costMicros + c.refundMicros !== c.fundedMicros) ||
      (['authorized', 'revoked'].includes(c.phase) &&
        [c.fundedMicros, c.costMicros, c.refundMicros, c.revenueMicros].some((n) => n !== 0)) ||
      (a.wageBasis === 'none'
        ? a.wageOffer !== undefined
        : typeof a.wageOffer !== 'number' || !Number.isFinite(a.wageOffer) || a.wageOffer <= 0)
    )
      throw Error('invalid-enterprise-service-contract');
  }
}
export function hasOpenServiceBusiness(e: EnterpriseState): boolean {
  return Object.values(e.serviceBusiness?.contracts ?? {}).some((c) => c.phase === 'funded');
}
function decide(e: EnterpriseState, event: EnterpriseServiceBusinessEvent): Decision {
  try {
    applyServiceBusinessEvent(e, event);
    return { accepted: true, event };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-service-business',
    };
  }
}
export function decideAuthorizeServiceBusiness(input: {
  enterprise: EnterpriseState;
  authorize?: ControlAuthorizationPort;
  actorId: AgentId;
  at: number;
  agreedRates?: true;
  terms: Omit<
    EnterpriseServiceAuthorization,
    'authorizedBy' | 'at' | 'wageOffer' | 'wageTerms' | 'authority'
  >;
}): Decision {
  const e = input.enterprise,
    t = input.terms,
    wageTerms =
      input.agreedRates && t.wageBasis !== 'none'
        ? enterpriseLaborRateReference(e, t.providerId, input.at)
        : undefined,
    wageOffer = input.agreedRates
      ? wageTerms
        ? wageTerms.wageMicros / 1e6
        : undefined
      : e.employeeWageOffers?.[t.providerId],
    authority = enterpriseManagementAuthority(
      e,
      input.actorId,
      'authorize-service',
      input.authorize,
    );
  if (!authority) return { accepted: false, reason: 'enterprise-service-authorization-required' };
  return decide(e, {
    type: 'EnterpriseServiceAuthorized',
    policyVersion: SERVICE_BUSINESS_POLICY.version,
    authorization: {
      ...t,
      ...(enterpriseRequiresManagement(e) ? { authority } : {}),
      authorizedBy: input.actorId,
      at: input.at,
      ...(t.wageBasis === 'none' || wageOffer === undefined ? {} : { wageOffer }),
      ...(wageTerms ? { wageTerms } : {}),
    },
  });
}
export function decideRevokeServiceBusiness(
  e: EnterpriseState,
  actorId: AgentId,
  serviceId: string,
  previousRevision: number,
  at: number,
  authorize?: ControlAuthorizationPort,
): Decision {
  const authority = enterpriseManagementAuthority(e, actorId, 'revoke-service', authorize);
  if (!authority)
    return { accepted: false, reason: 'only-unused-service-authorization-can-be-revoked' };
  return decide(e, {
    type: 'EnterpriseServiceAuthorizationRevoked',
    ...(enterpriseRequiresManagement(e) ? { authority } : {}),
    actorId,
    serviceId,
    previousRevision,
    at,
  });
}
export function decideRecordServiceAccounting(
  e: EnterpriseState,
  facts: ServiceAccountingFacts,
): Decision {
  return decide(e, { type: 'EnterpriseServiceAccountingRecorded', ...facts });
}
export function applyServiceBusinessEvent(
  e: EnterpriseState,
  event: EnterpriseServiceBusinessEvent,
): EnterpriseState {
  let next: EnterpriseServiceContract,
    balance = e.balance,
    retainedEarnings =
      e.retainedEarnings ??
      e.cumulativeSales - e.cumulativePurchases - e.cumulativeWages - (e.cumulativeDividends ?? 0);
  if (event.type === 'EnterpriseServiceAuthorized') {
    const a = event.authorization;
    if (enterpriseRequiresManagement(e))
      assertEnterpriseManagementAuthority(e, a.authority, 'authorize-service');
    if (
      event.policyVersion !== SERVICE_BUSINESS_POLICY.version ||
      (enterpriseRequiresManagement(e)
        ? a.authority?.actorId !== a.authorizedBy
        : a.authorizedBy !== e.ownerAgentId) ||
      !['active', 'insolvent'].includes(e.status) ||
      a.at < e.foundedAt ||
      Object.hasOwn(e.serviceBusiness?.contracts ?? {}, a.serviceId) ||
      (a.wageBasis !== 'none' &&
        (!e.earnedPayroll ||
          !e.employeeAgentIds.includes(a.providerId) ||
          (a.wageTerms
            ? !matchesEnterpriseLaborRate(e, a.providerId, a.wageTerms, a.at) ||
              a.wageTerms.wageMicros / 1e6 !== a.wageOffer
            : e.employeeWageOffers?.[a.providerId] !== a.wageOffer)))
    )
      throw Error('enterprise-service-authorization-required');
    next = {
      authorization: structuredClone(a),
      revision: 1,
      sourceRevision: a.sourceRevision,
      at: a.at,
      phase: 'authorized',
      fundedMicros: 0,
      costMicros: 0,
      refundMicros: 0,
      revenueMicros: 0,
    };
  } else {
    const old = e.serviceBusiness?.contracts[event.serviceId];
    if (
      !old ||
      old.revision !== event.previousRevision ||
      !integer(event.at) ||
      event.at < old.at ||
      ['ended', 'revoked'].includes(old.phase)
    )
      throw Error('enterprise-service-revision-or-phase-conflict');
    if (event.type === 'EnterpriseServiceAuthorizationRevoked') {
      if (enterpriseRequiresManagement(e))
        assertEnterpriseManagementAuthority(e, event.authority, 'revoke-service');
      if (
        (enterpriseRequiresManagement(e)
          ? event.authority?.actorId !== event.actorId
          : event.actorId !== e.ownerAgentId) ||
        old.phase !== 'authorized'
      )
        throw Error('only-unused-service-authorization-can-be-revoked');
      next = { ...old, revision: old.revision + 1, at: event.at, phase: 'revoked' };
    } else {
      if (
        e.status === 'closed' ||
        event.sourceRevision <= old.sourceRevision ||
        event.fundedMicros < old.fundedMicros ||
        event.costMicros < old.costMicros ||
        event.refundMicros < old.refundMicros ||
        event.revenueMicros < old.revenueMicros ||
        (old.phase === 'funded' && event.fundedMicros !== old.fundedMicros) ||
        (event.fundedMicros > old.fundedMicros && !['active', 'insolvent'].includes(e.status))
      )
        throw Error('invalid-service-accounting-transition');
      balance +=
        (event.refundMicros -
          old.refundMicros +
          event.revenueMicros -
          old.revenueMicros -
          event.fundedMicros +
          old.fundedMicros) /
        1000000;
      retainedEarnings +=
        (event.revenueMicros - old.revenueMicros - event.costMicros + old.costMicros) / 1000000;
      if (!Number.isFinite(balance) || balance < 0 || !Number.isFinite(retainedEarnings))
        throw Error('enterprise-service-insufficient-cash');
      next = {
        authorization: old.authorization,
        revision: old.revision + 1,
        sourceRevision: event.sourceRevision,
        at: event.at,
        phase: event.phase,
        fundedMicros: event.fundedMicros,
        costMicros: event.costMicros,
        refundMicros: event.refundMicros,
        revenueMicros: event.revenueMicros,
      };
    }
  }
  const state: EnterpriseServiceBusinessState = {
    policyVersion: SERVICE_BUSINESS_POLICY.version,
    contracts: { ...e.serviceBusiness?.contracts, [next.authorization.serviceId]: next },
  };
  assertServiceBusiness(state);
  return { ...e, balance, retainedEarnings, serviceBusiness: state };
}
/** An employment change cannot silently reuse old financial permission for the provider. */
export function serviceEmploymentTerms(
  e: EnterpriseState,
  serviceId: string,
  actorId: AgentId,
  at = 0,
  existingSession = false,
): EnterpriseServiceAuthorization | undefined {
  const c = e.serviceBusiness?.contracts[serviceId],
    a = c?.authorization;
  return c?.phase === 'funded' &&
    a?.providerId === actorId &&
    a.wageBasis !== 'none' &&
    ['active', 'insolvent'].includes(e.status) &&
    e.employeeAgentIds.includes(actorId) &&
    (a.wageTerms
      ? matchesEnterpriseLaborRate(e, actorId, a.wageTerms, at, existingSession)
      : e.employeeWageOffers?.[actorId] === a.wageOffer)
    ? a
    : undefined;
}
