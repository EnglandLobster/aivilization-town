import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  resourcePrincipalSnapshot,
  type PrincipalRequest,
  type PrincipalControlRequest,
} from '@aivilization/authority';
import {
  serviceAffiliationRequest,
  serviceSupplyRelationRequest,
  currentServiceEnterprise,
  serviceAdministrativeRequest,
  type ServiceSupplyRelationCommand,
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
  const root = mkdtempSync(join(tmpdir(), 'service-affiliation-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    publicGovernance: true,
    servicePrincipals: true,
    serviceSupply: true,
    serviceAffiliations: true,
    serviceSupplyRelations: enabled,
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
  const r = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => r.close());
  const [a, b, c] = m.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const d = r.invoke(actor, { name, arguments: args, requestId: `aff-${++n}` });
    r.finishTurn(actor, { summary: 'Independent firm affiliation engineering scenario' });
    return d;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}:${d.error}`).toBe(true);
    return d;
  };
  ok(b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '供给组织',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 3,
  });
  ok(b, 'services.publish', {
    id: 'clinic',
    kind: 'appointment',
    locationId: location,
    enterpriseId: 'firm',
    title: '原目录',
    description: '原供应关联',
    capacity: 1,
  });
  const control = (command: PrincipalControlRequest['command']): PrincipalControlRequest => {
    const v = r.state.services!.services.clinic!;
    return {
      resourceKind: 'service',
      resourceId: v.id,
      resourceRevision: v.revision,
      controlVersion: resourcePrincipalSnapshot(v).version,
      command,
    };
  };
  const approval = (
    request: PrincipalControlRequest,
    expiresAt = r.state.world.clock.now + 100000,
  ) =>
    serviceAffiliationRequest(r.state.services!, 'clinic', {
      type: 'services.approve-control',
      request,
      expiresAt,
      registryRevision: r.state.services!.affiliations!.revision,
    });
  const approve = (actor: string, request: PrincipalControlRequest) =>
    ok(actor, 'principals.operate', { request: approval(request) });
  const offer = () =>
    control({
      type: 'offer',
      target: { kind: 'resident', id: a },
      expiresAt: r.state.world.clock.now + 1000000,
      terms: '仅目录，旧关联和义务保留',
    });
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  const publicExecute = (request: PrincipalRequest, id: string) => {
    ok(a, 'governance.propose', {
      id,
      text: '只有精确目录控制',
      action: {
        kind: 'operation' in request ? 'manage-resource' : 'control-resource',
        expectedRevision: request.resourceRevision,
        request,
      },
      closesAt: r.state.world.clock.now + 60000,
      expectedProcedureRevision: r.state.world.publicGovernance!.authority.procedureRevision,
    });
    const rev = () => r.state.world.publicGovernance!.authority.proposals[id]!.revision;
    for (const who of [a, b])
      ok(who, 'governance.vote', { id, expectedRevision: rev(), choice: 'yes' });
    expect(r.advanceTime(60000, `public-aff-${id}`).ok).toBe(true);
    ok(c, 'governance.close', { id, expectedRevision: rev() });
    ok(c, 'governance.execute', { id, expectedRevision: rev() });
  };
  const collective = (
    id: string,
    capability: string,
    resourceId: string,
    args: Record<string, unknown>,
  ) => {
    ok(b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: r.state.collectives!.charters.club!.version,
      terms: '一项精确授权',
      action: { kind: 'resource', capability, resourceId, arguments: args },
      closesAt: r.state.world.clock.now + 100000,
      executeBefore: r.state.world.clock.now + 1000000,
    });
    const rev = () => r.state.collectives!.decisions[id]!.revision;
    for (const who of [b, c])
      ok(who, 'collectives.vote', { id, expectedRevision: rev(), vote: 'yes' });
    ok(b, 'collectives.decide', { id, expectedRevision: rev() });
    return () => ok(b, 'collectives.execute', { id, expectedRevision: rev() });
  };
  const club = () => {
    ok(b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: '管理程序',
        terms: '精确表决',
        members: [b, c],
        voters: [b, c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: 1000000,
    });
    ok(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  };
  const relation = (command: ServiceSupplyRelationCommand) =>
    serviceSupplyRelationRequest(r.state.services!.services.clinic!, command);
  return {
    relation,
    r,
    root,
    manifest,
    a,
    b,
    c,
    call,
    ok,
    control,
    approval,
    approve,
    offer,
    replay,
    publicExecute,
    collective,
    club,
  };
}
test('explicit v5 activation preserves original directory/world/manifest and does not fabricate relationship changes', () => {
  const t = fixture(false),
    before = structuredClone(t.r.state),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableServiceSupplyRelations().ok).toBe(true);
  expect(t.r.enableServiceSupplyRelations().ok).toBe(true);
  expect(t.r.state.services!.services).toEqual(before.services!.services);
  expect(t.r.state.world).toEqual(before.world);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  expect(t.r.state.services!.relationPolicy!.version).toBe('resident-service-supply-relations-v5');
  t.replay();
});
test('ended original enterprise can really close and cannot lock someone elses directory, original attribution/provider history stays', () => {
  const t = fixture();
  t.ok(t.b, 'principals.control', { request: t.offer() });
  const accept = t.control({ type: 'accept' });
  t.approve(t.b, accept);
  t.ok(t.a, 'principals.control', { request: accept });
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).error).toBe(
    'enterprise-service-estate-unsettled',
  );
  const request = t.relation({
      type: 'services.end-supply',
      subject: { kind: 'enterprise', id: 'firm' },
    }),
    before = structuredClone(t.r.state);
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request });
  expect(t.r.state.world).toEqual(before.world);
  expect(t.r.state.services!.services.clinic).toMatchObject({
    enterpriseId: 'firm',
    ownerId: t.b,
    namedProviders: [t.b],
    control: { controller: { kind: 'resident', id: t.a } },
    supplyRelation: { enterpriseId: null },
  });
  t.ok(t.b, 'world.close_enterprise', { enterpriseId: 'firm' });
  expect(t.r.state.world.enterprises.firm!.status).toBe('closed');
  t.ok(t.a, 'principals.control', {
    request: t.control({
      type: 'offer',
      target: { kind: 'resident', id: t.c },
      expiresAt: 1000000,
      terms: '旧企业不再锁定控制',
    }),
  });
  t.ok(t.c, 'principals.control', { request: t.control({ type: 'accept' }) });
  expect(t.r.state.services!.services.clinic!.enterpriseId).toBe('firm');
  expect(currentServiceEnterprise(t.r.state.services!.services.clinic!)).toBeUndefined();
  t.replay();
});
test('new firm requires directory invitation and independent acceptance; old company cannot approve current control, public read hides grant contents', () => {
  const t = fixture();
  t.ok(t.c, 'world.found_enterprise', {
    enterpriseId: 'new-firm',
    name: '另一供给方',
    occupationName: '自拟',
    initialCapital: 100,
    maxEmployees: 2,
  });
  t.ok(t.b, 'principals.operate', {
    request: t.relation({ type: 'services.end-supply', subject: { kind: 'resident', id: t.b } }),
  });
  const invite = t.relation({
    type: 'services.offer-supply',
    enterpriseId: 'new-firm',
    expiresAt: 1000000,
    terms: '独立未来供给，过去合同保留',
  });
  expect(t.call(t.c, 'principals.operate', { request: invite }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: invite });
  const metadata = t.ok(t.c, 'principals.read', { kind: 'service', id: 'clinic' }).data as {
    supplyRelation: unknown;
  };
  expect(metadata.supplyRelation).toBeDefined();
  const publicView = t.ok(t.a, 'services.read', { id: 'clinic' }).data as Record<string, unknown>;
  expect(publicView.supplyRelation).toBeUndefined();
  expect(publicView.currentEnterpriseAffiliation).toBeNull();
  expect(
    t.call(t.b, 'principals.operate', { request: t.relation({ type: 'services.accept-supply' }) })
      .ok,
  ).toBe(false);
  const before = structuredClone(t.r.state.world);
  t.ok(t.c, 'principals.operate', { request: t.relation({ type: 'services.accept-supply' }) });
  expect(t.r.state.world).toEqual(before);
  expect(currentServiceEnterprise(t.r.state.services!.services.clinic!)).toBe('new-firm');
  expect(t.r.state.services!.services.clinic!.enterpriseId).toBe('firm');
  const offer = t.offer();
  expect(t.call(t.b, 'principals.control', { request: offer }).ok).toBe(false);
  expect(t.call(t.b, 'principals.operate', { request: t.approval(offer) }).ok).toBe(false);
  t.approve(t.c, offer);
  t.ok(t.b, 'principals.control', { request: offer });
  t.approve(t.c, t.control({ type: 'accept' }));
  t.ok(t.a, 'principals.control', { request: t.control({ type: 'accept' }) });
  t.replay();
});
test('actual provider time and requested attendance protect ongoing supply from unilateral erasure', () => {
  const t = fixture();
  t.ok(t.b, 'principals.control', { request: t.offer() });
  t.approve(t.b, t.control({ type: 'accept' }));
  t.ok(t.a, 'principals.control', { request: t.control({ type: 'accept' }) });
  t.ok(t.a, 'principals.operate', {
    request: serviceAdministrativeRequest(t.r.state.services!, {
      type: 'schedule',
      id: 'slot',
      serviceId: 'clinic',
      start: 0,
      end: 60000,
      capacity: 1,
    }),
  });
  t.ok(t.b, 'services.start', { id: 'slot', expectedRevision: 1, until: 60000 });
  const end = () =>
      t.relation({ type: 'services.end-supply', subject: { kind: 'enterprise', id: 'firm' } }),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.b, 'principals.operate', { request: end() }).error).toBe(
    'outstanding-service-commitments',
  );
  expect(t.r.state.world).toEqual(before);
  t.ok(t.b, 'services.stop', {
    id: 'slot',
    expectedRevision: t.r.state.services!.slots.slot!.revision,
  });
  t.ok(t.c, 'bookings.request', { id: 'booking', slotId: 'slot', units: 1 });
  expect(t.call(t.b, 'principals.operate', { request: end() }).error).toBe(
    'outstanding-service-commitments',
  );
  t.ok(t.c, 'bookings.cancel', { id: 'booking', expectedRevision: 1 });
  t.ok(t.b, 'principals.operate', { request: end() });
  expect(t.r.state.services!.bookings.booking!.status).toBe('cancelled');
  t.replay();
});
test('v5 relationship/control facts need real world source and exact packet; ordinary v2 control cannot bypass a pending invitation', () => {
  const t = fixture(),
    before = structuredClone(t.r.state);
  t.ok(t.b, 'principals.operate', {
    request: t.relation({ type: 'services.end-supply', subject: { kind: 'resident', id: t.b } }),
  });
  const commit = [...t.r.journal.commits]
      .reverse()
      .find((v) => v.capability === 'principals.operate')!,
    e = commit.worldEvents![0]!;
  if (e.type !== 'ResidentServiceSupplyRelationsCommitted') throw Error('fixture');
  const v = e.payload.events[0];
  if (v?.type !== 'ServiceSupplyRelationChanged') throw Error('fixture');
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
            actorId: t.a,
            events: [{ ...v, authorization: { ...v.authorization, actorId: t.a } }],
          },
        },
      ],
    }),
  ).toThrow('world-principal-operation-source-mismatch');
  expect(() =>
    applyOpenSocietyEffects(before, {
      worldEvents: [
        {
          ...e,
          payload: {
            ...e.payload,
            events: [{ ...v, relation: { ...v.relation, enterpriseId: 'fake' } }],
          },
        },
      ],
    }),
  ).toThrow('service-supply-relation-fact-mismatch');
  expect(applyOpenSocietyEffects(before, commit).services).toEqual(t.r.state.services);
  t.replay();
});
test('collective firm separately accepts invitation with atomic exact source consumption; no raw management shortcut', () => {
  const t = fixture();
  t.club();
  t.ok(t.b, 'principals.operate', {
    request: t.relation({ type: 'services.end-supply', subject: { kind: 'resident', id: t.b } }),
  });
  t.ok(t.b, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'collective', id: 'club' },
    expiresAt: 1000000,
    terms: '集体管理',
  });
  t.collective('take-firm', 'resources.accept', 'firm', {
    kind: 'enterprise',
    expectedRevision: 2,
    expectedControlVersion: 2,
  })();
  t.ok(t.b, 'principals.operate', {
    request: t.relation({
      type: 'services.offer-supply',
      enterpriseId: 'firm',
      expiresAt: 1000000,
      terms: '双方独立',
    }),
  });
  const request = t.relation({ type: 'services.accept-supply' }),
    execute = t.collective('accept-supply', 'principals.operate', 'clinic', { request }),
    before = structuredClone(t.r.state);
  expect(t.call(t.b, 'principals.operate', { request }).ok).toBe(false);
  execute();
  const commit = [...t.r.journal.commits]
    .reverse()
    .find((v) => v.capability === 'collectives.execute')!;
  expect(() => applyOpenSocietyEffects(before, { worldEvents: commit.worldEvents! })).toThrow(
    'world-principal-operation-source-mismatch',
  );
  expect(applyOpenSocietyEffects(before, commit).services).toEqual(t.r.state.services);
  expect(t.r.state.collectives!.decisions['accept-supply']!.status).toBe('executed');
  expect(currentServiceEnterprise(t.r.state.services!.services.clinic!)).toBe('firm');
  t.replay();
});
test('public directory invitation uses public exact procedure, while firm independently accepts and may end only its own real relationship', () => {
  const t = fixture();
  t.ok(t.b, 'principals.operate', {
    request: t.relation({ type: 'services.end-supply', subject: { kind: 'resident', id: t.b } }),
  });
  const publicId = t.r.state.world.publicGovernance!.authority.grant.id;
  t.ok(t.b, 'principals.control', {
    request: t.control({
      type: 'offer',
      target: { kind: 'public', id: publicId },
      expiresAt: 1000000,
      terms: '公共目录',
    }),
  });
  t.publicExecute(t.control({ type: 'accept' }), 'public-directory');
  const invite = t.relation({
    type: 'services.offer-supply',
    enterpriseId: 'firm',
    expiresAt: 1000000,
    terms: '仅未来供给',
  });
  t.publicExecute(invite, 'public-invite');
  expect(currentServiceEnterprise(t.r.state.services!.services.clinic!)).toBeUndefined();
  t.ok(t.b, 'principals.operate', { request: t.relation({ type: 'services.accept-supply' }) });
  expect(currentServiceEnterprise(t.r.state.services!.services.clinic!)).toBe('firm');
  t.ok(t.b, 'principals.operate', {
    request: t.relation({
      type: 'services.end-supply',
      subject: { kind: 'enterprise', id: 'firm' },
    }),
  });
  expect(t.r.state.services!.services.clinic!.control!.controller.kind).toBe('public');
  expect(t.r.state.services!.services.clinic!.enterpriseId).toBe('firm');
  t.replay();
});
