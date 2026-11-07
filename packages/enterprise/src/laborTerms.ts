import { EARNED_PAYROLL_POLICY } from './earnedPayroll';
import {
  sameController,
  validController,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import type { EnterpriseState } from './model';
import { isEnterpriseOperational } from './model';
import {
  ENTERPRISE_CONTROL_VERSION,
  enterpriseControlVersion,
  enterpriseManagementAuthority,
  assertEnterpriseManagementAuthority,
  type EnterpriseManagementAuthority,
} from './control';

export const ENTERPRISE_LABOR_TERMS_POLICY = {
  version: 'enterprise-labor-terms-v1',
  moneyScale: EARNED_PAYROLL_POLICY.moneyScale,
  maxOffers: 10_000,
  maxReferenceMs: 31_536_000_000,
  maxValidityMs: 315_360_000_000,
} as const;
export type EnterpriseLaborOffer = {
  readonly id: string;
  readonly employeeId: string;
  readonly membershipGeneration: number;
  readonly wageMicros: number;
  readonly referenceMs: number;
  readonly validUntil: number;
  readonly offeredAt: number;
  readonly updatedAt: number;
  readonly revision: number;
  readonly authority: EnterpriseManagementAuthority;
  readonly status: 'offered' | 'accepted' | 'declined' | 'withdrawn';
  readonly respondedBy?: string;
};
export type EnterpriseLaborTermsState = {
  readonly policyVersion: typeof ENTERPRISE_LABOR_TERMS_POLICY.version;
  readonly revision: number;
  readonly updatedAt: number;
  readonly membershipGenerations: Readonly<Record<string, number>>;
  readonly offers: Readonly<Record<string, EnterpriseLaborOffer>>;
  readonly activeByEmployee: Readonly<Record<string, string>>;
};
export type EnterpriseLaborTermsEvent =
  | {
      readonly type: 'EnterpriseLaborTermsEnabled';
      readonly at: number;
      readonly policyVersion: typeof ENTERPRISE_LABOR_TERMS_POLICY.version;
    }
  | {
      readonly type: 'EnterpriseLaborTermsChanged';
      readonly previousRevision: number;
      readonly actorId: string;
      readonly offer: EnterpriseLaborOffer;
      readonly authority?: EnterpriseManagementAuthority;
    };
export type EnterpriseLaborTermsCommand =
  | {
      readonly type: 'offer';
      readonly id: string;
      readonly employeeId: string;
      readonly wageMicros: number;
      readonly referenceMs: number;
      readonly validUntil: number;
    }
  | {
      readonly type: 'accept' | 'decline' | 'withdraw';
      readonly id: string;
      readonly expectedRevision: number;
    };
const key = (v: string) =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(v) &&
  !['constructor', 'prototype', '__proto__'].includes(v);
const integer = (v: number) => Number.isSafeInteger(v) && v >= 0;
function sameAuthority(a: EnterpriseManagementAuthority, b: EnterpriseManagementAuthority) {
  return (
    a.policyVersion === b.policyVersion &&
    a.enterpriseId === b.enterpriseId &&
    a.controlVersion === b.controlVersion &&
    sameController(a.controller, b.controller) &&
    a.actorId === b.actorId &&
    a.operation === b.operation &&
    a.decisionId === b.decisionId
  );
}
export function assertEnterpriseLaborTerms(s: EnterpriseLaborTermsState): void {
  if (
    s.policyVersion !== ENTERPRISE_LABOR_TERMS_POLICY.version ||
    !integer(s.revision) ||
    s.revision < 1 ||
    !integer(s.updatedAt) ||
    Object.keys(s.offers).length > ENTERPRISE_LABOR_TERMS_POLICY.maxOffers ||
    Object.entries(s.membershipGenerations).some(([id, n]) => !key(id) || !integer(n) || n < 1)
  )
    throw Error('invalid-labor-terms-state');
  for (const [id, o] of Object.entries(s.offers)) {
    const a = o.authority;
    if (
      !a ||
      a.policyVersion !== ENTERPRISE_CONTROL_VERSION ||
      !key(a.enterpriseId) ||
      !integer(a.controlVersion) ||
      !validController(a.controller) ||
      !key(a.actorId) ||
      a.operation !== 'offer-labor-terms' ||
      (a.controller.kind === 'resident'
        ? a.actorId !== a.controller.id || a.decisionId !== undefined
        : !key(a.decisionId ?? ''))
    )
      throw Error('invalid-labor-offer-authority');
    if (
      (o.status === 'accepted' || o.status === 'declined') &&
      (o.respondedBy !== o.employeeId || o.updatedAt >= o.validUntil)
    )
      throw Error('invalid-labor-offer-consent');
    if (o.status === 'offered' && o.updatedAt !== o.offeredAt)
      throw Error('invalid-labor-offer-time');
    if (
      !key(id) ||
      id !== o.id ||
      !key(o.employeeId) ||
      !integer(o.membershipGeneration) ||
      o.membershipGeneration < 1 ||
      o.membershipGeneration > (s.membershipGenerations[o.employeeId] ?? 0) ||
      !integer(o.wageMicros) ||
      o.wageMicros < 1 ||
      !integer(o.referenceMs) ||
      o.referenceMs < 1 ||
      o.referenceMs > ENTERPRISE_LABOR_TERMS_POLICY.maxReferenceMs ||
      !integer(o.offeredAt) ||
      !integer(o.updatedAt) ||
      o.updatedAt < o.offeredAt ||
      o.updatedAt > s.updatedAt ||
      !integer(o.validUntil) ||
      o.validUntil <= o.offeredAt ||
      o.validUntil - o.offeredAt > ENTERPRISE_LABOR_TERMS_POLICY.maxValidityMs ||
      !integer(o.revision) ||
      o.revision !== (o.status === 'offered' ? 1 : 2) ||
      !['offered', 'accepted', 'declined', 'withdrawn'].includes(o.status) ||
      (o.status === 'offered' ? o.respondedBy !== undefined : !key(o.respondedBy ?? ''))
    )
      throw Error('invalid-labor-offer');
  }
  for (const [employee, id] of Object.entries(s.activeByEmployee)) {
    const o = s.offers[id];
    if (!key(employee) || !o || o.employeeId !== employee || o.status !== 'accepted')
      throw Error('invalid-active-labor-terms');
  }
}
/** The generation survives departure, so rejoining never revives old consent. */
export function laborTermsAfterJoin(
  e: EnterpriseState,
  employeeId: string,
): EnterpriseLaborTermsState {
  const s = e.laborTerms;
  if (!s || e.employeeAgentIds.some((id) => id === employeeId))
    throw Error('labor-terms-new-membership-required');
  const generation = (s.membershipGenerations[employeeId] ?? 0) + 1;
  if (!Number.isSafeInteger(generation)) throw Error('labor-membership-generation-overflow');
  return { ...s, membershipGenerations: { ...s.membershipGenerations, [employeeId]: generation } };
}
export function activeEnterpriseLaborTerms(
  e: EnterpriseState,
  employeeId: string,
  at: number,
): EnterpriseLaborOffer | undefined {
  const s = e.laborTerms,
    o = s?.offers[s.activeByEmployee[employeeId] ?? ''];
  return integer(at) &&
    isEnterpriseOperational(e) &&
    e.employeeAgentIds.some((id) => id === employeeId) &&
    o?.status === 'accepted' &&
    o.membershipGeneration === s?.membershipGenerations[employeeId] &&
    o.updatedAt <= at &&
    at < o.validUntil
    ? o
    : undefined;
}
export function applyEnterpriseLaborTermsEvent(
  e: EnterpriseState,
  event: EnterpriseLaborTermsEvent,
): EnterpriseState {
  if (event.type === 'EnterpriseLaborTermsEnabled') {
    if (
      e.laborTerms ||
      !isEnterpriseOperational(e) ||
      event.at < e.foundedAt ||
      event.policyVersion !== ENTERPRISE_LABOR_TERMS_POLICY.version ||
      !integer(event.at)
    )
      throw Error('invalid-labor-terms-activation');
    return {
      ...e,
      laborTerms: {
        policyVersion: event.policyVersion,
        revision: 1,
        updatedAt: event.at,
        membershipGenerations: Object.fromEntries(e.employeeAgentIds.map((id) => [id, 1])),
        offers: {},
        activeByEmployee: {},
      },
    };
  }
  const s = e.laborTerms,
    o = event.offer;
  if (
    !s ||
    event.previousRevision !== s.revision ||
    !Number.isSafeInteger(s.revision + 1) ||
    o.updatedAt < s.updatedAt
  )
    throw Error('labor-terms-revision-conflict');
  const old = s.offers[o.id];
  if (!old) {
    if (
      !isEnterpriseOperational(e) ||
      !e.employeeAgentIds.some((id) => id === o.employeeId) ||
      o.membershipGeneration !== s.membershipGenerations[o.employeeId] ||
      o.status !== 'offered' ||
      o.offeredAt !== o.updatedAt ||
      o.authority.actorId !== event.actorId
    )
      throw Error('invalid-labor-offer-source');
    assertEnterpriseManagementAuthority(e, o.authority, 'offer-labor-terms');
  } else {
    if (
      old.status !== 'offered' ||
      o.revision !== old.revision + 1 ||
      [
        'id',
        'employeeId',
        'membershipGeneration',
        'wageMicros',
        'referenceMs',
        'validUntil',
        'offeredAt',
      ].some((k) => o[k as keyof EnterpriseLaborOffer] !== old[k as keyof EnterpriseLaborOffer]) ||
      !sameAuthority(o.authority, old.authority) ||
      o.respondedBy !== event.actorId
    )
      throw Error('labor-offer-transition-mismatch');
    if (o.status === 'withdrawn') {
      assertEnterpriseManagementAuthority(e, event.authority, 'offer-labor-terms');
      if (event.authority?.actorId !== event.actorId) throw Error('labor-offer-authority-mismatch');
    } else if (o.status === 'accepted' || o.status === 'declined') {
      if (
        event.actorId !== old.employeeId ||
        !isEnterpriseOperational(e) ||
        !e.employeeAgentIds.some((id) => id === old.employeeId) ||
        old.membershipGeneration !== s.membershipGenerations[old.employeeId] ||
        old.authority.controlVersion !== enterpriseControlVersion(e) ||
        o.updatedAt >= old.validUntil
      )
        throw Error('labor-offer-personal-current-consent-required');
    } else throw Error('invalid-labor-offer-response');
  }
  const next: EnterpriseLaborTermsState = {
    ...s,
    revision: s.revision + 1,
    updatedAt: o.updatedAt,
    offers: { ...s.offers, [o.id]: structuredClone(o) },
    activeByEmployee:
      o.status === 'accepted'
        ? { ...s.activeByEmployee, [o.employeeId]: o.id }
        : s.activeByEmployee,
  };
  assertEnterpriseLaborTerms(next);
  return { ...e, laborTerms: next };
}
export function decideEnterpriseLaborTerms(input: {
  enterprise: EnterpriseState;
  actorId: string;
  at: number;
  command: EnterpriseLaborTermsCommand;
  authorize?: ControlAuthorizationPort;
}): { accepted: true; event: EnterpriseLaborTermsEvent } | { accepted: false; reason: string } {
  try {
    const { enterprise: e, command: c } = input,
      s = e.laborTerms;
    if (!s) throw Error('labor-terms-not-enabled');
    if (!integer(input.at) || input.at < s.updatedAt) throw Error('invalid-labor-terms-time');
    let offer: EnterpriseLaborOffer;
    let authority: EnterpriseManagementAuthority | undefined;
    if (c.type === 'offer') {
      if (s.offers[c.id]) throw Error('labor-offer-id-exists');
      authority = enterpriseManagementAuthority(
        e,
        input.actorId,
        'offer-labor-terms',
        input.authorize,
      );
      if (!authority) throw Error('labor-offer-employer-authority-required');
      offer = {
        id: c.id,
        employeeId: c.employeeId,
        membershipGeneration: s.membershipGenerations[c.employeeId] ?? 0,
        wageMicros: c.wageMicros,
        referenceMs: c.referenceMs,
        validUntil: c.validUntil,
        offeredAt: input.at,
        updatedAt: input.at,
        revision: 1,
        authority,
        status: 'offered',
      };
    } else {
      const old = s.offers[c.id];
      if (!old || old.revision !== c.expectedRevision) throw Error('labor-offer-revision-conflict');
      if (c.type === 'withdraw') {
        authority = enterpriseManagementAuthority(
          e,
          input.actorId,
          'offer-labor-terms',
          input.authorize,
        );
        if (!authority) throw Error('labor-offer-employer-authority-required');
      }
      offer = {
        ...old,
        revision: old.revision + 1,
        updatedAt: input.at,
        status: c.type === 'accept' ? 'accepted' : c.type === 'decline' ? 'declined' : 'withdrawn',
        respondedBy: input.actorId,
      };
    }
    const event: EnterpriseLaborTermsEvent = {
      type: 'EnterpriseLaborTermsChanged',
      previousRevision: s.revision,
      actorId: input.actorId,
      offer,
      ...(authority && c.type === 'withdraw' ? { authority } : {}),
    };
    applyEnterpriseLaborTermsEvent(e, event);
    return { accepted: true, event };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-labor-terms-command',
    };
  }
}

export type EnterpriseLaborRateReference = Pick<
  EnterpriseLaborOffer,
  'id' | 'revision' | 'membershipGeneration' | 'wageMicros' | 'referenceMs'
>;
export function assertEnterpriseLaborRateReference(r: EnterpriseLaborRateReference): void {
  if (
    !r ||
    Object.keys(r).length !== 5 ||
    !key(r.id) ||
    !integer(r.revision) ||
    r.revision < 2 ||
    !integer(r.membershipGeneration) ||
    r.membershipGeneration < 1 ||
    !integer(r.wageMicros) ||
    r.wageMicros < 1 ||
    !integer(r.referenceMs) ||
    r.referenceMs < 1 ||
    r.referenceMs > ENTERPRISE_LABOR_TERMS_POLICY.maxReferenceMs
  )
    throw Error('invalid-enterprise-labor-rate-reference');
}
export function enterpriseLaborRateReference(
  e: EnterpriseState,
  actorId: string,
  at: number,
): EnterpriseLaborRateReference | undefined {
  const o = activeEnterpriseLaborTerms(e, actorId, at);
  return o
    ? {
        id: o.id,
        revision: o.revision,
        membershipGeneration: o.membershipGeneration,
        wageMicros: o.wageMicros,
        referenceMs: o.referenceMs,
      }
    : undefined;
}
export function matchesEnterpriseLaborRate(
  e: EnterpriseState,
  actorId: string,
  reference: EnterpriseLaborRateReference,
  at: number,
  existingSession = false,
): boolean {
  assertEnterpriseLaborRateReference(reference);
  const o = existingSession
    ? e.laborTerms?.offers[reference.id]
    : activeEnterpriseLaborTerms(e, actorId, at);
  return (
    !!o &&
    o.employeeId === actorId &&
    o.status === 'accepted' &&
    isEnterpriseOperational(e) &&
    e.employeeAgentIds.some((id) => id === actorId) &&
    e.laborTerms?.membershipGenerations[actorId] === reference.membershipGeneration &&
    Object.entries(reference).every(([k, v]) => o[k as keyof EnterpriseLaborOffer] === v) &&
    ['id', 'revision', 'membershipGeneration', 'wageMicros', 'referenceMs'].every((k) =>
      Object.hasOwn(reference, k),
    )
  );
}
