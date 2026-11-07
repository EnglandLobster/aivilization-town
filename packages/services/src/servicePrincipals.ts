import { applyServiceRecordEvent } from './serviceRecordEvents';
import { serviceDirectoryHasOpenCommitments } from './principalEstate';
import {
  assertResourcePrincipalPolicy,
  applyPrincipalControl,
  assertPrincipalAuthorization,
  decidePrincipalControl,
  resourcePrincipalSnapshot,
  principalOperationKey,
  principalId,
  samePrincipalRequest,
  type PrincipalControlRequest,
  type PrincipalAuthorizationPort,
  type ResourcePrincipal,
  type PrincipalOperationRequest,
  type PrincipalValue,
} from '@aivilization/authority';
import { decideServices, serviceCapacityAvailable } from './aggregate';
import { type ServicesState, type Service, type ServicesPorts, type ServicesEvent } from './model';
import {
  SERVICE_PRINCIPALS_POLICY,
  INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
  serviceAdministrativeRequest,
  serviceProviderRequest,
  type ServicePrincipalsPolicy,
  type ServicePrincipalEvent,
  type ServiceAdministrativeCommand,
  type ServicePrincipalProviderCommand,
} from './servicePrincipalModel';
const no = (reason: string) => ({ accepted: false as const, reason });
export function assertServicePrincipalsPolicy(p: ServicePrincipalsPolicy) {
  assertResourcePrincipalPolicy(p.control);
  if (
    (p.version !== SERVICE_PRINCIPALS_POLICY.version &&
      p.version !== INDEPENDENT_SERVICE_PRINCIPALS_POLICY.version) ||
    p.maxProviders !== SERVICE_PRINCIPALS_POLICY.maxProviders ||
    Object.keys(p).length !== 3
  )
    throw Error('unsupported-service-principals-policy');
}
export type ServicePrincipalsPorts = {
  readonly available: (p: ResourcePrincipal) => boolean;
  readonly authorizeControl: PrincipalAuthorizationPort;
  readonly authorizeOperation: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  readonly inheritedProviders: (service: Service) => readonly string[];
  readonly service: ServicesPorts;
};
function providers(ids: readonly string[], limit: number) {
  if (ids.length > limit || ids.some((id) => !principalId(id)) || new Set(ids).size !== ids.length)
    throw Error('invalid-service-provider-permissions');
  return [...ids];
}
export function activePrincipalProvider(
  s: ServicesState,
  serviceId: string,
  id: string,
  at: number,
) {
  return Object.values(s.slots).some(
    (t) =>
      t.serviceId === serviceId &&
      (t.providers ?? []).some(
        (p) => p.residentId === id && p.startedAt <= at && (p.endedAt ?? p.until) > at,
      ),
  );
}
export function decideServicePrincipalControl(
  s: ServicesState,
  actorId: string,
  at: number,
  request: PrincipalControlRequest,
  p: ServicePrincipalsPorts,
) {
  if (!s.principalPolicy) return no('service-principals-not-enabled');
  if (s.relationPolicy) return no('service-supply-control-envelope-required');
  try {
    assertServicePrincipalsPolicy(s.principalPolicy);
    const v = s.services[request.resourceId];
    if (!v || request.resourceKind !== 'service') return no('service-principal-resource-not-found');
    if (v.revision !== request.resourceRevision || !Number.isSafeInteger(v.revision + 1))
      return no('service-principal-revision-conflict');
    if (!Number.isSafeInteger(at) || at < (v.principalAt ?? v.control?.at ?? 0))
      return no('invalid-service-principal-time');
    const affiliationAuthorization = v.enterpriseId
      ? p.authorizeControl({ kind: 'enterprise', id: v.enterpriseId }, request)
      : undefined;
    if (v.enterpriseId && !affiliationAuthorization)
      return no('service-enterprise-affiliation-authority-required');
    const d = decidePrincipalControl({
      policy: s.principalPolicy.control,
      snapshot: resourcePrincipalSnapshot(v),
      request,
      actorId,
      at,
      available: p.available,
      authorize: p.authorizeControl,
    });
    if (!d.accepted) return d;
    const e: ServicePrincipalEvent = {
      type: 'ServicePrincipalControlChanged',
      serviceId: v.id,
      previousRevision: v.revision,
      change: d.event,
      ...(v.control?.policyVersion !== 'resource-principals-v2'
        ? { inheritedProviders: providers(p.inheritedProviders(v), s.principalPolicy.maxProviders) }
        : {}),
      ...(affiliationAuthorization ? { affiliationAuthorization } : {}),
    };
    applyServicePrincipalEvent(s, e);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-principal-control');
  }
}
/** Closed operations contain no personal check-in, start, leave or effect declaration. */
export function decodeServicePrincipalOperation(
  r: PrincipalOperationRequest,
): ServiceAdministrativeCommand | ServicePrincipalProviderCommand {
  const a = r.operation.arguments;
  if (
    ['services.authorize-provider', 'services.revoke-provider'].includes(r.operation.capability)
  ) {
    if (
      Object.keys(a).length !== 4 ||
      (a.type !== 'services.authorize-provider' && a.type !== 'services.revoke-provider') ||
      a.type !== r.operation.capability ||
      typeof a.id !== 'string' ||
      typeof a.expectedRevision !== 'number' ||
      typeof a.residentId !== 'string'
    )
      throw Error('invalid-service-provider-command');
    return {
      type: a.type,
      id: a.id,
      expectedRevision: a.expectedRevision,
      residentId: a.residentId,
    };
  }
  const c = a.command;
  if (Object.keys(a).length !== 1 || !c || typeof c !== 'object' || Array.isArray(c))
    throw Error('invalid-service-administrative-command');
  const v = c as Record<string, unknown>;
  const exact = (keys: readonly string[]) =>
    Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
  if (
    v.type === 'schedule' &&
    r.operation.capability === 'services.schedule' &&
    exact(['type', 'id', 'serviceId', 'start', 'end', 'capacity']) &&
    typeof v.id === 'string' &&
    typeof v.serviceId === 'string' &&
    typeof v.start === 'number' &&
    typeof v.end === 'number' &&
    typeof v.capacity === 'number'
  )
    return {
      type: v.type,
      id: v.id,
      serviceId: v.serviceId,
      start: v.start,
      end: v.end,
      capacity: v.capacity,
    };
  if (
    (v.type === 'close' || v.type === 'accept' || v.type === 'cancel') &&
    r.operation.capability === (v.type === 'close' ? 'services.close' : `bookings.${v.type}`) &&
    exact(['type', 'id', 'expectedRevision']) &&
    typeof v.id === 'string' &&
    typeof v.expectedRevision === 'number'
  )
    return { type: v.type, id: v.id, expectedRevision: v.expectedRevision };
  if (
    v.type === 'call' &&
    r.operation.capability === 'queues.call' &&
    exact(['type', 'id', 'slotId', 'bookingId']) &&
    typeof v.id === 'string' &&
    typeof v.slotId === 'string' &&
    typeof v.bookingId === 'string'
  )
    return { type: v.type, id: v.id, slotId: v.slotId, bookingId: v.bookingId };
  throw Error('service-principal-operation-not-supported');
}
export function decideServicePrincipalOperation(
  s: ServicesState,
  actorId: string,
  at: number,
  r: PrincipalOperationRequest,
  p: ServicePrincipalsPorts,
) {
  if (!s.principalPolicy) return no('service-principals-not-enabled');
  try {
    assertServicePrincipalsPolicy(s.principalPolicy);
    const v = s.services[r.resourceId];
    if (!v || v.control?.policyVersion !== 'resource-principals-v2')
      return no('service-principal-control-required');
    if (v.control.offer) return no('service-principal-handover-pending');
    if (
      !Number.isSafeInteger(at) ||
      at < (v.principalAt ?? v.control.at) ||
      !p.available({ kind: 'resident', id: actorId })
    )
      return no('invalid-service-principal-actor-or-time');
    const c = decodeServicePrincipalOperation(r),
      provider = 'residentId' in c;
    const expected = provider ? serviceProviderRequest(s, c) : serviceAdministrativeRequest(s, c);
    if (!samePrincipalRequest(r, expected) || !Number.isSafeInteger(v.revision + 1))
      return no('service-principal-version-or-resource-conflict');
    const authorization = p.authorizeOperation(v.control.controller, r);
    if (!authorization) return no('service-principal-operation-authority-required');
    assertPrincipalAuthorization(authorization, v.control.controller, r, actorId);
    if (provider) {
      if (!p.available({ kind: 'resident', id: c.residentId }))
        return no('service-provider-resident-required');
      if (
        c.type === 'services.revoke-provider' &&
        activePrincipalProvider(s, v.id, c.residentId, at)
      )
        return no('service-active-provider-permission-required');
      const named =
        c.type === 'services.authorize-provider'
          ? [...new Set([...(v.namedProviders ?? []), c.residentId])]
          : (v.namedProviders ?? []).filter((id) => id !== c.residentId);
      const e: ServicePrincipalEvent = {
        type: 'ServicePrincipalOperationCommitted',
        serviceId: v.id,
        previousRevision: v.revision,
        at,
        authorization,
        events: [],
        providers: providers(named, s.principalPolicy.maxProviders),
      };
      applyServicePrincipalEvent(s, e);
      return { accepted: true as const, events: [e] };
    }
    const d = decideServices(s, actorId, at, c, {
      ...p.service,
      principalAdministration: authorization,
    });
    if (!d.accepted) return d;
    if (c.type === 'close' && serviceDirectoryHasOpenCommitments(s, v.id, at))
      return no('outstanding-service-commitments');
    if (
      d.events.some(
        (e) =>
          !['ServiceChanged', 'ServiceSlotChanged', 'BookingChanged', 'QueueEntryChanged'].includes(
            e.type,
          ),
      ) ||
      ('participation' in d && d.participation) ||
      ('releases' in d && d.releases)
    )
      return no('service-principal-body-effect-forbidden');
    const allowed = d.events.filter(
      (
        e,
      ): e is Extract<
        ServicesEvent,
        { type: 'ServiceChanged' | 'ServiceSlotChanged' | 'BookingChanged' | 'QueueEntryChanged' }
      > =>
        e.type === 'ServiceChanged' ||
        e.type === 'ServiceSlotChanged' ||
        e.type === 'BookingChanged' ||
        e.type === 'QueueEntryChanged',
    );
    const capacity = p.service.locationCapacity(v.locationId);
    if ((c.type === 'accept' || c.type === 'call') && capacity === undefined)
      return no('service-location-capacity-required');
    const e: ServicePrincipalEvent = {
      type: 'ServicePrincipalOperationCommitted',
      serviceId: v.id,
      previousRevision: v.revision,
      at,
      authorization,
      events: allowed,
      ...((c.type === 'accept' || c.type === 'call') && capacity !== undefined
        ? { capacityProof: { locationId: v.locationId, capacity } }
        : {}),
    };
    applyServicePrincipalEvent(s, e);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-principal-operation');
  }
}
function assertAdministrativeEffects(
  s: ServicesState,
  c: ServiceAdministrativeCommand,
  e: Extract<ServicePrincipalEvent, { type: 'ServicePrincipalOperationCommitted' }>,
) {
  const equal = (a: unknown, b: unknown) =>
    principalOperationKey(a as PrincipalValue) === principalOperationKey(b as PrincipalValue);
  const events = e.events;
  const capacity = (slotId: string, units: number) => {
    const service = s.services[e.serviceId]!,
      slot = s.slots[slotId],
      proof = e.capacityProof;
    return (
      !!slot &&
      service.active &&
      e.at < slot.end &&
      !!proof &&
      proof.locationId === service.locationId &&
      Number.isSafeInteger(proof.capacity) &&
      proof.capacity >= 0 &&
      serviceCapacityAvailable(s, slot, units, {
        exists: () => true,
        presentAndIdle: () => false,
        locationCapacity: (id) => (id === proof.locationId ? proof.capacity : undefined),
      })
    );
  };
  if ((c.type === 'accept' || c.type === 'call') !== (e.capacityProof !== undefined))
    throw Error('service-capacity-source-proof-required');

  if (c.type === 'schedule') {
    const t = events[0];
    if (
      !s.services[e.serviceId]!.active ||
      events.length !== 1 ||
      t?.type !== 'ServiceSlotChanged' ||
      !equal(t.slot, {
        id: c.id,
        serviceId: c.serviceId,
        start: c.start,
        end: c.end,
        capacity: c.capacity,
        revision: 1,
        active: true,
      }) ||
      s.slots[c.id] ||
      c.start < e.at ||
      c.end <= c.start ||
      !Number.isSafeInteger(c.start) ||
      !Number.isSafeInteger(c.end) ||
      !Number.isSafeInteger(c.capacity) ||
      c.capacity < 1 ||
      c.capacity > s.services[e.serviceId]!.capacity
    )
      throw Error('service-principal-slot-effect-mismatch');
    return;
  }
  if (c.type === 'close') {
    const v = s.services[c.id]!,
      t = events[0];
    if (
      c.expectedRevision !== v.revision ||
      events.length !== 1 ||
      t?.type !== 'ServiceChanged' ||
      !equal(t.service, { ...v, active: false, revision: v.revision + 1 }) ||
      serviceDirectoryHasOpenCommitments(s, v.id, e.at)
    )
      throw Error('service-principal-close-effect-mismatch');
    return;
  }
  if (c.type === 'accept' || c.type === 'cancel') {
    const b = s.bookings[c.id],
      t = events[0];
    if (
      !b ||
      events.length !== 1 ||
      t?.type !== 'BookingChanged' ||
      !equal(t.booking, {
        ...b,
        revision: b.revision + 1,
        status: c.type === 'accept' ? 'accepted' : 'cancelled',
      }) ||
      b.revision !== c.expectedRevision ||
      (c.type === 'accept'
        ? b.status !== 'requested' || !capacity(b.slotId, b.units)
        : !['requested', 'accepted'].includes(b.status))
    )
      throw Error('service-principal-booking-effect-mismatch');
    return;
  }
  const q = s.queues[c.id],
    slot = s.slots[c.slotId],
    qv = events[0],
    bv = events[1];
  if (
    !q ||
    !slot ||
    q.status !== 'waiting' ||
    !capacity(c.slotId, 1) ||
    Object.values(s.queues)
      .filter((v) => v.serviceId === q.serviceId && v.status === 'waiting')
      .sort((a, b) => a.sequence - b.sequence)[0]?.id !== q.id ||
    slot.serviceId !== q.serviceId ||
    events.length !== 2 ||
    qv?.type !== 'QueueEntryChanged' ||
    bv?.type !== 'BookingChanged' ||
    !equal(qv.entry, { ...q, status: 'called' }) ||
    !equal(bv.booking, {
      id: c.bookingId,
      slotId: c.slotId,
      residentId: q.residentId,
      units: 1,
      revision: 1,
      status: 'accepted',
      at: e.at,
    })
  )
    throw Error('service-principal-queue-effect-mismatch');
}
export function applyServicePrincipalEvent(
  s: ServicesState,
  e: ServicePrincipalEvent,
): ServicesState {
  if (e.type === 'ServicePrincipalAuthoritySeparated') {
    assertServicePrincipalsPolicy(e.policy);
    if (
      e.previousVersion !== SERVICE_PRINCIPALS_POLICY.version ||
      s.principalPolicy?.version !== e.previousVersion ||
      e.policy.version !== INDEPENDENT_SERVICE_PRINCIPALS_POLICY.version
    )
      throw Error('invalid-service-authority-transition');
    return { ...s, principalPolicy: structuredClone(e.policy) };
  }
  if (e.type === 'ServicePrincipalsEnabled') {
    assertServicePrincipalsPolicy(e.policy);
    if (s.principalPolicy || s.policy.version !== 'resident-services-v3')
      throw Error('invalid-service-principals-activation');
    return { ...s, principalPolicy: structuredClone(e.policy) };
  }
  if (!s.principalPolicy) throw Error('service-principals-not-enabled');
  assertServicePrincipalsPolicy(s.principalPolicy);
  const v = s.services[e.serviceId];
  if (!v || v.revision !== e.previousRevision || !Number.isSafeInteger(v.revision + 1))
    throw Error('service-principal-revision-conflict');
  if (e.type === 'ServicePrincipalControlChanged') {
    if (s.relationPolicy) throw Error('service-supply-control-envelope-required');
    const r = e.change.request;
    if (
      r.resourceKind !== 'service' ||
      r.resourceId !== v.id ||
      r.resourceRevision !== v.revision ||
      e.change.control.at < (v.principalAt ?? v.control?.at ?? 0)
    )
      throw Error('invalid-service-principal-control-source');
    if (v.enterpriseId) {
      if (!e.affiliationAuthorization)
        throw Error('service-enterprise-affiliation-authority-required');
      assertPrincipalAuthorization(
        e.affiliationAuthorization,
        { kind: 'enterprise', id: v.enterpriseId },
        r,
        e.affiliationAuthorization.actorId,
      );
    } else if (e.affiliationAuthorization) throw Error('unexpected-service-affiliation-authority');
    return applyServicePrincipalControlFact(s, e);
  }
  if (
    v.control?.policyVersion !== 'resource-principals-v2' ||
    v.control.offer ||
    !Number.isSafeInteger(e.at) ||
    e.at < (v.principalAt ?? v.control.at)
  )
    throw Error('invalid-service-principal-operation-state');
  const c = decodeServicePrincipalOperation(e.authorization.request),
    provider = 'residentId' in c,
    request = provider ? serviceProviderRequest(s, c) : serviceAdministrativeRequest(s, c);
  assertPrincipalAuthorization(
    e.authorization,
    v.control.controller,
    request,
    e.authorization.actorId,
  );
  if (provider) {
    if (
      e.events.length ||
      e.capacityProof !== undefined ||
      !e.providers ||
      c.id !== v.id ||
      c.expectedRevision !== v.revision ||
      (c.type === 'services.revoke-provider' &&
        activePrincipalProvider(s, v.id, c.residentId, e.at))
    )
      throw Error('invalid-service-provider-operation');
    const next =
      c.type === 'services.authorize-provider'
        ? [...new Set([...(v.namedProviders ?? []), c.residentId])]
        : (v.namedProviders ?? []).filter((id) => id !== c.residentId);
    if (principalOperationKey(next) !== principalOperationKey(e.providers))
      throw Error('service-provider-effect-mismatch');
    providers(next, s.principalPolicy.maxProviders);
    return {
      ...s,
      services: {
        ...s.services,
        [v.id]: { ...v, namedProviders: next, principalAt: e.at, revision: v.revision + 1 },
      },
    };
  }
  if (e.providers !== undefined) throw Error('unexpected-service-provider-change');
  assertAdministrativeEffects(s, c, e);
  const next = e.events.reduce(applyServiceRecordEvent, s),
    updated = next.services[v.id]!;
  return {
    ...next,
    services: {
      ...next.services,
      [v.id]: { ...updated, principalAt: e.at, revision: v.revision + 1 },
    },
  };
}

/** Shared immutable control facts; each versioned caller separately verifies its own affiliation evidence. */
export function applyServicePrincipalControlFact(
  s: ServicesState,
  e: Pick<
    Extract<ServicePrincipalEvent, { type: 'ServicePrincipalControlChanged' }>,
    'serviceId' | 'previousRevision' | 'change' | 'inheritedProviders'
  >,
): ServicesState {
  if (!s.principalPolicy) throw Error('service-principals-not-enabled');
  assertServicePrincipalsPolicy(s.principalPolicy);
  const v = s.services[e.serviceId],
    r = e.change.request;
  if (
    !v ||
    v.revision !== e.previousRevision ||
    !Number.isSafeInteger(v.revision + 1) ||
    r.resourceKind !== 'service' ||
    r.resourceId !== v.id ||
    r.resourceRevision !== v.revision ||
    e.change.control.at < (v.principalAt ?? v.control?.at ?? 0)
  )
    throw Error('invalid-service-principal-control-source');
  const first = v.control?.policyVersion !== 'resource-principals-v2';
  if (first !== (e.inheritedProviders !== undefined))
    throw Error('service-provider-migration-proof-required');
  const control = applyPrincipalControl(resourcePrincipalSnapshot(v), e.change),
    named = first
      ? providers(e.inheritedProviders!, s.principalPolicy.maxProviders)
      : v.namedProviders!;
  return {
    ...s,
    services: {
      ...s.services,
      [v.id]: {
        ...v,
        control,
        namedProviders: named,
        principalAt: control.at,
        revision: v.revision + 1,
      },
    },
  };
}
