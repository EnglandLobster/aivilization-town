import {
  assertPrincipalAuthorization,
  assertPrincipalOperationRequest,
  principalOperationKey,
  validResourcePrincipal,
  principalId,
  resourcePrincipalSnapshot,
  type PrincipalOperationRequest,
  type PrincipalValue,
} from '@aivilization/authority';
import { decideServices, serviceRecordFromPublication } from './aggregate';
import type { ServicesState, ServicesPolicy, Service } from './model';
import { validServiceRecordId } from './model';
import type { ServicePrincipalsPorts } from './servicePrincipals';
import {
  SERVICE_DIRECTORY_ID,
  SERVICE_SUPPLY_POLICY,
  type ServiceSupplyPolicy,
  type ServiceSupplyEvent,
  type PrincipalServiceCreation,
} from './serviceSupplyModel';
const record = (v: unknown): v is Readonly<Record<string, PrincipalValue>> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const no = (reason: string) => ({ accepted: false as const, reason });
export function assertServiceSupplyPolicy(p: ServiceSupplyPolicy): void {
  if (principalOperationKey(p) !== principalOperationKey(SERVICE_SUPPLY_POLICY))
    throw Error('unsupported-service-supply-policy');
}
export function serviceCreationRequest(
  s: ServicesState,
  creation: PrincipalServiceCreation,
): PrincipalOperationRequest {
  if (!s.registration) throw Error('service-supply-not-enabled');
  return {
    resourceKind: 'service-directory',
    resourceId: SERVICE_DIRECTORY_ID,
    resourceRevision: s.registration.revision,
    controlVersion: 1,
    operation: {
      capability: 'services.create',
      arguments: {
        principal: structuredClone(creation.principal),
        ...(creation.enterpriseSupply ? { enterpriseSupply: true } : {}),
        command: structuredClone(creation.command),
      },
    },
  };
}
export function decodeServiceCreation(r: PrincipalOperationRequest): PrincipalServiceCreation {
  assertPrincipalOperationRequest(r);
  const a = r.operation.arguments,
    c = a.command;
  if (
    r.resourceKind !== 'service-directory' ||
    r.resourceId !== SERVICE_DIRECTORY_ID ||
    r.operation.capability !== 'services.create' ||
    Object.keys(a).some((k) => !['principal', 'command', 'enterpriseSupply'].includes(k)) ||
    (a.enterpriseSupply !== undefined && a.enterpriseSupply !== true) ||
    !record(a.principal) ||
    !record(c)
  )
    throw Error('invalid-service-creation-request');
  const principal = a.principal as PrincipalServiceCreation['principal'];
  if (!validResourcePrincipal(principal)) throw Error('invalid-service-creation-principal');
  if (a.enterpriseSupply && principal.kind !== 'enterprise')
    throw Error('service-enterprise-supply-principal-required');
  const required = ['type', 'id', 'kind', 'locationId', 'title', 'description', 'capacity'];
  const optional = ['destinationId', 'unitsPerProvider', 'participationMode'];
  if (
    required.some((k) => !Object.hasOwn(c, k)) ||
    Object.keys(c).some((k) => !required.includes(k) && !optional.includes(k)) ||
    c.type !== 'publish' ||
    typeof c.id !== 'string' ||
    typeof c.locationId !== 'string' ||
    typeof c.title !== 'string' ||
    typeof c.description !== 'string' ||
    typeof c.capacity !== 'number' ||
    typeof c.kind !== 'string' ||
    !['appointment', 'course', 'event', 'transport', 'lodging'].includes(String(c.kind)) ||
    (c.destinationId !== undefined && typeof c.destinationId !== 'string') ||
    (c.unitsPerProvider !== undefined && typeof c.unitsPerProvider !== 'number') ||
    (c.participationMode !== undefined &&
      (typeof c.participationMode !== 'string' ||
        !['hosted', 'self-service'].includes(c.participationMode)))
  )
    throw Error('invalid-service-creation-command');
  // A closed envelope is checked before narrowing; enterprise affiliation is derived from the exact principal.
  return {
    principal,
    command: c as PrincipalServiceCreation['command'],
    ...(a.enterpriseSupply ? { enterpriseSupply: true } : {}),
  };
}
export function serviceReopeningRequest(service: Service): PrincipalOperationRequest {
  const control = resourcePrincipalSnapshot(service);
  if (service.control?.policyVersion !== 'resource-principals-v2')
    throw Error('service-principal-control-required');
  return {
    resourceKind: 'service',
    resourceId: service.id,
    resourceRevision: service.revision,
    controlVersion: control.version,
    operation: {
      capability: 'services.reopen',
      arguments: { id: service.id, expectedRevision: service.revision },
    },
  };
}
export function decodeServiceReopening(request: PrincipalOperationRequest): {
  id: string;
  expectedRevision: number;
} {
  assertPrincipalOperationRequest(request);
  const a = request.operation.arguments;
  if (
    request.resourceKind !== 'service' ||
    request.operation.capability !== 'services.reopen' ||
    Object.keys(a).length !== 2 ||
    a.id !== request.resourceId ||
    a.expectedRevision !== request.resourceRevision
  )
    throw Error('invalid-service-reopening-request');
  return { id: request.resourceId, expectedRevision: request.resourceRevision };
}
export function decidePrincipalServiceReopening(
  s: ServicesState,
  actorId: string,
  at: number,
  request: PrincipalOperationRequest,
  p: ServicePrincipalsPorts,
) {
  if (!s.registration || !s.principalPolicy) return no('service-supply-not-enabled');
  try {
    decodeServiceReopening(request);
    if (s.policyTransition?.retiredServiceIds.includes(request.resourceId))
      return no('legacy-service-republication-required');
    const service = s.services[request.resourceId];
    if (
      !service ||
      service.active ||
      service.control?.policyVersion !== 'resource-principals-v2' ||
      service.control.offer
    )
      return no('service-inactive-principal-required');
    const expected = serviceReopeningRequest(service);
    if (principalOperationKey(request) !== principalOperationKey(expected))
      return no('service-principal-version-or-resource-conflict');
    if (!p.service.exists(actorId) || !p.available(service.control.controller))
      return no('service-principal-actor-unavailable');
    const authorization = p.authorizeOperation(service.control.controller, request);
    if (!authorization) return no('service-principal-operation-authority-required');
    assertPrincipalAuthorization(authorization, service.control.controller, expected, actorId);
    const capacity = p.service.locationCapacity(service.locationId);
    if (capacity === undefined || capacity < service.capacity)
      return no('service-location-capacity-required');
    const event: ServiceSupplyEvent = {
      type: 'PrincipalServiceReopened',
      previousRevision: service.revision,
      at,
      authorization,
      service: { ...service, active: true, revision: service.revision + 1, principalAt: at },
      capacityProof: { locationId: service.locationId, capacity },
    };
    applyServiceSupplyEvent(s, event);
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-reopening');
  }
}
function createdService(
  actor: string,
  at: number,
  creation: PrincipalServiceCreation,
  authorization: Extract<ServiceSupplyEvent, { type: 'PrincipalServiceCreated' }>['authorization'],
  policy: ServicesPolicy,
): Service {
  const command = {
    ...creation.command,
    ...(creation.enterpriseSupply && creation.principal.kind === 'enterprise'
      ? { enterpriseId: creation.principal.id }
      : {}),
  };
  return {
    ...serviceRecordFromPublication(command, actor, policy),
    control: {
      policyVersion: 'resource-principals-v2',
      controller: creation.principal,
      version: 1,
      at,
      authorization,
    },
    namedProviders: [],
    principalAt: at,
  };
}
export function decidePrincipalServiceCreation(
  s: ServicesState,
  actorId: string,
  at: number,
  request: PrincipalOperationRequest,
  p: ServicePrincipalsPorts,
) {
  if (!s.registration || !s.principalPolicy) return no('service-supply-not-enabled');
  try {
    assertServiceSupplyPolicy(s.registration.policy);
    const creation = decodeServiceCreation(request),
      expected = serviceCreationRequest(s, creation);
    if (principalOperationKey(request) !== principalOperationKey(expected))
      return no('service-directory-version-conflict');
    if (
      !Number.isSafeInteger(at) ||
      at < 0 ||
      !p.service.exists(actorId) ||
      !p.available(creation.principal)
    )
      return no('service-creation-principal-or-actor-unavailable');
    const authorization = p.authorizeOperation(creation.principal, request);
    if (!authorization) return no('service-creation-authority-required');
    assertPrincipalAuthorization(authorization, creation.principal, request, actorId);
    if (Object.keys(s.services).length >= s.registration.policy.maxRegisteredServices)
      return no('service-directory-registration-limit');
    const command = {
      ...creation.command,
      ...(creation.enterpriseSupply && creation.principal.kind === 'enterprise'
        ? { enterpriseId: creation.principal.id }
        : {}),
    };
    const d = decideServices(s, actorId, at, command, {
      ...p.service,
      controlsEnterprise: (actor, id) =>
        actor === actorId &&
        creation.principal.kind === 'enterprise' &&
        creation.principal.id === id,
    });
    if (!d.accepted) return d;
    const capacity = p.service.locationCapacity(command.locationId),
      destinationCapacity =
        command.destinationId === undefined
          ? undefined
          : p.service.locationCapacity(command.destinationId);
    if (capacity === undefined) return no('service-location-capacity-required');
    const event: ServiceSupplyEvent = {
      type: 'PrincipalServiceCreated',
      previousDirectoryRevision: s.registration.revision,
      at,
      authorization,
      service: createdService(actorId, at, creation, authorization, s.policy),
      capacityProof: {
        locationId: command.locationId,
        capacity,
        ...(destinationCapacity === undefined ? {} : { destinationCapacity }),
      },
    };
    applyServiceSupplyEvent(s, event);
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-creation');
  }
}
export function applyServiceSupplyEvent(
  s: ServicesState,
  event: ServiceSupplyEvent,
): ServicesState {
  if (event.type === 'ServiceSupplyEnabled') {
    assertServiceSupplyPolicy(event.policy);
    if (
      s.registration ||
      !s.principalPolicy ||
      s.policy.version !== 'resident-services-v3' ||
      Object.keys(s.services).length > event.policy.maxRegisteredServices
    )
      throw Error('invalid-service-supply-activation');
    return { ...s, registration: { policy: structuredClone(event.policy), revision: 1 } };
  }
  if (!s.registration || !s.principalPolicy) throw Error('service-supply-not-enabled');
  assertServiceSupplyPolicy(s.registration.policy);
  if (event.type === 'PrincipalServiceReopened') {
    if (s.policyTransition?.retiredServiceIds.includes(event.service.id))
      throw new Error('legacy-service-republication-required');
    const v = s.services[event.service.id];
    if (
      !v ||
      v.active ||
      v.control?.policyVersion !== 'resource-principals-v2' ||
      v.control.offer ||
      event.previousRevision !== v.revision ||
      !Number.isSafeInteger(v.revision + 1) ||
      !Number.isSafeInteger(event.at) ||
      event.at < (v.principalAt ?? v.control.at)
    )
      throw Error('invalid-service-reopening-source');
    assertPrincipalAuthorization(
      event.authorization,
      v.control.controller,
      serviceReopeningRequest(v),
      event.authorization.actorId,
    );
    if (
      principalOperationKey(event.service) !==
        principalOperationKey({
          ...v,
          active: true,
          revision: v.revision + 1,
          principalAt: event.at,
        }) ||
      event.capacityProof.locationId !== v.locationId ||
      !Number.isSafeInteger(event.capacityProof.capacity) ||
      event.capacityProof.capacity < v.capacity
    )
      throw Error('invalid-service-reopening-facts');
    return { ...s, services: { ...s.services, [v.id]: structuredClone(event.service) } };
  }
  const r = event.authorization.request,
    creation = decodeServiceCreation(r),
    expected = serviceCreationRequest(s, creation),
    c = creation.command;
  assertPrincipalAuthorization(
    event.authorization,
    creation.principal,
    expected,
    event.service.ownerId,
  );
  if (
    event.previousDirectoryRevision !== s.registration.revision ||
    !Number.isSafeInteger(s.registration.revision + 1) ||
    !Number.isSafeInteger(event.at) ||
    event.at < 0 ||
    s.services[c.id] ||
    Object.keys(s.services).length >= s.registration.policy.maxRegisteredServices ||
    principalOperationKey(event.service) !==
      principalOperationKey(
        createdService(
          event.authorization.actorId,
          event.at,
          creation,
          event.authorization,
          s.policy,
        ),
      )
  )
    throw Error('service-creation-event-source-mismatch');
  const proof = event.capacityProof;
  if (
    (proof.destinationCapacity !== undefined &&
      (!Number.isSafeInteger(proof.destinationCapacity) || proof.destinationCapacity < 0)) ||
    Object.keys(proof).some((k) => !['locationId', 'capacity', 'destinationCapacity'].includes(k))
  )
    throw Error('invalid-service-capacity-source-proof');
  if (
    !validServiceRecordId(c.id) ||
    !principalId(c.id) ||
    !principalId(c.locationId) ||
    (c.destinationId !== undefined && !principalId(c.destinationId))
  )
    throw Error('invalid-service-creation-id');
  if (
    proof.locationId !== c.locationId ||
    !Number.isSafeInteger(proof.capacity) ||
    proof.capacity < c.capacity ||
    !Number.isSafeInteger(c.capacity) ||
    c.capacity < 1 ||
    c.capacity > s.policy.maxCapacity ||
    !c.title.trim() ||
    c.title.length > 120 ||
    !c.description.trim() ||
    c.description.length > s.policy.maxText ||
    (c.kind === 'lodging' && c.capacity !== 1) ||
    (c.kind === 'transport' &&
      (!c.destinationId ||
        c.destinationId === c.locationId ||
        proof.destinationCapacity === undefined)) ||
    (c.kind !== 'transport' &&
      proof.destinationCapacity !== undefined &&
      c.destinationId === undefined) ||
    (c.unitsPerProvider !== undefined &&
      (!Number.isSafeInteger(c.unitsPerProvider) ||
        c.unitsPerProvider < 1 ||
        c.unitsPerProvider > s.policy.maxCapacity ||
        event.service.participationMode !== 'hosted')) ||
    (c.kind === 'course' && event.service.participationMode !== 'hosted') ||
    (creation.enterpriseSupply && event.service.participationMode !== 'hosted')
  )
    throw Error('invalid-service-creation-facts');
  return {
    ...s,
    registration: { ...s.registration, revision: s.registration.revision + 1 },
    services: { ...s.services, [c.id]: structuredClone(event.service) },
  };
}
