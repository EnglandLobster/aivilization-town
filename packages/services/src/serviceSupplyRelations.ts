import {
  assertPrincipalOperationRequest,
  assertPrincipalAuthorization,
  validResourcePrincipal,
  resourcePrincipalSnapshot,
  samePrincipal,
  samePrincipalRequest,
  decidePrincipalControl,
  principalOperationKey,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
  type ResourcePrincipal,
} from '@aivilization/authority';
import type { ServicesState, Service } from './model';
import { serviceDirectoryHasOpenCommitments } from './principalEstate';
import {
  currentServiceEnterprise,
  serviceSupplyRelationVersion,
} from './serviceSupplyRelationFacts';
import { applyServicePrincipalControlFact, type ServicePrincipalsPorts } from './servicePrincipals';
import { serviceAffiliationConsentFor } from './serviceAffiliation';
import {
  SERVICE_SUPPLY_RELATION_POLICY,
  type ServiceSupplyRelationPolicy,
  type ServiceSupplyRelationCommand,
  type ServiceSupplyRelation,
  type ServiceSupplyRelationEvent,
} from './serviceSupplyRelationModel';
const no = (reason: string) => ({ accepted: false as const, reason });
export function assertServiceSupplyRelationPolicy(p: ServiceSupplyRelationPolicy) {
  if (
    Object.keys(p).length !== 3 ||
    Object.entries(SERVICE_SUPPLY_RELATION_POLICY).some(
      ([k, v]) => p[k as keyof ServiceSupplyRelationPolicy] !== v,
    )
  )
    throw Error('unsupported-service-supply-relation-policy');
}
export function serviceSupplyRelationRequest(
  v: Service,
  c: ServiceSupplyRelationCommand,
): PrincipalOperationRequest {
  return {
    resourceKind: 'service',
    resourceId: v.id,
    resourceRevision: v.revision,
    controlVersion: resourcePrincipalSnapshot(v).version,
    operation: { capability: c.type, arguments: structuredClone(c) },
  };
}
export function decodeServiceSupplyRelationOperation(
  r: PrincipalOperationRequest,
): ServiceSupplyRelationCommand {
  assertPrincipalOperationRequest(r);
  const a = r.operation.arguments;
  if (r.resourceKind !== 'service' || a.type !== r.operation.capability)
    throw Error('invalid-service-supply-relation-command');
  if (
    a.type === 'services.offer-supply' &&
    Object.keys(a).length === 4 &&
    typeof a.enterpriseId === 'string' &&
    validResourcePrincipal({ kind: 'enterprise', id: a.enterpriseId }) &&
    typeof a.expiresAt === 'number' &&
    typeof a.terms === 'string'
  )
    return { type: a.type, enterpriseId: a.enterpriseId, expiresAt: a.expiresAt, terms: a.terms };
  if (a.type === 'services.accept-supply' && Object.keys(a).length === 1) return { type: a.type };
  if (
    (a.type === 'services.end-supply' || a.type === 'services.cancel-supply') &&
    Object.keys(a).length === 2 &&
    a.subject &&
    typeof a.subject === 'object' &&
    !Array.isArray(a.subject)
  ) {
    const subject = a.subject as ResourcePrincipal; // Closed principal validator below owns this external envelope.
    if (validResourcePrincipal(subject)) return { type: a.type, subject };
  }
  throw Error('invalid-service-supply-relation-command');
}
export function serviceSupplyRelationSubject(
  v: Service,
  c: ServiceSupplyRelationCommand,
): ResourcePrincipal {
  const control = resourcePrincipalSnapshot(v),
    id = currentServiceEnterprise(v),
    o = v.supplyRelation?.offer;
  if (c.type === 'services.offer-supply') return control.controller;
  if (c.type === 'services.accept-supply') {
    if (!o) throw Error('service-supply-offer-missing');
    return { kind: 'enterprise', id: o.enterpriseId };
  }
  if (
    !samePrincipal(c.subject, control.controller) &&
    !(
      c.subject.kind === 'enterprise' &&
      c.subject.id === (c.type === 'services.end-supply' ? id : o?.enterpriseId)
    )
  )
    throw Error('service-supply-relation-party-required');
  return c.subject;
}
function facts(
  s: ServicesState,
  v: Service,
  c: ServiceSupplyRelationCommand,
  at: number,
  proof: Extract<
    ServiceSupplyRelationEvent,
    { type: 'ServiceSupplyRelationChanged' }
  >['authorization'],
): ServiceSupplyRelation {
  const version = serviceSupplyRelationVersion(v),
    id = currentServiceEnterprise(v),
    control = resourcePrincipalSnapshot(v),
    old = v.supplyRelation;
  if (
    !s.relationPolicy ||
    !Number.isSafeInteger(version + 1) ||
    !Number.isSafeInteger(v.revision + 1) ||
    !Number.isSafeInteger(at) ||
    at < Math.max(v.principalAt ?? control.at, old?.at ?? 0)
  )
    throw Error('invalid-service-supply-relation-version-or-time');
  let relation: ServiceSupplyRelation = {
    policyVersion: SERVICE_SUPPLY_RELATION_POLICY.version,
    version: version + 1,
    enterpriseId: id ?? null,
    at,
  };
  if (c.type === 'services.offer-supply') {
    if (id) throw Error('service-supply-relationship-already-exists');
    if (old?.offer && old.offer.expiresAt > at) throw Error('service-supply-offer-pending');
    if (v.participationMode === 'self-service') throw Error('service-hosted-supply-required');
    if (
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= at ||
      c.expiresAt - at > s.relationPolicy.maxOfferHorizonMs ||
      !c.terms.trim() ||
      c.terms.length > s.relationPolicy.maxTermsChars
    )
      throw Error('invalid-service-supply-offer-terms');
    relation = {
      ...relation,
      offer: {
        enterpriseId: c.enterpriseId,
        terms: c.terms,
        expiresAt: c.expiresAt,
        offeredAt: at,
        controller: structuredClone(control.controller),
        controlVersion: control.version,
        resourceRevision: v.revision,
        authorization: structuredClone(proof),
      },
    };
  } else if (c.type === 'services.accept-supply') {
    const o = old?.offer;
    if (
      !o ||
      id ||
      at >= o.expiresAt ||
      v.revision !== o.resourceRevision + 1 ||
      control.version !== o.controlVersion ||
      !samePrincipal(control.controller, o.controller)
    )
      throw Error('service-supply-offer-expired-or-stale');
    if (serviceDirectoryHasOpenCommitments(s, v.id, at))
      throw Error('outstanding-service-commitments');
    relation = { ...relation, enterpriseId: o.enterpriseId };
  } else if (c.type === 'services.end-supply') {
    if (!id) throw Error('service-supply-relationship-missing');
    if (serviceDirectoryHasOpenCommitments(s, v.id, at))
      throw Error('outstanding-service-commitments');
    relation = { ...relation, enterpriseId: null };
  } else if (!old?.offer) throw Error('service-supply-offer-missing');
  return relation;
}
export function decideServiceSupplyRelation(
  s: ServicesState,
  actorId: string,
  at: number,
  r: PrincipalOperationRequest,
  p: ServicePrincipalsPorts,
) {
  try {
    if (!s.relationPolicy) return no('service-supply-relations-not-enabled');
    assertServiceSupplyRelationPolicy(s.relationPolicy);
    const v = s.services[r.resourceId],
      c = decodeServiceSupplyRelationOperation(r);
    if (!v || !samePrincipalRequest(r, serviceSupplyRelationRequest(v, c)))
      return no('service-supply-relation-version-conflict');
    const principal = serviceSupplyRelationSubject(v, c),
      authorization = p.authorizeOperation(principal, r);
    if (!authorization) return no('service-supply-relation-authority-required');
    if (principal.kind === 'enterprise' && !p.available(principal))
      return no('service-supply-enterprise-unavailable');
    if (
      (c.type === 'services.offer-supply' || c.type === 'services.accept-supply') &&
      !p.available(resourcePrincipalSnapshot(v).controller)
    )
      return no('service-supply-directory-principal-unavailable');
    assertPrincipalAuthorization(authorization, principal, r, actorId);
    if (
      c.type === 'services.offer-supply' &&
      !p.available({ kind: 'enterprise', id: c.enterpriseId })
    )
      return no('service-supply-enterprise-unavailable');
    if (c.type === 'services.accept-supply' && !p.available(principal))
      return no('service-supply-enterprise-unavailable');
    const e: ServiceSupplyRelationEvent = {
      type: 'ServiceSupplyRelationChanged',
      serviceId: v.id,
      previousRevision: v.revision,
      previousSupplyVersion: serviceSupplyRelationVersion(v),
      at,
      authorization,
      relation: facts(s, v, c, at, authorization),
    };
    applyServiceSupplyRelationEvent(s, e);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-supply-relation');
  }
}
export function decideServiceSupplyControl(
  s: ServicesState,
  actorId: string,
  at: number,
  r: PrincipalControlRequest,
  p: ServicePrincipalsPorts,
) {
  try {
    if (!s.relationPolicy || !s.principalPolicy) return no('service-supply-relations-not-enabled');
    assertServiceSupplyRelationPolicy(s.relationPolicy);
    const v = s.services[r.resourceId];
    if (!v || r.resourceKind !== 'service' || r.resourceRevision !== v.revision)
      return no('service-principal-revision-conflict');
    if (v.supplyRelation?.offer && at < v.supplyRelation.offer.expiresAt)
      return no('service-supply-offer-pending');
    const id = currentServiceEnterprise(v),
      authorization = id ? p.authorizeControl({ kind: 'enterprise', id }, r) : undefined,
      consent = id ? serviceAffiliationConsentFor(s, r, at) : undefined;
    if (id && (!p.available({ kind: 'enterprise', id }) || (!authorization && !consent)))
      return no('service-enterprise-affiliation-authority-required');
    const d = decidePrincipalControl({
      policy: s.principalPolicy.control,
      snapshot: resourcePrincipalSnapshot(v),
      request: r,
      actorId,
      at,
      available: p.available,
      authorize: p.authorizeControl,
    });
    if (!d.accepted) return d;
    const e: ServiceSupplyRelationEvent = {
      type: 'ServiceSupplyPrincipalControlChanged',
      serviceId: v.id,
      previousRevision: v.revision,
      supplyVersion: serviceSupplyRelationVersion(v),
      change: d.event,
      ...(v.control?.policyVersion !== 'resource-principals-v2'
        ? { inheritedProviders: p.inheritedProviders(v) }
        : {}),
      ...(authorization
        ? { affiliationAuthorization: authorization }
        : consent
          ? { consentVersion: consent.version }
          : {}),
    };
    applyServiceSupplyRelationEvent(s, e);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-supply-control');
  }
}
export function applyServiceSupplyRelationEvent(
  s: ServicesState,
  e: ServiceSupplyRelationEvent,
): ServicesState {
  if (e.type === 'ServiceSupplyRelationsEnabled') {
    assertServiceSupplyRelationPolicy(e.policy);
    if (s.relationPolicy || !s.affiliations || !s.registration || !s.principalPolicy)
      throw Error('invalid-service-supply-relations-activation');
    return { ...s, relationPolicy: structuredClone(e.policy) };
  }
  if (!s.relationPolicy) throw Error('service-supply-relations-not-enabled');
  assertServiceSupplyRelationPolicy(s.relationPolicy);
  const v = s.services[e.serviceId];
  if (!v || v.revision !== e.previousRevision || !Number.isSafeInteger(v.revision + 1))
    throw Error('service-supply-relation-version-conflict');
  if (e.type === 'ServiceSupplyRelationChanged') {
    const r = e.authorization.request,
      c = decodeServiceSupplyRelationOperation(r);
    if (
      e.previousSupplyVersion !== serviceSupplyRelationVersion(v) ||
      !samePrincipalRequest(r, serviceSupplyRelationRequest(v, c))
    )
      throw Error('service-supply-relation-version-conflict');
    assertPrincipalAuthorization(
      e.authorization,
      serviceSupplyRelationSubject(v, c),
      r,
      e.authorization.actorId,
    );
    const expected = facts(s, v, c, e.at, e.authorization);
    if (principalOperationKey(expected) !== principalOperationKey(e.relation))
      throw Error('service-supply-relation-fact-mismatch');
    return {
      ...s,
      services: {
        ...s.services,
        [v.id]: { ...v, supplyRelation: structuredClone(e.relation), revision: v.revision + 1 },
      },
    };
  }
  const id = currentServiceEnterprise(v),
    r = e.change.request,
    at = e.change.control.at;
  if (
    e.supplyVersion !== serviceSupplyRelationVersion(v) ||
    (v.supplyRelation?.offer && at < v.supplyRelation.offer.expiresAt)
  )
    throw Error('service-supply-control-source-conflict');
  if (id) {
    if (e.affiliationAuthorization && e.consentVersion === undefined)
      assertPrincipalAuthorization(
        e.affiliationAuthorization,
        { kind: 'enterprise', id },
        r,
        e.change.control.authorization.actorId,
      );
    else if (!e.affiliationAuthorization && e.consentVersion !== undefined) {
      const c = serviceAffiliationConsentFor(s, r, at);
      if (!c || c.version !== e.consentVersion)
        throw Error('service-affiliation-consent-unavailable');
    } else throw Error('service-enterprise-affiliation-authority-required');
  } else if (e.affiliationAuthorization || e.consentVersion !== undefined)
    throw Error('unexpected-service-affiliation-authority');
  let next = applyServicePrincipalControlFact(s, e);
  if (e.consentVersion !== undefined) {
    const a = s.affiliations,
      c = a?.consents[v.id];
    if (!a || !c || !Number.isSafeInteger(a.revision + 1))
      throw Error('service-affiliation-version-conflict');
    next = {
      ...next,
      affiliations: {
        ...a,
        revision: a.revision + 1,
        consents: { ...a.consents, [v.id]: { ...c, status: 'used' } },
      },
    };
  }
  return next;
}
