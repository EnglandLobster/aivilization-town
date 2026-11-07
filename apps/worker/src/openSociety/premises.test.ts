import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import {
  openPremisesFixture as fixture,
  premisesCleanup as cleanup,
} from './testFixtures/openPremises';
test('resident tools bind donor consent, settle elapsed construction, expose only authorized detail, and survive journal restart', () => {
  const t = fixture();
  t.reserve();
  expect(t.call(t.d, 'materials.read', { id: 'r' }).error).toBe(
    'material-reservation-not-readable',
  );
  t.create();
  expect(t.call(t.a, 'materials.withdraw', { id: 'r', expectedRevision: 2 }).error).toBe(
    'material-reservation-not-offered',
  );
  expect(t.call(t.d, 'construction.read', { id: 'p' }).error).toBe('construction-not-readable');
  expect(
    t.call(t.a, 'construction.start', {
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
  t.time(120000);
  expect(t.r.state.world.premises!.buildings).toEqual({});
  expect(t.project().progressMs).toBe(120000);
  t.ok(t.c, 'construction.leave', { id: 'p', expectedRevision: t.project().revision });
  t.ok(t.b, 'construction.start', {
    id: 'p',
    expectedRevision: t.project().revision,
    until: t.r.state.world.clock.now + 360000,
  });
  t.time(360000);
  expect(t.project().status).toBe('completed');
  expect(t.stock().inventory).toEqual({});
  expect(t.r.state.world.locations['premises-home']!.capacity).toBe(2);
  const detail = t.ok(t.b, 'premises.read', { id: 'home' }).data;
  expect(detail).toMatchObject({ embodied: { Wood: 8 } });
  expect(t.ok(t.d, 'premises.read', { id: 'home' }).data).not.toHaveProperty('access');
  const state = t.r.state;
  t.r.close();
  const reopened = new OpenSocietyRuntime(t.root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(state);
  const journal = readFileSync(join(t.root, 'journal.jsonl'), 'utf8');
  expect(journal).toContain('ResidentPremisesCommitted');
});
test('unbound offers expire at a simulated boundary and return exactly once; schema guards reject invented fields and effects', () => {
  const t = fixture();
  t.reserve(t.r.state.world.clock.now + 5000);
  t.time(5000);
  expect(t.r.state.world.materials!.reservations!.records.r).toMatchObject({
    status: 'settled',
    held: {},
    returned: { Wood: 8 },
  });
  expect(t.stock().inventory.Wood).toBe(8);
  const revision = t.stock().revision;
  t.time(5000);
  expect(t.stock().revision).toBe(revision);
  expect(
    t.call(t.b, 'construction.create', {
      id: 'p',
      kind: 'build',
      buildingId: 'home',
      siteId: t.site!.id,
      expectedSiteRevision: 1,
      controllerKind: 'resident',
      controllerId: t.b,
      title: '房屋',
      description: '正文',
      workers: [t.b],
      reservationRefs: ['r@1'],
      ...t.blueprint,
      freeMaterials: true,
    }).ok,
  ).toBe(false);
  expect(t.r.state.world.premises!.projects).toEqual({});
});
test('a collective separately accepts stock control and authorizes exact material and building actions; its members still start personally', () => {
  const t = fixture();
  let n = 0;
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同建设',
      terms: '自己确定用途和协作程序',
      members: [t.b, t.c],
      voters: [t.b, t.c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: t.r.state.world.clock.now + 10000000,
  });
  t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  const proposal = (capability: string, resourceId: string, args: Record<string, unknown>) => {
    const id = `decision${++n}`;
    t.ok(t.b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: t.r.state.collectives!.charters.club!.version,
      terms: '精确资源操作',
      action: { kind: 'resource', capability, resourceId, arguments: args },
      closesAt: t.r.state.world.clock.now + 10000,
      executeBefore: t.r.state.world.clock.now + 1000000,
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
    return id;
  };
  const execute = (id: string) =>
    t.ok(t.c, 'collectives.execute', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    });
  t.ok(t.a, 'stocks.create', { id: 's', title: '共同材料', locationId: t.location });
  t.ok(t.a, 'stocks.deposit', { id: 's', expectedRevision: 1, items: { Wood: 8 } });
  t.ok(t.a, 'stocks.offer', {
    id: 's',
    expectedRevision: 2,
    expectedControlVersion: 1,
    targetKind: 'collective',
    targetId: 'club',
    terms: '材料保管交接',
    expiresAt: t.r.state.world.clock.now + 1000000,
  });
  execute(
    proposal('stocks.accept', 's', {
      expectedRevision: t.stock().revision,
      expectedControlVersion: t.stock().control.version,
    }),
  );
  execute(
    proposal('materials.reserve', 'r', {
      stockId: 's',
      expectedStockRevision: t.stock().revision,
      beneficiaryKind: 'collective',
      beneficiaryId: 'club',
      consumerDomain: 'premises',
      consumerId: 'p',
      items: { Wood: 8 },
      terms: '明确用途',
      expiresAt: t.r.state.world.clock.now + 1000000,
    }),
  );
  const create = proposal('construction.create', 'p', {
    kind: 'build',
    buildingId: 'home',
    siteId: t.site!.id,
    expectedSiteRevision: 1,
    controllerKind: 'collective',
    controllerId: 'club',
    title: '共同房屋',
    description: '合住由后续具体授权决定',
    workers: [t.b, t.c],
    reservationRefs: ['r@1'],
    ...t.blueprint,
  });
  execute(create);
  expect(t.r.state.world.premises!.projects.p!.decisionId).toBe(create);
  expect(t.project().session).toBeUndefined();
  expect(
    t.call(t.b, 'collectives.propose', {
      id: 'force',
      collectiveId: 'club',
      expectedVersion: t.r.state.collectives!.charters.club!.version,
      terms: '不能代人工作',
      action: {
        kind: 'resource',
        capability: 'construction.start',
        resourceId: 'p',
        arguments: { expectedRevision: 1, until: t.r.state.world.clock.now + 480000 },
      },
      closesAt: t.r.state.world.clock.now + 10000,
      executeBefore: t.r.state.world.clock.now + 1000000,
    }).ok,
  ).toBe(false);
  t.ok(t.b, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + 480000,
  });
  t.time(480000);
  expect(t.r.state.world.premises!.buildings.home!.control.controller).toEqual({
    kind: 'collective',
    id: 'club',
  });
  expect(t.call(t.b, 'world.move', { targetLocationId: 'premises-home' }).error).toContain(
    'premises-entry-not-authorized',
  );
  execute(
    proposal('premises.configure', 'home', {
      expectedRevision: 1,
      title: '共同房屋',
      entry: 'listed',
      visitors: [],
      operators: [],
      residents: [t.b],
    }),
  );
  t.ok(t.b, 'world.move', { targetLocationId: 'premises-home' });
});
function factory(facilityUse = true) {
  const t = fixture(true, facilityUse, {
    primaryUse: 'production',
    workstations: 1,
    storageUnits: 10,
  });
  t.reserve(undefined, { Wood: 8.1, 'Iron Ingot': 1 });
  t.create();
  t.ok(t.c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + t.project().plan.workMs,
  });
  t.time(t.project().plan.workMs);
  t.ok(t.b, 'premises.configure', {
    id: 'home',
    expectedRevision: 1,
    title: '名字自己选',
    entry: 'listed',
    visitors: [],
    operators: [t.b, t.c],
    residents: [],
  });
  const travel = (actor: string) => {
    t.ok(actor, 'world.move', { targetLocationId: 'premises-home' });
    t.time(t.r.state.world.activityTimeByAgent[actor]!.availableAt - t.r.state.world.clock.now);
  };
  travel(t.b);
  travel(t.c);
  t.ok(t.b, 'stocks.create', { id: 's1', title: '第一个库存', locationId: 'premises-home' });
  t.ok(t.c, 'stocks.create', { id: 's2', title: '第二个库存', locationId: 'premises-home' });
  return t;
}
test('built storage limits aggregate all stocks and reserve future outputs; a real workstation is shared across distinct people and releases on personal leave', () => {
  const t = factory();
  t.ok(t.b, 'stocks.deposit', { id: 's1', expectedRevision: 1, items: { Wood: 6 } });
  t.ok(t.c, 'stocks.deposit', { id: 's2', expectedRevision: 1, items: { Wood: 4 } });
  expect(
    t.call(t.c, 'stocks.deposit', { id: 's2', expectedRevision: 2, items: { Wood: 1 } }).error,
  ).toBe('material-stock-capacity');
  const createJob = (actor: string, id: string, stockId: string) => ({
    id,
    stockId,
    expectedRevision: t.r.state.world.materials!.stocks[stockId]!.revision,
    recipeId: 'book',
    quantity: 1,
    productName: '作品',
    description: '原话',
    workers: [actor],
  });
  expect(t.call(t.b, 'production.create', createJob(t.b, 'j1', 's1')).error).toBe(
    'material-stock-capacity',
  );
  t.ok(t.b, 'stocks.withdraw', {
    id: 's1',
    expectedRevision: 2,
    recipientId: t.b,
    items: { Wood: 2 },
  });
  t.ok(t.b, 'production.create', createJob(t.b, 'j1', 's1'));
  t.ok(t.c, 'production.create', createJob(t.c, 'j2', 's2'));
  expect(
    t.call(t.c, 'stocks.deposit', {
      id: 's2',
      expectedRevision: t.r.state.world.materials!.stocks.s2!.revision,
      items: { Wood: 0.1 },
    }).error,
  ).toBe('material-stock-capacity');
  const duration = t.r.state.world.materials!.productions.j1!.recipe.workMs;
  t.ok(t.b, 'production.start', {
    id: 'j1',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + duration,
  });
  expect(
    t.call(t.c, 'production.start', {
      id: 'j2',
      expectedRevision: 1,
      until: t.r.state.world.clock.now + duration,
    }).error,
  ).toBe('production-workstation-unavailable');
  t.ok(t.b, 'production.leave', { id: 'j1', expectedRevision: 2 });
  t.ok(t.c, 'production.start', {
    id: 'j2',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + duration,
  });
  t.time(duration);
  expect(t.r.state.world.materials!.productions.j2!.status).toBe('completed');
  expect(t.r.state.world.materials!.stocks.s2!.inventory.Book).toBe(1);
  t.ok(t.b, 'production.start', {
    id: 'j1',
    expectedRevision: t.r.state.world.materials!.productions.j1!.revision,
    until: t.r.state.world.clock.now + duration,
  });
  t.time(duration);
  expect(t.r.state.world.materials!.stocks.s1!.inventory.Book).toBe(1);
  const expected = t.r.state;
  t.r.close();
  const reopened = new OpenSocietyRuntime(t.root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(expected);
});
test('external material offers retain physical return space, and losing operating authority stops future work without taking the worker stock', () => {
  const t = factory();
  t.ok(t.b, 'stocks.deposit', { id: 's1', expectedRevision: 1, items: { Wood: 8 } });
  t.ok(t.b, 'materials.reserve', {
    id: 'space-held',
    stockId: 's1',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: t.b,
    consumerDomain: 'premises',
    consumerId: 'future-project',
    items: { Wood: 2 },
    terms: '保留退回位置',
    expiresAt: t.r.state.world.clock.now + 1000000,
  });
  expect(
    t.call(t.c, 'stocks.deposit', { id: 's2', expectedRevision: 1, items: { Wood: 3 } }).error,
  ).toBe('material-stock-capacity');
  t.ok(t.c, 'stocks.deposit', { id: 's2', expectedRevision: 1, items: { Wood: 2 } });
  t.ok(t.b, 'materials.withdraw', { id: 'space-held', expectedRevision: 1 });
  expect(t.r.state.world.materials!.stocks.s1!.inventory.Wood).toBe(8);
  t.ok(t.b, 'stocks.withdraw', {
    id: 's1',
    expectedRevision: t.r.state.world.materials!.stocks.s1!.revision,
    recipientId: t.b,
    items: { Wood: 1 },
  });
  t.ok(t.c, 'production.create', {
    id: 'j',
    stockId: 's2',
    expectedRevision: 2,
    recipeId: 'book',
    quantity: 1,
    productName: '作品',
    description: '实际投入',
    workers: [t.c],
  });
  const duration = t.r.state.world.materials!.productions.j!.recipe.workMs;
  t.ok(t.c, 'production.start', {
    id: 'j',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + duration,
  });
  t.time(1000);
  const progress = t.r.state.world.materials!.productions.j!.progressMs;
  t.ok(t.b, 'premises.configure', {
    id: 'home',
    expectedRevision: t.r.state.world.premises!.buildings.home!.revision,
    title: '用途不变',
    entry: 'listed',
    visitors: [],
    operators: [t.b],
    residents: [],
  });
  t.time(1000);
  expect(t.r.state.world.materials!.productions.j).toMatchObject({
    progressMs: progress,
    lastStop: { reason: 'facility-unavailable' },
    held: { Wood: 1 },
  });
  expect(t.r.state.world.materials!.productions.j!.session).toBeUndefined();
  t.ok(t.c, 'production.cancel', {
    id: 'j',
    expectedRevision: t.r.state.world.materials!.productions.j!.revision,
  });
  expect(t.r.state.world.materials!.stocks.s2!.inventory.Wood).toBe(2);
  t.ok(t.c, 'stocks.withdraw', {
    id: 's2',
    expectedRevision: t.r.state.world.materials!.stocks.s2!.revision,
    recipientId: t.c,
    items: { Wood: 2 },
  });
});
test('an empty custody record in a zero-storage building cannot manufacture physical storage by its name', () => {
  const t = fixture();
  t.reserve();
  t.create();
  t.ok(t.c, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + 480000,
  });
  t.time(480000);
  t.ok(t.b, 'world.move', { targetLocationId: 'premises-home' });
  t.time(t.r.state.world.activityTimeByAgent[t.b]!.availableAt - t.r.state.world.clock.now);
  t.ok(t.b, 'stocks.create', {
    id: 'warehouse',
    title: '任意名称都不是仓库',
    locationId: 'premises-home',
  });
  expect(
    t.call(t.b, 'stocks.deposit', { id: 'warehouse', expectedRevision: 1, items: { Wood: 0.1 } })
      .error,
  ).toBe('material-stock-capacity');
  expect(t.r.state.world.materials!.stocks.warehouse!.inventory).toEqual({});
});
