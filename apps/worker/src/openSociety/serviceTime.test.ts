import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asLocationId } from '@aivilization/sim-core';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'service-time-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 3,
    continuity: true,
    elapsedRest: true,
    serviceTime: enabled,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: asLocationId('town-square'),
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
  const [provider, recipient, manager] = m.residents.map((a) => a.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId: `service-time-${++n}` });
    r.finishTurn(actor, { summary: 'Directed continuous service verification' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const v = call(actor, name, args);
    expect(v.ok, v.error).toBe(true);
    return v;
  };
  const operate = (actor: string, action: string, extra: Record<string, unknown> = {}) =>
    ok(actor, `engagements.${action}`, {
      id: 'service',
      expectedRevision: r.state.world.serviceEngagements!.engagements.service!.revision,
      ...extra,
    });
  const setup = (controller = provider) => {
    ok(controller, 'engagements.offer', {
      id: 'service',
      controllerKind: 'resident',
      controllerId: controller,
      title: 'Residents choose the purpose',
      terms: 'Actual mutual participation; no employee wages assumed',
      locationId: 'town-square',
      providerId: provider,
      recipientId: recipient,
      payerSector: 'agent',
      payerId: recipient,
      revenueSector: 'agent',
      revenueId: controller,
      providerShareBps: 5000,
      pricePerHour: 36,
      modelId: 'personal-assistance-v1',
      maxDurationMs: 3600000,
      startAt: 0,
      endAt: 7200000,
      reservationRefs: [],
    });
    operate(recipient, 'accept');
    operate(recipient, 'fund');
    operate(provider, 'start', { until: 3600000 });
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const again = new OpenSocietyRuntime(root);
    cleanup.push(() => again.close());
    expect(again.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, provider, recipient, manager, call, ok, operate, setup, replay };
}
test('one-sided waiting has no service effect, independent overlap charges once, leaving stops both without claiming employee wages', () => {
  const t = fixture();
  t.setup();
  const balance = t.r.state.world.agents[t.provider]!.balance;
  expect(t.r.advanceTime(60000, 'provider-wait').ok).toBe(true);
  expect(t.r.state.world.serviceEngagements!.engagements.service!.progressMs).toBe(0);
  expect(t.r.state.world.agents[t.provider]!.balance).toBe(balance);
  t.operate(t.recipient, 'start', { until: 3600000 });
  expect(t.r.advanceTime(900000, 'actual-overlap').ok).toBe(true);
  expect(t.r.state.world.serviceEngagements!.engagements.service!).toMatchObject({
    progressMs: 900000,
    charged: 9,
    providerPaid: 4.5,
    revenuePaid: 4.5,
  });
  expect(t.r.state.world.agents[t.provider]!.balance).toBeCloseTo(balance + 9, 8);
  expect(t.call(t.provider, 'world.sleep', { durationSeconds: 60 }).ok).toBe(false);
  t.operate(t.recipient, 'leave');
  const before = structuredClone(t.r.state.world.serviceEngagements);
  expect(t.r.advanceTime(60000, 'after-leave').ok).toBe(true);
  expect(t.r.state.world.serviceEngagements).toEqual(before);
  expect(t.r.state.world.activityTimeByAgent[t.provider]!.availableAt).toBe(960000);
  expect(t.ok(t.provider, 'engagements.models', {}).data).toMatchObject({
    actualBody: { policyVersion: 'resident-service-time-v1' },
  });
  t.replay();
});
test('service time upgrade refuses active old participation, then explicitly enables without rewriting manifest or past fees', () => {
  const t = fixture(false);
  t.setup();
  const manifest = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableServiceTime().ok).toBe(false);
  t.operate(t.provider, 'leave');
  const prior = structuredClone(t.r.state.world.serviceEngagements);
  expect(t.r.enableServiceTime().ok).toBe(true);
  expect(t.r.state.world.serviceEngagements).toEqual(prior);
  const revision = t.r.state.revision;
  expect(t.r.enableServiceTime().ok).toBe(true);
  expect(t.r.state.revision).toBe(revision);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  t.replay();
});

test('service ledger exposes only each participant own body, including when nested time proofs exist', () => {
  const t = fixture(); t.setup(t.manager);
  t.operate(t.recipient, 'start', { until: 3600000 });
  expect(t.r.advanceTime(60000, 'ledger-overlap').ok).toBe(true);
  for (const actor of [t.provider, t.recipient, t.manager]) {
    const result = t.ok(actor, 'engagements.ledger', { id: 'service' });
    const serialized = JSON.stringify(result.data);
    for (const privateKey of ['providerBefore', 'providerAfter', 'recipientBefore', 'recipientAfter', 'elapsedBody'])
      expect(serialized).not.toContain(privateKey);
    expect(serialized.includes('ownBefore')).toBe(actor !== t.manager);
    expect(serialized.includes('charge')).toBe(true);
  }
  t.replay();
});
