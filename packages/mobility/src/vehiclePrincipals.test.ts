import { expect, test } from 'vitest';
import {
  type ResourcePrincipal,
  type PrincipalAuthoritySource,
  type PrincipalControlRequest,
} from '@aivilization/authority';
import { emptyMobilityState, authorizedDriver, type MobilityState } from './model';
import { decideMobility, applyMobilityEvent } from './aggregate';
import {
  VEHICLE_PRINCIPALS_POLICY,
  applyVehiclePrincipalEvent,
  decideVehiclePrincipalControl,
  decideVehiclePrincipalOperation,
  type VehiclePrincipalPorts,
  type VehiclePrincipalEvent,
} from './vehiclePrincipals';
function fixture() {
  const legacy = emptyMobilityState([
    { id: 'car', ownerId: 'old', authorized: ['user'], locationId: 'a', seats: 2, revision: 1 },
  ]);
  let s = applyVehiclePrincipalEvent(legacy, {
      type: 'VehiclePrincipalsEnabled',
      policy: VEHICLE_PRINCIPALS_POLICY,
    }),
    actor = 'old';
  const history: VehiclePrincipalEvent[] = [];
  const source = (p: ResourcePrincipal): PrincipalAuthoritySource =>
    p.kind === 'resident'
      ? { kind: 'personal' }
      : p.kind === 'enterprise'
        ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
        : p.kind === 'collective'
          ? { kind: 'collective', decisionId: 'independent-vote', charterVersion: 1 }
          : { kind: 'public', proposalId: 'public-vote', procedureRevision: 1 };
  const ports: VehiclePrincipalPorts = {
    available: () => true,
    authorizeControl: (p, r) => ({ actorId: actor, principal: p, request: r, source: source(p) }),
    authorizeOperation: (p, r) => ({ actorId: actor, principal: p, request: r, source: source(p) }),
    driverReleaseBlocked: () => undefined,
  };
  const request = (command: PrincipalControlRequest['command']): PrincipalControlRequest => ({
    resourceKind: 'vehicle',
    resourceId: 'car',
    resourceRevision: s.vehicles.car!.revision,
    controlVersion: s.vehicles.car!.control?.version ?? 1,
    command,
  });
  const control = (
    who: string,
    at: number,
    c: PrincipalControlRequest['command'],
    override: Partial<VehiclePrincipalPorts> = {},
  ) => {
    actor = who;
    const d = decideVehiclePrincipalControl(s, who, at, request(c), { ...ports, ...override });
    if (d.accepted)
      for (const e of d.events) {
        s = applyVehiclePrincipalEvent(s, e);
        history.push(e);
      }
    return d;
  };
  const use = (
    who: string,
    at: number,
    type: 'vehicles.authorize' | 'vehicles.revoke',
    residentId: string,
    override: Partial<VehiclePrincipalPorts> = {},
  ) => {
    actor = who;
    const d = decideVehiclePrincipalOperation(
      s,
      who,
      at,
      { type, id: 'car', expectedRevision: s.vehicles.car!.revision, residentId },
      { ...ports, ...override },
    );
    if (d.accepted)
      for (const e of d.events) {
        s = applyVehiclePrincipalEvent(s, e);
        history.push(e);
      }
    return d;
  };
  return {
    legacy,
    get state() {
      return s;
    },
    ports,
    request,
    control,
    use,
    history,
    patch: (change: Partial<MobilityState>) => {
      s = { ...s, ...change };
    },
    replay: () => {
      let t = applyVehiclePrincipalEvent(legacy, {
        type: 'VehiclePrincipalsEnabled',
        policy: VEHICLE_PRINCIPALS_POLICY,
      });
      for (const e of JSON.parse(JSON.stringify(history)) as typeof history)
        t = applyVehiclePrincipalEvent(t, e);
      expect(t).toEqual(s);
    },
  };
}
test('explicit activation preserves finite vehicles and old driving, and exact bilateral custody preserves current permissions', () => {
  const f = fixture();
  expect(f.state.vehicles).toEqual(f.legacy.vehicles);
  expect(
    decideVehiclePrincipalControl(f.legacy, 'old', 0, f.request({ type: 'cancel' }), f.ports),
  ).toMatchObject({ accepted: false, reason: 'vehicle-principals-not-enabled' });
  expect(
    f.control('old', 1, {
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      expiresAt: 100,
      terms: '保持受托义务',
    }).accepted,
  ).toBe(true);
  expect(
    f.control('old', 2, { type: 'accept' }, { authorizeControl: () => undefined }).accepted,
  ).toBe(false);
  expect(f.control('manager', 2, { type: 'accept' }).accepted).toBe(true);
  expect(f.state.vehicles.car!.control!.controller).toEqual({ kind: 'enterprise', id: 'firm' });
  expect(f.state.vehicles.car!.ownerId).toBe('old');
  expect(authorizedDriver(f.state.vehicles.car!, 'old')).toBe(true);
  expect(authorizedDriver(f.state.vehicles.car!, 'manager')).toBe(false);
  f.replay();
});
test('old owner has no permanent permission or management backdoor; original authorized users retain use and personal driving stays personal', () => {
  const f = fixture();
  f.control('old', 1, {
    type: 'offer',
    target: { kind: 'enterprise', id: 'firm' },
    expiresAt: 100,
    terms: '精确交接',
  });
  f.control('manager', 2, { type: 'accept' });
  expect(
    decideMobility(
      f.state,
      'old',
      3,
      { type: 'vehicles.authorize', id: 'car', expectedRevision: 3, residentId: 'manager' },
      {
        exists: () => true,
        location: () => 'a',
        idle: () => true,
        destinationExists: () => true,
        arrivalAt: () => 10,
      },
    ),
  ).toMatchObject({ accepted: false, reason: 'vehicle-principal-operation-required' });
  expect(
    f.use('manager', 3, 'vehicles.revoke', 'old', {
      driverReleaseBlocked: () => 'actual-cargo-custody',
    }),
  ).toMatchObject({ accepted: false, reason: 'actual-cargo-custody' });
  expect(f.use('manager', 3, 'vehicles.revoke', 'old').accepted).toBe(true);
  expect(authorizedDriver(f.state.vehicles.car!, 'old')).toBe(false);
  expect(authorizedDriver(f.state.vehicles.car!, 'user')).toBe(true);
  const p = {
    exists: () => true,
    location: () => 'a',
    idle: () => true,
    destinationExists: () => true,
    arrivalAt: () => 10,
  };
  expect(
    decideMobility(f.state, 'old', 3, { type: 'drivers.register', vehicleId: 'car' }, p).accepted,
  ).toBe(false);
  expect(
    decideMobility(f.state, 'user', 3, { type: 'drivers.register', vehicleId: 'car' }, p).accepted,
  ).toBe(true);
  expect(f.use('manager', 4, 'vehicles.authorize', 'manager').accepted).toBe(true);
  f.replay();
});
test('collective and public transfer bind independent source, reject wrong resources, expiry, busy trips and injected ordinary vehicle events', () => {
  for (const kind of ['collective', 'public'] as const) {
    const f = fixture();
    expect(
      f.control('old', 1, {
        type: 'offer',
        target: { kind, id: 'group' },
        expiresAt: 100,
        terms: '独立确认',
      }).accepted,
    ).toBe(true);
    expect(f.control('user', 100, { type: 'accept' })).toMatchObject({
      accepted: false,
      reason: 'principal-control-offer-expired-or-unavailable',
    });
    expect(f.control('user', 2, { type: 'accept' }).accepted).toBe(true);
    const v = f.state.vehicles.car!;
    expect(() =>
      applyMobilityEvent(f.state, {
        type: 'VehicleChanged',
        value: { ...v, authorized: ['old'], revision: v.revision + 1 },
      }),
    ).toThrow('vehicle-principal-authority-event-required');
    expect(() =>
      applyMobilityEvent(f.state, {
        type: 'VehicleChanged',
        value: {
          ...v,
          control: { ...v.control!, controller: { kind: 'resident', id: 'old' } },
          revision: v.revision + 1,
        },
      }),
    ).toThrow('vehicle-principal-authority-event-required');
    f.patch({
      vehicles: {
        ...f.state.vehicles,
        car: {
          ...v,
          journey: { from: 'a', to: 'b', people: ['user'], departedAt: 2, arrivesAt: 10 },
        },
      },
    });
    expect(f.control('user', 3, { type: 'cancel' })).toMatchObject({
      accepted: false,
      reason: 'vehicle-principal-journey-or-booking-unsettled',
    });
  }
});
test('control and permission clocks, policy driver limits and exact replay source remain bounded', () => {
  const t = fixture();
  expect(
    t.control('old', 20, {
      type: 'offer',
      target: { kind: 'resident', id: 'new' },
      expiresAt: 100,
      terms: 'source',
    }).accepted,
  ).toBe(true);
  expect(t.control('new', 19, { type: 'accept' })).toMatchObject({
    accepted: false,
    reason: 'invalid-vehicle-principal-control-time',
  });
  expect(t.control('new', 21, { type: 'accept' }).accepted).toBe(true);
  expect(t.use('new', 20, 'vehicles.authorize', 'new').accepted).toBe(false);
  expect(
    t.use('new', 22, 'vehicles.authorize', 'missing', { available: (p) => p.id !== 'missing' })
      .accepted,
  ).toBe(false);
  const v = t.state.vehicles.car!,
    bounded = {
      ...t.state,
      vehicles: { car: { ...v, authorized: Array.from({ length: 128 }, (_, i) => `u${i}`) } },
    };
  expect(
    decideVehiclePrincipalOperation(
      bounded,
      'new',
      22,
      { type: 'vehicles.authorize', id: 'car', expectedRevision: v.revision, residentId: 'extra' },
      t.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'vehicle-driver-limit' });
  // The ordinary event reducer cannot alter principal clocks, even if physical state looks unchanged.
  expect(() =>
    applyMobilityEvent(t.state, {
      type: 'VehicleChanged',
      value: { ...v, revision: v.revision + 1, principalAt: 20 },
    }),
  ).toThrow('vehicle-principal-authority-event-required');
  expect(() =>
    applyVehiclePrincipalEvent(t.legacy, {
      type: 'VehiclePrincipalsEnabled',
      policy: {
        ...VEHICLE_PRINCIPALS_POLICY,
        control: { ...VEHICLE_PRINCIPALS_POLICY.control, maxOfferHorizonMs: -1 },
      },
    }),
  ).toThrow('unsupported-resource-principal-policy');
});
