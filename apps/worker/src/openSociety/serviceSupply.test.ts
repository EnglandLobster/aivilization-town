import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  serviceCreationRequest,
  serviceReopeningRequest,
  serviceAdministrativeRequest,
  SERVICE_DIRECTORY_ID,
  type PrincipalServiceCreation,
} from '@aivilization/services';
import { type PrincipalOperationRequest } from '@aivilization/authority';
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
  const root = mkdtempSync(join(tmpdir(), 'service-supply-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    publicGovernance: true,
    servicePrincipals: true,
    serviceSupply: enabled,
  });
  const location = Object.values(m.initialWorld.locations).find(
    (l) => l.kind === 'market',
  )!.locationId;
  const manifest = {
    ...m,
    initialWorld: {
      ...m.initialWorld,
      agents: Object.fromEntries(
        Object.entries(m.initialWorld.agents).map(([id, v]) => [
          id,
          { ...v, locationId: location },
        ]),
      ),
    },
  };
  expect(manifest.provenance.serviceRegistration).toBe(
    enabled ? 'resident-service-supply-v3' : undefined,
  );
  expect(manifest.provenance.serviceSupply).toBe('service-supply-v1');
  const r = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => r.close());
  const [a, b, c] = manifest.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const d = r.invoke(actor, { name, arguments: args, requestId: `supply-${++n}` });
    r.finishTurn(actor, { summary: 'Explicit directory registration engineering acceptance' });
    return d;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}:${d.error}`).toBe(true);
    return d;
  };
  const create = (
    id: string,
    principal: PrincipalServiceCreation['principal'],
    enterpriseSupply = false,
  ) =>
    serviceCreationRequest(r.state.services!, {
      principal,
      command: {
        type: 'publish',
        id,
        kind: 'appointment',
        locationId: location,
        title: '居民自拟目录',
        description: '不制造设施或身体效果',
        capacity: 1,
      },
      ...(enterpriseSupply ? { enterpriseSupply: true } : {}),
    });
  const execute = (actor: string, request: PrincipalOperationRequest) =>
    ok(actor, 'principals.operate', { request });
  const replay = () => {
    const before = structuredClone(r.state),
      journal = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(journal);
  };
  const publicExecute = (request: PrincipalOperationRequest, id: string) => {
    ok(a, 'governance.propose', {
      id,
      text: '仅精确目录动作',
      action: { kind: 'manage-resource', expectedRevision: request.resourceRevision, request },
      closesAt: r.state.world.clock.now + 60000,
      expectedProcedureRevision: r.state.world.publicGovernance!.authority.procedureRevision,
    });
    const revision = () => r.state.world.publicGovernance!.authority.proposals[id]!.revision;
    for (const who of [a, b])
      ok(who, 'governance.vote', { id, expectedRevision: revision(), choice: 'yes' });
    expect(r.advanceTime(60000, `supply-public-${id}`).ok).toBe(true);
    ok(c, 'governance.close', { id, expectedRevision: revision() });
    ok(c, 'governance.execute', { id, expectedRevision: revision() });
  };
  return { r, root, manifest, a, b, c, location, call, ok, create, execute, replay, publicExecute };
}
test('explicit creation registration preserves old manifest and existing directory and has a real positive version', () => {
  const t = fixture(false);
  t.ok(t.a, 'services.publish', {
    id: 'old',
    kind: 'event',
    locationId: t.location,
    title: '旧原文',
    description: '旧供给',
    capacity: 1,
  });
  const old = structuredClone(t.r.state.services!.services),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(
    t.call(t.a, 'principals.read', { kind: 'service-directory', id: SERVICE_DIRECTORY_ID }).ok,
  ).toBe(false);
  expect(t.r.enableServiceSupply().ok).toBe(true);
  expect(t.r.enableServiceSupply().ok).toBe(true);
  expect(t.r.state.services!.services).toEqual(old);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  expect(
    t.ok(t.a, 'principals.read', { kind: 'service-directory', id: SERVICE_DIRECTORY_ID }).data,
  ).toMatchObject({ requestBase: { resourceRevision: 1, controlVersion: 1 } });
  t.replay();
});
test('enterprise direct creation uses current management, optional distinct supply affiliation, and no automatic provider labor', () => {
  const t = fixture();
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '居民供给组织',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 3,
  });
  const request = t.create('clinic', { kind: 'enterprise', id: 'firm' }, true),
    before = structuredClone(t.r.state);
  expect(t.call(t.a, 'principals.operate', { request }).ok).toBe(false);
  t.execute(t.b, request);
  const v = t.r.state.services!.services.clinic!;
  expect(v).toMatchObject({
    ownerId: t.b,
    enterpriseId: 'firm',
    control: { controller: { kind: 'enterprise', id: 'firm' } },
    namedProviders: [],
  });
  expect(t.r.state.world.agents).toEqual(before.world.agents);
  expect(t.r.state.world.enterprises).toEqual(before.world.enterprises);
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).error).toBe(
    'enterprise-service-estate-unsettled',
  );
  const req = t.create('independent', { kind: 'enterprise', id: 'firm' });
  t.execute(t.b, req);
  expect(t.r.state.services!.services.independent!.enterpriseId).toBeUndefined();
  const now = t.r.state.world.clock.now;
  t.execute(
    t.b,
    serviceAdministrativeRequest(t.r.state.services!, {
      type: 'schedule',
      id: 'slot',
      serviceId: 'clinic',
      start: now,
      end: now + 60000,
      capacity: 1,
    }),
  );
  expect(t.call(t.b, 'services.start', { id: 'slot', expectedRevision: 1 }).ok).toBe(false);
  t.replay();
});
test('new creation world envelope checks actual capacity, rejects raw effects, and preserves replay without duplicate registration', () => {
  const t = fixture(),
    before = structuredClone(t.r.state),
    request = t.create('clinic', { kind: 'resident', id: t.a });
  t.execute(t.a, request);
  const commit = [...t.r.journal.commits]
      .reverse()
      .find((c) => c.capability === 'principals.operate')!,
    e = commit.worldEvents![0]!;
  if (e.type !== 'ResidentServiceSupplyCommitted') throw Error('fixture');
  const v = e.payload.events[0];
  if (v?.type !== 'PrincipalServiceCreated') throw Error('fixture');
  expect(() => applyWorldEvent(before.world, e)).toThrow(
    'service-principal-directory-port-required',
  );
  expect(() => applyOpenSocietyEffects(before, { servicesEvents: [v] })).toThrow(
    'service-principal-world-envelope-required',
  );
  expect(() =>
    applyOpenSocietyEffects(before, {
      worldEvents: [
        {
          ...e,
          payload: {
            ...e.payload,
            events: [
              {
                ...v,
                capacityProof: { ...v.capacityProof, capacity: v.capacityProof.capacity + 1 },
              },
            ],
          },
        },
      ],
    }),
  ).toThrow('service-capacity-world-source-mismatch');
  expect(applyOpenSocietyEffects(before, commit).services).toEqual(t.r.state.services);
  expect(t.r.state.services!.registration!.revision).toBe(2);
  t.replay();
});
test('public creation requires separate scoped grant and commits its exact decision with the directory, without providers or payment', () => {
  const t = fixture(),
    before = structuredClone(t.r.state.world),
    request = t.create('public-clinic', {
      kind: 'public',
      id: t.r.state.world.publicGovernance!.authority.grant.id,
    });
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  t.publicExecute(request, 'create');
  expect(t.r.state.services!.services['public-clinic']).toMatchObject({
    ownerId: t.c,
    namedProviders: [],
    control: { controller: request.operation.arguments.principal },
  });
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.r.state.world.publicGovernance!.authority.proposals.create!.status).toBe('executed');
  t.replay();
});
test('separated authority preserves public creation grant and commits its exact decision with the directory, without providers or payment', () => {
  const t = fixture(),
    before = structuredClone(t.r.state.world),
    request = t.create('public-clinic', {
      kind: 'public',
      id: t.r.state.world.publicGovernance!.authority.grant.id,
    });
  expect(t.r.enableIndependentServicePrincipals().ok).toBe(true);
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  t.publicExecute(request, 'create');
  expect(t.r.state.services!.services['public-clinic']).toMatchObject({
    ownerId: t.c,
    namedProviders: [],
    control: { controller: request.operation.arguments.principal },
  });
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.r.state.world.publicGovernance!.authority.proposals.create!.status).toBe('executed');
  t.replay();
});
test('closed directory reopening preserves original identity, contracts and history; old exact approval becomes stale', () => {
  const t = fixture();
  t.execute(t.a, t.create('clinic', { kind: 'resident', id: t.a }));
  t.execute(
    t.a,
    serviceAdministrativeRequest(t.r.state.services!, {
      type: 'close',
      id: 'clinic',
      expectedRevision: 1,
    }),
  );
  const before = structuredClone(t.r.state),
    request = serviceReopeningRequest(t.r.state.services!.services.clinic!);
  t.execute(t.a, request);
  expect(t.r.state.services!.services.clinic).toEqual({
    ...before.services!.services.clinic,
    active: true,
    revision: 3,
    principalAt: t.r.state.world.clock.now,
  });
  expect(t.r.state.world.agents).toEqual(before.world.agents);
  expect(t.r.state.services!.bookings).toEqual(before.services!.bookings);
  expect(t.call(t.a, 'principals.operate', { request }).ok).toBe(false);
  t.replay();
});
test('collective direct creation consumes an independent exact decision atomically and keeps all members outside bodily labor', () => {
  const t = fixture();
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '自拟服务组织',
      terms: '逐次决定',
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
  const request = t.create('clinic', { kind: 'collective', id: 'club' });
  t.ok(t.b, 'collectives.propose', {
    id: 'create',
    collectiveId: 'club',
    expectedVersion: t.r.state.collectives!.charters.club!.version,
    terms: '仅这项创建',
    action: {
      kind: 'resource',
      capability: 'principals.operate',
      resourceId: SERVICE_DIRECTORY_ID,
      arguments: { request },
    },
    closesAt: 100000,
    executeBefore: 1000000,
  });
  const revision = () => t.r.state.collectives!.decisions.create!.revision;
  for (const who of [t.b, t.c])
    t.ok(who, 'collectives.vote', { id: 'create', expectedRevision: revision(), vote: 'yes' });
  t.ok(t.b, 'collectives.decide', { id: 'create', expectedRevision: revision() });
  const before = structuredClone(t.r.state);
  expect(t.call(t.b, 'principals.operate', { request }).ok).toBe(false);
  t.ok(t.b, 'collectives.execute', { id: 'create', expectedRevision: revision() });
  const commit = [...t.r.journal.commits]
    .reverse()
    .find((v) => v.capability === 'collectives.execute')!;
  expect(t.r.state.collectives!.decisions.create!.status).toBe('executed');
  expect(t.r.state.services!.services.clinic).toMatchObject({
    ownerId: t.b,
    namedProviders: [],
    control: { controller: { kind: 'collective', id: 'club' } },
  });
  expect(() => applyOpenSocietyEffects(before, { worldEvents: commit.worldEvents! })).toThrow(
    'world-principal-operation-source-mismatch',
  );
  expect(applyOpenSocietyEffects(before, commit).services).toEqual(t.r.state.services);
  expect(t.r.state.world.agents).toEqual(before.world.agents);
  t.replay();
});
