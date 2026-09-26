import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function setup(continuity = true, resultLimit = 24000) {
  const root = mkdtempSync(join(tmpdir(), 'resident-continuity-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({ count: 3, continuity, initialization: 'newcomers' });
  const r = new OpenSocietyRuntime(root, {
    ...manifest,
    policy: { ...manifest.policy, maxResultChars: resultLimit },
  });
  cleanup.push(() => r.close());
  const [a, b, c] = manifest.residents.map((x) => x.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `test-${++n}` });
    r.finishTurn(actor, { summary: 'test' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const result = call(actor, name, args);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result.data as Record<string, unknown>;
  };
  const group = () => {
    ok(a, 'groups.create', { id: 'g', title: '同伴' });
    const invite = ok(a, 'groups.invite', { groupId: 'g', residentId: b });
    ok(b, 'groups.accept', { id: invite.id, expectedRevision: 1 });
  };
  const replay = () => {
    const state = structuredClone(r.state);
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
  };
  return { r, root, a, b, c, call, ok, group, replay };
}

test('original reads persist by person/source, page receipts do not skip unseen messages, attention protects pending decisions', () => {
  const { r, a, b, c, call, ok, group, replay } = setup();
  group();
  ok(b, 'proposals.create', { id: 'p', participants: [a], terms: '可以不回应', expiresAt: 100000 });
  r.advanceTime(1, 'tick');
  for (let i = 0; i < 6; i++) ok(b, 'groups.send', { groupId: 'g', content: `原话-${i}` });
  expect(r.context(a).lifeInbox?.items.some((i) => i.kind === 'proposal')).toBe(true);
  expect(call(c, 'groups.messages', { groupId: 'g' }).ok).toBe(false);
  const latest = ok(a, 'groups.messages', { groupId: 'g', limit: 1 }) as {
    items: { id: string; content: string }[];
  };
  const id = latest.items[0]!.id;
  expect(r.state.communication?.readMessageIds?.[a]).toEqual([id]);
  expect(r.context(a).lifeInbox?.sections.find((s) => s.section === 'messages')?.total).toBe(5);
  const memories = r.state.experiences[a]!.filter((e) => e.sourceIds.includes(id));
  expect(memories).toHaveLength(1);
  expect(memories[0]?.people).toContain(b);
  ok(a, 'groups.messages', { groupId: 'g', limit: 1 });
  expect(r.state.experiences[a]!.filter((e) => e.sourceIds.includes(id))).toHaveLength(1);
  expect(ok(a, 'memory.search', { personId: b, sourceId: id }).total).toBe(1);
  ok(a, 'groups.close', { groupId: 'g', expectedRevision: 2 });
  expect(ok(a, 'memory.read', { id: memories[0]!.id }).summary).toContain('原话-5');
  replay();
});

test('oversized original read cannot mark messages read or manufacture perception', () => {
  const { r, a, b, call, ok, group } = setup(true, 1200);
  group();
  ok(b, 'groups.send', { groupId: 'g', content: '原'.repeat(1800) });
  const before = r.state.experiences[a]?.length ?? 0;
  expect(call(a, 'groups.messages', { groupId: 'g' })).toMatchObject({
    ok: false,
    error: 'read-result-too-large',
  });
  expect(r.state.experiences[a]?.length ?? 0).toBe(before);
  expect(r.state.communication?.readMessageIds?.[a]).toBeUndefined();
});

test('feed reads preserve fixed originals and participants, personal pin survives newer notes', () => {
  const { r, a, b, ok, replay } = setup();
  ok(a, 'files.create', {
    spaceId: 'app-reviews',
    path: 'posts/read.md',
    content: '值得参考的原始看法',
  });
  const publication = Object.values(r.state.distribution!.publications)[0]!;
  ok(b, 'feed.read', { id: publication.id });
  ok(b, 'feed.read', { id: publication.id });
  const memories = r.state.experiences[b]!.filter((e) => e.sourceIds.includes(publication.id));
  expect(memories).toHaveLength(1);
  expect(memories[0]!.people).toContain(a);
  ok(b, 'cognition.update', {
    key: 'long-term',
    kind: 'goal',
    statement: '我自己想做的事',
    confidence: 0.5,
    evidenceIds: [],
    expectedRevision: 0,
    active: true,
    pinned: true,
    people: [a],
  });
  r.advanceTime(1000, 'advance');
  for (let i = 0; i < 10; i++)
    ok(b, 'cognition.update', {
      key: `note-${i}`,
      kind: 'note',
      statement: '小事',
      confidence: 0.5,
      evidenceIds: [],
      expectedRevision: 0,
      active: true,
    });
  expect(r.context(b).cognition.items[0]?.key).toBe('long-term');
  ok(b, 'schedule.configure', { freeActivityIntervalMs: 7200000 });
  expect(r.state.residents[b]!.nextWakeAt - r.state.world.clock.now).toBe(7200000);
  replay();
});

test('disputed partial refund can be settled with independent consent and exact conserved funds', () => {
  const { r, a, b, c, call, ok, replay } = setup();
  const startingA = r.state.world.agents[a]!.balance,
    startingB = r.state.world.agents[b]!.balance,
    supply = r.state.world.moneySupply;
  ok(a, 'offers.publish', {
    id: 'f',
    kind: 'service',
    commodity: 'service',
    description: '写一段文字',
    unitPrice: 10,
    maxQuantity: 1,
    deliveryMode: 'remote',
  });
  ok(b, 'orders.create', { id: 'o', offerId: 'f', offerRevision: 1, quantity: 1 });
  const rev = () => r.state.world.residentCommerce!.orders.o!.revision;
  ok(a, 'orders.accept', { id: 'o', expectedRevision: rev() });
  ok(b, 'orders.pay', { id: 'o', expectedRevision: rev() });
  ok(a, 'orders.deliver', { id: 'o', expectedRevision: rev(), content: '原始作品' });
  ok(b, 'orders.dispute', { id: 'o', expectedRevision: rev(), content: '协商一下' });
  ok(a, 'orders.refund', { id: 'o', expectedRevision: rev(), amount: 2 });
  ok(a, 'orders.propose-settlement', {
    id: 'o',
    expectedRevision: rev(),
    amount: 0,
    content: '已退2元，剩余8元结算',
  });
  expect(
    call(a, 'orders.respond-settlement', { id: 'o', expectedRevision: rev(), accept: true }).ok,
  ).toBe(false);
  expect(
    call(c, 'orders.respond-settlement', { id: 'o', expectedRevision: rev(), accept: true }).ok,
  ).toBe(false);
  const stale = rev();
  ok(b, 'orders.respond-settlement', { id: 'o', expectedRevision: rev(), accept: false });
  expect(r.state.world.residentCommerce!.orders.o!.escrow).toBe(8);
  ok(b, 'orders.propose-settlement', {
    id: 'o',
    expectedRevision: rev(),
    amount: 0,
    content: '我接受剩余8元交易',
  });
  expect(
    call(a, 'orders.respond-settlement', { id: 'o', expectedRevision: stale, accept: true }).ok,
  ).toBe(false);
  ok(a, 'orders.respond-settlement', { id: 'o', expectedRevision: rev(), accept: true });
  expect(r.state.world.residentCommerce!.orders.o).toMatchObject({
    status: 'settled',
    escrow: 0,
    refunded: 2,
  });
  expect(r.state.world.agents[a]!.balance).toBe(startingA + 8);
  expect(r.state.world.agents[b]!.balance).toBe(startingB - 8);
  expect(r.state.world.moneySupply).toBe(supply);
  expect(
    r.state.experiences[b]!.some((e) => e.summary.includes('settled') && e.people.includes(a)),
  ).toBe(true);
  replay();
});

test('hosted service reserves provider time, attendee can leave without teleport or satisfaction claims', () => {
  const { r, a, b, c, call, ok, replay } = setup();
  ok(a, 'services.publish', {
    id: 's',
    kind: 'appointment',
    locationId: 'town-square',
    title: '交流',
    description: '自愿参与',
    capacity: 2,
  });
  ok(a, 'services.schedule', { id: 'slot', serviceId: 's', start: 1000, end: 5000, capacity: 2 });
  ok(b, 'bookings.request', { id: 'b', slotId: 'slot', units: 1 });
  ok(a, 'bookings.accept', { id: 'b', expectedRevision: 1 });
  r.advanceTime(1000, 'start');
  expect(call(b, 'bookings.check-in', { id: 'b', expectedRevision: 2 })).toMatchObject({
    ok: false,
    error: 'provider-session-not-active',
  });
  ok(a, 'services.start', { id: 'slot', expectedRevision: 1 });
  expect(r.state.world.activityTimeByAgent[a]?.availableAt).toBe(5000);
  ok(b, 'bookings.check-in', { id: 'b', expectedRevision: 2 });
  r.advanceTime(1000, 'middle');
  expect(call(c, 'bookings.leave', { id: 'b', expectedRevision: 3 }).ok).toBe(false);
  ok(b, 'bookings.leave', { id: 'b', expectedRevision: 3 });
  expect(r.state.services!.bookings.b).toMatchObject({
    status: 'ended',
    attendedMs: 1000,
    providerOverlapMs: 1000,
  });
  expect(r.state.world.activityTimeByAgent[b]?.availableAt).toBe(2000);
  expect(r.state.world.activityTimeByAgent[a]?.availableAt).toBe(5000);
  expect(r.state.world.agents[b]!.locationId).toBe('town-square');
  replay();
});

test('natural-day wages scale with real duration; old manifests keep old parameters', () => {
  const { r, a, ok, replay } = setup();
  const legacy = createOpenSocietyManifest({ count: 3 });
  expect(legacy.rhythm).toBeUndefined();
  expect(legacy.worldPolicies.sleep).toMatchObject({ energyRecoveryPerSecond: 1 });
  ok(a, 'world.apply_job', { occupationName: 'Cleaner' });
  const advance = r.advanceTime(86400000, 'eligibility');
  expect(advance.ok).toBe(true);
  // Start a fresh funded initial scenario below, without waiting through hunger for this wage check.
  const manifest = createOpenSocietyManifest({
    count: 10,
    continuity: true,
    initialization: 'settled',
    seed: 'rhythm-check',
  });
  const root = mkdtempSync(join(tmpdir(), 'wage-continuity-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const worker = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => worker.close());
  const employed = Object.values(worker.state.world.agents).find((p) => p.job === 'Cleaner')!;
  expect(employed).toBeDefined();
  // Work is only possible at the actual workplace, reached through world movement.
  worker.beginTurn(employed.agentId);
  const travel = worker.invoke(employed.agentId, {
    name: 'world.move',
    arguments: { targetLocationId: 'workshop' },
    requestId: 'travel',
  });
  expect(travel.ok).toBe(true);
  worker.finishTurn(employed.agentId, { summary: 'travel' });
  const until = worker.state.world.activityTimeByAgent[employed.agentId]!.availableAt;
  if (until > worker.state.world.clock.now)
    worker.advanceTime(until - worker.state.world.clock.now, 'arrive');
  worker.beginTurn(employed.agentId);
  const work = worker.invoke(employed.agentId, {
    name: 'world.work',
    arguments: { occupationName: 'Cleaner', laborSeconds: 3600 },
    requestId: 'work',
  });
  expect(work.ok, work.error).toBe(true);
  const wage = worker.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .find((e) => e.type === 'WagePaid');
  expect(wage).toMatchObject({
    type: 'WagePaid',
    payload: { amount: 31.25, laborSeconds: 3600, laborPayPolicy: { referenceSeconds: 28800 } },
  });
  replay();
});
