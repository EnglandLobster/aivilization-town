import { verifyEndedWageAfterExit } from './testFixtures/earnedWageExit';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyWorldEvent,
  dispatchWorldCommand,
  interruptResidentEmployedMaterialEvent,
} from '@aivilization/world';
import { asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy, openWorldPolicies } from './manifest';
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
    elapsedLabor: true,
    productiveEmployment: enabled,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    moneySupply: m.initialWorld.moneySupply + 900,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: asLocationId('workshop'),
          job: null,
          balance: a.balance + (id.endsWith('001') ? 900 : 0),
          inventory: { ...a.inventory, Wood: 10 },
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
function setup() {
  const t = fixture(true);
  t.ok(t.owner, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: 'Resident workshop',
    occupationName: 'Maker',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.ok(t.owner, 'world.post_job', { enterpriseId: 'firm', wageOffer: 100000, openSlots: 3 });
  t.ok(t.worker, 'world.join_enterprise', { enterpriseId: 'firm' });

  t.ok(t.owner, 'stocks.create', {
    id: 'stock',
    title: 'Employer personal stock',
    locationId: 'workshop',
  });
  t.ok(t.owner, 'stocks.deposit', { id: 'stock', expectedRevision: 1, items: { Wood: 4 } });
  const create = {
    id: 'job',
    stockId: 'stock',
    expectedRevision: 2,
    recipeId: 'book',
    quantity: 2,
    workers: [t.worker],
    productName: 'Our product',
    description: 'Original words',
    enterpriseId: 'firm',
  };
  return { ...t, create };
}
test('employer authorization and independent production share actual body time, conserved goods and personal wages', () => {
  const t = setup();
  const before = t.r.state.world;
  expect(t.call(t.other, 'production.create', t.create).ok).toBe(false);
  expect(t.r.state.world.materials!.stocks.stock!.inventory).toEqual(
    before.materials!.stocks.stock!.inventory,
  );
  t.ok(t.owner, 'production.create', t.create);
  const job = t.r.state.world.materials!.productions.job!;
  expect(t.r.state.world.enterprises.firm!.earnedPayroll?.claims).toEqual({});
  expect(t.ok(t.worker, 'production.read', { id: 'job' }).data).toMatchObject({
    employment: { enterpriseId: 'firm', ownQuotedWage: 100000 },
  });
  const start = t.r.state.world.agents[t.worker]!.physiology;
  const now = t.r.state.world.clock.now,
    duration = job.recipe.workMs * 2;
  t.ok(t.worker, 'production.start', { id: 'job', expectedRevision: 1, until: now + duration });
  expect(t.call(t.worker, 'world.work', { occupationName: 'Maker', laborSeconds: 60 }).ok).toBe(
    false,
  );
  const claimId = Object.keys(t.r.state.world.productiveEmployment!.claims)[0]!;
  expect(t.r.state.world.enterprises.firm!.earnedPayroll!.claims[claimId]!.earnedMicros).toBe(0);
  expect(t.r.advanceTime(duration, 'complete-production').ok).toBe(true);
  const w = t.r.state.world,
    claim = w.enterprises.firm!.earnedPayroll!.claims[claimId]!;
  expect(w.materials!.stocks.stock!.inventory).toEqual({ Book: 2, Wood: 2 });
  expect(w.materials!.productions.job!.progressMs).toBe(duration);
  expect(claim.elapsedMs).toBe(duration);
  expect(claim.status).toBe('ended');
  expect(claim.earnedMicros).toBeGreaterThan(0);
  const decay = openWorldPolicies(t.r.manifest.seed, w, t.r.manifest.rhythm).calendar!
    .physiologicalDecay;
  expect(w.agents[t.worker]!.physiology.energy).toBeCloseTo(
    start.energy - job.recipe.energyCost * 2 - (decay.energyPerHour * duration) / 3600000,
    8,
  );
  expect(t.ok(t.worker, 'world.observe', { view: 'labor', section: claimId }).data).toMatchObject({
    source: { productionId: 'job' },
    claim: { elapsedMs: duration },
  });
  expect(t.call(t.other, 'world.observe', { view: 'labor', section: claimId }).error).toBe(
    'own-labor-not-found',
  );
  expect(w.moneySupply).toBe(before.moneySupply);
  t.replay();
});
test('leaving employment atomically stops productive labor, retains debt and permits only the departed creditor to collect', () => {
  const t = setup();
  t.ok(t.owner, 'production.create', t.create);
  const duration = t.r.state.world.materials!.productions.job!.recipe.workMs * 2;
  t.ok(t.worker, 'production.start', { id: 'job', expectedRevision: 1, until: duration });
  const partial = Math.floor(duration * 0.75);
  expect(t.r.advanceTime(partial, 'partial-production').ok).toBe(true);
  const id = Object.keys(t.r.state.world.productiveEmployment!.claims)[0]!;
  t.ok(t.worker, 'world.leave_enterprise', { enterpriseId: 'firm' });
  expect(t.r.state.world.materials!.productions.job!.session).toBeUndefined();
  const claim = t.r.state.world.enterprises.firm!.earnedPayroll!.claims[id]!;
  expect(claim.status).toBe('ended');
  expect(claim.elapsedMs).toBe(partial);
  expect(claim.earnedMicros).toBeGreaterThan(claim.paidMicros);
  expect(t.call(t.other, 'world.claim_wage', { id, expectedRevision: claim.revision }).ok).toBe(
    false,
  );
  t.ok(t.owner, 'world.fund_enterprise', { enterpriseId: 'firm', amount: 500 });
  t.ok(t.worker, 'world.claim_wage', { id, expectedRevision: claim.revision });
  expect(t.r.state.world.enterprises.firm!.earnedPayroll!.claims[id]!.paidMicros).toBeGreaterThan(
    claim.paidMicros,
  );
  const progress = t.r.state.world.materials!.productions.job!.progressMs;
  expect(t.r.advanceTime(60000, 'after-leaving').ok).toBe(true);
  expect(t.r.state.world.materials!.productions.job!.progressMs).toBe(progress);
  t.replay();
});
test('physical task permission does not grant employer funding; stale or foreign labor authority leaves all material state unchanged', () => {
  const t = setup();
  t.ok(t.other, 'stocks.create', { id: 'foreign', title: 'Other stock', locationId: 'workshop' });
  t.ok(t.other, 'stocks.deposit', { id: 'foreign', expectedRevision: 1, items: { Wood: 2 } });
  const before = structuredClone(t.r.state.world);
  expect(t.call(t.other, 'production.create', { ...t.create, stockId: 'foreign' }).error).toBe(
    'production-employer-authority-required',
  );
  expect(t.r.state.world.materials).toEqual(before.materials);
  expect(t.r.state.world.enterprises).toEqual(before.enterprises);
  expect(t.call(t.owner, 'production.create', { ...t.create, workers: [t.other] }).error).toBe(
    'production-employee-contracted-wage-required',
  );
  expect(t.r.state.world.materials).toEqual(before.materials);
  t.ok(t.owner, 'production.create', t.create);
  t.ok(t.worker, 'production.start', { id: 'job', expectedRevision: 1, until: 120000 });
  expect(t.r.advanceTime(30000, 'partial-before-layoff').ok).toBe(true);
  expect(
    t.call(t.other, 'world.layoff_employee', { enterpriseId: 'firm', employeeAgentId: t.worker })
      .ok,
  ).toBe(false);
  t.ok(t.owner, 'world.layoff_employee', { enterpriseId: 'firm', employeeAgentId: t.worker });
  const w = t.r.state.world;
  expect(w.agents[t.worker]!.job).toBeNull();
  expect(w.materials!.productions.job!.session).toBeUndefined();
  const claim = Object.values(w.enterprises.firm!.earnedPayroll!.claims)[0]!;
  expect(claim.elapsedMs).toBe(30000);
  expect(claim.status).toBe('ended');
  expect(
    t.call(t.worker, 'production.start', {
      id: 'job',
      expectedRevision: w.materials!.productions.job!.revision,
      until: 90000,
    }).ok,
  ).toBe(false);
  expect(t.r.state.world.enterprises.firm!.earnedPayroll!.claims[claim.id]).toEqual(claim);
  t.replay();
});

test.each([false, true])(
  'preserved productive creditor: ended debt pays, active work must first end (%s)',
  (active) => {
    const t = setup();
    t.ok(t.owner, 'production.create', t.create);
    const duration = t.r.state.world.materials!.productions.job!.recipe.workMs * 2;
    t.ok(t.worker, 'production.start', { id: 'job', expectedRevision: 1, until: duration });
    expect(t.r.advanceTime(Math.floor(duration * 0.75), 'estate-production').ok).toBe(true);
    const id = Object.keys(t.r.state.world.productiveEmployment!.claims)[0]!;
    if (!active) t.ok(t.worker, 'world.leave_enterprise', { enterpriseId: 'firm' });
    t.ok(t.owner, 'world.fund_enterprise', { enterpriseId: 'firm', amount: 500 });
    verifyEndedWageAfterExit(t.r.state.world, t.worker, id, 'productive', active);
    t.replay();
  },
);

test('system employment interruption needs actual loss of work authority, preserves assets and cannot masquerade as personal leave', () => {
  const t = setup();
  t.ok(t.owner, 'production.create', t.create);
  const duration = t.r.state.world.materials!.productions.job!.recipe.workMs * 2;
  t.ok(t.worker, 'production.start', { id: 'job', expectedRevision: 1, until: duration });
  expect(t.r.advanceTime(Math.floor(duration * 0.75), 'interruption-boundary').ok).toBe(true);
  const w = structuredClone(t.r.state.world);
  expect(() =>
    interruptResidentEmployedMaterialEvent({
      projection: w,
      productionId: 'job',
      requestId: 'unjustified-stop',
      simulationId: 'test',
      nextSequence: 1,
      authorization: {
        authorize: () => undefined,
        controlAvailable: () => false,
        hasExternalObligation: () => false,
        mayStoreAt: () => true,
      },
    }),
  ).toThrow('material-interruption-actual-unavailability-required');
  const events = dispatchWorldCommand({
    projection: w,
    policies: openWorldPolicies(t.r.manifest.seed, w, t.r.manifest.rhythm),
    nextSequence: 1000,
    command: createCommandEnvelope({
      id: 'membership-ended',
      simulationId: 'test',
      type: 'AgentLeaveEnterprise',
      actorId: t.worker,
      issuedAt: w.clock.now,
      payload: { enterpriseId: 'firm' },
    }),
  });
  const i = events.findIndex(
    (e) => e.type === 'ResidentMaterialsCommitted' && e.payload.interruption,
  );
  expect(i).toBeGreaterThan(0);
  const event = events[i]!;
  if (event.type !== 'ResidentMaterialsCommitted') throw Error('missing-interruption');
  const before = events.slice(0, i).reduce(applyWorldEvent, w);
  const { interruption, ...legacy } = event.payload;
  expect(interruption?.workerId).toBe(t.worker);
  expect(() => applyWorldEvent(before, { ...event, payload: legacy })).toThrow(
    'material-interruption-proof-required',
  );
  const after = applyWorldEvent(before, event);
  expect(after.materials!.productions.job!.session).toBeUndefined();
  expect(after.materials!.productions.job!.progressMs).toBe(
    w.materials!.productions.job!.progressMs,
  );
  expect(after.materials!.productions.job!.held).toEqual(w.materials!.productions.job!.held);
  expect(after.materials!.stocks).toEqual(w.materials!.stocks);
  const receipt = event.payload.events.find((e) => e.type === 'MaterialReceiptRecorded');
  expect(receipt).toMatchObject({
    receipt: { actorId: 'system', operation: 'production-interrupted-v1', efforts: [] },
  });
  expect(after.activityTimeByAgent[t.worker]!.availableAt).toBe(w.clock.now);
  expect(after.agents[t.worker]!.physiology).toEqual(w.agents[t.worker]!.physiology);
  expect(applyWorldEvent(before, event)).toEqual(after);
  expect(t.r.state.world).toEqual(w);
  t.replay();
});
