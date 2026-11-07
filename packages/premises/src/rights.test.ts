import { expect, test } from 'vitest';
import { initialResourceControl, RESOURCE_CONTROL_POLICY } from '@aivilization/authority';
import {
  PREMISES_RIGHTS_POLICY,
  type PremisesRightsCommand,
  type PremisesRightsPorts,
  type PremisesRightsState,
  type PremisesRightsEvent,
} from './rightsModel';
import { decidePremisesRights, applyPremisesRightsEvent, expirePremisesRights } from './rights';
import {
  premisesPermitAllows,
  premisesPermitUseUntil,
  nextPremisesRightsBoundary,
  premisesHasPermitObligations,
} from './rightsAccess';
import type { PremisesBuilding } from './model';

function setup() {
  let building: PremisesBuilding = {
    id: 'hall',
    siteId: 'site',
    locationId: 'room',
    ownerId: 'owner',
    control: initialResourceControl('owner', 0, RESOURCE_CONTROL_POLICY),
    title: '房屋',
    blueprint: {
      primaryUse: 'residence',
      floorArea: 20,
      capacity: 4,
      fixtures: { workstations: 1, careStations: 0, teachingStations: 0, storageUnits: 10 },
    },
    condition: 1000,
    status: 'operational',
    access: { entry: 'listed', visitors: [], operators: [], residents: [] },
    embodied: { Wood: 10 },
    salvage: {},
    footprintReleased: false,
    wearSettledAt: 0,
    revision: 1,
    at: 0,
  };
  let s = applyPremisesRightsEvent(undefined, {
    type: 'PremisesRightsEnabled',
    policy: PREMISES_RIGHTS_POLICY,
  });
  const events: PremisesRightsEvent[] = [
    { type: 'PremisesRightsEnabled', policy: PREMISES_RIGHTS_POLICY },
  ];
  const ports: PremisesRightsPorts = {
    building: () => building,
    exists: (id) => ['owner', 'user', 'guest', 'third'].includes(id),
    controllerAvailable: () => true,
    authorize: () => undefined,
    conflict: () => undefined,
    releaseBlocked: () => undefined,
  };
  const offer = (id = 'permit'): Extract<PremisesRightsCommand, { type: 'offer' }> => ({
    type: 'offer',
    buildingRevision: 1,
    terms: {
      id,
      buildingId: 'hall',
      grantee: { kind: 'resident', id: 'user' },
      users: ['user', 'guest'],
      scopes: ['operate', 'store'],
      mode: 'shared',
      title: '共用工坊',
      terms: '双方保留原文；仅按已同意时段使用。',
      startAt: 10,
      endAt: 100,
      acceptBy: 30,
    },
  });
  function run(
    actor: string,
    at: number,
    c: PremisesRightsCommand,
    override: Partial<PremisesRightsPorts> = {},
  ) {
    const d = decidePremisesRights(s, actor, at, c, { ...ports, ...override });
    if (d.accepted)
      for (const e of d.events) {
        s = applyPremisesRightsEvent(s, e);
        events.push(e);
      }
    return d;
  }
  const accept = () => run('user', 1, { type: 'accept', id: 'permit', revision: 1 });
  return {
    get state() {
      return s;
    },
    events,
    ports,
    offer,
    run,
    accept,
    setBuilding: (patch: Partial<PremisesBuilding>) => {
      building = { ...building, ...patch };
    },
    expire: (at: number) => {
      for (const e of expirePremisesRights(s, at)) {
        s = applyPremisesRightsEvent(s, e);
        events.push(e);
      }
    },
  };
}
test('permission needs independent acceptance and confers usage only within its exact scopes and period', () => {
  const f = setup();
  expect(f.run('owner', 0, f.offer()).accepted).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 20, false)).toBe(false);
  expect(f.run('owner', 1, { type: 'accept', id: 'permit', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-grantee-authority-required',
  });
  expect(f.accept().accepted).toBe(true);
  for (const scope of ['entry', 'operate', 'store'] as const)
    expect(premisesPermitAllows(f.state, 'hall', 'guest', scope, 10, false)).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'reside', 10, false)).toBe(false);
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'operate', 9, false)).toBe(false);
  expect(premisesPermitAllows(f.state, 'hall', 'guest', 'operate', 100, false)).toBe(false);
  expect(premisesPermitUseUntil(f.state, 'hall', 'guest', 'operate', 10, false)).toBe(100);
});
test('exact control version is required before acceptance, accepted rights survive control transfer', () => {
  const f = setup();
  f.run('owner', 0, f.offer());
  f.setBuilding({ control: initialResourceControl('third', 1, RESOURCE_CONTROL_POLICY) });
  expect(f.accept()).toMatchObject({ accepted: false, reason: 'permit-control-changed' });
  f.setBuilding({ control: initialResourceControl('owner', 0, RESOURCE_CONTROL_POLICY) });
  f.accept();
  f.setBuilding({ control: initialResourceControl('third', 2, RESOURCE_CONTROL_POLICY) });
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 20, false)).toBe(true);
  expect(premisesHasPermitObligations(f.state, 'hall', 2)).toBe(true);
});
test('exclusive acceptance prevents conflicting double grants and bounds the controllers legacy access', () => {
  const f = setup(),
    offer = f.offer();
  f.run('owner', 0, { ...offer, terms: { ...offer.terms, mode: 'exclusive' } });
  f.accept();
  f.run('owner', 2, f.offer('other'));
  expect(f.run('user', 3, { type: 'accept', id: 'other', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-exclusive-conflict',
  });
  expect(premisesPermitAllows(f.state, 'hall', 'owner', 'operate', 20, true)).toBe(false);
  expect(premisesPermitAllows(f.state, 'hall', 'owner', 'entry', 20, true)).toBe(true);
  expect(premisesPermitUseUntil(f.state, 'hall', 'owner', 'operate', 0, true)).toBe(10);
});
test('nonoverlapping exclusive windows and different scopes compose; shared permits do not claim capacity', () => {
  const f = setup(),
    offer = f.offer();
  f.run('owner', 0, {
    ...offer,
    terms: { ...offer.terms, scopes: ['operate'], mode: 'exclusive' },
  });
  f.accept();
  for (const [id, scope, start, end] of [
    ['home', 'reside', 10, 100],
    ['later', 'operate', 100, 200],
  ] as const) {
    f.run('owner', 2, {
      ...offer,
      terms: { ...offer.terms, id, scopes: [scope], mode: 'exclusive', startAt: start, endAt: end },
    });
    expect(f.run('user', 3, { type: 'accept', id, revision: 1 }).accepted).toBe(true);
  }
});
test('actual external obligations are checked again on acceptance and active work blocks early release', () => {
  const f = setup();
  f.run('owner', 0, f.offer());
  expect(
    f.run(
      'user',
      1,
      { type: 'accept', id: 'permit', revision: 1 },
      { conflict: () => 'occupied-by-lease' },
    ),
  ).toMatchObject({ accepted: false, reason: 'occupied-by-lease' });
  f.accept();
  expect(
    f.run(
      'user',
      20,
      { type: 'release', id: 'permit', revision: 2 },
      { releaseBlocked: () => 'work-in-progress' },
    ),
  ).toMatchObject({ accepted: false, reason: 'work-in-progress' });
  expect(f.run('owner', 20, { type: 'release', id: 'permit', revision: 2 }).accepted).toBe(false);
  expect(f.run('user', 20, { type: 'release', id: 'permit', revision: 2 }).accepted).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 19, false)).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 20, false)).toBe(false);
});
test('expiry preserves historical labor permission, does not grant renewal and replays deterministically', () => {
  const f = setup();
  f.run('owner', 0, f.offer());
  f.accept();
  expect(nextPremisesRightsBoundary(f.state, 1)).toBe(10);
  f.expire(100);
  f.expire(1000);
  expect(f.events).toHaveLength(4);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 99, false)).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 100, false)).toBe(false);
  let replay: PremisesRightsState | undefined;
  for (const e of JSON.parse(JSON.stringify(f.events)) as PremisesRightsEvent[])
    replay = applyPremisesRightsEvent(replay, e);
  expect(replay).toEqual(f.state);
  expect(premisesHasPermitObligations(f.state, 'hall', 100)).toBe(false);
});
test('delayed acceptance does not backdate rights, expiry is idempotent and stale commands reject', () => {
  const f = setup();
  f.run('owner', 0, f.offer());
  expect(f.run('user', 20, { type: 'accept', id: 'permit', revision: 1 }).accepted).toBe(true);
  expect(premisesPermitAllows(f.state, 'hall', 'user', 'operate', 19, false)).toBe(false);
  expect(f.run('user', 20, { type: 'accept', id: 'permit', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-revision-conflict',
  });
  const g = setup();
  g.run('owner', 0, g.offer());
  g.expire(30);
  expect(g.accept().accepted).toBe(false);
});
test('invalid scope, duplicate users, unlimited time and exclusive entry never become authority', () => {
  for (const patch of [
    { endAt: Infinity },
    { startAt: -1 },
    { users: ['user', 'user'] },
    { users: ['missing'] },
    { scopes: [] },
    { scopes: ['entry'] as const, mode: 'exclusive' as const },
    { acceptBy: 0 },
    { grantee: { kind: 'resident' as const, id: 'owner' } },
  ]) {
    const f = setup(),
      offer = f.offer();
    expect(f.run('owner', 0, { ...offer, terms: { ...offer.terms, ...patch } }).accepted).toBe(
      false,
    );
    expect(f.state.permits).toEqual({});
  }
});
test('collective signatures require exact decision provenance and represented side', () => {
  const f = setup(),
    offer = f.offer();
  f.run('owner', 0, {
    ...offer,
    terms: { ...offer.terms, grantee: { kind: 'collective', id: 'club' } },
  });
  expect(f.run('owner', 1, { type: 'accept', id: 'permit', revision: 1 }).accepted).toBe(false);
  expect(
    f.run(
      'owner',
      1,
      { type: 'accept', id: 'permit', revision: 1 },
      {
        actingFor: { kind: 'resident', id: 'owner' },
        authorize: () => ({ actorId: 'owner', decisionId: 'vote-1' }),
      },
    ).accepted,
  ).toBe(false);
  expect(
    f.run(
      'owner',
      1,
      { type: 'accept', id: 'permit', revision: 1 },
      {
        actingFor: { kind: 'collective', id: 'club' },
        authorize: () => ({ actorId: 'owner', decisionId: 'vote-1' }),
      },
    ).accepted,
  ).toBe(true);
  expect(f.state.permits.permit?.accepted).toEqual({
    actorId: 'owner',
    decisionId: 'vote-1',
    at: 1,
  });
});
test('replay rejects forged acceptance, duplicate grant and unilateral revocation', () => {
  const f = setup();
  f.run('owner', 0, f.offer());
  expect(() =>
    applyPremisesRightsEvent(f.state, {
      type: 'PremisesPermitAccepted',
      id: 'permit',
      revision: 2,
      signature: { actorId: 'owner', at: 1 },
    }),
  ).toThrow('invalid-permit-acceptance-event');
  f.accept();
  expect(() =>
    applyPremisesRightsEvent(f.state, {
      type: 'PremisesPermitClosed',
      id: 'permit',
      revision: 3,
      reason: 'released',
      signature: { actorId: 'owner', at: 20 },
    }),
  ).toThrow('invalid-permit-closure-event');
  expect(() => applyPremisesRightsEvent(f.state, f.events[1]!)).toThrow(
    'invalid-permit-offer-event',
  );
});
