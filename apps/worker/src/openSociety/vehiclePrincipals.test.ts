import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  resourcePrincipalSnapshot,
  type PrincipalControlCommand,
  type PrincipalRequest,
} from '@aivilization/authority';
import { vehiclePrincipalRequest, authorizedDriver } from '@aivilization/mobility';
import { applyOpenSocietyEffects } from './state';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { openFreightFixture } from './testFixtures/openFreight';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'vehicle-principals-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    publicGovernance: true,
    vehiclePrincipals: enabled,
  });
  const r = new OpenSocietyRuntime(root, manifest);
  clean.push(() => r.close());
  const [a, b, c] = manifest.residents.map((r) => r.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const d = r.invoke(actor, { name, arguments: args, requestId: `vp-${++n}` });
    r.finishTurn(actor, { summary: 'Vehicle engineering acceptance' });
    return d;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}:${d.error}`).toBe(true);
    return d;
  };
  const vehicle = () => r.state.world.residentMobility!.vehicles['seed-car-1']!;
  const request = (command: PrincipalControlCommand) => ({
    resourceKind: 'vehicle',
    resourceId: vehicle().id,
    resourceRevision: vehicle().revision,
    controlVersion: resourcePrincipalSnapshot(vehicle()).version,
    command,
  });
  const operation = (type: 'vehicles.authorize' | 'vehicles.revoke', residentId: string) =>
    vehiclePrincipalRequest(vehicle(), {
      type,
      id: vehicle().id,
      expectedRevision: vehicle().revision,
      residentId,
    });
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  const publicExecute = (req: PrincipalRequest, id: string) => {
    ok(a, 'governance.propose', {
      id,
      text: '仅这一个精确车辆动作',
      action: {
        kind: 'operation' in req ? 'manage-resource' : 'control-resource',
        expectedRevision: req.resourceRevision,
        request: req,
      },
      closesAt: r.state.world.clock.now + 60000,
      expectedProcedureRevision: r.state.world.publicGovernance!.authority.procedureRevision,
    });
    const rev = () => r.state.world.publicGovernance!.authority.proposals[id]!.revision;
    for (const actor of [a, b])
      ok(actor, 'governance.vote', { id, expectedRevision: rev(), choice: 'yes' });
    expect(r.advanceTime(60000, `pv-${id}`).ok).toBe(true);
    ok(c, 'governance.close', { id, expectedRevision: rev() });
    ok(c, 'governance.execute', { id, expectedRevision: rev() });
  };
  return {
    r,
    root,
    manifest,
    a,
    b,
    c,
    call,
    ok,
    vehicle,
    request,
    operation,
    replay,
    publicExecute,
  };
}
test('vehicle activation is independent of stock policy, preserves old assets/manifest, and has bounded query delivery', () => {
  const t = fixture(false),
    before = structuredClone(t.r.state.world),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.a, 'principals.list').ok).toBe(false);
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  expect(t.r.state.world.materials?.resourcePrincipals).toBeUndefined();
  expect(t.vehicle()).toEqual(before.residentMobility!.vehicles[t.vehicle().id]);
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  expect(t.r.context(t.a).self).toMatchObject({ resourcePrincipalsWith: 'town principals list' });
  expect(t.ok(t.a, 'principals.read', { kind: 'vehicle', id: t.vehicle().id }).data).toMatchObject({
    requestBase: { controlVersion: 1 },
    namedDrivers: [t.a],
  });
  expect(t.call(t.b, 'principals.read', { kind: 'vehicle', id: t.vehicle().id }).ok).toBe(false);
  t.replay();
});
test('enterprise vehicle control uses current management; permission remains explicit and old owner cannot bypass it', () => {
  const t = fixture();
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'fleet',
    name: '居民自拟车队',
    occupationName: '角色',
    initialCapital: 100,
    maxEmployees: 3,
  });
  const cash = t.r.state.world.enterprises.fleet!.balance;
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'enterprise', id: 'fleet' },
      expiresAt: 1000000,
      terms: '只交接车辆控制',
    }),
  });
  expect(t.call(t.c, 'principals.control', { request: t.request({ type: 'accept' }) }).ok).toBe(
    false,
  );
  t.ok(t.b, 'principals.control', { request: t.request({ type: 'accept' }) });
  expect(t.vehicle().control!.controller).toEqual({ kind: 'enterprise', id: 'fleet' });
  expect(authorizedDriver(t.vehicle(), t.b)).toBe(false);
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'fleet' }).ok).toBe(false);
  expect(t.r.state.world.enterprises.fleet!.balance).toBe(cash);
  expect(
    t.call(t.a, 'vehicles.authorize', {
      id: t.vehicle().id,
      expectedRevision: t.vehicle().revision,
      residentId: t.c,
    }).error,
  ).toBe('vehicle-principal-operation-required');
  t.ok(t.b, 'principals.operate', { request: t.operation('vehicles.revoke', t.a) });
  expect(authorizedDriver(t.vehicle(), t.a)).toBe(false);
  expect(t.call(t.a, 'drivers.register', { vehicleId: t.vehicle().id }).error).toBe(
    'vehicle-authorization-required',
  );
  t.ok(t.b, 'principals.operate', { request: t.operation('vehicles.authorize', t.c) });
  t.ok(t.c, 'drivers.register', { vehicleId: t.vehicle().id });
  const before = structuredClone(t.r.state),
    commit = [...t.r.journal.commits].reverse().find((c) => c.capability === 'principals.operate')!;
  expect(commit.worldEvents![0]!.type).toBe('ResidentVehiclePrincipalsCommitted');
  const e = commit.worldEvents![0]!;
  if (e.type !== 'ResidentVehiclePrincipalsCommitted') throw Error('fixture');
  expect(() =>
    applyOpenSocietyEffects(before, {
      worldEvents: [{ ...e, payload: { ...e.payload, actorId: t.a } }],
    }),
  ).toThrow();
  t.replay();
});
test('public custody and exact named permission consume actual independent approval atomically without broadening warehouse scope', () => {
  const t = fixture();
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'public', id: t.r.state.world.publicGovernance!.authority.grant.id },
      expiresAt: 1000000,
      terms: '公用有限车辆',
    }),
  });
  expect(t.call(t.b, 'principals.control', { request: t.request({ type: 'accept' }) }).ok).toBe(
    false,
  );
  t.publicExecute(t.request({ type: 'accept' }), 'take');
  expect(t.vehicle().control!.controller.kind).toBe('public');
  expect(t.r.state.world.publicGovernance!.authority.grant.resourceCustody).toBeUndefined();
  expect(
    t.call(t.b, 'principals.operate', { request: t.operation('vehicles.authorize', t.b) }).ok,
  ).toBe(false);
  t.publicExecute(t.operation('vehicles.authorize', t.b), 'driver');
  expect(authorizedDriver(t.vehicle(), t.b)).toBe(true);
  expect(t.r.state.world.publicGovernance!.authority.proposals.driver!.status).toBe('executed');
  const e = [...t.r.journal.commits].reverse().find((c) => c.capability === 'governance.execute')!
    .worldEvents![0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted') throw Error('fixture');
  expect(e.payload.vehicleCommit?.events[0]?.type).toBe('VehiclePrincipalDriversChanged');
  t.replay();
});
test('actual entrusted cargo survives parked control handover; permission cannot be revoked until real return', () => {
  const t = openFreightFixture(true, true, 1000000000, true);
  t.prepare(true);
  t.op(t.b, 'load');
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  const v = () => t.r.state.world.residentMobility!.vehicles['seed-car-1']!;
  const req = (command: PrincipalControlCommand) => ({
    resourceKind: 'vehicle',
    resourceId: v().id,
    resourceRevision: v().revision,
    controlVersion: resourcePrincipalSnapshot(v()).version,
    command,
  });
  const freight = structuredClone(t.freight()),
    materials = structuredClone(t.r.state.world.materials);
  t.ok(t.a, 'principals.control', {
    request: req({
      type: 'offer',
      target: { kind: 'resident', id: t.d },
      expiresAt: 1000000,
      terms: '保留既有承运责任',
    }),
  });
  t.ok(t.d, 'principals.control', { request: req({ type: 'accept' }) });
  expect(t.freight()).toEqual(freight);
  expect(t.r.state.world.materials).toEqual(materials);
  const revoke = () =>
    vehiclePrincipalRequest(v(), {
      type: 'vehicles.revoke',
      id: v().id,
      expectedRevision: v().revision,
      residentId: t.b,
    });
  expect(t.call(t.d, 'principals.operate', { request: revoke() }).error).toBe(
    'vehicle-actual-cargo-custody',
  );
  t.ok(t.b, 'vehicles.drive', {
    id: v().id,
    expectedRevision: v().revision,
    destinationId: t.east,
  });
  expect(
    t.call(t.d, 'principals.control', {
      request: req({
        type: 'offer',
        target: { kind: 'resident', id: t.a },
        expiresAt: 1000000,
        terms: '不能在途交接',
      }),
    }).error,
  ).toBe('vehicle-principal-journey-or-booking-unsettled');
  t.op(t.a, 'cancel');
  t.arrive();
  t.ok(t.b, 'vehicles.drive', {
    id: v().id,
    expectedRevision: v().revision,
    destinationId: t.west,
  });
  t.arrive();
  t.op(t.b, 'return');
  t.ok(t.d, 'principals.operate', { request: revoke() });
  expect(t.freight()).toMatchObject({ status: 'returned', paid: 3, refunded: 5, escrow: 0 });
  t.replay();
});
test('collective authority uses the exact decision and one atomic consumption; members do not become drivers', () => {
  const t = fixture();
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '居民车队',
      terms: '每项独立表决',
      members: [t.b, t.c],
      voters: [t.b, t.c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 1000000,
  });
  t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  const approve = (id: string, request: PrincipalRequest) => {
    t.ok(t.b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: t.r.state.collectives!.charters.club!.version,
      terms: '仅此精确动作',
      action: {
        kind: 'resource',
        capability: 'operation' in request ? 'principals.operate' : 'principals.control',
        resourceId: request.resourceId,
        arguments: { request },
      },
      closesAt: 100000,
      executeBefore: 1000000,
    });
    for (const actor of [t.b, t.c])
      t.ok(actor, 'collectives.vote', {
        id,
        expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    t.ok(t.b, 'collectives.decide', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    });
  };
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'collective', id: 'club' },
      expiresAt: 1000000,
      terms: '有限车辆控制',
    }),
  });
  const acceptance = t.request({ type: 'accept' });
  approve('take', acceptance);
  expect(t.call(t.b, 'principals.control', { request: acceptance }).ok).toBe(false);
  t.ok(t.b, 'collectives.execute', {
    id: 'take',
    expectedRevision: t.r.state.collectives!.decisions.take!.revision,
  });
  expect(authorizedDriver(t.vehicle(), t.b)).toBe(false);
  const req = t.operation('vehicles.authorize', t.c);
  approve('driver', req);
  const before = structuredClone(t.r.state);
  t.ok(t.b, 'collectives.execute', {
    id: 'driver',
    expectedRevision: t.r.state.collectives!.decisions.driver!.revision,
  });
  const commit = [...t.r.journal.commits]
    .reverse()
    .find((c) => c.capability === 'collectives.execute')!;
  expect(
    commit.collectiveEvents?.some(
      (e) => e.type === 'CollectiveDecisionChanged' && e.decision.status === 'executed',
    ),
  ).toBe(true);
  expect(() => applyOpenSocietyEffects(before, { worldEvents: commit.worldEvents! })).toThrow(
    'world-principal-operation-source-mismatch',
  );
  expect(applyOpenSocietyEffects(before, commit).world.residentMobility).toEqual(
    t.r.state.world.residentMobility,
  );
  expect(authorizedDriver(t.vehicle(), t.c)).toBe(true);
  t.replay();
});
test('booked rides block handover and revocation; actual driver receives the unchanged agreed fare', () => {
  const t = fixture();
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'resident', id: t.c },
      expiresAt: 1000000,
      terms: '车归管理者，驾驶是本人行为',
    }),
  });
  t.ok(t.c, 'principals.control', { request: t.request({ type: 'accept' }) });
  t.ok(t.a, 'drivers.register', { vehicleId: t.vehicle().id });
  t.ok(t.a, 'drivers.online');
  t.ok(t.b, 'rides.request', { id: 'trip', destinationId: 'school', expiresAt: 3600000 });
  t.ok(t.a, 'rides.quote', { id: 'quote', rideId: 'trip', fare: 10, expiresAt: 3500000 });
  const balances = Object.fromEntries(
    [t.a, t.b, t.c].map((id) => [id, t.r.state.world.agents[id]!.balance]),
  );
  const supply = t.r.state.world.moneySupply;
  t.ok(t.b, 'rides.book', { id: 'trip', quoteId: 'quote', expectedRevision: 1 });
  expect(
    t.call(t.c, 'principals.operate', { request: t.operation('vehicles.revoke', t.a) }).error,
  ).toBe('vehicle-principal-journey-or-booking-unsettled');
  expect(
    t.call(t.c, 'principals.control', {
      request: t.request({
        type: 'offer',
        target: { kind: 'resident', id: t.b },
        terms: '不能交接预订车',
        expiresAt: 1000000,
      }),
    }).ok,
  ).toBe(false);
  t.ok(t.a, 'rides.pickup', { id: 'trip', expectedRevision: 2 });
  if (t.r.state.world.transitByAgent?.[t.a])
    expect(
      t.r.advanceTime(
        t.r.state.world.transitByAgent[t.a]!.arrivesAt - t.r.state.world.clock.now,
        'pickup-arrive',
      ).ok,
    ).toBe(true);
  t.ok(t.b, 'rides.board', {
    id: 'trip',
    expectedRevision: t.r.state.world.residentMobility!.rides.trip!.revision,
  });
  expect(
    t.r.advanceTime(
      t.r.state.world.transitByAgent![t.a]!.arrivesAt - t.r.state.world.clock.now,
      'ride-arrive',
    ).ok,
  ).toBe(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(balances[t.a]! + 10);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(balances[t.b]! - 10);
  expect(t.r.state.world.agents[t.c]!.balance).toBe(balances[t.c]);
  expect(t.r.state.world.moneySupply).toBe(supply);
  expect(t.r.state.world.residentMobility!.rides.trip!.status).toBe('completed');
  t.replay();
});

test('world replay validates the offered subject against actual registries, not only a self-consistent signature', () => {
  const t = fixture(),
    before = structuredClone(t.r.state);
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'resident', id: t.b },
      expiresAt: 1000000,
      terms: '已有主体',
    }),
  });
  const commit = [...t.r.journal.commits]
      .reverse()
      .find((c) => c.capability === 'principals.control')!,
    e = structuredClone(commit.worldEvents![0]!);
  if (e.type !== 'ResidentResourcePrincipalControlCommitted') throw Error('fixture');
  const change = e.payload.change,
    proof = change.control.authorization;
  const target = { kind: 'resident' as const, id: 'absent' };
  const request = {
    ...change.request,
    command: { type: 'offer' as const, target, expiresAt: 1000000, terms: '已有主体' },
  };
  const forged = {
    ...e,
    payload: {
      ...e.payload,
      change: {
        ...change,
        request,
        control: {
          ...change.control,
          authorization: { ...proof, request },
          offer: {
            ...change.control.offer!,
            target,
            authorization: { ...change.control.offer!.authorization, request },
          },
        },
      },
    },
  };
  expect(() => applyOpenSocietyEffects(before, { worldEvents: [forged] })).toThrow(
    'vehicle-principal-target-unavailable',
  );
  t.replay();
});
