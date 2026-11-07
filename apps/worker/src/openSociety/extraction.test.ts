import { asLocationId } from '@aivilization/sim-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'finite-production-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    physicalProduction: enabled,
    initialization: 'newcomers',
  });
  const initialWorld = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: asLocationId('workshop'),
          residentialTier: 1,
          inventory: {},
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld,
    worldPolicies: serializableWorldPolicy(m.seed, initialWorld, m.rhythm),
  });
  clean.push(() => r.close());
  const a = m.residents[0]!.id,
    b = m.residents[1]!.id;
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId: `x${++n}` });
    r.finishTurn(actor, { summary: 'Engineering test only' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const v = call(actor, name, args);
    expect(v.ok, `${name}: ${v.error}`).toBe(true);
    return v.data;
  };
  const time = (ms: number) => {
    const v = r.advanceTime(ms, `time-${++n}`);
    expect(v.ok, v.error).toBe(true);
  };
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { root, r, a, b, call, ok, time, replay };
}
test('residential tier one can gather finite wheat, actually mill and bake, and eat the resulting food without old production', () => {
  const t = fixture(),
    stock = () => t.r.state.world.materials!.stocks.food!;
  const sources = t.ok(t.a, 'sources.list');
  expect(JSON.stringify(sources)).toContain('source-wheat');
  const rules = t.ok(t.a, 'world.observe', { view: 'rules', section: 'production' });
  expect(rules).toMatchObject({
    legacyProduction: 'business produce is disabled in this explicitly enabled mode',
  });
  expect(t.r.context(t.a)).toMatchObject({
    physicalProduction: { version: 'resident-extraction-v1' },
  });
  expect(
    t.call(t.a, 'world.produce', {
      commodityName: 'Bread',
      quantity: 1,
      availableLaborSeconds: 600,
    }).error,
  ).toContain('physical-production-required');
  t.ok(t.a, 'stocks.create', {
    id: 'food',
    locationId: asLocationId('workshop'),
    title: '自己选择的材料',
  });
  const create = {
    id: 'grain',
    stockId: 'food',
    expectedRevision: stock().revision,
    sourceId: 'source-wheat',
    sourceRevision: 1,
    quantity: 1,
    workers: [t.a],
    productName: '谷物',
    description: '自主用途',
  };
  expect(t.call(t.b, 'production.gather', create).ok).toBe(false);
  const sourceBefore = structuredClone(
    t.r.state.world.materials!.extraction!.sources['source-wheat'],
  );
  const { workers, ...withoutWorkers } = create;
  expect(workers).toEqual([t.a]);
  expect(t.call(t.a, 'production.gather', withoutWorkers).error).toBe('missing-argument:workers');
  expect(t.call(t.a, 'production.gather', { ...create, workers: [] }).error).toBe(
    'array-too-short:workers',
  );
  expect(t.r.state.world.materials!.extraction!.sources['source-wheat']).toEqual(sourceBefore);
  expect(t.r.state.world.materials!.productions.grain).toBeUndefined();
  t.ok(t.a, 'production.gather', create);
  expect(stock().inventory).toEqual({});
  const work = (id: string) => {
    const j = t.r.state.world.materials!.productions[id]!;
    t.ok(t.a, 'production.start', {
      id,
      expectedRevision: j.revision,
      until: t.r.state.world.clock.now + j.recipe.workMs,
    });
    t.time(j.recipe.workMs);
  };
  work('grain');
  expect(stock().inventory).toEqual({ Wheat: 1 });
  for (const [id, recipeId] of [
    ['flour', 'flour'],
    ['bread', 'bread'],
  ]) {
    t.ok(t.a, 'production.create', {
      id,
      stockId: 'food',
      expectedRevision: stock().revision,
      recipeId,
      quantity: 1,
      workers: [t.a],
      productName: '我的食物',
      description: '原文',
    });
    work(id!);
  }
  expect(stock().inventory).toEqual({ Bread: 1 });
  expect(t.r.state.world.agents[t.a]!.residentialTier).toBe(1);
  t.ok(t.a, 'stocks.withdraw', {
    id: 'food',
    expectedRevision: stock().revision,
    recipientId: t.a,
    items: { Bread: 1 },
  });
  t.ok(t.a, 'world.move', { targetLocationId: 'restaurant' });
  t.time(t.r.state.world.transitByAgent![t.a]!.arrivesAt - t.r.state.world.clock.now);
  const satiety = t.r.state.world.agents[t.a]!.physiology.satiety;
  t.ok(t.a, 'world.eat', { commodityName: 'Bread', quantity: 1 });
  expect(t.r.state.world.agents[t.a]!.inventory.Bread ?? 0).toBe(0);
  expect(t.r.state.world.agents[t.a]!.physiology.satiety).toBeGreaterThan(satiety);
  expect(
    t.r.journal.commits
      .flatMap((c) => c.worldEvents ?? [])
      .some((e) => e.type === 'CommodityProduced'),
  ).toBe(false);
  t.replay();
});
test('unused finite-source reservations are released at their real cadence boundary without producing goods', () => {
  const t = fixture();
  t.ok(t.a, 'stocks.create', { id: 'food', locationId: 'workshop', title: '自己选择的材料' });
  t.ok(t.a, 'production.gather', {
    id: 'unused',
    stockId: 'food',
    expectedRevision: 1,
    sourceId: 'source-wheat',
    sourceRevision: 1,
    quantity: 2,
    workers: [t.a],
    productName: '原料',
    description: '尚未劳动',
  });
  const job = () => t.r.state.world.materials!.productions.unused!;
  t.time(job().sourceExpiresAt! - t.r.state.world.clock.now);
  expect(job().status).toBe('cancelled');
  expect(t.r.state.world.materials!.stocks.food!.inventory).toEqual({});
  expect(t.r.state.world.materials!.extraction!.sources['source-wheat']!.remaining).toBe(100);
  t.replay();
});

test('source contention exposes aggregate capacity without private jobs and releases only actual labor', () => {
  const t = fixture();
  const actors = [t.a, t.b, t.r.manifest.residents[2]!.id];
  const sourceId = 'source-wood';
  for (const [i, actor] of actors.entries()) {
    const stockId = `private-stock-${i}`,
      id = `private-job-${i}`;
    t.ok(actor, 'stocks.create', { id: stockId, locationId: 'workshop', title: stockId });
    t.ok(actor, 'production.gather', {
      id,
      stockId,
      expectedRevision: t.r.state.world.materials!.stocks[stockId]!.revision,
      sourceId,
      sourceRevision: t.r.state.world.materials!.extraction!.sources[sourceId]!.revision,
      quantity: 1,
      workers: [actor],
      productName: 'wood',
      description: 'private purpose',
    });
  }
  const start = (i: number) => {
    const id = `private-job-${i}`,
      job = t.r.state.world.materials!.productions[id]!;
    return t.call(actors[i]!, 'production.start', {
      id,
      expectedRevision: job.revision,
      until: t.r.state.world.clock.now + job.recipe.workMs,
    });
  };
  expect(start(0).ok).toBe(true);
  expect(start(1).ok).toBe(true);
  const source = t.ok(actors[2]!, 'sources.read', { id: sourceId });
  expect(source).toMatchObject({ source: { laborSlots: { capacity: 2, inUse: 2, available: 0 } } });
  expect(JSON.stringify(source)).not.toContain('private-job');
  expect(JSON.stringify(source)).not.toContain('private-stock');
  expect(JSON.stringify(source)).not.toContain(t.a);
  const job = t.ok(actors[2]!, 'production.read', { id: 'private-job-2' });
  expect(job).toMatchObject({
    sourceWork: { readWith: 'town sources read --id source-wood', laborSlots: { available: 0 } },
  });
  const before = structuredClone(t.r.state.world);
  expect(start(2).error).toBe('material-source-labor-capacity-unavailable');
  expect(t.r.state.world).toEqual(before);
  t.ok(t.a, 'production.leave', {
    id: 'private-job-0',
    expectedRevision: t.r.state.world.materials!.productions['private-job-0']!.revision,
  });
  expect(t.ok(actors[2]!, 'sources.read', { id: sourceId })).toMatchObject({
    source: { laborSlots: { inUse: 1, available: 1 } },
  });
  expect(start(2).ok).toBe(true);
  t.replay();
});
