import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { programResourceFixture as fixture } from './testFixtures/programResourceExchange';
import { createOpenSocietyManifest } from './manifest';
import { initialOpenSocietyState } from './state';
import { PROGRAM_ACTIONS_POLICY } from '@aivilization/collaboration';

test.each([
  'premises',
  'stock',
  'space',
  'register',
  'group',
  'enterprise',
] as const)(
  '%s actual runtime admission and journal recovery preserve a paid atomic exchange',
  (kind) => {
    const f = fixture(kind, true),
      t = f.t,
      before = f.state;
    const receipt = t.ok(
      t.a,
      'programs.run',
      { id: 'exchange', expectedRevision: 1 },
      'paid-handoff',
    );
    expect(f.resource().control?.controller).toEqual({ kind: 'resident', id: t.c });
    expect(f.state.world.agents[t.c]!.balance).toBe(before.world.agents[t.c]!.balance - 30);
    expect(
      t.ok(t.a, 'programs.run', { id: 'exchange', expectedRevision: 1 }, 'paid-handoff'),
    ).toEqual(receipt);
    expect(f.state.world.agents[t.c]!.balance).toBe(before.world.agents[t.c]!.balance - 30);
    expect(t.call(t.d, 'programs.runs', {}).data).toMatchObject({ items: [] });
    t.replay();
  },
);
test('scheduled exchange stays between its original time boundaries through complete journal replay', () => {
  const f = fixture('space', true),
    t = f.t,
    at = f.state.world.clock.now;
  t.ok(t.a, 'programs.schedule', {
    id: 'later',
    programId: 'exchange',
    programRevision: 1,
    startAt: at + 1000,
    intervalMs: 60000,
    runs: 1,
  });
  t.time(2000);
  expect(f.resource().control?.controller).toEqual({ kind: 'resident', id: t.c });
  const run = Object.values(f.state.coordination!.runs)[0]!;
  expect(run).toMatchObject({ status: 'succeeded', at: at + 1000, scheduleId: 'later' });
  expect(f.state.world.clock.now).toBe(at + 2000);
  expect(f.state.coordination!.schedules.later).toMatchObject({
    status: 'completed',
    completedRuns: 1,
  });
  t.replay();
});
test('revoking one mandate prevents every resource and payment effect, including an already scheduled execution', () => {
  const f = fixture('premises', true),
    t = f.t,
    at = f.state.world.clock.now;
  t.ok(t.a, 'programs.schedule', {
    id: 'later',
    programId: 'exchange',
    programRevision: 1,
    startAt: at + 1000,
    intervalMs: 60000,
    runs: 1,
  });
  t.ok(t.c, 'mandates.revoke', { id: `mandate-${t.c}`, expectedRevision: 1 });
  const old = f.resource(),
    balances = Object.values(f.state.world.agents).map((a) => a.balance);
  t.time(2000);
  expect(f.resource()).toEqual(old);
  expect(Object.values(f.state.world.agents).map((a) => a.balance)).toEqual(balances);
  expect(Object.values(f.state.coordination!.runs)[0]).toMatchObject({
    status: 'failed',
    reason: 'program-mandate-required',
  });
  expect(f.state.coordination!.schedules.later!.status).toBe('failed');
  t.replay();
});
test('explicit enablement is idempotent, persisted and absent in old manifests', () => {
  const old = createOpenSocietyManifest({ count: 3, continuity: true });
  expect(old.programActionsPolicy).toBeUndefined();
  expect(initialOpenSocietyState(old).coordination!.actionsPolicy).toBeUndefined();
  const fresh = createOpenSocietyManifest({ count: 3, continuity: true, programActions: true });
  expect(fresh.provenance.programActions).toBe(PROGRAM_ACTIONS_POLICY.version);
  expect(initialOpenSocietyState(fresh).coordination!.actionsPolicy).toEqual(
    PROGRAM_ACTIONS_POLICY,
  );
  const f = fixture('space', true),
    first = f.t.r.enableProgramActions();
  expect(f.t.r.enableProgramActions()).toEqual(first);
  const reopened = f.t.replay();
  expect(reopened.enableProgramActions()).toEqual(first);
});
test('v2 mandates remain v2 when executed after explicit enterprise-language upgrade; original manifest and journal replay remain stable', () => {
  const f = fixture('space', true),
    t = f.t,
    old = f.state.coordination!.programs.exchange!;
  const mandates = structuredClone(f.state.coordination!.mandates),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableEnterprisePrograms().ok).toBe(true);
  expect(t.r.enableEnterprisePrograms().ok).toBe(true);
  expect(t.r.state.coordination!.programs.exchange).toEqual(old);
  expect(t.r.state.coordination!.mandates).toEqual(mandates);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  t.ok(t.a, 'programs.run', { id: 'exchange', expectedRevision: 1 }, 'v2-after-v3');
  const run = Object.values(t.r.state.coordination!.runs)[0]!;
  expect(run.status).toBe('succeeded');
  expect(
    run.execution!.steps.every((s) => s.authority.policyVersion === PROGRAM_ACTIONS_POLICY.version),
  ).toBe(true);
  t.replay();
});
test('enterprise exchange failure after intermediate offer and accept commits neither control nor payment and consumes no mandate', () => {
  const f = fixture('enterprise', true),
    t = f.t;
  const payer = t.r.state.world.agents[t.c]!;
  t.ok(t.c, 'payments.transfer', {
    targetId: t.d,
    amount: payer.balance,
    note: 'Independent earlier expense',
  });
  const before = structuredClone(t.r.state);
  const result = t.call(
    t.a,
    'programs.run',
    { id: 'exchange', expectedRevision: 1 },
    'insufficient-management-price',
  );
  // The failed attempt is recorded, but none of its provisional steps becomes a fact.
  expect(result.ok).toBe(false);
  expect(result.error).toBe('insufficient-balance');
  const run = Object.values(t.r.state.coordination!.runs)[0]!;
  expect(run.status).toBe('failed');
  expect(t.r.state.world.enterprises).toEqual(before.world.enterprises);
  expect(t.r.state.world.agents).toEqual(before.world.agents);
  expect(t.r.state.coordination!.mandates).toEqual(before.coordination!.mandates);
  t.ok(t.d, 'payments.transfer', {
    targetId: t.c,
    amount: 30,
    note: 'Voluntary funding for a new attempt',
  });
  t.ok(t.a, 'programs.run', { id: 'exchange', expectedRevision: 1 }, 'retry-with-new-funds');
  expect(t.r.state.world.enterprises.asset!.control?.controller).toEqual({
    kind: 'resident',
    id: t.c,
  });
  for (const m of Object.values(t.r.state.coordination!.mandates)) expect(m.usedRuns).toBe(1);
  t.replay();
});

test('fresh v3 experiments expose their policy while incompatible initialization is rejected', () => {
  const m = createOpenSocietyManifest({ enterprisePrograms: true });
  expect(m.provenance.programActions).toBe('resident-program-actions-v3');
  expect(initialOpenSocietyState(m).coordination!.actionsPolicy!.version).toBe(
    'resident-program-actions-v3',
  );
  for (const input of [
    { resourceControl: false },
    { societyKernel: false },
    { programActions: false },
  ])
    expect(() => createOpenSocietyManifest({ ...input, enterprisePrograms: true })).toThrow(
      'enterprise-programs-require-resource-control-and-program-actions',
    );
});
