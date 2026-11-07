import { expect, test } from 'vitest';
import {
  resourcePrincipalSnapshot,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  applyServicesEvent,
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  type ServicesEvent,
  type ServicesState,
} from './model';
import { SERVICE_PRINCIPALS_POLICY } from './servicePrincipalModel';
import { SERVICE_SUPPLY_POLICY } from './serviceSupplyModel';
import { SERVICE_AFFILIATION_POLICY } from './serviceAffiliationModel';
import {
  SERVICE_SUPPLY_RELATION_POLICY,
  type ServiceSupplyRelationCommand,
  type ServiceSupplyRelationEvent,
} from './serviceSupplyRelationModel';
import {
  serviceSupplyRelationRequest,
  decideServiceSupplyRelation,
  decideServiceSupplyControl,
} from './serviceSupplyRelations';
import { currentServiceEnterprise } from './serviceSupplyRelationFacts';
import { canProvide } from './supply';
import { enterpriseServiceEstateIds } from './principalEstate';
import { type ServicePrincipalsPorts } from './servicePrincipals';
function fixture() {
  const legacy: ServicesState = {
    ...emptyServicesState(STAFFED_SERVICES_POLICY),
    services: {
      clinic: {
        id: 'clinic',
        ownerId: 'owner',
        enterpriseId: 'old-firm',
        locationId: 'site',
        kind: 'appointment',
        participationMode: 'hosted',
        title: '原文',
        description: '原供给来源',
        capacity: 2,
        revision: 1,
        active: true,
      },
    },
  };
  const activation: ServicesEvent[] = [
    { type: 'ServicePrincipalsEnabled', policy: SERVICE_PRINCIPALS_POLICY },
    { type: 'ServiceSupplyEnabled', policy: SERVICE_SUPPLY_POLICY },
    { type: 'ServiceAffiliationsEnabled', policy: SERVICE_AFFILIATION_POLICY },
    { type: 'ServiceSupplyRelationsEnabled', policy: SERVICE_SUPPLY_RELATION_POLICY },
  ];
  let s = activation.reduce(applyServicesEvent, legacy),
    actor = 'owner';
  const history: ServicesEvent[] = [...activation];
  const ports: ServicePrincipalsPorts = {
    available: () => true,
    authorizeControl: (p, r) =>
      p.kind === 'resident' && p.id === actor
        ? { actorId: actor, principal: p, request: r, source: { kind: 'personal' } }
        : p.kind === 'enterprise' &&
            ((p.id === 'old-firm' && actor === 'manager') ||
              (p.id === 'new-firm' && actor === 'new-manager'))
          ? {
              actorId: actor,
              principal: p,
              request: r,
              source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
            }
          : undefined,
    authorizeOperation: (p, r) =>
      p.kind === 'resident' && p.id === actor
        ? { actorId: actor, principal: p, request: r, source: { kind: 'personal' } }
        : p.kind === 'enterprise' &&
            ((p.id === 'old-firm' && actor === 'manager') ||
              (p.id === 'new-firm' && actor === 'new-manager'))
          ? {
              actorId: actor,
              principal: p,
              request: r,
              source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
            }
          : undefined,
    inheritedProviders: (v) => (currentServiceEnterprise(v) ? ['worker'] : ['owner']),
    service: {
      exists: () => true,
      presentAndIdle: () => true,
      locationCapacity: () => 2,
      employedBy: (a, id) => a === 'worker' && id === 'old-firm',
      controlsEnterprise: (a, id) =>
        (a === 'manager' && id === 'old-firm') || (a === 'new-manager' && id === 'new-firm'),
    },
  };
  const apply = (
    d:
      | { accepted: true; events: readonly ServiceSupplyRelationEvent[] }
      | { accepted: false; reason: string },
  ) => {
    if (d.accepted)
      for (const e of d.events) {
        s = applyServicesEvent(s, e);
        history.push(e);
      }
    return d;
  };
  const request = (c: ServiceSupplyRelationCommand) =>
    serviceSupplyRelationRequest(s.services.clinic!, c);
  const relation = (who: string, c: ServiceSupplyRelationCommand, at = 10) => {
    actor = who;
    return apply(decideServiceSupplyRelation(s, who, at, request(c), ports));
  };
  const control = (who: string, command: PrincipalControlRequest['command'], at = 20) => {
    actor = who;
    const v = s.services.clinic!;
    return apply(
      decideServiceSupplyControl(
        s,
        who,
        at,
        {
          resourceKind: 'service',
          resourceId: v.id,
          resourceRevision: v.revision,
          controlVersion: resourcePrincipalSnapshot(v).version,
          command,
        },
        ports,
      ),
    );
  };
  const override = (x: Partial<ServicesState>) => {
    s = { ...s, ...x };
  };
  return {
    get state() {
      return s;
    },
    legacy,
    history,
    ports,
    relation,
    request,
    control,
    override,
  };
}
test('either actual directory owner or current supplying firm may end future affiliation, immutable origin and bodily/booking facts remain', () => {
  for (const [who, subject] of [
    ['owner', { kind: 'resident', id: 'owner' }],
    ['manager', { kind: 'enterprise', id: 'old-firm' }],
  ] as const) {
    const t = fixture(),
      before = structuredClone(t.state);
    expect(t.relation('intruder', { type: 'services.end-supply', subject }).accepted).toBe(false);
    expect(t.relation(who, { type: 'services.end-supply', subject }).accepted).toBe(true);
    expect(t.state.services.clinic!.enterpriseId).toBe('old-firm');
    expect(currentServiceEnterprise(t.state.services.clinic!)).toBeUndefined();
    expect(t.state.services.clinic!.control).toEqual(before.services.clinic!.control);
    expect(t.state.bookings).toEqual(before.bookings);
    expect(enterpriseServiceEstateIds(t.state, 'old-firm', 10)).toEqual([]);
    expect(canProvide(t.state.services.clinic!, 'owner', t.ports.service)).toBe(true);
    expect(canProvide(t.state.services.clinic!, 'worker', t.ports.service)).toBe(false);
    expect(t.history.reduce(applyServicesEvent, t.legacy)).toEqual(t.state);
  }
});
test('directory invites an actual firm, its separate manager independently accepts current exact version, nobody or resources appear', () => {
  const t = fixture();
  expect(
    t.relation('owner', { type: 'services.end-supply', subject: { kind: 'resident', id: 'owner' } })
      .accepted,
  ).toBe(true);
  const terms = {
    type: 'services.offer-supply' as const,
    enterpriseId: 'new-firm',
    expiresAt: 100,
    terms: '新未来供给，旧债务不变',
  };
  expect(t.relation('new-manager', terms, 11).accepted).toBe(false);
  expect(t.relation('owner', terms, 11).accepted).toBe(true);
  expect(currentServiceEnterprise(t.state.services.clinic!)).toBeUndefined();
  expect(t.relation('owner', { type: 'services.accept-supply' }, 12).accepted).toBe(false);
  expect(
    t.control(
      'owner',
      {
        type: 'offer',
        target: { kind: 'resident', id: 'receiver' },
        expiresAt: 100,
        terms: '目录转移',
      },
      12,
    ),
  ).toMatchObject({ accepted: false, reason: 'service-supply-offer-pending' });
  expect(t.relation('new-manager', { type: 'services.accept-supply' }, 12).accepted).toBe(true);
  expect(currentServiceEnterprise(t.state.services.clinic!)).toBe('new-firm');
  expect(t.state.services.clinic!.enterpriseId).toBe('old-firm');
  expect(t.state.services.clinic!.namedProviders).toBeUndefined();
  expect(t.history.reduce(applyServicesEvent, t.legacy)).toEqual(t.state);
});
test('active or accepted participation prevents changing affiliation, while either invitation party may cancel without ending bodies', () => {
  const t = fixture();
  const slot = {
    id: 'slot',
    serviceId: 'clinic',
    start: 0,
    end: 1000,
    capacity: 1,
    revision: 1,
    active: true,
    providers: [{ residentId: 'worker', startedAt: 0, until: 1000 }],
  };
  t.override({ slots: { slot } });
  expect(
    t.relation('manager', {
      type: 'services.end-supply',
      subject: { kind: 'enterprise', id: 'old-firm' },
    }),
  ).toMatchObject({ accepted: false, reason: 'outstanding-service-commitments' });
  t.override({
    slots: { ...t.state.slots, slot: { ...slot, providers: [] } },
    bookings: {
      b: {
        id: 'b',
        slotId: 'slot',
        residentId: 'patient',
        units: 1,
        revision: 1,
        status: 'accepted',
        at: 0,
      },
    },
  });
  expect(
    t.relation('owner', { type: 'services.end-supply', subject: { kind: 'resident', id: 'owner' } })
      .accepted,
  ).toBe(false);
  t.override({ bookings: {} });
  expect(
    t.relation('owner', { type: 'services.end-supply', subject: { kind: 'resident', id: 'owner' } })
      .accepted,
  ).toBe(true);
  expect(
    t.relation(
      'owner',
      { type: 'services.offer-supply', enterpriseId: 'new-firm', expiresAt: 100, terms: '仅邀请' },
      11,
    ).accepted,
  ).toBe(true);
  expect(
    t.relation(
      'manager',
      { type: 'services.cancel-supply', subject: { kind: 'enterprise', id: 'old-firm' } },
      12,
    ).accepted,
  ).toBe(false);
  expect(
    t.relation(
      'new-manager',
      { type: 'services.cancel-supply', subject: { kind: 'enterprise', id: 'new-firm' } },
      12,
    ).accepted,
  ).toBe(true);
  expect(t.state.services.clinic!.supplyRelation!.offer).toBeUndefined();
});
test('after real supply ends, closed historical employer cannot lock independent control; stale/expired invitation and forged ordinary relationship facts refuse', () => {
  const t = fixture();
  expect(
    t.relation('owner', { type: 'services.end-supply', subject: { kind: 'resident', id: 'owner' } })
      .accepted,
  ).toBe(true);
  const before = structuredClone(t.state),
    v = before.services.clinic!;
  expect(() =>
    applyServicesEvent(before, {
      type: 'ServiceChanged',
      service: { ...v, supplyRelation: { ...v.supplyRelation!, enterpriseId: 'forged' } },
    }),
  ).toThrow('service-control-event-required');
  expect(
    t.control(
      'owner',
      {
        type: 'offer',
        target: { kind: 'resident', id: 'receiver' },
        expiresAt: 100,
        terms: '原企业已不控制未来',
      },
      20,
    ).accepted,
  ).toBe(true);
  expect(t.control('receiver', { type: 'accept' }, 21).accepted).toBe(true);
  expect(t.state.services.clinic).toMatchObject({
    ownerId: 'owner',
    enterpriseId: 'old-firm',
    control: { controller: { kind: 'resident', id: 'receiver' } },
    supplyRelation: { enterpriseId: null },
  });
  expect(t.history.reduce(applyServicesEvent, t.legacy)).toEqual(t.state);
  const u = fixture();
  u.relation('owner', { type: 'services.end-supply', subject: { kind: 'resident', id: 'owner' } });
  u.relation(
    'owner',
    { type: 'services.offer-supply', enterpriseId: 'new-firm', expiresAt: 100, terms: '期限' },
    11,
  );
  expect(u.relation('new-manager', { type: 'services.accept-supply' }, 100).accepted).toBe(false);
  const request = u.request({ type: 'services.accept-supply' }),
    changed: PrincipalOperationRequest = {
      ...request,
      resourceRevision: request.resourceRevision + 1,
    };
  expect(decideServiceSupplyRelation(u.state, 'new-manager', 12, changed, u.ports).accepted).toBe(
    false,
  );
});
