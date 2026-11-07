import { asLocationId } from '@aivilization/sim-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import {
  createOpenSocietyManifest,
  PROCESSED_COMMODITIES,
  serializableWorldPolicy,
} from './manifest';
import { createTownManifest, TOWN_INTERDEPENDENT_PROFILE } from './runProfile';

const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});

test('the interdependent profile seeds a small purse, a raw-only outside market and material growth', () => {
  const m = createTownManifest({ profile: TOWN_INTERDEPENDENT_PROFILE, count: 3 });
  const pools = Object.keys(m.initialWorld.marketPools);
  expect(pools).toContain('Wheat');
  expect(pools).not.toContain('Bread');
  expect(pools.some((c) => PROCESSED_COMMODITIES.has(c))).toBe(false);
  expect(m.initialWorld.treasury).toBe(3000);
  expect(m.initialWorld.materials?.expertise?.policy.version).toBe('resident-learning-by-doing-v1');
  expect(m.initialWorld.materials?.regrowth?.policy.version).toBe('material-source-regrowth-v1');
  expect(m.provenance).toMatchObject({ runProfile: TOWN_INTERDEPENDENT_PROFILE });
  const root = mkdtempSync(join(tmpdir(), 'interdependent-profile-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(root, m);
  clean.push(() => r.close());
  expect(r.advanceTime(3_600_000, 'interdependent-hour').ok).toBe(true);
});

test('practice makes the same resident faster and depleted sources regrow over simulated days', () => {
  const root = mkdtempSync(join(tmpdir(), 'material-growth-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 2,
    continuity: true,
    physicalProduction: true,
    materialGrowth: true,
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
  const [a, b] = m.residents.map((x) => x.id) as [string, string];
  let n = 0;
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId: `g${++n}` });
    r.finishTurn(actor, { summary: 'Engineering test only' });
    expect(v.ok, `${name}: ${v.error}`).toBe(true);
    return v.data as Record<string, unknown>;
  };
  const materials = () => r.state.world.materials!;
  const apples = () => materials().extraction!.sources['source-apple']!;
  ok(a, 'stocks.create', { id: 'shed', locationId: 'workshop', title: '自己的棚子' });
  const gather = (id: string, quantity: number) => {
    ok(a, 'production.gather', {
      id,
      stockId: 'shed',
      expectedRevision: materials().stocks.shed!.revision,
      sourceId: 'source-apple',
      sourceRevision: apples().revision,
      quantity,
      workers: [a],
      productName: '苹果',
      description: '自主采集',
    });
    const job = materials().productions[id]!;
    ok(a, 'production.start', {
      id,
      expectedRevision: job.revision,
      until: r.state.world.clock.now + job.quantity * job.recipe.workMs,
    });
    expect(r.advanceTime(job.quantity * job.recipe.workMs, `work-${id}`).ok).toBe(true);
    return job;
  };
  const novice = gather('first', 30);
  expect(novice.expertise).toBeUndefined();
  expect(materials().expertise!.experienceMs[a]).toEqual({ Apple: 30 * novice.recipe.workMs });
  const practiced = gather('second', 1);
  expect(practiced.expertise!.multiplier).toBeLessThan(0.7);
  expect(practiced.recipe.workMs).toBeLessThan(novice.recipe.workMs);

  // Each resident sees only their own pace.
  const own = ok(a, 'sources.read', { id: 'source-apple' });
  const other = ok(b, 'sources.read', { id: 'source-apple' });
  expect((own.source as { yourPace: { multiplier: number } }).yourPace.multiplier).toBeLessThan(1);
  expect((other.source as { yourPace: { multiplier: number } }).yourPace.multiplier).toBe(1);
  expect(own).toHaveProperty('regrowth.fractionPerDay', 0.2);

  const depleted = apples().remaining;
  expect(depleted).toBe(apples().initialQuantity - 31);
  expect(r.advanceTime(86_400_000, 'one-day').ok).toBe(true);
  expect(apples().remaining).toBe(depleted + 20);

  const before = structuredClone(r.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  r.close();
  const next = new OpenSocietyRuntime(root);
  clean.push(() => next.close());
  expect(next.state).toEqual(before);
  expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
});
