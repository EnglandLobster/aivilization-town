import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { resourcePrincipalSnapshot, type PrincipalControlRequest } from '@aivilization/authority';
import { serviceAffiliationRequest } from '@aivilization/services';
import { enterpriseControlVersion } from '@aivilization/enterprise';
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
    serviceAffiliations: enabled,
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
  const publicExecute = (request: PrincipalControlRequest, id: string) => {
    ok(a, 'governance.propose', {
      id,
      text: '只有精确目录控制',
      action: { kind: 'control-resource', expectedRevision: request.resourceRevision, request },
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
  return {
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
test('explicit affiliation migration preserves all existing directory/world facts and old manifest without manufactured consent', () => {
  const t = fixture(false),
    before = structuredClone(t.r.state),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableServiceAffiliations().ok).toBe(true);
  expect(t.r.enableServiceAffiliations().ok).toBe(true);
  expect(t.r.state.services!.services).toEqual(before.services!.services);
  expect(t.r.state.world).toEqual(before.world);
  expect(t.r.state.services!.affiliations!.consents).toEqual({});
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.replay();
});
test('owner and firm manager independently authorize exact offer/accept; source forgery, raw effects and absent real directory reject', () => {
  const t = fixture(),
    offer = t.offer();
  t.ok(t.b, 'principals.control', { request: offer });
  const accept = t.control({ type: 'accept' });
  expect(t.call(t.a, 'principals.control', { request: accept }).error).toBe(
    'service-enterprise-affiliation-authority-required',
  );
  const before = structuredClone(t.r.state);
  t.approve(t.b, accept);
  expect(t.r.state.services!.services).toEqual(before.services!.services);
  expect(t.r.state.world).toEqual(before.world);
  const commit = [...t.r.journal.commits]
      .reverse()
      .find((v) => v.capability === 'principals.operate')!,
    e = commit.worldEvents![0]!;
  if (e.type !== 'ResidentServiceAffiliationCommitted') throw Error('fixture');
  const v = e.payload.events[0];
  if (v?.type !== 'ServiceAffiliationConsentApproved') throw Error('fixture');
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
            events: [
              {
                ...v,
                consent: {
                  ...v.consent,
                  authorization: { ...v.consent.authorization, actorId: t.a },
                },
              },
            ],
          },
        },
      ],
    }),
  ).toThrow('world-principal-operation-source-mismatch');
  t.ok(t.a, 'principals.control', { request: accept });
  expect(t.r.state.services!.affiliations!.consents.clinic!.status).toBe('used');
  expect(t.r.state.services!.services.clinic).toMatchObject({
    ownerId: t.b,
    enterpriseId: 'firm',
    namedProviders: [t.b],
    control: { controller: { kind: 'resident', id: t.a } },
  });
  expect(t.r.state.world.agents).toEqual(before.world.agents);
  expect(t.r.state.services!.bookings).toEqual(before.services!.bookings);
  t.replay();
});
test('revocation and expiry preserve ownership and funds, edited operation cannot use old permission', () => {
  const t = fixture();
  t.ok(t.b, 'principals.control', { request: t.offer() });
  const accept = t.control({ type: 'accept' });
  t.approve(t.b, accept);
  const revoke = serviceAffiliationRequest(t.r.state.services!, 'clinic', {
    type: 'services.revoke-control',
    registryRevision: t.r.state.services!.affiliations!.revision,
    expectedConsentVersion: t.r.state.services!.affiliations!.consents.clinic!.version,
  });
  expect(t.call(t.a, 'principals.operate', { request: revoke }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: revoke });
  expect(t.call(t.a, 'principals.control', { request: accept }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: t.approval(accept, 1000) });
  expect(t.r.advanceTime(1000, 'aff-expiry').ok).toBe(true);
  expect(t.call(t.a, 'principals.control', { request: accept }).ok).toBe(false);
  t.replay();
});
test('firm consent survives institutional manager handover, former manager cannot issue a new consent and successor may revoke', () => {
  const t = fixture();
  t.ok(t.b, 'principals.control', { request: t.offer() });
  const accept = t.control({ type: 'accept' });
  t.approve(t.b, accept);
  t.ok(t.b, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'resident', id: t.c },
    expiresAt: 1000000,
    terms: '管理交接',
  });
  t.ok(t.c, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  t.ok(t.a, 'principals.control', { request: accept });
  const next = t.control({
    type: 'offer',
    target: { kind: 'resident', id: t.c },
    expiresAt: 1000000,
    terms: '下一份交接',
  });
  expect(t.call(t.b, 'principals.operate', { request: t.approval(next) }).ok).toBe(false);
  t.approve(t.c, next);
  t.ok(t.a, 'principals.control', { request: next });
  t.replay();
});
test('collective-managed firm approval consumes only its actual independent decision; later personal acceptance does not consume the decision again', () => {
  const t = fixture();
  t.club();
  t.ok(t.b, 'principals.control', { request: t.offer() });
  t.ok(t.b, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'collective', id: 'club' },
    expiresAt: 1000000,
    terms: '集体管理',
  });
  t.collective('firm-accept', 'resources.accept', 'firm', {
    kind: 'enterprise',
    expectedRevision: 2,
    expectedControlVersion: 2,
  })();
  expect(enterpriseControlVersion(t.r.state.world.enterprises.firm!)).toBe(3);
  const accept = t.control({ type: 'accept' }),
    approve = t.approval(accept),
    execute = t.collective('approve', 'principals.operate', 'clinic', { request: approve }),
    before = structuredClone(t.r.state);
  expect(t.call(t.b, 'principals.operate', { request: approve }).ok).toBe(false);
  execute();
  const commit = [...t.r.journal.commits]
    .reverse()
    .find((v) => v.capability === 'collectives.execute')!;
  expect(() => applyOpenSocietyEffects(before, { worldEvents: commit.worldEvents! })).toThrow(
    'world-principal-operation-source-mismatch',
  );
  expect(applyOpenSocietyEffects(before, commit).services).toEqual(t.r.state.services);
  expect(t.r.state.collectives!.decisions.approve!.status).toBe('executed');
  t.ok(t.a, 'principals.control', { request: accept });
  expect(t.r.state.collectives!.decisions.approve!.status).toBe('executed');
  const accepted = [...t.r.journal.commits]
    .reverse()
    .find((v) => v.capability === 'principals.control')!;
  expect(accepted.collectiveEvents ?? []).toEqual([]);
  t.replay();
});
test('public receiving control uses separate real firm approval and exact public execution, with no provider, bodily or financial effects', () => {
  const t = fixture(),
    offer = t.control({
      type: 'offer',
      target: { kind: 'public', id: t.r.state.world.publicGovernance!.authority.grant.id },
      expiresAt: 1000000,
      terms: '公共控制，企业供给仍独立',
    });
  t.ok(t.b, 'principals.control', { request: offer });
  const accept = t.control({ type: 'accept' });
  t.approve(t.b, accept);
  const before = structuredClone(t.r.state.world);
  t.publicExecute(accept, 'public-accept');
  expect(t.r.state.services!.services.clinic!.control!.controller.kind).toBe('public');
  expect(t.r.state.services!.affiliations!.consents.clinic!.status).toBe('used');
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  const commit = [...t.r.journal.commits]
      .reverse()
      .find((v) => v.capability === 'governance.execute')!,
    e = commit.worldEvents![0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted') throw Error('fixture');
  expect(e.payload.serviceAffiliationCommit).toBeDefined();
  expect(e.payload.serviceDirectoryCommit).toBeUndefined();
  t.replay();
});
