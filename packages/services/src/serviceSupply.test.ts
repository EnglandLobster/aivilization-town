import { expect, test } from 'vitest';
import {
  type PrincipalOperationRequest,
  type PrincipalAuthoritySource,
  type ResourcePrincipal,
} from '@aivilization/authority';
import {
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  applyServicesEvent,
  type ServicesState,
} from './model';
import { canProvide } from './supply';
import { decideServices } from './aggregate';
import {
  applyServicePrincipalEvent,
  decideServicePrincipalOperation,
  type ServicePrincipalsPorts,
} from './servicePrincipals';
import { SERVICE_PRINCIPALS_POLICY, serviceAdministrativeRequest } from './servicePrincipalModel';
import { SERVICE_SUPPLY_POLICY, type PrincipalServiceCreation } from './serviceSupplyModel';
import {
  applyServiceSupplyEvent,
  decidePrincipalServiceCreation,
  decidePrincipalServiceReopening,
  serviceCreationRequest,
  serviceReopeningRequest,
} from './serviceSupply';
function fixture() {
  const old = emptyServicesState(STAFFED_SERVICES_POLICY);
  const principal = applyServicePrincipalEvent(old, {
    type: 'ServicePrincipalsEnabled',
    policy: SERVICE_PRINCIPALS_POLICY,
  });
  let state = applyServiceSupplyEvent(principal, {
    type: 'ServiceSupplyEnabled',
    policy: SERVICE_SUPPLY_POLICY,
  });
  let actor = 'writer',
    capacity = 3;
  const source = (p: ResourcePrincipal): PrincipalAuthoritySource =>
    p.kind === 'resident'
      ? { kind: 'personal' }
      : p.kind === 'enterprise'
        ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
        : p.kind === 'collective'
          ? { kind: 'collective', decisionId: 'exact', charterVersion: 1 }
          : { kind: 'public', proposalId: 'exact', procedureRevision: 1 };
  const p: ServicePrincipalsPorts = {
    available: () => true,
    authorizeControl: () => undefined,
    authorizeOperation: (principal, request) =>
      actor === 'intruder'
        ? undefined
        : { actorId: actor, principal, request, source: source(principal) },
    inheritedProviders: () => [],
    service: {
      exists: () => true,
      locationCapacity: () => capacity,
      presentAndIdle: () => true,
      employedBy: () => true,
      controlsEnterprise: () => true,
    },
  };
  const creation = (
    id = 'clinic',
    principal: ResourcePrincipal = { kind: 'enterprise', id: 'firm' },
  ): PrincipalServiceCreation => ({
    principal,
    command: {
      type: 'publish',
      id,
      kind: 'appointment',
      locationId: 'room',
      title: '居民原文',
      description: '目录不产生身体效果',
      capacity: 2,
    },
  });
  const run = (request: PrincipalOperationRequest, who = 'writer') => {
    actor = who;
    const d = decidePrincipalServiceCreation(state, actor, 10, request, p);
    if (d.accepted) state = d.events.reduce(applyServiceSupplyEvent, state);
    return d;
  };
  return {
    old,
    principal,
    p,
    creation,
    run,
    capacity: (v: number) => (capacity = v),
    actor: (v: string) => (actor = v),
    get state() {
      return state;
    },
    set state(v: ServicesState) {
      state = v;
    },
  };
}
test('organizational creation records the exact subject and actual author, starts with no named labor, and has deterministic replay', () => {
  for (const principal of [
    { kind: 'resident', id: 'writer' },
    { kind: 'enterprise', id: 'firm' },
    { kind: 'collective', id: 'club' },
    { kind: 'public', id: 'town' },
  ] as const) {
    const t = fixture(),
      before = t.state,
      request = serviceCreationRequest(t.state, {
        ...t.creation('clinic', principal),
        ...(principal.kind === 'enterprise' ? ({ enterpriseSupply: true } as const) : {}),
      }),
      d = t.run(request);
    expect(d.accepted).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    expect(t.state.services.clinic).toMatchObject({
      ownerId: 'writer',
      control: { controller: principal, authorization: { request } },
      namedProviders: [],
      participationMode: 'hosted',
      unitsPerProvider: 1,
    });
    expect(t.state.services.clinic!.enterpriseId).toBe(
      principal.kind === 'enterprise' ? 'firm' : undefined,
    );
    expect(canProvide(t.state.services.clinic!, 'writer', t.p.service)).toBe(false);
    expect(t.state.registration!.revision).toBe(2);
    expect(d.events.reduce(applyServiceSupplyEvent, before)).toEqual(t.state);
    const event = d.events[0];
    if (event?.type !== 'PrincipalServiceCreated') throw Error('fixture');
    expect(() =>
      applyServiceSupplyEvent(before, {
        ...event,
        service: { ...event.service, ownerId: 'intruder' },
      }),
    ).toThrow();
  }
});
test('precise creation rejects unauthorized, stale or malformed requests, insufficient capacity and unrelated enterprise affiliation', () => {
  const t = fixture(),
    request = serviceCreationRequest(t.state, t.creation());
  expect(t.run(request, 'intruder')).toMatchObject({
    accepted: false,
    reason: 'service-creation-authority-required',
  });
  expect(t.state.registration!.revision).toBe(1);
  t.capacity(1);
  expect(t.run(request).accepted).toBe(false);
  expect(Object.keys(t.state.services)).toEqual([]);
  t.capacity(3);
  expect(t.run(request).accepted).toBe(true);
  expect(t.run(request)).toMatchObject({
    accepted: false,
    reason: 'service-directory-version-conflict',
  });
  const next = serviceCreationRequest(t.state, t.creation('other'));
  expect(t.run({ ...next, resourceRevision: 0 }).accepted).toBe(false);
  expect(
    t.run({
      ...next,
      operation: {
        ...next.operation,
        arguments: {
          ...next.operation.arguments,
          command: { ...t.creation('other').command, enterpriseId: 'other-firm' },
        },
      },
    }).accepted,
  ).toBe(false);
  expect(
    t.run({
      ...next,
      operation: {
        ...next.operation,
        arguments: {
          ...next.operation.arguments,
          command: { ...t.creation('other').command, id: '__proto__' },
        },
      },
    }).accepted,
  ).toBe(false);
  expect(t.state.registration!.revision).toBe(2);
});
test('legacy personal publication advances actual registration version without inventing organizational control; old state stays compatible', () => {
  const t = fixture(),
    request = serviceCreationRequest(t.state, t.creation());
  const d = decideServices(
    t.state,
    'writer',
    5,
    t.creation('personal', { kind: 'resident', id: 'writer' }).command,
    t.p.service,
  );
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  t.state = d.events.reduce(applyServicesEvent, t.state);
  expect(t.state.registration!.revision).toBe(2);
  expect(t.state.services.personal!.control).toBeUndefined();
  expect(t.run(request).accepted).toBe(false);
  const old = decideServices(t.old, 'writer', 5, t.creation('old').command, t.p.service);
  expect(old.accepted).toBe(true);
  if (!old.accepted) throw Error(old.reason);
  expect(old.events.reduce(applyServicesEvent, t.old).registration).toBeUndefined();
});
test('reopening preserves history and named permission, requires current control and actual capacity, and never starts a body', () => {
  const t = fixture();
  expect(t.run(serviceCreationRequest(t.state, t.creation())).accepted).toBe(true);
  const close = decideServicePrincipalOperation(
    t.state,
    'writer',
    11,
    serviceAdministrativeRequest(t.state, { type: 'close', id: 'clinic', expectedRevision: 1 }),
    t.p,
  );
  expect(close.accepted).toBe(true);
  if (!close.accepted) throw Error(close.reason);
  t.state = close.events.reduce(applyServicePrincipalEvent, t.state);
  const before = structuredClone(t.state),
    request = serviceReopeningRequest(t.state.services.clinic!);
  t.capacity(1);
  expect(decidePrincipalServiceReopening(t.state, 'writer', 12, request, t.p).accepted).toBe(false);
  t.capacity(3);
  const d = decidePrincipalServiceReopening(t.state, 'writer', 12, request, t.p);
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  t.state = d.events.reduce(applyServiceSupplyEvent, t.state);
  expect(t.state.services.clinic).toEqual({
    ...before.services.clinic,
    active: true,
    revision: 3,
    principalAt: 12,
  });
  expect(t.state.slots).toEqual(before.slots);
  expect(t.state.bookings).toEqual(before.bookings);
  expect(decidePrincipalServiceReopening(t.state, 'writer', 12, request, t.p).accepted).toBe(false);
  expect(d.events.reduce(applyServiceSupplyEvent, before)).toEqual(t.state);
});
