import { expect, test } from 'vitest';
import { initialResourceControl, RESOURCE_CONTROL_POLICY } from '@aivilization/authority';
import {
  PREMISES_RIGHTS_POLICY,
  type PremisesRightsEvent,
  type PremisesRightsState,
} from './rightsModel';
import type { PremisesBuilding } from './model';
import type { PremisesProvisionEvent } from './provisionModel';
import { applyPremisesRightsEvent, decidePremisesRights, expirePremisesRights } from './rights';
import {
  applyPremisesProvisionEvent,
  startPremisesProvision,
  settlePremisesProvision,
  unsettledPremisesProvisions,
} from './provision';

function fixture(start = true) {
  let building: PremisesBuilding = {
    id: 'hall',
    siteId: 'site',
    locationId: 'room',
    ownerId: 'owner',
    control: initialResourceControl('owner', 0, RESOURCE_CONTROL_POLICY),
    title: '空间',
    blueprint: {
      primaryUse: 'social',
      floorArea: 8,
      capacity: 2,
      fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
    },
    condition: 1000,
    status: 'operational',
    access: { entry: 'listed', visitors: [], operators: [], residents: [] },
    embodied: { Wood: 8 },
    salvage: {},
    footprintReleased: false,
    wearSettledAt: 0,
    revision: 1,
    at: 0,
  };
  const initial = applyPremisesRightsEvent(undefined, {
    type: 'PremisesRightsEnabled',
    policy: PREMISES_RIGHTS_POLICY,
  });
  let state = initial;
  const rightsEvents: PremisesRightsEvent[] = [],
    provisionEvents: PremisesProvisionEvent[] = [];
  const ports = {
    building: () => building,
    exists: () => true,
    controllerAvailable: () => true,
    authorize: () => undefined,
    conflict: () => undefined,
    releaseBlocked: () => undefined,
  };
  const offer = decidePremisesRights(
    state,
    'owner',
    0,
    {
      type: 'offer',
      buildingRevision: 1,
      terms: {
        id: 'permit',
        buildingId: 'hall',
        grantee: { kind: 'resident', id: 'user' },
        users: ['user'],
        scopes: ['entry'],
        mode: 'shared',
        title: '定期许可',
        terms: '仅明确的供给期间',
        startAt: 20,
        endAt: 100,
        acceptBy: 20,
      },
    },
    ports,
  );
  if (!offer.accepted) throw Error(offer.reason);
  for (const e of offer.events) {
    state = applyPremisesRightsEvent(state, e);
    rightsEvents.push(e);
  }
  const accepted = decidePremisesRights(
    state,
    'user',
    10,
    { type: 'accept', id: 'permit', revision: 1 },
    ports,
  );
  if (!accepted.accepted) throw Error(accepted.reason);
  for (const e of accepted.events) {
    state = applyPremisesRightsEvent(state, e);
    rightsEvents.push(e);
  }
  const provision = (d: ReturnType<typeof startPremisesProvision>) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted)
      for (const e of d.events) {
        state = applyPremisesProvisionEvent(state, e);
        provisionEvents.push(e);
      }
  };
  if (start) provision(startPremisesProvision(state, 'permit', 'order', 'user', 10));
  const settle = (at: number) => provision(settlePremisesProvision(state, 'permit', at, building));
  return {
    initial,
    rightsEvents,
    provisionEvents,
    ports,
    get state() {
      return state;
    },
    get building() {
      return building;
    },
    settle,
    provision,
    setBuilding: (patch: Partial<PremisesBuilding>) => {
      building = { ...building, ...patch };
    },
    applyRight: (e: PremisesRightsEvent) => {
      state = applyPremisesRightsEvent(state, e);
    },
  };
}
test('only the exact new independent acceptance can start paid provisioning; old free rights do not acquire invented history', () => {
  const f = fixture(false);
  expect(f.state.provisions).toBeUndefined();
  expect(startPremisesProvision(f.state, 'permit', 'order', 'owner', 10).accepted).toBe(false);
  expect(startPremisesProvision(f.state, 'permit', 'order', 'user', 11).accepted).toBe(false);
  f.provision(startPremisesProvision(f.state, 'permit', 'order', 'user', 10));
  expect(f.state.provisions!.permit).toMatchObject({
    startedAt: 10,
    settledAt: 10,
    availableMs: 0,
    unavailableMs: 0,
    orderId: 'order',
  });
  expect(f.state.permits.permit!.revision).toBe(2);
  expect(startPremisesProvision(f.state, 'permit', 'other-order', 'user', 10).accepted).toBe(false);
});
test('future start, damage and repair account for exact available/unavailable intervals without requiring attendance', () => {
  const f = fixture();
  f.settle(15);
  expect(f.state.provisions!.permit!.availableMs).toBe(0);
  f.settle(30);
  f.settle(50);
  expect(f.state.provisions!.permit!.availableMs).toBe(30);
  f.setBuilding({ condition: 0, at: 50, revision: 2 });
  f.settle(80);
  f.setBuilding({ condition: 1000, at: 80, revision: 3 });
  f.settle(100);
  expect(f.state.provisions!.permit).toMatchObject({
    settledAt: 100,
    availableMs: 50,
    unavailableMs: 30,
  });
  for (const e of expirePremisesRights(f.state, 100)) f.applyRight(e);
  f.settle(1000);
  expect(f.state.provisions!.permit!.availableMs + f.state.provisions!.permit!.unavailableMs).toBe(
    80,
  );
  expect(f.state.permits.permit!.status).toBe('expired');
});
test('settle-before-change prevents retroactive free service or retroactive charging after an unobserved physical mutation', () => {
  const f = fixture();
  expect(unsettledPremisesProvisions(f.state, 'hall', 30)).toHaveLength(1);
  f.setBuilding({ at: 30, revision: 2, condition: 0 });
  expect(settlePremisesProvision(f.state, 'permit', 40, f.building)).toMatchObject({
    accepted: false,
    reason: 'provision-building-changed-before-settlement',
  });
  f.setBuilding({ at: 0, revision: 1, condition: 1000 });
  f.settle(30);
  expect(unsettledPremisesProvisions(f.state, 'hall', 30)).toEqual([]);
  f.setBuilding({ at: 30, revision: 2, condition: 0 });
  f.settle(40);
  expect(f.state.provisions!.permit).toMatchObject({ availableMs: 10, unavailableMs: 10 });
});
test('early termination first settles elapsed supply and cannot charge the remaining future period', () => {
  const f = fixture();
  expect(
    decidePremisesRights(
      f.state,
      'user',
      60,
      { type: 'release', id: 'permit', revision: 2 },
      f.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'provision-must-settle-before-permit-closes' });
  expect(() =>
    f.applyRight({
      type: 'PremisesPermitClosed',
      id: 'permit',
      revision: 3,
      signature: { actorId: 'user', at: 60 },
      reason: 'released',
    }),
  ).toThrow('provision-must-settle-before-permit-closes');
  f.settle(60);
  const d = decidePremisesRights(
    f.state,
    'user',
    60,
    { type: 'release', id: 'permit', revision: 2 },
    f.ports,
  );
  if (!d.accepted) throw Error(d.reason);
  for (const e of d.events) f.applyRight(e);
  f.settle(1000);
  expect(f.state.provisions!.permit).toMatchObject({
    settledAt: 60,
    availableMs: 40,
    unavailableMs: 0,
  });
});
test('forged interval totals, stale evidence, backward time and replaying one interval twice reject', () => {
  const f = fixture();
  const d = settlePremisesProvision(f.state, 'permit', 40, f.building);
  if (!d.accepted || d.events[0]?.type !== 'PremisesProvisionSettled') throw Error('fixture');
  const e = d.events[0];
  expect(() => applyPremisesProvisionEvent(f.state, { ...e, availableMs: 21 })).toThrow(
    'invalid-provision-time-conservation',
  );
  expect(() =>
    applyPremisesProvisionEvent(f.state, { ...e, evidence: { ...e.evidence, buildingAt: 11 } }),
  ).toThrow('invalid-provision-interval-event');
  expect(() => applyPremisesProvisionEvent(f.state, { ...e, from: 9 })).toThrow(
    'invalid-provision-interval-event',
  );
  f.provision(d);
  expect(() => applyPremisesProvisionEvent(f.state, e)).toThrow('invalid-provision-interval-event');
  expect(settlePremisesProvision(f.state, 'permit', 39, f.building).accepted).toBe(false);
  expect(settlePremisesProvision(f.state, 'permit', Infinity, f.building).accepted).toBe(false);
});
test('segmented supply arithmetic is equivalent and recorded events restore the exact state', () => {
  const a = fixture(),
    b = fixture();
  a.settle(100);
  for (const at of [15, 20, 40, 70, 100]) b.settle(at);
  expect(a.state.provisions!.permit!.availableMs).toBe(b.state.provisions!.permit!.availableMs);
  expect(a.state.provisions!.permit!.unavailableMs).toBe(b.state.provisions!.permit!.unavailableMs);
  let replay: PremisesRightsState = b.initial;
  for (const e of JSON.parse(JSON.stringify(b.rightsEvents)) as PremisesRightsEvent[])
    replay = applyPremisesRightsEvent(replay, e);
  for (const e of JSON.parse(JSON.stringify(b.provisionEvents)) as PremisesProvisionEvent[])
    replay = applyPremisesProvisionEvent(replay, e);
  expect(replay).toEqual(b.state);
});
