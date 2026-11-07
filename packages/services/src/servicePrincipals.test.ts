import { expect, test } from 'vitest';
import {
  type PrincipalAuthoritySource,
  type ResourcePrincipal,
  type PrincipalControlRequest,
} from '@aivilization/authority';
import {
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  applyServicesEvent,
  type ServicesCommand,
  type ServicesEvent,
} from './model';
import { decideServices } from './aggregate';
import { canProvide } from './supply';
import { decideServiceControl } from './serviceControl';
import {
  SERVICE_PRINCIPALS_POLICY,
  serviceAdministrativeRequest,
  serviceProviderRequest,
  type ServicePrincipalEvent,
  type ServiceAdministrativeCommand,
} from './servicePrincipalModel';
import {
  applyServicePrincipalEvent,
  decideServicePrincipalControl,
  decideServicePrincipalOperation,
  type ServicePrincipalsPorts,
} from './servicePrincipals';
function fixture(enterpriseId?: string) {
  const ports = {
    exists: (id: string) => ['old', 'user', 'manager', 'patient'].includes(id),
    locationCapacity: () => 10,
    presentAndIdle: () => true,
    controlsEnterprise: (id: string) => id === 'old' || id === 'manager',
    employedBy: (id: string) => id === 'user',
  };
  const enabled = emptyServicesState(STAFFED_SERVICES_POLICY);
  const pub = decideServices(
    enabled,
    'old',
    0,
    {
      type: 'publish',
      id: 'clinic',
      kind: 'appointment',
      locationId: 'a',
      title: '居民原文诊所',
      description: '只登记安排，不产生疗效',
      capacity: 2,
      ...(enterpriseId ? { enterpriseId } : {}),
    },
    ports,
  );
  if (!pub.accepted) throw Error(pub.reason);
  const legacy = pub.events.reduce(applyServicesEvent, enabled);
  let state = applyServicePrincipalEvent(legacy, {
      type: 'ServicePrincipalsEnabled',
      policy: SERVICE_PRINCIPALS_POLICY,
    }),
    actor = 'old';
  const history: ServicePrincipalEvent[] = [];
  const all: ServicesEvent[] = [
    { type: 'ServicePrincipalsEnabled', policy: SERVICE_PRINCIPALS_POLICY },
  ];
  const source = (p: ResourcePrincipal): PrincipalAuthoritySource =>
    p.kind === 'resident'
      ? { kind: 'personal' }
      : p.kind === 'enterprise'
        ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
        : p.kind === 'collective'
          ? { kind: 'collective', decisionId: 'vote', charterVersion: 1 }
          : { kind: 'public', proposalId: 'public', procedureRevision: 1 };
  const principal: ServicePrincipalsPorts = {
    available: (p) => (p.kind === 'resident' ? ports.exists(p.id) : true),
    authorizeControl: (p, r) => ({ actorId: actor, principal: p, request: r, source: source(p) }),
    authorizeOperation: (p, r) => ({ actorId: actor, principal: p, request: r, source: source(p) }),
    inheritedProviders: () => (enterpriseId ? ['old', 'user'] : ['old']),
    service: ports,
  };
  const apply = (
    d:
      | { accepted: true; events: readonly ServicePrincipalEvent[] }
      | { accepted: false; reason: string },
  ) => {
    if (d.accepted)
      for (const e of d.events) {
        state = applyServicePrincipalEvent(state, e);
        history.push(e);
        all.push(e);
      }
    return d;
  };
  const control = (
    who: string,
    at: number,
    command: PrincipalControlRequest['command'],
    override: Partial<ServicePrincipalsPorts> = {},
  ) => {
    actor = who;
    const v = state.services.clinic!;
    return apply(
      decideServicePrincipalControl(
        state,
        who,
        at,
        {
          resourceKind: 'service',
          resourceId: v.id,
          resourceRevision: v.revision,
          controlVersion: v.control?.version ?? 1,
          command,
        },
        { ...principal, ...override },
      ),
    );
  };
  const operate = (who: string, at: number, c: ServiceAdministrativeCommand) => {
    actor = who;
    return apply(
      decideServicePrincipalOperation(
        state,
        who,
        at,
        serviceAdministrativeRequest(state, c),
        principal,
      ),
    );
  };
  const permission = (
    who: string,
    at: number,
    type: 'services.authorize-provider' | 'services.revoke-provider',
    residentId: string,
  ) => {
    actor = who;
    const v = state.services.clinic!;
    return apply(
      decideServicePrincipalOperation(
        state,
        who,
        at,
        serviceProviderRequest(state, { type, id: v.id, expectedRevision: v.revision, residentId }),
        principal,
      ),
    );
  };
  return {
    legacy,
    replay: () => all.reduce(applyServicesEvent, legacy),
    principal,
    ports,
    history,
    get state() {
      return state;
    },
    control,
    operate,
    permission,
    personal: (who: string, at: number, c: ServicesCommand) => {
      const d = decideServices(state, who, at, c, ports);
      if (d.accepted) {
        state = d.events.reduce(applyServicesEvent, state);
        all.push(...d.events);
      }
      return d;
    },
  };
}
test('service authority migration preserves authorship and provider history; administrator must separately be a provider', () => {
  const t = fixture();
  expect(
    t.control('old', 1, {
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      expiresAt: 1000,
      terms: '只交接目录',
    }).accepted,
  ).toBe(true);
  expect(t.control('manager', 2, { type: 'accept' }).accepted).toBe(true);
  const service = t.state.services.clinic!;
  expect(service).toMatchObject({
    ownerId: 'old',
    namedProviders: ['old'],
    control: { controller: { kind: 'enterprise', id: 'firm' } },
  });
  expect(canProvide(service, 'manager', t.ports)).toBe(false);
  expect(
    t.personal('old', 3, {
      type: 'schedule',
      id: 'unauthorized',
      serviceId: 'clinic',
      start: 10,
      end: 100,
      capacity: 1,
    }).accepted,
  ).toBe(false);
  expect(
    t.operate('manager', 3, {
      type: 'schedule',
      id: 'slot',
      serviceId: 'clinic',
      start: 10,
      end: 100,
      capacity: 1,
    }).accepted,
  ).toBe(true);
  expect(
    t.personal('manager', 10, { type: 'start-session', id: 'slot', expectedRevision: 1 }).accepted,
  ).toBe(false);
  expect(t.permission('manager', 4, 'services.authorize-provider', 'user').accepted).toBe(true);
  expect(
    t.personal('user', 10, { type: 'start-session', id: 'slot', expectedRevision: 1, until: 80 })
      .accepted,
  ).toBe(true);
  expect(t.permission('manager', 11, 'services.revoke-provider', 'user')).toMatchObject({
    accepted: false,
    reason: 'service-active-provider-permission-required',
  });
  expect(
    t.personal('user', 30, { type: 'stop-session', id: 'slot', expectedRevision: 2 }).accepted,
  ).toBe(true);
  expect(t.permission('manager', 31, 'services.revoke-provider', 'user').accepted).toBe(true);
  expect(t.state.slots.slot!.providers).toEqual([
    { residentId: 'user', startedAt: 10, until: 80, endedAt: 30 },
  ]);
});
test('administrative booking acceptance is distinct from independent actual patient participation, and closure keeps obligations', () => {
  const t = fixture();
  t.control('old', 1, {
    type: 'offer',
    target: { kind: 'public', id: 'town' },
    expiresAt: 1000,
    terms: '公共原文目录',
  });
  t.control('manager', 2, { type: 'accept' });
  expect(
    t.operate('manager', 3, {
      type: 'schedule',
      id: 'slot',
      serviceId: 'clinic',
      start: 10,
      end: 100,
      capacity: 1,
    }).accepted,
  ).toBe(true);
  expect(
    t.personal('patient', 4, { type: 'request', id: 'booking', slotId: 'slot', units: 1 }).accepted,
  ).toBe(true);
  expect(
    t.operate('manager', 5, { type: 'accept', id: 'booking', expectedRevision: 1 }).accepted,
  ).toBe(true);
  expect(t.state.bookings.booking!.checkedInAt).toBeUndefined();
  expect(
    t.operate('manager', 6, {
      type: 'close',
      id: 'clinic',
      expectedRevision: t.state.services.clinic!.revision,
    }),
  ).toMatchObject({ accepted: false, reason: 'outstanding-bookings' });
  expect(
    t.personal('manager', 10, { type: 'check-in', id: 'booking', expectedRevision: 2 }).accepted,
  ).toBe(false);
  expect(
    t.operate('manager', 7, { type: 'cancel', id: 'booking', expectedRevision: 2 }).accepted,
  ).toBe(true);
  expect(
    t.operate('manager', 8, {
      type: 'close',
      id: 'clinic',
      expectedRevision: t.state.services.clinic!.revision,
    }).accepted,
  ).toBe(true);
  expect(t.replay()).toEqual(t.state);
});
test('enterprise affiliation requires its own exact proof and preserves original binding and inherited named staff', () => {
  const t = fixture('original');
  expect(
    t.control(
      'old',
      1,
      {
        type: 'offer',
        target: { kind: 'collective', id: 'club' },
        expiresAt: 1000,
        terms: '关联不转移',
      },
      {
        authorizeControl: (p, r) =>
          p.kind === 'enterprise'
            ? undefined
            : { actorId: 'old', principal: p, request: r, source: { kind: 'personal' } },
      },
    ),
  ).toMatchObject({ accepted: false, reason: 'service-enterprise-affiliation-authority-required' });
  expect(
    t.control('old', 1, {
      type: 'offer',
      target: { kind: 'collective', id: 'club' },
      expiresAt: 1000,
      terms: '关联不转移',
    }).accepted,
  ).toBe(true);
  expect(t.control('manager', 2, { type: 'accept' }).accepted).toBe(true);
  expect(t.state.services.clinic!).toMatchObject({
    enterpriseId: 'original',
    ownerId: 'old',
    namedProviders: ['old', 'user'],
    control: { controller: { kind: 'collective', id: 'club' } },
  });
  expect(canProvide(t.state.services.clinic!, 'manager', t.ports)).toBe(false);
  const enabled = applyServicePrincipalEvent(t.legacy, {
    type: 'ServicePrincipalsEnabled',
    policy: SERVICE_PRINCIPALS_POLICY,
  });
  expect(t.history.reduce(applyServicePrincipalEvent, enabled)).toEqual(t.state);
  const event = t.history[0]!;
  if (event.type !== 'ServicePrincipalControlChanged') throw Error('fixture');
  const { affiliationAuthorization: _auth, ...forged } = event;
  void _auth;
  expect(() => applyServicePrincipalEvent(enabled, forged)).toThrow(
    'service-enterprise-affiliation-authority-required',
  );
});
test('legacy commands and ordinary events cannot overwrite v2 control or named permissions; unsupported body delegation rejects', () => {
  const t = fixture();
  t.control('old', 1, {
    type: 'offer',
    target: { kind: 'resident', id: 'manager' },
    expiresAt: 1000,
    terms: '具名',
  });
  t.control('manager', 2, { type: 'accept' });
  const v = t.state.services.clinic!;
  expect(
    decideServiceControl({
      state: {
        ...t.state,
        controlPolicy: {
          version: 'resident-service-control-v1',
          control: {
            version: 'resource-control-v1',
            maxOfferHorizonMs: 2592000000,
            maxTermsChars: 2000,
          },
        },
      },
      serviceId: v.id,
      actorId: 'manager',
      at: 3,
      expectedRevision: v.revision,
      command: { type: 'cancel', expectedVersion: v.control!.version },
      authorize: () => ({ actorId: 'manager' }),
      available: () => true,
    }),
  ).toMatchObject({ accepted: false, reason: 'service-principal-control-required' });
  expect(() =>
    applyServicesEvent(t.state, {
      type: 'ServiceChanged',
      service: { ...v, namedProviders: ['manager'], revision: v.revision + 1 },
    }),
  ).toThrow('service-principal-operation-envelope-required');
  expect(
    decideServicePrincipalOperation(
      t.state,
      'manager',
      3,
      {
        resourceKind: 'service',
        resourceId: v.id,
        resourceRevision: v.revision,
        controlVersion: v.control!.version,
        operation: {
          capability: 'services.start',
          arguments: { command: { type: 'start-session', id: 'slot', expectedRevision: 1 } },
        },
      },
      t.principal,
    ).accepted,
  ).toBe(false);
  expect(t.control('manager', 1, { type: 'cancel' }).accepted).toBe(false);
});

test('explicit authority separation preserves service agreements and rejects repeated or mismatched transitions', () => {
  const state = applyServicePrincipalEvent(emptyServicesState(STAFFED_SERVICES_POLICY), {
    type: 'ServicePrincipalsEnabled',
    policy: SERVICE_PRINCIPALS_POLICY,
  });
  const event = {
    type: 'ServicePrincipalAuthoritySeparated' as const,
    previousVersion: SERVICE_PRINCIPALS_POLICY.version,
    policy: { ...SERVICE_PRINCIPALS_POLICY, version: 'resident-service-principals-v3' as const },
  };
  const next = applyServicePrincipalEvent(state, event);
  expect(next).toEqual({ ...state, principalPolicy: event.policy });
  expect(applyServicesEvent(state, event)).toEqual(next);
  expect(() => applyServicePrincipalEvent(next, event)).toThrow(
    'invalid-service-authority-transition',
  );
  expect(() =>
    applyServicePrincipalEvent(emptyServicesState(STAFFED_SERVICES_POLICY), event),
  ).toThrow('invalid-service-authority-transition');
});
