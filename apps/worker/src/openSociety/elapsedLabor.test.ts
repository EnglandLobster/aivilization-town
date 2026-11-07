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
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'actual-enterprise-labor-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    elapsedRest: true,
    elapsedLabor: enabled,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: asLocationId('workshop'),
          job: null,
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
  const [owner, worker, other] = m.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `labor-${++n}` });
    r.finishTurn(actor, { summary: 'Directed actual enterprise labor verification' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const result = call(actor, name, args);
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
  return { root, r, owner, worker, other, call, ok, replay };
}
test('resident-owned firm, independent hire, actual work and personal claims are visible through authenticated tools and exactly replay', () => {
  const t = fixture();
  t.ok(t.owner, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: 'Resident workshop',
    occupationName: 'Maker',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.ok(t.owner, 'world.post_job', { enterpriseId: 'firm', wageOffer: 100, openSlots: 3 });
  t.ok(t.worker, 'world.join_enterprise', { enterpriseId: 'firm' });
  const before = t.r.state.world.agents[t.worker]!.balance;
  t.ok(t.worker, 'world.work', { occupationName: 'Maker', laborSeconds: 1800 });
  expect(t.r.state.world.agents[t.worker]!.balance).toBe(before);
  const started = t.r.context(t.worker).action.labor!.active!;
  expect(started.elapsedMs).toBe(0);
  expect(t.r.context(t.other).action.labor!.active).toBeNull();
  expect(t.call(t.other, 'world.observe', { view: 'labor', section: started.id }).error).toBe(
    'own-labor-not-found',
  );
  expect(
    t.call(t.other, 'world.stop_work', { id: started.id, expectedRevision: started.revision })
      .error,
  ).toBe('own-labor-required');
  expect(t.r.advanceTime(600000, 'ten-minutes').ok).toBe(true);
  const active = t.r.context(t.worker).action.labor!.active!;
  expect(active.elapsedMs).toBe(600000);
  expect(active.earned).toBeGreaterThan(0);
  expect(
    t.call(t.worker, 'world.stop_work', { id: started.id, expectedRevision: started.revision })
      .error,
  ).toBe('labor-revision-conflict');
  t.ok(t.worker, 'world.stop_work', { id: active.id, expectedRevision: active.revision });
  expect(t.r.context(t.worker).action.labor!.active).toBeNull();
  expect(
    t.ok(t.worker, 'world.observe', { view: 'labor', section: started.id }).data,
  ).toMatchObject({
    session: { status: 'interrupted', elapsedMs: 600000 },
    terms: {
      withholdingVersion: 'labor-reference-period-withholding-v1',
      wageSource: 'recorded-employment-offer',
    },
    claim: { actorId: t.worker, status: 'ended' },
  });
  expect(t.ok(t.worker, 'world.observe', { view: 'labor', limit: 1 }).data).toMatchObject({
    total: 1,
  });
  expect(t.ok(t.worker, 'world.observe', { view: 'rules', section: 'labor' }).data).toMatchObject({
    scope: 'enterprise-employment-only-public-scenario-work-retains-its-recorded-policy',
  });
  expect(
    t.ok(t.worker, 'world.observe', { view: 'rules', section: 'educationOpportunityCost' }).data,
  ).toMatchObject({
    policyVersion: 'education-opportunity-cost-v3',
    currentOccupationName: 'Maker',
    foregoneLaborIncome: 6.25,
  });
  t.replay();
});
