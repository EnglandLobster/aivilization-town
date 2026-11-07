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
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'actual-enterprise-labor-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    elapsedRest: true,
    elapsedLabor: false,
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
  expect(r.enableAgreedLabor().ok).toBe(true);
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

test('independent enterprise terms are discoverable, consented and frozen through actual work and replay', () => {
  const t = fixture();
  t.ok(t.owner, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '自定经营',
    occupationName: 'Maker',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.ok(t.owner, 'world.post_job', { enterpriseId: 'firm', wageOffer: 7, openSlots: 3 });
  t.ok(t.worker, 'world.join_enterprise', { enterpriseId: 'firm' });
  expect(t.call(t.worker, 'world.work', { occupationName: 'Maker', laborSeconds: 60 }).error).toBe(
    'accepted-current-labor-terms-required',
  );
  const args = {
    enterpriseId: 'firm',
    operation: 'offer',
    id: 'hourly',
    employeeId: t.worker,
    wageMicros: 60_000_000,
    referenceMs: 3_600_000,
    validUntil: t.r.state.world.clock.now + 86_400_000,
  };
  expect(t.call(t.other, 'business.change-labor-terms', args).ok).toBe(false);
  t.ok(t.owner, 'business.change-labor-terms', args);
  expect(
    t.call(t.other, 'business.labor-terms', { enterpriseId: 'firm', id: 'hourly' }).error,
  ).toBe('labor-offer-not-found');
  const accept = { enterpriseId: 'firm', operation: 'accept', id: 'hourly', expectedRevision: 1 };
  expect(t.call(t.owner, 'business.change-labor-terms', accept).ok).toBe(false);
  t.ok(t.worker, 'business.change-labor-terms', accept);
  expect(
    t.ok(t.worker, 'business.labor-terms', { enterpriseId: 'firm', id: 'hourly' }).data,
  ).toMatchObject({ ownCurrent: { wageMicros: 60_000_000, referenceMs: 3_600_000 } });
  const before = t.r.state.world.agents[t.worker]!.balance;
  t.ok(t.worker, 'world.work', { occupationName: 'Maker', laborSeconds: 600 });
  expect(t.r.state.world.agents[t.worker]!.balance).toBe(before);
  const id = t.r.state.world.residentLabor!.process.activeByActor[t.worker]!;
  expect(t.r.state.world.residentLabor!.termsBySession[id]).toMatchObject({
    grossMicros: 10_000_000,
    wageSource: 'accepted-labor-terms',
    agreement: { id: 'hourly', revision: 2 },
  });
  t.ok(t.owner, 'business.change-labor-terms', {
    ...args,
    id: 'new-rate',
    wageMicros: 120_000_000,
  });
  t.ok(t.worker, 'business.change-labor-terms', { ...accept, id: 'new-rate' });
  expect(t.r.advanceTime(300_000, 'half-work').ok).toBe(true);
  const active = t.r.state.world.residentLabor!.process.sessions[id]!;
  t.ok(t.worker, 'world.stop_work', { id, expectedRevision: active.revision });
  expect(t.r.state.world.enterprises.firm!.earnedPayroll!.claims[id]!.earnedMicros).toBe(5_000_000);
  expect(t.r.state.world.residentLabor!.termsBySession[id]!.agreement!.id).toBe('hourly');
  t.replay();
});
