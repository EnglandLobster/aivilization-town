import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  resourcePrincipalSnapshot,
  type PrincipalControlCommand,
  type PrincipalRequest,
} from '@aivilization/authority';
import {
  serviceAdministrativeRequest,
  serviceProviderRequest,
  type ServiceAdministrativeCommand,
} from '@aivilization/services';
import { applyWorldEvent } from '@aivilization/world';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { applyOpenSocietyEffects } from './state';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'service-principals-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const base = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    publicGovernance: true,
    servicePrincipals: enabled,
  });
  const location = Object.values(base.initialWorld.locations).find(
    (l) => l.kind === 'market',
  )!.locationId;
  const manifest = {
    ...base,
    initialWorld: {
      ...base.initialWorld,
      agents: Object.fromEntries(
        Object.entries(base.initialWorld.agents).map(([id, a]) => [
          id,
          { ...a, locationId: location },
        ]),
      ),
    },
  };
  const r = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => r.close());
  const [a, b, c] = manifest.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const d = r.invoke(actor, { name, arguments: args, requestId: `sp-${++n}` });
    r.finishTurn(actor, { summary: 'Explicit service authority engineering acceptance' });
    return d;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}:${d.error}`).toBe(true);
    return d;
  };
  const publish = (enterpriseId?: string) =>
    ok(a, 'services.publish', {
      id: 'clinic',
      kind: 'appointment',
      locationId: location,
      title: '居民自拟服务',
      description: '仅实际排期和本人参与',
      capacity: 2,
      ...(enterpriseId ? { enterpriseId } : {}),
    });
  const service = () => r.state.services!.services.clinic!;
  const request = (command: PrincipalControlCommand) => ({
    resourceKind: 'service',
    resourceId: 'clinic',
    resourceRevision: service().revision,
    controlVersion: resourcePrincipalSnapshot(service()).version,
    command,
  });
  const admin = (command: ServiceAdministrativeCommand) =>
    serviceAdministrativeRequest(r.state.services!, command);
  const permit = (
    type: 'services.authorize-provider' | 'services.revoke-provider',
    residentId: string,
  ) =>
    serviceProviderRequest(r.state.services!, {
      type,
      id: 'clinic',
      expectedRevision: service().revision,
      residentId,
    });
  const transfer = (
    target: { kind: 'resident' | 'enterprise' | 'public'; id: string },
    actor = b,
  ) => {
    ok(a, 'principals.control', {
      request: request({
        type: 'offer',
        target,
        expiresAt: r.state.world.clock.now + 1000000,
        terms: '目录控制与原作者和身体分别归属',
      }),
    });
    ok(actor, 'principals.control', { request: request({ type: 'accept' }) });
  };
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  const publicExecute = (req: PrincipalRequest, id: string) => {
    ok(a, 'governance.propose', {
      id,
      text: '仅这项服务动作',
      action: {
        kind: 'operation' in req ? 'manage-resource' : 'control-resource',
        expectedRevision: req.resourceRevision,
        request: req,
      },
      closesAt: r.state.world.clock.now + 60000,
      expectedProcedureRevision: r.state.world.publicGovernance!.authority.procedureRevision,
    });
    const revision = () => r.state.world.publicGovernance!.authority.proposals[id]!.revision;
    for (const actor of [a, b])
      ok(actor, 'governance.vote', { id, expectedRevision: revision(), choice: 'yes' });
    expect(r.advanceTime(60000, `public-${id}`).ok).toBe(true);
    ok(c, 'governance.close', { id, expectedRevision: revision() });
    ok(c, 'governance.execute', { id, expectedRevision: revision() });
  };
  return {
    root,
    r,
    manifest,
    a,
    b,
    c,
    location,
    call,
    ok,
    publish,
    service,
    request,
    admin,
    permit,
    transfer,
    replay,
    publicExecute,
  };
}
test('service activation preserves old directory, assets and manifest; no implicit stock or vehicle authority', () => {
  const t = fixture(false);
  t.publish();
  const directory = structuredClone(t.r.state.services),
    agents = structuredClone(t.r.state.world.agents),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableServicePrincipals().ok).toBe(true);
  expect(t.r.enableServicePrincipals().ok).toBe(true);
  expect(t.r.state.services!.services).toEqual(directory!.services);
  expect(t.r.state.world.agents).toEqual(agents);
  expect(t.r.state.world.materials?.resourcePrincipals).toBeUndefined();
  expect(t.r.state.world.residentMobility?.principalPolicy).toBeUndefined();
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  expect(t.r.context(t.a).self).toMatchObject({ resourcePrincipalsWith: 'town principals list' });
  expect(t.ok(t.a, 'principals.read', { kind: 'service', id: 'clinic' }).data).toMatchObject({
    requestBase: { controlVersion: 1 },
  });
  t.replay();
});
test('enterprise directory control cannot authorize its manager to work, erase reservations, or close the enterprise', () => {
  const t = fixture();
  t.publish();
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '居民服务组织',
    occupationName: '居民角色',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.transfer({ kind: 'enterprise', id: 'firm' });
  expect(t.service()).toMatchObject({
    ownerId: t.a,
    namedProviders: [t.a],
    control: { controller: { kind: 'enterprise', id: 'firm' } },
  });
  const now = t.r.state.world.clock.now;
  const command = {
    type: 'schedule' as const,
    id: 'slot',
    serviceId: 'clinic',
    start: now,
    end: now + 60000,
    capacity: 1,
  };
  expect(t.call(t.a, 'services.schedule', { ...command }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: t.admin(command) });
  expect(
    t.call(t.b, 'services.start', { id: 'slot', expectedRevision: 1, until: now + 50000 }).ok,
  ).toBe(false);
  t.ok(t.a, 'services.start', { id: 'slot', expectedRevision: 1, until: now + 50000 });
  expect(
    t.call(t.b, 'principals.operate', { request: t.permit('services.revoke-provider', t.a) }).error,
  ).toBe('service-active-provider-permission-required');
  t.ok(t.c, 'bookings.request', { id: 'visit', slotId: 'slot', units: 1 });
  expect(t.ok(t.b, 'bookings.read', { id: 'visit' }).data).toMatchObject({ residentId: t.c });
  expect(t.call(t.a, 'bookings.read', { id: 'visit' }).ok).toBe(false);
  expect(t.ok(t.c, 'services.read', { id: 'clinic' }).data).not.toHaveProperty('control');
  const before = structuredClone(t.r.state);
  t.ok(t.b, 'principals.operate', {
    request: t.admin({ type: 'accept', id: 'visit', expectedRevision: 1 }),
  });
  expect(t.r.state.world.activityTimeByAgent).toEqual(before.world.activityTimeByAgent);
  expect(t.r.state.world.agents).toEqual(before.world.agents);
  expect(t.r.state.services!.bookings.visit!.status).toBe('accepted');
  expect(
    t.call(t.b, 'principals.operate', {
      request: t.admin({ type: 'close', id: 'clinic', expectedRevision: t.service().revision }),
    }).error,
  ).toBe('outstanding-bookings');
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).error).toBe(
    'enterprise-service-estate-unsettled',
  );
  t.ok(t.c, 'bookings.check-in', { id: 'visit', expectedRevision: 2, until: now + 40000 });
  expect(t.r.advanceTime(1000, 'actual-overlap').ok).toBe(true);
  t.ok(t.a, 'services.stop', { id: 'slot', expectedRevision: 2 });
  expect(t.r.state.services!.bookings.visit).toMatchObject({
    status: 'ended',
    attendedMs: 1000,
    providerOverlapMs: 1000,
  });
  t.ok(t.b, 'principals.operate', { request: t.permit('services.revoke-provider', t.a) });
  expect(t.service().namedProviders).toEqual([]);
  t.ok(t.b, 'principals.operate', {
    request: t.admin({ type: 'close', id: 'clinic', expectedRevision: t.service().revision }),
  });
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).ok).toBe(false);
  t.ok(t.b, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'resident', id: t.a },
      expiresAt: now + 1000000,
      terms: '关闭目录仍需真实交接',
    }),
  });
  t.ok(t.a, 'principals.control', { request: t.request({ type: 'accept' }) });
  expect(t.service().active).toBe(false);
  t.ok(t.b, 'world.close_enterprise', { enterpriseId: 'firm' });
  expect(t.r.state.world.enterprises.firm!.status).toBe('closed');
  t.replay();
});
test('collective service management consumes the exact frozen decision together with the unique directory change', () => {
  const t = fixture();
  t.publish();
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '居民服务社团',
      terms: '每项独立确认',
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
      terms: '仅此动作',
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
      terms: '独立接收目录',
    }),
  });
  const take = t.request({ type: 'accept' });
  approve('take', take);
  expect(t.call(t.b, 'principals.control', { request: take }).ok).toBe(false);
  t.ok(t.b, 'collectives.execute', {
    id: 'take',
    expectedRevision: t.r.state.collectives!.decisions.take!.revision,
  });
  const now = t.r.state.world.clock.now;
  const req = t.admin({
    type: 'schedule',
    id: 'slot',
    serviceId: 'clinic',
    start: now,
    end: now + 60000,
    capacity: 1,
  });
  approve('schedule', req);
  const before = structuredClone(t.r.state);
  t.ok(t.b, 'collectives.execute', {
    id: 'schedule',
    expectedRevision: t.r.state.collectives!.decisions.schedule!.revision,
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
  expect(applyOpenSocietyEffects(before, commit).services).toEqual(t.r.state.services);
  expect(t.service().namedProviders).toEqual([t.a]);
  t.ok(t.a, 'bookings.request', { id: 'visit', slotId: 'slot', units: 1 });
  expect(t.call(t.c, 'bookings.read', { id: 'visit' }).ok).toBe(false);
  t.replay();
});
test('source validation rejects missing directory, duplicate channels, forged capacity and old administrative records', () => {
  const t = fixture();
  t.publish();
  t.transfer({ kind: 'resident', id: t.b });
  const before = structuredClone(t.r.state),
    now = t.r.state.world.clock.now;
  t.ok(t.b, 'principals.operate', {
    request: t.admin({
      type: 'schedule',
      id: 'slot',
      serviceId: 'clinic',
      start: now,
      end: now + 60000,
      capacity: 1,
    }),
  });
  const commit = [...t.r.journal.commits]
      .reverse()
      .find((c) => c.capability === 'principals.operate')!,
    e = commit.worldEvents![0]!;
  expect(() => applyWorldEvent(before.world, e)).toThrow(
    'service-principal-directory-port-required',
  );
  if (e.type !== 'ResidentServicePrincipalsCommitted') throw Error('fixture');
  const d = e.payload.events[0];
  if (d?.type !== 'ServicePrincipalOperationCommitted') throw Error('fixture');
  expect(() =>
    applyOpenSocietyEffects(before, { worldEvents: [e], servicesEvents: d.events }),
  ).toThrow('service-principal-duplicate-effect-channel');
  expect(() => applyOpenSocietyEffects(before, { servicesEvents: d.events })).toThrow(
    'service-principal-operation-envelope-required',
  );
  t.ok(t.c, 'bookings.request', { id: 'visit', slotId: 'slot', units: 1 });
  const bookingBefore = structuredClone(t.r.state);
  t.ok(t.b, 'principals.operate', {
    request: t.admin({ type: 'accept', id: 'visit', expectedRevision: 1 }),
  });
  const accepted = [...t.r.journal.commits]
    .reverse()
    .find((c) => c.capability === 'principals.operate')!.worldEvents![0]!;
  if (accepted.type !== 'ResidentServicePrincipalsCommitted') throw Error('fixture');
  const a = accepted.payload.events[0];
  if (a?.type !== 'ServicePrincipalOperationCommitted' || !a.capacityProof) throw Error('fixture');
  const proof = a.capacityProof;
  expect(() =>
    applyOpenSocietyEffects(bookingBefore, {
      worldEvents: [
        {
          ...accepted,
          payload: {
            ...accepted.payload,
            events: [
              {
                ...a,
                capacityProof: { ...proof, capacity: proof.capacity + 1 },
              },
            ],
          },
        },
      ],
    }),
  ).toThrow('service-capacity-world-source-mismatch');
  expect(applyOpenSocietyEffects(bookingBefore, { worldEvents: [accepted] }).services).toEqual(
    t.r.state.services,
  );
  t.replay();
});
test('public directory approval commits one exact service change and does not grant personal provider permission', () => {
  const t = fixture();
  t.publish();
  t.ok(t.a, 'principals.control', {
    request: t.request({
      type: 'offer',
      target: { kind: 'public', id: t.r.state.world.publicGovernance!.authority.grant.id },
      expiresAt: 1000000,
      terms: '只接受服务目录',
    }),
  });
  t.publicExecute(t.request({ type: 'accept' }), 'take');
  expect(t.service().namedProviders).toEqual([t.a]);
  const req = t.permit('services.authorize-provider', t.c);
  expect(t.call(t.c, 'principals.operate', { request: req }).ok).toBe(false);
  t.publicExecute(req, 'provide');
  expect(t.service().namedProviders).toEqual([t.a, t.c]);
  const e = [...t.r.journal.commits].reverse().find((c) => c.capability === 'governance.execute')!
    .worldEvents![0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted') throw Error('fixture');
  expect(e.payload.serviceDirectoryCommit?.events[0]?.type).toBe(
    'ServicePrincipalOperationCommitted',
  );
  expect(t.r.state.world.activityTimeByAgent[t.c]?.availableAt ?? 0).toBeLessThanOrEqual(
    t.r.state.world.clock.now,
  );
  t.replay();
});
