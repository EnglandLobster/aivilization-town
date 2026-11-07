import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  principalPermitRequest,
  type PrincipalPremisesRightsCommand,
} from '@aivilization/premises';
import { type PrincipalRequest, type ResourcePrincipal } from '@aivilization/authority';
import {
  applyWorldEvent,
  residentTradeEvidence,
  mayOperateWorldPremises,
  hasEnterprisePrincipalAssets,
} from '@aivilization/world';
import { openPermitsFixture } from './testFixtures/openPermits';
function fixture(enabled = true) {
  const t = openPermitsFixture(true, { principals: true });
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '真正承担许可的企业',
    occupationName: '角色',
    initialCapital: 100,
    maxEmployees: 3,
  });
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  const control = (command: Record<string, unknown>) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: t.building().revision,
    controlVersion: t.building().control.version,
    command,
  });
  t.ok(t.b, 'principals.control', {
    request: control({
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      terms: '不转让个人身份',
      expiresAt: t.r.state.world.clock.now + 1000000,
    }),
  });
  t.ok(t.b, 'principals.control', { request: control({ type: 'accept' }) });
  if (enabled) expect(t.r.enablePrincipalPermits().ok).toBe(true);
  const request = (c: PrincipalPremisesRightsCommand) =>
    principalPermitRequest(t.r.state.world.premisesRights!, c, { building: () => t.building() });
  const offer = (
    grantee: ResourcePrincipal = { kind: 'resident', id: t.c },
    id = 'permission',
  ): Extract<PrincipalPremisesRightsCommand, { type: 'offer' }> => ({
    type: 'offer',
    buildingRevision: t.building().revision,
    terms: {
      id,
      buildingId: 'home',
      grantee,
      users: [t.c],
      scopes: ['operate'],
      mode: 'shared',
      title: '实际工坊许可',
      terms: '本人实际进入，组织不代替身体',
      startAt: t.r.state.world.clock.now,
      endAt: t.r.state.world.clock.now + 3600000,
      acceptBy: t.r.state.world.clock.now + 600000,
    },
  });
  const approvePublic = (id: string, r: PrincipalRequest) => {
    t.ok(t.a, 'governance.propose', {
      id,
      text: '独立确认这份许可',
      action: {
        kind: 'operation' in r ? 'manage-resource' : 'control-resource',
        expectedRevision: r.resourceRevision,
        request: r,
      },
      closesAt: t.r.state.world.clock.now + 60000,
      expectedProcedureRevision: t.r.state.world.publicGovernance!.authority.procedureRevision,
    });
    for (const actor of [t.a, t.b, t.c])
      t.ok(actor, 'governance.vote', {
        id,
        expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
        choice: 'yes',
      });
    t.time(60000);
    t.ok(t.d, 'governance.close', {
      id,
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    });
    return {
      id,
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    };
  };
  return { ...t, request, offer, control, approvePublic };
}
test('principal permit activation preserves legacy assets/permissions and manifest; old experiments never implicitly upgrade', () => {
  const t = fixture(false),
    w = structuredClone(t.r.state.world),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.b, 'principals.operate', { request: t.request(t.offer()) }).error).toBe(
    'principal-permits-not-enabled',
  );
  expect(t.r.enablePrincipalPermits().ok).toBe(true);
  expect(t.r.enablePrincipalPermits().ok).toBe(true);
  expect(t.r.state.world.premisesRights!.permits).toEqual(w.premisesRights!.permits);
  expect(t.r.state.world.premises).toEqual(w.premises);
  expect(t.r.state.world.agents).toEqual(w.agents);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  expect(t.r.state.world.publicGovernance!.authority.grant.principalPermits?.resourceKinds).toEqual(
    ['premises-permit'],
  );
  t.replay();
});
test('real enterprise proof and recipient consent govern named usage, old methods cannot bypass, no money/body effects or legacy paid-order proof', () => {
  const t = fixture(),
    before = structuredClone(t.r.state.world.agents),
    r = t.request(t.offer());
  expect(t.call(t.a, 'principals.operate', { request: r }).ok).toBe(false);
  expect(t.call(t.b, 'permits.offer', t.offer()).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: r });
  expect(mayOperateWorldPremises(t.r.state.world, t.c, t.building().locationId)).toBe(false);
  expect(t.call(t.c, 'permits.accept', { id: 'permission', expectedRevision: 1 }).error).toBe(
    'principal-permit-operation-required',
  );
  const take = t.request({ type: 'accept', id: 'permission', revision: 1 });
  expect(t.call(t.b, 'principals.operate', { request: take }).ok).toBe(false);
  const raw = structuredClone(t.r.state.world);
  t.ok(t.c, 'principals.operate', { request: take });
  expect(mayOperateWorldPremises(t.r.state.world, t.c, t.building().locationId)).toBe(true);
  expect(t.r.state.world.agents).toEqual(before);
  expect(
    residentTradeEvidence(t.r.state.world, { kind: 'permit', id: 'permission' }),
  ).toBeUndefined();
  const read = t.ok(t.c, 'permits.read', { id: 'permission' }).data as {
    requestBase: { resourceKind: string };
  };
  expect(read.requestBase.resourceKind).toBe('premises-permit');
  const accepted = t.r.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .find(
      (e) =>
        e.type === 'ResidentPrincipalPremisesRightsCommitted' &&
        e.payload.events[0]?.type === 'PrincipalPremisesPermitAccepted',
    );
  expect(accepted).toBeDefined();
  if (accepted?.type !== 'ResidentPrincipalPremisesRightsCommitted')
    throw Error('accepted commit missing');
  const event = accepted.payload.events[0]!;
  if (event.type !== 'PrincipalPremisesPermitAccepted') throw Error('accepted effect missing');
  expect(() =>
    applyWorldEvent(raw, {
      ...accepted,
      payload: {
        ...accepted.payload,
        events: [
          {
            ...event,
            authorization: {
              ...event.authorization,
              source: { kind: 'enterprise', managementVersion: 999, managementDecisionId: null },
            },
          },
        ],
      },
    }),
  ).toThrow('world-principal-operation-source-mismatch');
  t.replay();
});
test('public grantee separately votes on acceptance, and accepted organizational use survives later building custody change', () => {
  const t = fixture();
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer({ kind: 'public', id: 'town' })) });
  const take = t.request({ type: 'accept', id: 'permission', revision: 1 });
  expect(t.call(t.a, 'principals.operate', { request: take }).ok).toBe(false);
  const approval = t.approvePublic('public-take', take);
  t.ok(t.d, 'governance.execute', approval);
  const p = t.r.state.world.premisesRights!.permits.permission!;
  expect('principalAuthorization' in p && p.principalAuthorization.accepted?.source).toMatchObject({
    kind: 'public',
    proposalId: 'public-take',
  });
  t.ok(t.b, 'principals.control', {
    request: t.control({
      type: 'offer',
      target: { kind: 'resident', id: t.a },
      terms: '保留既有许可',
      expiresAt: t.r.state.world.clock.now + 1000000,
    }),
  });
  t.ok(t.a, 'principals.control', { request: t.control({ type: 'accept' }) });
  expect(mayOperateWorldPremises(t.r.state.world, t.c, t.building().locationId)).toBe(true);
  expect(hasEnterprisePrincipalAssets(t.r.state.world, 'firm')).toBe(true);
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).ok).toBe(false);
  expect(
    t.call(t.d, 'principals.operate', {
      request: t.request({ type: 'release', id: 'permission', revision: 2 }),
    }).ok,
  ).toBe(false);
  t.ok(
    t.a,
    'governance.execute',
    t.approvePublic(
      'public-release',
      t.request({ type: 'release', id: 'permission', revision: 2 }),
    ),
  );
  expect(t.r.state.world.premisesRights!.permits.permission!.status).toBe('released');
  t.replay();
});
test('collective permit acceptance consumes exact independently approved decision atomically; personal and missing journal authority reject', () => {
  const t = fixture(),
    at = t.r.state.world.clock.now;
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同使用',
      terms: '每份合同独立表决',
      members: [t.b, t.c],
      voters: [t.b, t.c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: at + 1000000,
  });
  t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ kind: 'collective', id: 'club' })),
  });
  const request = t.request({ type: 'accept', id: 'permission', revision: 1 });
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  t.ok(t.b, 'collectives.propose', {
    id: 'take',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '仅这一份工坊许可',
    action: {
      kind: 'resource',
      capability: 'principals.operate',
      resourceId: request.resourceId,
      arguments: { request },
    },
    closesAt: at + 100000,
    executeBefore: at + 1000000,
  });
  for (const actor of [t.b, t.c])
    t.ok(actor, 'collectives.vote', {
      id: 'take',
      expectedRevision: t.r.state.collectives!.decisions.take!.revision,
      vote: 'yes',
    });
  t.ok(t.b, 'collectives.decide', {
    id: 'take',
    expectedRevision: t.r.state.collectives!.decisions.take!.revision,
  });
  t.ok(t.c, 'collectives.execute', {
    id: 'take',
    expectedRevision: t.r.state.collectives!.decisions.take!.revision,
  });
  expect(t.r.state.collectives!.decisions.take!.status).toBe('executed');
  const commit = t.r.journal.commits.find((c) =>
    c.collectiveEvents?.some(
      (e) =>
        e.type === 'CollectiveDecisionChanged' &&
        e.decision.status === 'executed' &&
        e.decision.id === 'take',
    ),
  )!;
  expect(commit.worldEvents).toHaveLength(1);
  expect(commit.worldEvents![0]!.type).toBe('ResidentPrincipalPremisesRightsCommitted');
  t.replay();
});
