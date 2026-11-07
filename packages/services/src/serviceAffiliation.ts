import { currentServiceEnterprise } from './serviceSupplyRelationFacts';
import {
  assertPrincipalControlRequest,
  assertPrincipalOperationRequest,
  assertPrincipalAuthorization,
  decidePrincipalControl,
  resourcePrincipalSnapshot,
  samePrincipalRequest,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import type { ServicesState, Service } from './model';
import { applyServicePrincipalControlFact, type ServicePrincipalsPorts } from './servicePrincipals';
import {
  SERVICE_AFFILIATION_POLICY,
  type ServiceAffiliationPolicy,
  type ServiceAffiliationCommand,
  type ServiceAffiliationEvent,
} from './serviceAffiliationModel';
const no = (reason: string) => ({ accepted: false as const, reason });
export function assertServiceAffiliationPolicy(p: ServiceAffiliationPolicy) {
  if (
    Object.keys(p).length !== 2 ||
    p.version !== SERVICE_AFFILIATION_POLICY.version ||
    p.maxConsentHorizonMs !== SERVICE_AFFILIATION_POLICY.maxConsentHorizonMs
  )
    throw Error('unsupported-service-affiliation-policy');
}
export function serviceAffiliationRequest(
  s: ServicesState,
  serviceId: string,
  c: ServiceAffiliationCommand,
): PrincipalOperationRequest {
  const v = s.services[serviceId];
  if (!s.affiliations || !v || !currentServiceEnterprise(v))
    throw Error('service-affiliation-source-required');
  return {
    resourceKind: 'service',
    resourceId: serviceId,
    resourceRevision: v.revision,
    controlVersion: resourcePrincipalSnapshot(v).version,
    operation: { capability: c.type, arguments: structuredClone(c) },
  };
}
/** Closed arguments; a model cannot invent a second actor or an employer's signature. */
export function decodeServiceAffiliationOperation(
  r: PrincipalOperationRequest,
): ServiceAffiliationCommand {
  assertPrincipalOperationRequest(r);
  const a = r.operation.arguments;
  if (
    r.resourceKind !== 'service' ||
    a.type !== r.operation.capability ||
    !Number.isSafeInteger(a.registryRevision) ||
    typeof a.registryRevision !== 'number' ||
    a.registryRevision < 1
  )
    throw Error('invalid-service-affiliation-command');
  if (
    a.type === 'services.approve-control' &&
    Object.keys(a).length === 4 &&
    typeof a.expiresAt === 'number'
  ) {
    const request = a.request;
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw Error('invalid-service-affiliation-request');
    // Authority validator closes and verifies this external envelope before its typed use.
    const control = request as PrincipalControlRequest;
    assertPrincipalControlRequest(control);
    return {
      type: a.type,
      request: control,
      expiresAt: a.expiresAt,
      registryRevision: a.registryRevision,
    };
  }
  if (
    a.type === 'services.revoke-control' &&
    Object.keys(a).length === 3 &&
    typeof a.expectedConsentVersion === 'number' &&
    Number.isSafeInteger(a.expectedConsentVersion) &&
    a.expectedConsentVersion > 0
  )
    return {
      type: a.type,
      expectedConsentVersion: a.expectedConsentVersion,
      registryRevision: a.registryRevision,
    };
  throw Error('invalid-service-affiliation-command');
}
function assertRequest(s: ServicesState, v: Service, r: PrincipalControlRequest) {
  assertPrincipalControlRequest(r);
  if (
    r.resourceKind !== 'service' ||
    r.resourceId !== v.id ||
    r.resourceRevision !== v.revision ||
    r.controlVersion !== resourcePrincipalSnapshot(v).version
  )
    throw Error('service-affiliation-control-version-conflict');
  // Acceptance is consent to the actual recorded offer, not a guess about a future revision.
  if (r.command.type !== 'offer' && !v.control?.offer)
    throw Error('principal-control-offer-missing');
  if (!s.principalPolicy) throw Error('service-principals-not-enabled');
}
export function decideServiceAffiliation(
  s: ServicesState,
  actorId: string,
  at: number,
  r: PrincipalOperationRequest,
  p: ServicePrincipalsPorts,
) {
  try {
    const a = s.affiliations;
    if (!a) return no('service-affiliations-not-enabled');
    assertServiceAffiliationPolicy(a.policy);
    const v = s.services[r.resourceId],
      c = decodeServiceAffiliationOperation(r);
    const enterpriseId = v && currentServiceEnterprise(v);
    if (!v || !enterpriseId || !p.available({ kind: 'enterprise', id: enterpriseId }))
      return no('service-affiliation-enterprise-unavailable');
    if (
      !samePrincipalRequest(r, serviceAffiliationRequest(s, v.id, c)) ||
      c.registryRevision !== a.revision ||
      !Number.isSafeInteger(a.revision + 1)
    )
      return no('service-affiliation-version-conflict');
    if (
      !Number.isSafeInteger(at) ||
      at < (v.principalAt ?? v.control?.at ?? 0) ||
      !p.available({ kind: 'resident', id: actorId })
    )
      return no('invalid-service-affiliation-actor-or-time');
    const authorization = p.authorizeOperation({ kind: 'enterprise', id: enterpriseId }, r);
    if (!authorization) return no('service-enterprise-affiliation-authority-required');
    assertPrincipalAuthorization(
      authorization,
      { kind: 'enterprise', id: enterpriseId },
      r,
      actorId,
    );
    let e: ServiceAffiliationEvent;
    if (c.type === 'services.approve-control') {
      assertRequest(s, v, c.request);
      const prior = a.consents[v.id];
      if (
        prior?.status === 'available' &&
        at < prior.expiresAt &&
        samePrincipalRequest(prior.request, c.request)
      )
        return no('service-affiliation-consent-already-available');
      if (
        !Number.isSafeInteger(c.expiresAt) ||
        c.expiresAt <= at ||
        c.expiresAt - at > a.policy.maxConsentHorizonMs
      )
        return no('invalid-service-affiliation-consent-time');
      e = {
        type: 'ServiceAffiliationConsentApproved',
        previousRegistryRevision: a.revision,
        consent: {
          version: a.revision,
          serviceId: v.id,
          enterpriseId,
          request: structuredClone(c.request),
          approvedAt: at,
          expiresAt: c.expiresAt,
          authorization,
          status: 'available',
        },
      };
    } else {
      const prior = a.consents[v.id];
      if (!prior || prior.status !== 'available' || prior.version !== c.expectedConsentVersion)
        return no('service-affiliation-consent-unavailable');
      if (at < prior.approvedAt) return no('invalid-service-affiliation-time');
      e = {
        type: 'ServiceAffiliationConsentRevoked',
        serviceId: v.id,
        previousRegistryRevision: a.revision,
        consentVersion: prior.version,
        at,
        authorization,
      };
    }
    applyServiceAffiliationEvent(s, e);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-affiliation');
  }
}
export function serviceAffiliationConsentFor(
  s: ServicesState,
  r: PrincipalControlRequest,
  at: number,
) {
  const c = s.affiliations?.consents[r.resourceId],
    v = s.services[r.resourceId];
  return c?.status === 'available' &&
    !!v &&
    c.enterpriseId === currentServiceEnterprise(v) &&
    c.approvedAt <= at &&
    at < c.expiresAt &&
    samePrincipalRequest(c.request, r)
    ? c
    : undefined;
}
export function decideAffiliatedServiceControl(
  s: ServicesState,
  actorId: string,
  at: number,
  r: PrincipalControlRequest,
  p: ServicePrincipalsPorts,
) {
  try {
    if (s.relationPolicy) return no('service-supply-control-envelope-required');
    const a = s.affiliations,
      v = s.services[r.resourceId],
      consent = serviceAffiliationConsentFor(s, r, at);
    const enterpriseId = v && currentServiceEnterprise(v);
    if (!a || !v || !enterpriseId || !consent) return no('service-affiliation-consent-unavailable');
    assertRequest(s, v, r);
    if (!p.available({ kind: 'enterprise', id: enterpriseId }))
      return no('service-affiliation-enterprise-unavailable');
    const d = decidePrincipalControl({
      policy: s.principalPolicy!.control,
      snapshot: resourcePrincipalSnapshot(v),
      request: r,
      actorId,
      at,
      available: p.available,
      authorize: p.authorizeControl,
    });
    if (!d.accepted) return d;
    const e: ServiceAffiliationEvent = {
      type: 'ServiceAffiliatedPrincipalControlChanged',
      serviceId: v.id,
      previousRevision: v.revision,
      previousRegistryRevision: a.revision,
      consentVersion: consent.version,
      change: d.event,
      ...(v.control?.policyVersion !== 'resource-principals-v2'
        ? { inheritedProviders: p.inheritedProviders(v) }
        : {}),
    };
    applyServiceAffiliationEvent(s, e);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-affiliated-service-control');
  }
}
export function applyServiceAffiliationEvent(
  s: ServicesState,
  e: ServiceAffiliationEvent,
): ServicesState {
  if (e.type === 'ServiceAffiliationsEnabled') {
    assertServiceAffiliationPolicy(e.policy);
    if (s.affiliations || !s.principalPolicy || !s.registration)
      throw Error('invalid-service-affiliations-activation');
    return { ...s, affiliations: { policy: structuredClone(e.policy), revision: 1, consents: {} } };
  }
  const a = s.affiliations;
  if (!a) throw Error('service-affiliations-not-enabled');
  assertServiceAffiliationPolicy(a.policy);
  if (e.previousRegistryRevision !== a.revision || !Number.isSafeInteger(a.revision + 1))
    throw Error('service-affiliation-version-conflict');
  if (e.type === 'ServiceAffiliationConsentApproved') {
    const c = e.consent,
      v = s.services[c.serviceId],
      r = c.authorization.request,
      cmd = decodeServiceAffiliationOperation(r);
    const enterpriseId = v && currentServiceEnterprise(v);
    if (
      !v ||
      !enterpriseId ||
      c.enterpriseId !== enterpriseId ||
      cmd.type !== 'services.approve-control' ||
      c.version !== a.revision ||
      c.status !== 'available' ||
      !samePrincipalRequest(c.request, cmd.request) ||
      c.expiresAt !== cmd.expiresAt ||
      cmd.registryRevision !== a.revision ||
      !samePrincipalRequest(r, serviceAffiliationRequest(s, v.id, cmd)) ||
      !Number.isSafeInteger(c.approvedAt) ||
      c.approvedAt < (v.principalAt ?? v.control?.at ?? 0) ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= c.approvedAt ||
      c.expiresAt - c.approvedAt > a.policy.maxConsentHorizonMs
    )
      throw Error('invalid-service-affiliation-consent-fact');
    assertRequest(s, v, c.request);
    assertPrincipalAuthorization(
      c.authorization,
      { kind: 'enterprise', id: enterpriseId },
      r,
      c.authorization.actorId,
    );
    const prior = a.consents[v.id];
    if (
      prior?.status === 'available' &&
      c.approvedAt < prior.expiresAt &&
      samePrincipalRequest(prior.request, c.request)
    )
      throw Error('service-affiliation-consent-already-available');
    return {
      ...s,
      affiliations: {
        ...a,
        revision: a.revision + 1,
        consents: { ...a.consents, [v.id]: structuredClone(c) },
      },
    };
  }
  if (e.type === 'ServiceAffiliatedPrincipalControlChanged' && s.relationPolicy)
    throw Error('service-supply-control-envelope-required');
  const v = s.services[e.serviceId],
    c = a.consents[e.serviceId];
  const enterpriseId = v && currentServiceEnterprise(v);
  if (
    !v ||
    !enterpriseId ||
    !c ||
    c.status !== 'available' ||
    c.version !== e.consentVersion ||
    c.enterpriseId !== enterpriseId
  )
    throw Error('service-affiliation-consent-unavailable');
  if (e.type === 'ServiceAffiliationConsentRevoked') {
    const r = e.authorization.request,
      cmd = decodeServiceAffiliationOperation(r);
    if (
      cmd.type !== 'services.revoke-control' ||
      cmd.expectedConsentVersion !== c.version ||
      cmd.registryRevision !== a.revision ||
      !samePrincipalRequest(r, serviceAffiliationRequest(s, v.id, cmd)) ||
      !Number.isSafeInteger(e.at) ||
      e.at < c.approvedAt
    )
      throw Error('invalid-service-affiliation-revocation');
    assertPrincipalAuthorization(
      e.authorization,
      { kind: 'enterprise', id: enterpriseId },
      r,
      e.authorization.actorId,
    );
    return {
      ...s,
      affiliations: {
        ...a,
        revision: a.revision + 1,
        consents: { ...a.consents, [v.id]: { ...c, status: 'revoked' } },
      },
    };
  }
  if (!serviceAffiliationConsentFor(s, e.change.request, e.change.control.at))
    throw Error('service-affiliation-consent-unavailable');
  const next = applyServicePrincipalControlFact(s, e);
  return {
    ...next,
    affiliations: {
      ...a,
      revision: a.revision + 1,
      consents: { ...a.consents, [v.id]: { ...c, status: 'used' } },
    },
  };
}
