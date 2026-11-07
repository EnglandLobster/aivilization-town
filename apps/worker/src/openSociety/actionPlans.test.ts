import { asLocationId } from '@aivilization/sim-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { ACTION_PLAN_HINT, parseActionPlanStep } from './actionPlans';
import { OPEN_SOCIETY_TOOLS } from './catalog';
import { parseCapabilityFlags, parseResidentCommand } from './commandGrammar';
import { createSocietyMetrics } from './societyMetrics';

const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});

const V1 = 'resident-action-plans-v1';
function town(actionPlans: boolean | 'resident-action-plans-v2' = true) {
  const root = mkdtempSync(join(tmpdir(), 'action-plans-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 2,
    continuity: true,
    physicalProduction: true,
    actionPlans,
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
  const turn = (actor: string, calls: [string, Record<string, unknown>][]) => {
    r.beginTurn(actor);
    const results = calls.map(([name, args]) =>
      r.invoke(actor, { name, arguments: args, requestId: `ap${++n}` }),
    );
    r.finishTurn(actor, { summary: 'test' });
    return results;
  };
  // Advance to the next time anything is due, as a scheduler would.
  const advanceToNext = () => {
    const now = r.state.world.clock.now;
    const next = Math.min(
      ...[
        ...Object.values(r.state.residents).map((x) => x.nextWakeAt),
        ...Object.values(r.state.world.activityTimeByAgent).map((x) => x.availableAt),
      ].filter((at) => at > now),
    );
    expect(r.advanceTime(Math.max(1, next - now), `adv${++n}`).ok).toBe(true);
  };
  return { root, r, m, a, b, turn, advanceToNext };
}

test('plans are off unless enabled, and only own actions in town syntax can be queued', () => {
  const off = town(false);
  const [refused] = off.turn(off.a, [
    [
      'schedule.plan',
      { id: 'p', note: 'x', steps: ['town travel go --target-location-id school'] },
    ],
  ]);
  expect(refused?.error).toBe('action-plans-not-enabled');

  expect(parseActionPlanStep('town travel go --target-location-id school', V1)).toMatchObject({
    capability: 'world.move',
    arguments: { targetLocationId: 'school' },
  });
  expect(() => parseActionPlanStep('town offers publish --id o --commodity Bread', V1)).toThrow(
    'plan-step-not-plannable',
  );
  expect(() => parseActionPlanStep('town nothing here', V1)).toThrow('plan-step-unknown-command');
  expect(() => parseActionPlanStep('rm -rf /', V1)).toThrow('plan-step-unparseable');
  expect(() =>
    parseActionPlanStep(
      'town travel go --target-location-id school --expected-revision current',
      V1,
    ),
  ).toThrow('plan-step-invalid');
});

test('the context hint is valid schedule.plan syntax whose example steps are plannable', () => {
  const t = town();
  expect(t.r.context(t.a)).toMatchObject({ plan: null, planWith: ACTION_PLAN_HINT });
  const argv = parseResidentCommand(ACTION_PLAN_HINT.split(' — ')[0]!);
  expect(argv.slice(0, 2)).toEqual(['schedule', 'plan']);
  const definition = OPEN_SOCIETY_TOOLS.find((tool) => tool.name === 'schedule.plan')!;
  const args = parseCapabilityFlags(definition, argv.slice(2), { validate: true });
  expect(args.steps).toHaveLength(2);
  expect((args.steps as string[]).map((step) => parseActionPlanStep(step, V1).capability)).toEqual([
    'world.move',
    'world.work',
  ]);
});

test('a queued production chain runs step by step and wakes the resident only when it is done', () => {
  const t = town();
  const step = (command: string) => command.replaceAll('$A', t.a);
  t.turn(t.a, [
    ['stocks.create', { id: 'shed', locationId: 'workshop', title: '我的棚子' }],
    [
      'schedule.plan',
      {
        id: 'bread-start',
        note: '先把小麦变成面粉',
        steps: [
          step(
            'town production gather --id g1 --stock-id shed --expected-revision current --source-id source-wheat --source-revision current --quantity 1 --product-name 麦 --description 采 --workers $A',
          ),
          'town production start --id g1 --expected-revision current --until complete',
          step(
            'town production create --id f1 --stock-id shed --expected-revision current --recipe-id flour --quantity 1 --product-name 面 --description 磨 --workers $A',
          ),
          'town production start --id f1 --expected-revision current --until complete',
        ],
      },
    ],
  ]);
  const turnsBefore = Object.keys(t.r.state.turns).length;
  // The plan already started after the opportunity: gathering is under way.
  expect(t.r.state.residents[t.a]!.plan).toMatchObject({ status: 'active', next: 2 });
  expect(t.r.state.residents[t.a]!.wakeReason).toBe('plan-step');
  for (let i = 0; i < 6 && t.r.state.residents[t.a]!.plan!.status === 'active'; i++)
    t.advanceToNext();
  expect(t.r.state.residents[t.a]!.plan).toMatchObject({ status: 'completed', next: 4 });
  // Every step has been carried out; the resident is woken when the last one's work ends.
  const wakeAt = t.r.state.residents[t.a]!.nextWakeAt;
  expect(wakeAt).toBe(t.r.state.world.activityTimeByAgent[t.a]!.availableAt);
  while (t.r.state.world.clock.now < wakeAt) t.advanceToNext();
  const resident = t.r.state.residents[t.a]!;
  expect(resident.nextWakeAt).toBeLessThanOrEqual(t.r.state.world.clock.now);
  expect(t.r.state.world.materials!.stocks.shed!.inventory).toEqual({ Flour: 1 });
  // No model opportunity was needed between steps.
  expect(Object.keys(t.r.state.turns).length).toBe(turnsBefore);
  expect(t.r.context(t.a)).toMatchObject({ plan: { status: 'completed' } });
  // Metrics keep steps the world ran apart from calls the resident made in the opportunity.
  const metrics = createSocietyMetrics(t.m);
  for (const commit of t.r.journal.commits) metrics.add(commit);
  const { attention, agency } = metrics.result();
  expect(attention.plans).toEqual({
    created: 1,
    stepsRun: 4,
    stepRefusals: 0,
    stepsByCapability: { 'production.gather': 1, 'production.create': 1, 'production.start': 2 },
    endings: { completed: 1 },
    stopReasons: {},
  });
  expect(agency.residentCalls).toBe(2);

  const before = structuredClone(t.r.state),
    bytes = readFileSync(join(t.root, 'journal.jsonl'));
  t.r.close();
  const next = new OpenSocietyRuntime(t.root);
  clean.push(() => next.close());
  expect(next.state).toEqual(before);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
});

test('a refused step stops the plan and wakes the resident with the real reason', () => {
  const t = town();
  t.turn(t.a, [
    [
      'schedule.plan',
      {
        id: 'bad',
        note: '试试',
        steps: [
          'town production start --id missing --expected-revision current --until complete',
          'town travel go --target-location-id school',
        ],
      },
    ],
  ]);
  const resident = t.r.state.residents[t.a]!;
  expect(resident.plan).toMatchObject({
    status: 'stopped',
    next: 0,
    lastResult: { ok: false, error: 'plan-resource-not-found' },
  });
  expect(resident.wakeReason).toBe('plan-stopped:plan-resource-not-found');
  const metrics = createSocietyMetrics(t.m);
  for (const commit of t.r.journal.commits) metrics.add(commit);
  expect(metrics.result().attention.plans).toMatchObject({
    stepsRun: 0,
    endings: { stopped: 1 },
    stopReasons: { 'plan-resource-not-found': 1 },
  });
  // The second step never ran.
  expect(t.r.state.world.transitByAgent?.[t.a]).toBeUndefined();
});

test('cancelling stops before the next step; the other resident is unaffected', () => {
  const t = town();
  t.turn(t.a, [
    [
      'schedule.plan',
      {
        id: 'walk',
        note: '散步',
        steps: [
          'town travel go --target-location-id school',
          'town travel go --target-location-id workshop',
        ],
      },
    ],
  ]);
  expect(t.r.state.residents[t.a]!.plan).toMatchObject({ status: 'active', next: 1 });
  const [cancelled] = t.turn(t.a, [['schedule.plan-cancel', {}]]);
  expect(cancelled?.ok).toBe(true);
  t.advanceToNext();
  expect(t.r.state.residents[t.a]!.plan!.status).toBe('cancelled');
  expect(t.r.state.residents[t.b]!.plan).toBeUndefined();
});

test('a plan re-queued under the same id at the same time runs its own steps', () => {
  const t = town();
  // The first plan fails at once (no such job), so the resident is woken at the same time and
  // queues a corrected plan under the same ID. Its steps must not collide with the first plan's.
  t.turn(t.a, [
    [
      'schedule.plan',
      {
        id: 'p',
        note: '试试',
        steps: ['town production start --id missing --expected-revision current --until complete'],
      },
    ],
  ]);
  expect(t.r.state.residents[t.a]!.plan).toMatchObject({ status: 'stopped' });
  const at = t.r.state.world.clock.now;
  t.turn(t.a, [
    [
      'schedule.plan',
      { id: 'p', note: '去学校', steps: ['town travel go --target-location-id school'] },
    ],
  ]);
  expect(t.r.state.world.clock.now).toBe(at);
  expect(t.r.state.residents[t.a]!.plan).toMatchObject({ status: 'completed', next: 1 });
  expect(t.r.state.world.transitByAgent?.[t.a]).toBeDefined();

  const before = structuredClone(t.r.state);
  t.r.close();
  const next = new OpenSocietyRuntime(t.root);
  clean.push(() => next.close());
  expect(next.state).toEqual(before);
});

test('v2 also lets residents plan using goods they own; v1 towns keep the v1 set', () => {
  const consume = 'town life consume --commodity-name Apple --quantity 1';
  expect(() => parseActionPlanStep(consume, V1)).toThrow('plan-step-not-plannable:life consume');
  expect(parseActionPlanStep(consume, 'resident-action-plans-v2')).toMatchObject({
    capability: 'world.consume',
    arguments: { commodityName: 'Apple', quantity: 1 },
  });
  const v1 = town(),
    v2 = town('resident-action-plans-v2');
  const plannable = (t: typeof v1) =>
    (t.r.context(t.a) as unknown as { plannable: string[] }).plannable;
  expect(plannable(v1)).not.toContain('life consume');
  expect(plannable(v2)).toEqual([...plannable(v1), 'life consume']);
  expect(v2.r.state.actionPlans?.version).toBe('resident-action-plans-v2');
  const [queued] = v2.turn(v2.a, [
    ['schedule.plan', { id: 'snack', note: '吃个苹果', steps: [consume] }],
  ]);
  expect(queued).toMatchObject({
    ok: true,
    data: { plan: { version: 'resident-action-plans-v2' } },
  });
});
