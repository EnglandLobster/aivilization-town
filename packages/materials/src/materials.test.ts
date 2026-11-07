import { expect, test } from 'vitest';
import { RESOURCE_CONTROL_POLICY, type ControlAuthorizationPort } from '@aivilization/authority';
import type { Inventory } from '@aivilization/economy';
import {
  applyMaterialCommit,
  emptyMaterialsState,
  decideMaterialProduction,
  settleMaterialProduction,
  interruptMaterialProduction,
  decideMaterialStock,
  nextMaterialBoundary,
  assertMaterialsPolicy,
  type MaterialsPolicy,
  type MaterialPorts,
  type MaterialCommand,
  type MaterialDecision,
  type MaterialEvent,
} from './index';
const policy: MaterialsPolicy = {
  version: 'resident-materials-v1',
  control: RESOURCE_CONTROL_POLICY,
  maxStocksPerController: 3,
  maxStocks: 10,
  maxJobsPerStock: 20,
  maxJobs: 30,
  maxKinds: 8,
  maxQuantity: 100,
  maxBatch: 20,
  maxWorkers: 4,
  maxShiftMs: 8000,
  settlementIntervalMs: 100,
  recipes: [
    {
      id: 'boards',
      version: 'boards-v1',
      inputs: { Wood: 2 },
      outputs: { Board: 1 },
      workMs: 1000,
      energyCost: 6,
      satietyCost: 4,
      minResidentialTier: 1,
    },
  ],
};
function setup(p = policy) {
  let state = emptyMaterialsState(p),
    at = 0,
    n = 0;
  const inventories: Record<string, Inventory> = { a: { Wood: 20 }, b: { Wood: 5 }, c: {} };
  const bodies: Record<
    string,
    { energy: number; satiety: number; residentialTier: number; capable: boolean }
  > = Object.fromEntries(
    ['a', 'b', 'c'].map((id) => [
      id,
      { energy: 100, satiety: 100, residentialTier: 1, capable: true },
    ]),
  );
  const locations: Record<string, string> = { a: 'site', b: 'site', c: 'remote' },
    busy: Record<string, { startedAt: number; until: number }> = {};
  const commits: (readonly MaterialEvent[])[] = [];
  let external = false,
    authorize: ControlAuthorizationPort = () => undefined;
  const ports: MaterialPorts = {
    exists: (id) => !!bodies[id],
    present: (id, loc) => locations[id] === loc,
    idle: (id) => !busy[id] || busy[id].until <= at,
    mayStoreAt: () => true,
    inventory: (id) => inventories[id] ?? {},
    body: (id) => bodies[id],
    controlAvailable: (c) => (c.kind === 'resident' ? !!bodies[c.id] : c.id === 'club'),
    authorize: (c) => authorize(c),
    hasExternalObligation: () => external,
    sessionReserved: (j) =>
      !!j.session &&
      busy[j.session.actorId]?.startedAt === j.session.startedAt &&
      busy[j.session.actorId]?.until === j.session.until,
  };
  function apply(d: MaterialDecision) {
    if (d.accepted) {
      const v = applyMaterialCommit(state, d.events);
      for (const [id, delta] of Object.entries(v.residentDeltas)) {
        const inventory = { ...inventories[id] };
        for (const [item, q] of Object.entries(delta)) {
          inventory[item] = (inventory[item] ?? 0) + q;
          expect(inventory[item]).toBeGreaterThanOrEqual(0);
        }
        inventories[id] = inventory;
      }
      for (const e of v.efforts) {
        bodies[e.actorId]!.energy -= e.energyCost;
        bodies[e.actorId]!.satiety -= e.satietyCost;
      }
      if (d.reservation)
        busy[d.reservation.actorId] = { startedAt: at, until: d.reservation.until };
      if (d.release) delete busy[d.release.actorId];
      state = v.state;
      commits.push(d.events);
    }
    return d;
  }
  const call = (actor: string, c: MaterialCommand): MaterialDecision =>
    apply(
      c.type === 'create-production' ||
        c.type === 'create-extraction' ||
        c.type === 'start-production' ||
        c.type === 'leave-production' ||
        c.type === 'cancel-production'
        ? decideMaterialProduction(state, actor, at, `r${++n}`, c, ports)
        : decideMaterialStock(state, actor, at, `r${++n}`, c, ports),
    );
  const stock = () => state.stocks.s!,
    job = () => state.productions.j!;
  const ok = (actor: string, c: MaterialCommand) => {
    const d = call(actor, c);
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    return d;
  };
  ok('a', { type: 'create-stock', id: 's', title: '自己的原料', locationId: 'site' });
  const seed = (amount = 6) => {
    ok('a', {
      type: 'deposit',
      id: 's',
      expectedRevision: stock().revision,
      items: { Wood: amount },
    });
  };
  const create = () =>
    ok('a', {
      type: 'create-production',
      id: 'j',
      stockId: 's',
      expectedRevision: stock().revision,
      recipeId: 'boards',
      quantity: 3,
      workers: ['a', 'b'],
      productName: '居民选择的名称',
      description: '不会因名称改变物理配方',
    });
  return {
    call,
    ok,
    seed,
    create,
    stock,
    job,
    bodies,
    inventories,
    locations,
    busy,
    ports,
    get state() {
      return state;
    },
    get at() {
      return at;
    },
    setTime: (t: number) => {
      at = t;
    },
    setAuthority: (a: ControlAuthorizationPort) => {
      authorize = a;
    },
    setExternal: (b: boolean) => {
      external = b;
    },
    tick: (t: number) => {
      at = t;
      return apply(settleMaterialProduction(state, 'j', at, `r${++n}`, 'system', ports));
    },
    replay: () => {
      let s = emptyMaterialsState(p);
      for (const events of commits) s = applyMaterialCommit(s, events).state;
      expect(s).toEqual(state);
    },
  };
}
test('stock contributions and withdrawals require actual material, location, explicit use and current authority', () => {
  const t = setup();
  t.seed();
  expect(t.inventories.a!.Wood).toBe(14);
  expect(t.stock().inventory.Wood).toBe(6);
  expect(
    t.call('b', {
      type: 'deposit',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: 1 },
    }),
  ).toMatchObject({ accepted: false, reason: 'material-contribution-not-authorized' });
  t.ok('a', {
    type: 'configure-stock',
    id: 's',
    expectedRevision: t.stock().revision,
    contributors: ['b'],
    readers: ['b'],
  });
  t.ok('b', { type: 'deposit', id: 's', expectedRevision: t.stock().revision, items: { Wood: 1 } });
  expect(
    t.call('b', {
      type: 'withdraw',
      recipientId: 'b',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: 1 },
    }).accepted,
  ).toBe(false);
  t.locations.a = 'remote';
  expect(
    t.call('a', {
      type: 'withdraw',
      recipientId: 'a',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: 1 },
    }).accepted,
  ).toBe(false);
  t.locations.a = 'site';
  t.ok('a', {
    type: 'withdraw',
    recipientId: 'a',
    id: 's',
    expectedRevision: t.stock().revision,
    items: { Wood: 2 },
  });
  expect(t.stock().inventory.Wood! + t.inventories.a!.Wood! + t.inventories.b!.Wood!).toBe(25);
  t.replay();
});
test('material handover requires target consent; old author and contributor are not permanent controllers', () => {
  const t = setup();
  t.seed();
  t.ok('a', {
    type: 'control-stock',
    id: 's',
    expectedRevision: t.stock().revision,
    control: {
      type: 'offer',
      expectedVersion: 1,
      target: { kind: 'collective', id: 'club' },
      expiresAt: 10000,
      terms: '保留实物',
    },
  });
  expect(
    t.call('b', {
      type: 'control-stock',
      id: 's',
      expectedRevision: t.stock().revision,
      control: { type: 'accept', expectedVersion: 2 },
    }).accepted,
  ).toBe(false);
  t.setAuthority((c) =>
    c.kind === 'collective' && c.id === 'club'
      ? { actorId: 'b', decisionId: 'decision1' }
      : undefined,
  );
  t.ok('b', {
    type: 'control-stock',
    id: 's',
    expectedRevision: t.stock().revision,
    control: { type: 'accept', expectedVersion: 2 },
  });
  expect(
    t.call('a', {
      type: 'withdraw',
      recipientId: 'a',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: 1 },
    }).accepted,
  ).toBe(false);
  t.ok('b', {
    type: 'withdraw',
    recipientId: 'b',
    id: 's',
    expectedRevision: t.stock().revision,
    items: { Wood: 1 },
  });
  expect(t.stock().ownerId).toBe('a');
  expect(t.stock().inventory.Wood).toBe(5);
  t.replay();
});
test('production reserves real inputs, never creates outputs before elapsed work, and workers independently hand over partial progress', () => {
  const t = setup();
  t.seed();
  t.create();
  expect(t.stock().inventory).toEqual({});
  expect(t.job().held).toEqual({ Wood: 6 });
  expect(
    t.call('c', { type: 'start-production', id: 'j', expectedRevision: 1, until: 1000 }).accepted,
  ).toBe(false);
  t.ok('a', { type: 'start-production', id: 'j', expectedRevision: 1, until: 1000 });
  expect(
    t.call('b', { type: 'start-production', id: 'j', expectedRevision: 2, until: 1000 }).accepted,
  ).toBe(false);
  expect(t.tick(600).accepted).toBe(true);
  expect(t.stock().inventory).toEqual({});
  expect(t.job().progressMs).toBe(600);
  expect(t.bodies.a!.energy).toBeCloseTo(96.4);
  t.ok('a', { type: 'leave-production', id: 'j', expectedRevision: t.job().revision });
  t.ok('b', { type: 'start-production', id: 'j', expectedRevision: t.job().revision, until: 3000 });
  t.tick(1000);
  expect(t.stock().inventory.Board).toBe(1);
  expect(t.job().held.Wood).toBe(4);
  t.tick(3000);
  expect(t.job().status).toBe('completed');
  expect(t.job().held).toEqual({});
  expect(t.stock().inventory).toEqual({ Board: 3 });
  expect(t.bodies.b!.energy).toBeCloseTo(85.6);
  expect(t.busy.b).toBeUndefined();
  t.replay();
});
test('cancel preserves completed outputs and actual effort, returns unconsumed escrow and releases only this session', () => {
  const t = setup();
  t.seed();
  t.create();
  t.ok('b', { type: 'start-production', id: 'j', expectedRevision: 1, until: 3000 });
  t.setTime(1500);
  t.ok('a', { type: 'cancel-production', id: 'j', expectedRevision: t.job().revision });
  expect(t.job()).toMatchObject({ status: 'cancelled', completed: 1, progressMs: 1500, held: {} });
  expect(t.stock().inventory).toEqual({ Wood: 4, Board: 1 });
  expect(t.bodies.b!.energy).toBe(91);
  expect(t.busy.b).toBeUndefined();
  t.replay();
});
test('a controller cannot start or leave another persons work; inconsistent world reservation yields no unearned progress', () => {
  const t = setup();
  t.seed();
  t.create();
  t.ok('b', { type: 'start-production', id: 'j', expectedRevision: 1, until: 2000 });
  expect(
    t.call('a', { type: 'leave-production', id: 'j', expectedRevision: t.job().revision }),
  ).toMatchObject({ accepted: false, reason: 'personal-production-participation-required' });
  t.busy.b = { startedAt: 50, until: 3000 };
  t.tick(1000);
  expect(t.busy.b).toEqual({ startedAt: 50, until: 3000 });
  expect(t.job().progressMs).toBe(0);
  expect(t.job().session).toBeUndefined();
  expect(t.stock().inventory).toEqual({});
  t.replay();
});
test('finite body budget stops exhausted work and never charges negative effort or continues beyond the reserved interval', () => {
  const t = setup();
  t.seed();
  t.create();
  t.ok('a', { type: 'start-production', id: 'j', expectedRevision: 1, until: 2000 });
  t.bodies.a!.energy = 3;
  t.tick(1000);
  expect(t.job().progressMs).toBe(500);
  expect(t.job().session).toBeUndefined();
  expect(t.job().lastStop?.reason).toBe('effort-exhausted');
  expect(t.bodies.a!.energy).toBe(0);
  expect(t.stock().inventory).toEqual({});
  t.setTime(1000);
  expect(
    t.call('a', {
      type: 'start-production',
      id: 'j',
      expectedRevision: t.job().revision,
      until: 2000,
    }).accepted,
  ).toBe(false);
  t.replay();
});
test('settlement blocks new contributions and orders, but material recovery and closing remain possible after obligations clear', () => {
  const t = setup();
  t.seed();
  t.create();
  t.ok('a', { type: 'settle-stock', id: 's', expectedRevision: t.stock().revision });
  expect(
    t.call('a', {
      type: 'deposit',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: 1 },
    }).accepted,
  ).toBe(false);
  expect(
    t.call('a', { type: 'close-stock', id: 's', expectedRevision: t.stock().revision }).accepted,
  ).toBe(false);
  t.ok('a', { type: 'cancel-production', id: 'j', expectedRevision: t.job().revision });
  t.ok('a', {
    type: 'withdraw',
    recipientId: 'a',
    id: 's',
    expectedRevision: t.stock().revision,
    items: { Wood: 6 },
  });
  t.setExternal(true);
  expect(
    t.call('a', { type: 'close-stock', id: 's', expectedRevision: t.stock().revision }).accepted,
  ).toBe(false);
  t.setExternal(false);
  t.ok('a', { type: 'close-stock', id: 's', expectedRevision: t.stock().revision });
  t.replay();
});
test('incoming deposits cannot steal headroom needed for future output or cancellation refunds', () => {
  const t = setup({ ...policy, maxQuantity: 6 });
  t.seed();
  t.create();
  expect(
    t.call('a', {
      type: 'deposit',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: 1 },
    }),
  ).toMatchObject({ accepted: false, reason: 'material-stock-capacity' });
  t.ok('a', { type: 'cancel-production', id: 'j', expectedRevision: 1 });
  expect(t.stock().inventory.Wood).toBe(6);
  t.replay();
});
test('chunked progress has the same physical result and effort, with exact finite cadence boundaries', () => {
  const a = setup(),
    b = setup();
  for (const t of [a, b]) {
    t.seed();
    t.create();
    t.ok('a', { type: 'start-production', id: 'j', expectedRevision: 1, until: 3000 });
  }
  expect(nextMaterialBoundary(a.state, 0)).toBe(100);
  a.tick(3000);
  for (const at of [100, 315, 700, 1000, 2234, 3000]) b.tick(at);
  expect(a.stock().inventory).toEqual(b.stock().inventory);
  expect(a.job().held).toEqual(b.job().held);
  expect(a.job().progressMs).toBe(b.job().progressMs);
  expect(a.bodies.a!.energy).toBeCloseTo(b.bodies.a!.energy, 8);
  expect(nextMaterialBoundary(a.state, 3000)).toBeUndefined();
  a.replay();
  b.replay();
});
test('invalid policy, values, revisions and forged conversion/effort facts fail without a partial stock change', () => {
  expect(() =>
    assertMaterialsPolicy({ ...policy, recipes: [{ ...policy.recipes[0]!, inputs: {} }] }),
  ).toThrow('invalid-materials-policy');
  const t = setup();
  t.seed();
  const before = t.state;
  expect(
    t.call('a', {
      type: 'withdraw',
      recipientId: 'a',
      id: 's',
      expectedRevision: 1,
      items: { Wood: 1 },
    }).accepted,
  ).toBe(false);
  expect(
    t.call('a', {
      type: 'deposit',
      id: 's',
      expectedRevision: t.stock().revision,
      items: { Wood: NaN },
    }).accepted,
  ).toBe(false);
  expect(t.state).toEqual(before);
  expect(() =>
    applyMaterialCommit(t.state, [
      {
        type: 'MaterialStockChanged',
        stock: { ...t.stock(), revision: t.stock().revision + 1, inventory: { Wood: 100 } },
      },
    ]),
  ).toThrow('material-stock-flow-mismatch');
  t.create();
  expect(() =>
    applyMaterialCommit(t.state, [
      {
        type: 'MaterialProductionChanged',
        production: { ...t.job(), revision: 2, progressMs: 1000, completed: 1 },
      },
    ]),
  ).toThrow('material-production-flow-mismatch');
  t.replay();
});

test.each([0, 500])(
  'system interruption freezes exactly settled work at %s without changing held goods',
  (at) => {
    const t = setup();
    t.seed();
    t.create();
    t.ok('a', {
      type: 'start-production',
      id: 'j',
      expectedRevision: t.job().revision,
      until: 3000,
    });
    if (at) t.tick(at);
    const before = structuredClone(t.state);
    const d = interruptMaterialProduction(t.state, 'j', at, 'system-interruption');
    if (!d.accepted) throw Error(d.reason);
    expect(d.release).toEqual(t.job().session);
    const next = applyMaterialCommit(t.state, d.events).state;
    expect(next.productions.j!.session).toBeUndefined();
    expect(next.productions.j!.lastStop).toEqual({
      actorId: 'a',
      at,
      reason: 'worker-unavailable',
    });
    expect(next.productions.j!.held).toEqual(t.job().held);
    expect(next.productions.j!.progressMs).toBe(t.job().progressMs);
    expect(next.stocks).toEqual(t.state.stocks);
    expect(next.receipts['system-interruption']).toMatchObject({
      actorId: 'system',
      operation: 'production-interrupted-v1',
      efforts: [],
      conversions: [],
      transfers: [],
    });
    expect(t.state).toEqual(before);
    expect(applyMaterialCommit(before, d.events).state).toEqual(next);
    expect(() => applyMaterialCommit(next, d.events)).toThrow();
    expect(interruptMaterialProduction(t.state, 'j', at + 1, 'unsettled')).toMatchObject({
      accepted: false,
      reason: 'material-interruption-needs-settled-boundary',
    });
    expect(interruptMaterialProduction(next, 'j', at, 'again')).toMatchObject({
      accepted: false,
      reason: 'active-material-work-required',
    });
    const changed = d.events[0]!;
    if (changed.type !== 'MaterialProductionChanged') throw Error('missing-change');
    expect(() =>
      applyMaterialCommit(before, [
        {
          ...changed,
          production: { ...changed.production, progressMs: changed.production.progressMs + 1 },
        },
        ...d.events.slice(1),
      ]),
    ).toThrow('material-interruption-changed-work-or-assets');
    const receipt = d.events[1]!;
    if (receipt.type !== 'MaterialReceiptRecorded') throw Error('missing-receipt');
    expect(() =>
      applyMaterialCommit(before, [
        changed,
        { ...receipt, receipt: { ...receipt.receipt, actorId: 'a' } },
      ]),
    ).toThrow('material-interruption-source-mismatch');
  },
);
