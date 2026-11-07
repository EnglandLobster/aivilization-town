import { asAgentId, asLocationId, createEventEnvelope } from '@aivilization/sim-core';
import { createMaterialsPolicy, type MaterialCommand } from '@aivilization/materials';
import { expect, test } from 'vitest';
import { createWorldProjection, applyWorldEvent } from './projection';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  settleResidentMaterialEvent,
  type MaterialAuthorization,
} from './residentMaterials';
import { handleAdvanceSimulationTimeCommand } from './agentActions';
import { createCommandEnvelope } from '@aivilization/sim-core';
import type { WorldEvent } from './events';
const policy = createMaterialsPolicy([
  {
    id: 'book',
    version: 'test-book-v1',
    inputs: { Wood: 1 },
    outputs: { Book: 1 },
    workMs: 1000,
    energyCost: 5,
    satietyCost: 2,
    minResidentialTier: 1,
  },
]);
function setup() {
  const initial = createWorldProjection({
    agents: ['a', 'b'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: { Wood: 4 },
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      residentialTier: 1,
      job: null,
      locationId: asLocationId('site'),
    })),
    locations: [
      {
        locationId: asLocationId('site'),
        name: 'Real place',
        kind: 'production',
        activityAffinities: [],
        capacity: 10,
      },
    ],
    moneySupply: 200,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const authorization: MaterialAuthorization = {
    authorize: () => undefined,
    controlAvailable: (c) => c.kind === 'resident' && !!w.agents[c.id],
    hasExternalObligation: () => false,
    mayStoreAt: (_, id) => !!w.locations[id],
  };
  const context = (actorId = 'a') => ({
    projection: w,
    actorId,
    authorization,
    requestId: `r${++n}`,
    simulationId: 'sim',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(w.moneySupply).toBe(200);
    expect(w.agents.a!.balance + w.agents.b!.balance).toBe(200);
  };
  const act = (command: MaterialCommand, actor = 'a') =>
    residentMaterialEvent({ ...context(actor), command });
  const ok = (command: MaterialCommand, actor = 'a') => {
    const d = act(command, actor);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
    return d;
  };
  commit([
    enableResidentMaterialsEvent({
      at: w.clock.now,
      simulationId: 'sim',
      requestId: 'enable',
      nextSequence: 1,
      policy,
    }),
  ]);
  ok({ type: 'create-stock', id: 's', locationId: 'site', title: 'Actual material' });
  ok({ type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 3 } });
  ok({
    type: 'create-production',
    id: 'j',
    stockId: 's',
    expectedRevision: 2,
    recipeId: 'book',
    quantity: 3,
    workers: ['a', 'b'],
    productName: '自己的作品',
    description: '仅为原文',
  });
  const time = (deltaMs: number) => {
    const es = handleAdvanceSimulationTimeCommand({
      projection: w,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `time${++n}`,
        simulationId: 'sim',
        source: 'system',
        type: 'AdvanceSimulationTime',
        payload: { deltaMs },
        issuedAt: w.clock.now,
      }),
    });
    commit(es);
  };
  const tick = () => {
    const d = settleResidentMaterialEvent({ ...context('system'), productionId: 'j' });
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
  };
  return {
    get w() {
      return w;
    },
    initial,
    events,
    context,
    act,
    ok,
    commit,
    time,
    tick,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('material reservation, real exclusive work, conversion and body costs settle atomically and replay without creating cash', () => {
  const t = setup();
  expect(t.w.agents.a!.inventory.Wood).toBe(1);
  expect(t.w.materials!.productions.j!.held.Wood).toBe(3);
  expect(t.w.materials!.stocks.s!.inventory).toEqual({});
  t.ok({ type: 'start-production', id: 'j', expectedRevision: 1, until: 3000 }, 'b');
  expect(t.w.activityTimeByAgent.b).toMatchObject({
    commandType: 'ResidentMaterialWork',
    availableAt: 3000,
    settlementTiming: 'effects-at-completion',
  });
  t.time(1000);
  t.tick();
  expect(t.w.materials!.stocks.s!.inventory.Book).toBe(1);
  expect(t.w.agents.b!.physiology.energy).toBe(95);
  t.time(500);
  t.ok(
    { type: 'leave-production', id: 'j', expectedRevision: t.w.materials!.productions.j!.revision },
    'b',
  );
  expect(t.w.activityTimeByAgent.b!.availableAt).toBe(1500);
  expect(t.w.agents.b!.physiology.energy).toBe(92.5);
  t.ok({
    type: 'start-production',
    id: 'j',
    expectedRevision: t.w.materials!.productions.j!.revision,
    until: 3000,
  });
  t.time(1500);
  t.tick();
  expect(t.w.materials!.stocks.s!.inventory.Book).toBe(3);
  expect(t.w.materials!.productions.j!.held).toEqual({});
  expect(t.w.agents.a!.physiology.energy).toBe(92.5);
  t.replay();
});
test('preflight rejects concurrent personal work and insufficient material without touching any world state', () => {
  const t = setup();
  t.ok({ type: 'start-production', id: 'j', expectedRevision: 1, until: 3000 });
  const before = t.w;
  expect(
    t.act({
      type: 'deposit',
      id: 's',
      expectedRevision: t.w.materials!.stocks.s!.revision,
      items: { Wood: 1 },
    }),
  ).toMatchObject({ accepted: false, reason: 'material-presence-and-idle-required' });
  expect(
    t.act({
      type: 'withdraw',
      id: 's',
      expectedRevision: t.w.materials!.stocks.s!.revision,
      recipientId: 'b',
      items: { Wood: 1 },
    }),
  ).toMatchObject({ accepted: false });
  expect(t.w).toEqual(before);
  t.replay();
});
test('an unrelated activity cannot be released when ending an invalidated production reservation', () => {
  const t = setup();
  t.ok({ type: 'start-production', id: 'j', expectedRevision: 1, until: 3000 });
  const w = {
    ...t.w,
    activityTimeByAgent: {
      ...t.w.activityTimeByAgent,
      a: { ...t.w.activityTimeByAgent.a!, commandType: 'ResidentParticipate' as const },
    },
  };
  const d = settleResidentMaterialEvent({
    ...t.context('system'),
    projection: w,
    productionId: 'j',
  });
  // Same time is a no-op; at a later checkpoint the job stops, preserving the unrelated reservation.
  const advanced = { ...w, clock: { ...w.clock, now: 1000 } };
  expect(d.accepted).toBe(true);
  const stopped = settleResidentMaterialEvent({
    ...t.context('system'),
    projection: advanced,
    productionId: 'j',
  });
  expect(stopped.accepted).toBe(true);
  if (stopped.accepted) {
    const result = stopped.events.reduce(applyWorldEvent, advanced);
    expect(result.activityTimeByAgent.a).toEqual(w.activityTimeByAgent.a);
    expect(result.materials!.productions.j!.progressMs).toBe(0);
    expect(result.materials!.productions.j!.session).toBeUndefined();
  }
});
test('old projections stay without material state and forged material facts fail replay integrity', () => {
  const t = setup();
  expect(t.initial.materials).toBeUndefined();
  const stock = t.w.materials!.stocks.s!;
  const forged = createEventEnvelope({
    id: 'forged',
    simulationId: 'sim',
    sequence: 999,
    occurredAt: t.w.clock.now,
    type: 'ResidentMaterialsCommitted',
    payload: {
      policyVersion: 'resident-materials-v1' as const,
      events: [
        {
          type: 'MaterialStockChanged' as const,
          stock: { ...stock, revision: stock.revision + 1, inventory: { Gold: 100 } },
        },
      ],
    },
  });
  expect(() => applyWorldEvent(t.w, forged)).toThrow('material-stock-flow-mismatch');
  expect(() =>
    applyWorldEvent(
      t.w,
      enableResidentMaterialsEvent({
        at: 0,
        simulationId: 'sim',
        requestId: 'again',
        nextSequence: 999,
        policy,
      }),
    ),
  ).toThrow('materials-already-enabled');
  t.replay();
});
