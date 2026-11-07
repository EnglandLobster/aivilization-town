import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { materialOperationRequest } from '@aivilization/materials';
import { premisesPrincipalRequest, type PrincipalPremisesCommand } from '@aivilization/premises';
import type {
  ResourcePrincipal,
  PrincipalOperationRequest,
  PrincipalRequest,
  PrincipalControlCommand,
} from '@aivilization/authority';
import { OpenSocietyRuntime } from './runtime';
import { applyWorldEvent } from '@aivilization/world';
import { openPremisesFixture, premisesCleanup } from './testFixtures/openPremises';
function fixture() {
  const t = openPremisesFixture(true, true, {}, false, {
    principals: true,
    manifest: { premisesPrincipals: true },
  });
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '材料企业',
    occupationName: '角色',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.ok(t.a, 'stocks.create', { id: 's', title: '供料', locationId: t.location });
  t.ok(t.a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 8 } });
  const control = (command: Record<string, unknown>) => ({
    resourceKind: 'stock',
    resourceId: 's',
    resourceRevision: t.stock().revision,
    controlVersion: t.stock().control.version,
    command,
  });
  t.ok(t.a, 'principals.control', {
    request: control({
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      terms: '保管并非雇佣或资本',
      expiresAt: 1000000,
    }),
  });
  t.ok(t.b, 'principals.control', { request: control({ type: 'accept' }) });
  const reserve = (principal: ResourcePrincipal) =>
    t.ok(t.b, 'principals.operate', {
      request: materialOperationRequest(t.stock(), {
        type: 'reserve-materials',
        offer: {
          id: 'r',
          stockId: 's',
          expectedStockRevision: t.stock().revision,
          beneficiary: principal,
          consumer: { domain: 'premises', id: 'p' },
          items: { Wood: 8 },
          terms: '仅本工程',
          expiresAt: t.r.state.world.clock.now + 1000000,
        },
      }),
    });
  const create = (principal: ResourcePrincipal): PrincipalPremisesCommand => ({
    type: 'create-construction',
    construction: {
      id: 'p',
      kind: 'build',
      buildingId: 'home',
      siteId: t.site!.id,
      expectedSiteRevision: t.r.state.world.premises!.sites[t.site!.id]!.revision,
      controller: principal,
      title: '承担主体的房屋',
      description: '个人自愿劳动',
      blueprint: {
        primaryUse: 'residence',
        floorArea: 8,
        capacity: 2,
        fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
      },
      workers: [t.c],
      reservations: [{ id: 'r', revision: 1 }],
    },
  });
  const request = (c: PrincipalPremisesCommand) =>
    premisesPrincipalRequest(t.r.state.world.premises!, c);
  const replay = () => {
    const state = structuredClone(t.r.state),
      bytes = readFileSync(join(t.root, 'journal.jsonl'));
    t.r.close();
    const next = new OpenSocietyRuntime(t.root);
    premisesCleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
  };
  const publicApprove = (id: string, req: PrincipalRequest) => {
    t.ok(t.a, 'governance.propose', {
      id,
      text: '这一个精确工程动作',
      action: {
        kind: 'operation' in req ? 'manage-resource' : 'control-resource',
        expectedRevision: req.resourceRevision,
        request: req,
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
  return { ...t, reserve, create, request, replay, publicApprove };
}
test('actual firm materials and independently authorized construction settle into firm assets; worker/creator gain no control and estate cannot disappear', () => {
  const t = fixture(),
    principal = { kind: 'enterprise', id: 'firm' } as const;
  t.reserve(principal);
  expect(t.r.state.world.materials!.reservations!.records.r!.status).toBe('offered');
  const req = t.request(t.create(principal));
  expect(t.call(t.c, 'principals.operate', { request: req }).ok).toBe(false);
  const beforeCreation = t.r.state.world;
  t.ok(t.b, 'principals.operate', { request: req });
  const recorded = t.r.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .filter((e) => e.type === 'ResidentPremisesCommitted')
    .at(-1)!;
  if (recorded.type !== 'ResidentPremisesCommitted') throw Error('fixture');
  const forged = {
    ...recorded,
    payload: {
      ...recorded.payload,
      events: recorded.payload.events.map((e) =>
        e.type === 'PremisesPrincipalOperationRecorded'
          ? {
              ...e,
              receipt: {
                ...e.receipt,
                authorization: {
                  ...e.receipt.authorization,
                  source: {
                    kind: 'enterprise' as const,
                    managementVersion: 999,
                    managementDecisionId: null,
                  },
                },
              },
            }
          : e,
      ),
    },
  };
  expect(() => applyWorldEvent(beforeCreation, forged)).toThrow();
  expect(t.r.state.world.premises!.buildings).toEqual({});
  expect(t.project().session).toBeUndefined();
  expect(t.r.state.world.materials!.reservations!.records.r).toMatchObject({
    status: 'bound',
    beneficiary: principal,
  });
  expect(
    t.call(t.b, 'construction.start', {
      id: 'p',
      expectedRevision: 1,
      until: t.r.state.world.clock.now + 480000,
    }).error,
  ).toBe('construction-worker-not-authorized');
  t.ok(t.c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + 480000,
  });
  t.time(480000);
  const b = t.r.state.world.premises!.buildings.home!;
  expect(b.control.controller).toEqual(principal);
  expect(b.ownerId).toBe(t.b);
  expect(b.embodied).toEqual({ Wood: 8 });
  expect(t.project().progressMs).toBe(480000);
  expect(t.stock().inventory).toEqual({});
  expect(t.r.state.world.materials!.reservations!.records.r).toMatchObject({
    allocated: { Wood: 8 },
    held: {},
    status: 'settled',
  });
  const config = t.request({
    type: 'manage-premises',
    id: 'home',
    expectedRevision: b.revision,
    command: {
      type: 'configure',
      title: '开放入口',
      access: { entry: 'public', visitors: [], operators: [], residents: [] },
    },
  });
  expect(t.call(t.c, 'principals.operate', { request: config }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: config });
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).ok).toBe(false);
  const list = t.ok(t.b, 'principals.list', {}).data as { items: readonly unknown[] };
  expect(list.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'premises', id: 'home', controller: principal }),
    ]),
  );
  t.replay();
});
test('public project authority requires independent votes and a separate source reservation, then cancels with all goods returned to their original firm', () => {
  const t = fixture(),
    principal = { kind: 'public', id: 'town' } as const;
  t.reserve(principal);
  const req = t.request(t.create(principal));
  expect(t.call(t.a, 'principals.operate', { request: req }).ok).toBe(false);
  const approval = t.publicApprove('create', req);
  t.ok(t.d, 'governance.execute', approval);
  expect(t.r.state.world.publicGovernance!.authority.proposals.create!.status).toBe('executed');
  expect(t.project().controller).toEqual(principal);
  expect(t.project().createdBy).toBe(t.d);
  expect(t.project().session).toBeUndefined();
  expect(
    t.call(t.d, 'construction.cancel', { id: 'p', expectedRevision: t.project().revision }).ok,
  ).toBe(false);
  const cancel = t.request({
    type: 'cancel-construction',
    id: 'p',
    expectedRevision: t.project().revision,
  });
  t.ok(t.a, 'governance.execute', t.publicApprove('cancel', cancel));
  expect(t.project().status).toBe('cancelled');
  expect(t.r.state.world.premises!.buildings).toEqual({});
  expect(t.stock().control.controller).toEqual({ kind: 'enterprise', id: 'firm' });
  expect(t.stock().inventory.Wood).toBe(8);
  expect(t.r.state.world.materials!.reservations!.records.r).toMatchObject({
    status: 'settled',
    returned: { Wood: 8 },
  });
  t.replay();
});

test('collective project decisions consume authority atomically, fail when the site version changes, and never grant individual members a shortcut', () => {
  const t = fixture(),
    principal = { kind: 'collective', id: 'club' } as const;
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同建设',
      terms: '每次精确表决',
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
  t.reserve(principal);
  const req = t.request(t.create(principal));
  expect(t.call(t.b, 'principals.operate', { request: req }).ok).toBe(false);
  const approve = (id: string, request: PrincipalOperationRequest) => {
    t.ok(t.b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: 1,
      terms: '这一个资源操作',
      action: {
        kind: 'resource',
        capability: 'principals.operate',
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
    return { id, expectedRevision: t.r.state.collectives!.decisions[id]!.revision };
  };
  const stale = approve('stale', req),
    valid = approve('valid', req);
  t.ok(t.c, 'collectives.execute', valid);
  expect(t.project().principalAuthorization?.source).toMatchObject({
    kind: 'collective',
    decisionId: 'valid',
  });
  expect(t.r.state.collectives!.decisions.valid!.status).toBe('executed');
  const before = structuredClone(t.r.state.world);
  expect(t.call(t.b, 'collectives.execute', stale).ok).toBe(false);
  expect(t.r.state.world).toEqual(before);
  expect(t.r.state.collectives!.decisions.stale!.status).toBe('passed');
  expect(t.call(t.b, 'construction.cancel', { id: 'p', expectedRevision: 1 }).ok).toBe(false);
  t.ok(
    t.c,
    'collectives.execute',
    approve('cancel', t.request({ type: 'cancel-construction', id: 'p', expectedRevision: 1 })),
  );
  expect(t.project().status).toBe('cancelled');
  expect(t.stock().inventory.Wood).toBe(8);
  t.replay();
});
test('public completion retains the approved principal as control source and future administration needs a new independent public decision', () => {
  const t = fixture(),
    principal = { kind: 'public', id: 'town' } as const;
  t.reserve(principal);
  t.ok(t.d, 'governance.execute', t.publicApprove('build', t.request(t.create(principal))));
  t.ok(t.c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + 480000,
  });
  t.time(480000);
  const b = t.r.state.world.premises!.buildings.home!;
  expect(b.control.controller).toEqual(principal);
  expect(b.ownerId).toBe(t.d);
  if (b.control.policyVersion !== 'resource-principals-v2') throw Error('fixture');
  expect(b.control.authorization).toMatchObject({
    source: { kind: 'public', proposalId: 'build' },
  });
  expect(t.project().progressMs).toBe(480000);
  expect(b.embodied).toEqual({ Wood: 8 });
  const request = t.request({
    type: 'manage-premises',
    id: 'home',
    expectedRevision: b.revision,
    command: {
      type: 'configure',
      title: '公共开放空间',
      access: { entry: 'public', visitors: [], operators: [], residents: [] },
    },
  });
  expect(t.call(t.d, 'principals.operate', { request }).ok).toBe(false);
  t.ok(t.b, 'governance.execute', t.publicApprove('configure', request));
  expect(t.r.state.world.premises!.buildings.home!.title).toBe('公共开放空间');
  expect(t.r.state.world.premises!.buildings.home!.control).toEqual(b.control);
  t.replay();
});

test('firm to public to collective building transfers require each actual authority and preserve all physical/use facts and journal replay', () => {
  const t = fixture(),
    firm = { kind: 'enterprise', id: 'firm' } as const;
  t.reserve(firm);
  t.ok(t.b, 'principals.operate', { request: t.request(t.create(firm)) });
  const building = () => t.r.state.world.premises!.buildings.home!;
  const control = (command: PrincipalControlCommand) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: building()?.revision ?? 1,
    controlVersion: building()?.control.version ?? 1,
    command,
  });
  expect(
    t.call(t.b, 'principals.control', {
      request: control({
        type: 'offer',
        target: { kind: 'public', id: 'town' },
        expiresAt: 1000000,
        terms: '不能转活跃工程',
      }),
    }).ok,
  ).toBe(false);
  t.ok(t.c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + 480000,
  });
  t.time(480000);
  t.ok(t.b, 'principals.operate', {
    request: t.request({
      type: 'manage-premises',
      id: 'home',
      expectedRevision: building().revision,
      command: {
        type: 'configure',
        title: '原使用不变',
        access: { entry: 'listed', visitors: [t.c], operators: [], residents: [] },
      },
    }),
  });
  const original = structuredClone(building());
  t.ok(t.b, 'principals.control', {
    request: control({
      type: 'offer',
      target: { kind: 'public', id: 'town' },
      expiresAt: 2000000,
      terms: '主体交接，保留原使用',
    }),
  });
  expect(t.ok(t.a, 'principals.read', { kind: 'premises', id: 'home' }).data).toMatchObject({
    offer: { target: { kind: 'public', id: 'town' } },
  });
  expect(t.call(t.a, 'principals.control', { request: control({ type: 'accept' }) }).ok).toBe(
    false,
  );
  t.ok(t.d, 'governance.execute', t.publicApprove('accept-building', control({ type: 'accept' })));
  expect(building().control.controller).toEqual({ kind: 'public', id: 'town' });
  expect(
    t.call(t.b, 'premises.close', { id: 'home', expectedRevision: building().revision }).ok,
  ).toBe(false);
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '持有空间',
      terms: '逐项表决',
      members: [t.b, t.c],
      voters: [t.b, t.c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 2000000,
  });
  t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  t.ok(
    t.a,
    'governance.execute',
    t.publicApprove(
      'offer-building',
      control({
        type: 'offer',
        target: { kind: 'collective', id: 'club' },
        expiresAt: 2000000,
        terms: '保留原空间事实',
      }),
    ),
  );
  const request = control({ type: 'accept' });
  expect(t.call(t.b, 'principals.control', { request }).ok).toBe(false);
  t.ok(t.b, 'collectives.propose', {
    id: 'take-building',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '独立接收',
    action: {
      kind: 'resource',
      capability: 'principals.control',
      resourceId: 'home',
      arguments: { request },
    },
    closesAt: t.r.state.world.clock.now + 100000,
    executeBefore: 2000000,
  });
  for (const actor of [t.b, t.c])
    t.ok(actor, 'collectives.vote', {
      id: 'take-building',
      expectedRevision: t.r.state.collectives!.decisions['take-building']!.revision,
      vote: 'yes',
    });
  t.ok(t.b, 'collectives.decide', {
    id: 'take-building',
    expectedRevision: t.r.state.collectives!.decisions['take-building']!.revision,
  });
  t.ok(t.c, 'collectives.execute', {
    id: 'take-building',
    expectedRevision: t.r.state.collectives!.decisions['take-building']!.revision,
  });
  expect(building().control.controller).toEqual({ kind: 'collective', id: 'club' });
  for (const key of [
    'ownerId',
    'siteId',
    'locationId',
    'blueprint',
    'access',
    'embodied',
    'salvage',
    'condition',
    'wearSettledAt',
    'status',
    'footprintReleased',
  ] as const)
    expect(building()[key]).toEqual(original[key]);
  expect(t.project().controller).toEqual(firm);
  t.ok(t.b, 'principals.operate', {
    request: materialOperationRequest(t.stock(), {
      type: 'close-stock',
      id: 's',
      expectedRevision: t.stock().revision,
    }),
  });
  t.ok(t.b, 'world.close_enterprise', { enterpriseId: 'firm' });
  expect(t.r.state.world.enterprises.firm!.status).toBe('closed');
  t.replay();
});
