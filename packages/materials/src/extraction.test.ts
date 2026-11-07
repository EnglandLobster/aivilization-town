import { expect, test } from 'vitest';
import {
  applyMaterialCommit,
  createMaterialsPolicy,
  emptyMaterialsState,
  decideMaterialStock,
  decideMaterialProduction,
  settleMaterialProduction,
  isProductionCommand,
  MATERIAL_EXTRACTION_POLICY,
  materialSourceWorkAvailable,
  materialSourceLaborCapacity,
  type MaterialSource,
  type MaterialCommand,
  type MaterialDecision,
  type MaterialEvent,
  type MaterialPorts,
} from './index';

const source: MaterialSource = {
  id: 'wood',
  commodity: 'Wood',
  locationId: 'site',
  initialQuantity: 5,
  remaining: 5,
  workMs: 1000,
  energyCost: 4,
  satietyCost: 2,
  capacity: 1,
  revision: 1,
  at: 0,
};
function fixture() {
  const initial = emptyMaterialsState(
    createMaterialsPolicy([
      {
        id: 'board',
        version: 'board-v1',
        inputs: { Wood: 1 },
        outputs: { Board: 1 },
        workMs: 1000,
        energyCost: 4,
        satietyCost: 1,
        minResidentialTier: 1,
      },
    ]),
  );
  let s = initial,
    at = 0,
    n = 0;
  const batches: (readonly MaterialEvent[])[] = [];
  const body = { energy: 100, satiety: 100, residentialTier: 1, capable: true };
  const busy: Record<string, { startedAt: number; until: number }> = {};
  const ports: MaterialPorts = {
    exists: (id) => ['a', 'b'].includes(id),
    present: () => true,
    idle: (id) => !busy[id] || busy[id].until <= at,
    mayStoreAt: () => true,
    inventory: () => ({}),
    body: () => body,
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: (j) =>
      !!j.session &&
      busy[j.session.actorId]?.startedAt === j.session.startedAt &&
      busy[j.session.actorId]?.until === j.session.until,
    workstationAvailable: (id, actor) => materialSourceWorkAvailable(s, id, actor, at),
  };
  const commit = (events: readonly MaterialEvent[]) => {
    const v = applyMaterialCommit(s, events);
    for (const e of v.efforts) {
      body.energy -= e.energyCost;
      body.satiety -= e.satietyCost;
    }
    s = v.state;
    batches.push(events);
    if (s.extraction)
      expect(
        s.extraction.sources.wood!.remaining +
          Object.values(s.productions).reduce((sum, j) => sum + (j.held.Wood ?? 0), 0) +
          Object.values(s.stocks).reduce((sum, v) => sum + (v.inventory.Wood ?? 0), 0),
      ).toBe(5);
  };
  const apply = (d: MaterialDecision) => {
    if (d.accepted) {
      commit(d.events);
      if (d.reservation)
        busy[d.reservation.actorId] = { startedAt: at, until: d.reservation.until };
      if (d.release) delete busy[d.release.actorId];
    }
    return d;
  };
  const call = (actor: string, c: MaterialCommand) =>
    apply(
      isProductionCommand(c)
        ? decideMaterialProduction(s, actor, at, `r${++n}`, c, ports)
        : decideMaterialStock(s, actor, at, `r${++n}`, c, ports),
    );
  const ok = (actor: string, c: MaterialCommand) => {
    const d = call(actor, c);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    return d;
  };
  commit([
    { type: 'MaterialExtractionEnabled', policy: MATERIAL_EXTRACTION_POLICY, sources: [source] },
  ]);
  for (const actor of ['a', 'b'])
    ok(actor, { type: 'create-stock', id: actor, locationId: 'site', title: actor });
  const create = (actor = 'a', id = 'job', quantity = 3) =>
    call(actor, {
      type: 'create-extraction',
      id,
      stockId: actor,
      expectedRevision: s.stocks[actor]!.revision,
      sourceId: 'wood',
      sourceRevision: s.extraction!.sources.wood!.revision,
      quantity,
      workers: [actor],
      productName: '居民任意命名',
      description: '',
    });
  const op = (
    type: 'start-production' | 'leave-production' | 'cancel-production',
    actor = 'a',
    id = 'job',
    until = 3000,
  ) =>
    ok(
      actor,
      type === 'start-production'
        ? { type, id, expectedRevision: s.productions[id]!.revision, until }
        : { type, id, expectedRevision: s.productions[id]!.revision },
    );
  const tick = (to: number) => {
    at = to;
    return apply(settleMaterialProduction(s, 'job', at, `r${++n}`, 'system', ports));
  };
  return {
    get s() {
      return s;
    },
    body,
    initial,
    batches,
    ports,
    call,
    ok,
    commit,
    create,
    op,
    tick,
    time: (v: number) => {
      at = v;
    },
    replay: () =>
      expect(
        batches.reduce((state, batch) => applyMaterialCommit(state, batch).state, initial),
      ).toEqual(s),
  };
}
test('finite resources require actual labor, partial work can resume, and cancellation returns unearned material to source', () => {
  const f = fixture();
  expect(f.create().accepted).toBe(true);
  expect(f.s.extraction!.sources.wood!.remaining).toBe(2);
  expect(f.s.stocks.a!.inventory).toEqual({});
  f.op('start-production');
  f.tick(400);
  expect(f.s.stocks.a!.inventory).toEqual({});
  f.op('leave-production');
  expect(f.s.productions.job!.progressMs).toBe(400);
  f.time(700);
  f.op('start-production', 'a', 'job', 3300);
  f.tick(1300);
  expect(f.s.stocks.a!.inventory).toEqual({ Wood: 1 });
  f.op('cancel-production');
  expect(f.s.extraction!.sources.wood!.remaining).toBe(4);
  expect(f.s.productions.job!.held).toEqual({});
  expect(f.body.energy).toBeCloseTo(96, 8);
  f.replay();
});
test('source revision, finite availability, independent stock authority and simultaneous source capacity cannot be bypassed', () => {
  const f = fixture();
  expect(f.create().accepted).toBe(true);
  expect(f.create('b', 'other', 3)).toMatchObject({
    accepted: false,
    reason: 'insufficient-material-source',
  });
  expect(f.create('b', 'other', 2).accepted).toBe(true);
  f.op('start-production');
  expect(
    f.call('b', { type: 'start-production', id: 'other', expectedRevision: 1, until: 2000 }),
  ).toMatchObject({ accepted: false, reason: 'material-source-labor-capacity-unavailable' });
  expect(
    f.call('b', {
      type: 'cancel-production',
      id: 'job',
      expectedRevision: f.s.productions.job!.revision,
    }).accepted,
  ).toBe(false);
  expect(
    f.call('a', {
      type: 'withdraw',
      id: 'a',
      expectedRevision: f.s.stocks.a!.revision,
      recipientId: 'a',
      items: { Wood: 1 },
    }).accepted,
  ).toBe(false);
  f.tick(3000);
  expect(f.s.stocks.a!.inventory).toEqual({ Wood: 3 });
  f.time(3000);
  f.op('start-production', 'b', 'other', 5000);
  f.replay();
});
test('source seeds and cancellation flows reject forged material creation, direct harvest and policy changes', () => {
  const f = fixture();
  expect(() =>
    f.commit([
      { type: 'MaterialExtractionEnabled', policy: MATERIAL_EXTRACTION_POLICY, sources: [source] },
    ]),
  ).toThrow();
  expect(() =>
    applyMaterialCommit(f.initial, [
      {
        type: 'MaterialExtractionEnabled',
        policy: MATERIAL_EXTRACTION_POLICY,
        sources: [{ ...source, remaining: 6 }],
      },
    ]),
  ).toThrow();
  expect(() =>
    f.commit([{ type: 'MaterialSourceChanged', source: { ...source, revision: 2, remaining: 4 } }]),
  ).toThrow('material-source-flow-mismatch');
  expect(f.create().accepted).toBe(true);
  const job = f.s.productions.job!,
    stock = f.s.stocks.a!;
  expect(() =>
    applyMaterialCommit(f.s, [
      {
        type: 'MaterialProductionChanged',
        production: { ...job, status: 'cancelled', held: {}, revision: job.revision + 1 },
      },
      {
        type: 'MaterialStockChanged',
        stock: { ...stock, inventory: { Wood: 3 }, revision: stock.revision + 1 },
      },
      {
        type: 'MaterialReceiptRecorded',
        receipt: {
          id: 'forged',
          actorId: 'a',
          at: 0,
          operation: 'cancel-production',
          stockId: 'a',
          productionId: 'job',
          transfers: [
            {
              from: { kind: 'production', id: 'job' },
              to: { kind: 'stock', id: 'a' },
              items: { Wood: 3 },
            },
          ],
          conversions: [],
          efforts: [],
        },
      },
    ]),
  ).toThrow();
  f.replay();
});
test('split and combined actual work produce equal resource and effort results', () => {
  const run = (steps: number[]) => {
    const f = fixture();
    f.create();
    f.op('start-production');
    for (const t of steps) f.tick(t);
    f.replay();
    return {
      stock: f.s.stocks.a!.inventory,
      remaining: f.s.extraction!.sources.wood!.remaining,
      body: f.body,
      held: f.s.productions.job!.held,
      completed: f.s.productions.job!.completed,
    };
  };
  expect(run([250, 500, 1000, 1600, 3000])).toEqual(run([3000]));
});

test('unused source reservations expire without awarding goods or erasing completed labor', () => {
  const f = fixture();
  f.create();
  f.tick(MATERIAL_EXTRACTION_POLICY.reservationDurationMs);
  expect(f.s.extraction!.sources.wood!.remaining).toBe(5);
  expect(f.s.stocks.a!.inventory).toEqual({});
  expect(f.s.productions.job!.status).toBe('cancelled');
  f.replay();
});

test('declared endowment provenance replays without changing stock and old events keep provenance absent', () => {
  const f = fixture();
  const origin = {
    version: 'declared-material-endowment-v1' as const,
    id: 'new-source-declaration',
    kind: 'new-operator-endowment' as const,
    description: 'New finite endowment, not historical resident property.',
  };
  const event = {
    type: 'MaterialExtractionEnabled' as const,
    policy: MATERIAL_EXTRACTION_POLICY,
    origin,
    sources: [source],
  };
  const next = applyMaterialCommit(f.initial, [event]).state;
  expect(next.extraction!.origin).toEqual(origin);
  expect(next.stocks).toEqual(f.initial.stocks);
  expect(applyMaterialCommit(f.initial, [event]).state).toEqual(next);
  const legacy = { type: event.type, policy: event.policy, sources: event.sources };
  expect(applyMaterialCommit(f.initial, [legacy]).state.extraction!.origin).toBeUndefined();
  expect(() =>
    applyMaterialCommit(f.initial, [{ ...event, origin: { ...origin, description: '' } }]),
  ).toThrow('invalid-material-source-origin');
});

test('source labor projection and admission share capacity without leaking worker identities or deadlines', () => {
  const f = fixture();
  expect(f.create().accepted).toBe(true);
  expect(materialSourceLaborCapacity(f.s, 'wood', 0)).toEqual({
    version: 'material-source-labor-capacity-v1',
    capacity: 1,
    inUse: 0,
    available: 1,
  });
  f.op('start-production');
  expect(materialSourceLaborCapacity(f.s, 'wood', 0)).toEqual({
    version: 'material-source-labor-capacity-v1',
    capacity: 1,
    inUse: 1,
    available: 0,
  });
  expect(materialSourceWorkAvailable(f.s, 'job', 'a', 0)).toBe(true);
  expect(materialSourceLaborCapacity(f.s, 'wood', 3000)?.available).toBe(1);
  expect(materialSourceLaborCapacity(f.s, 'missing', 0)).toBeUndefined();
  expect(() => materialSourceLaborCapacity(f.s, 'wood', NaN)).toThrow('invalid-material-time');
  f.op('leave-production');
  expect(materialSourceLaborCapacity(f.s, 'wood', 0)?.available).toBe(1);
  f.replay();
});
