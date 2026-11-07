import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asLocationId } from '@aivilization/sim-core';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true, treasury?: number) {
  const root = mkdtempSync(join(tmpdir(), 'public-labor-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 2,
    continuity: true,
    elapsedRest: true,
    elapsedLabor: true,
    publicLabor: enabled,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    ...(treasury === undefined
      ? {}
      : {
          treasury,
          moneySupply: m.initialWorld.moneySupply - (m.initialWorld.treasury ?? 0) + treasury,
        }),
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          job: 'Cleaner',
          locationId: asLocationId('workshop'),
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: world,
    worldPolicies: serializableWorldPolicy(m.seed, world, m.rhythm),
  });
  cleanup.push(() => r.close());
  const [actor, other] = m.residents.map((v) => v.id) as [string, string];
  let n = 0;
  const call = (who: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(who);
    const result = r.invoke(who, { name, arguments: args, requestId: `public-work-${++n}` });
    r.finishTurn(who, { summary: 'Directed public labor verification' });
    return result;
  };
  const ok = (who: string, name: string, args: Record<string, unknown> = {}) => {
    const result = call(who, name, args);
    expect(result.ok, result.error).toBe(true);
    return result;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  const session = () =>
    Object.values(r.state.world.publicLabor!.process.sessions).find((s) => s.actorId === actor)!;
  return { root, r, actor, other, call, ok, session, replay };
}
test('public labor is discoverable through existing personal work/query/stop routes, with no other-person payroll disclosure or future pay', () => {
  const t = fixture(),
    before = t.r.state.world.agents[t.actor]!;
  t.ok(t.actor, 'world.work', { occupationName: 'Cleaner', laborSeconds: 3600 });
  expect(t.session().earnedMicros).toBe(0);
  expect(t.r.state.world.agents[t.actor]!.balance).toBe(before.balance);
  expect(t.r.context(t.actor).action.labor!.active).toMatchObject({
    sourceKind: 'initial-public-employment-regime',
    id: t.session().id,
  });
  expect(t.ok(t.actor, 'world.observe', { view: 'rules', section: 'labor' }).data).toMatchObject({
    publicEmployment: { policy: { funding: 'treasury-prefunded-gross-wage' } },
  });
  expect(t.call(t.other, 'world.observe', { view: 'labor', section: t.session().id }).error).toBe(
    'own-labor-not-found',
  );
  expect(t.r.advanceTime(600000, 'actual-work').ok).toBe(true);
  expect(t.session().earnedMicros).toBeGreaterThan(0);
  expect(t.session().paidMicros).toBe(t.session().earnedMicros);
  const expectedEnergy =
    before.physiology.energy -
    (t.session().terms.energyCostPerHour +
      t.r.state.world.publicLabor!.configuration.body.decay.energyPerHour) /
      6;
  expect(t.r.state.world.agents[t.actor]!.physiology.energy).toBeCloseTo(expectedEnergy, 8);
  expect(t.ok(t.actor, 'world.observe', { view: 'labor' }).data).toMatchObject({
    total: 1,
    items: [{ sourceKind: 'initial-public-employment-regime' }],
  });
  t.ok(t.actor, 'world.stop_work', { id: t.session().id, expectedRevision: t.session().revision });
  expect(t.session().status).toBe('interrupted');
  expect(t.r.context(t.actor).action.labor!.active).toBeNull();
  expect(
    t.ok(t.actor, 'world.observe', { view: 'labor', section: t.session().id }).data,
  ).toMatchObject({ protectedGrossRemaining: 0, session: { status: 'interrupted' } });
  expect(
    t.call(t.actor, 'world.claim_wage', {
      id: t.session().id,
      expectedRevision: t.session().revision,
    }).ok,
  ).toBe(false);
  t.replay();
});
test('zero public cash refuses a start atomically without discounting future labor or minting money', () => {
  const t = fixture(true, 0),
    before = structuredClone(t.r.state.world);
  expect(
    t.call(t.actor, 'world.work', { occupationName: 'Cleaner', laborSeconds: 3600 }).error,
  ).toBe('public-wage-full-funding-required');
  expect(t.r.state.world.publicLabor!.process.sessions).toEqual({});
  expect(t.r.state.world.agents[t.actor]!.physiology).toEqual(before.agents[t.actor]!.physiology);
  expect(t.r.state.world.agents[t.actor]!.balance).toBe(before.agents[t.actor]!.balance);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  t.replay();
});
