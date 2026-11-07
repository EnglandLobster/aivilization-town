import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { asLocationId } from '@aivilization/sim-core';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resident-engagements-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({ count: 4, continuity: true, serviceEngagements: enabled }),
    location = Object.values(m.initialWorld.locations).find(
      (l) => l.kind === 'healthcare',
    )!.locationId;
  const initialWorld = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a], i) => [
        id,
        {
          ...a,
          locationId: asLocationId(location),
          inventory: { ...a.inventory, Apple: 10, Book: 1 },
          educationScore: i === 1 ? 2000 : 1000,
          physiology: { energy: 100, satiety: 50, health: 50 },
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld,
    worldPolicies: serializableWorldPolicy(m.seed, initialWorld, m.rhythm),
  });
  cleanup.push(() => r.close());
  const [a, b, c, d] = m.residents.map((r) => r.id) as [string, string, string, string];
  let n = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown> = {},
    requestId = `eng-${++n}`,
  ) => {
    r.beginTurn(actor);
    const v = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Service engineering acceptance' });
    return v;
  };
  const ok = (
    actor: string,
    name: string,
    args: Record<string, unknown> = {},
    requestId?: string,
  ) => {
    const v = call(actor, name, args, requestId);
    expect(v.ok, `${name}:${v.error}`).toBe(true);
    return v;
  };
  const time = (ms: number) => {
    const v = r.advanceTime(ms, `tick-${++n}`);
    expect(v.ok, v.error).toBe(true);
  };
  const terms = (extra: Record<string, unknown> = {}) => ({
    id: 'svc',
    controllerKind: 'resident',
    controllerId: a,
    title: '居民自己命名的服务',
    terms: '按真实双方重叠时间收费，随时退出，余款退原出资者。',
    locationId: location,
    providerId: b,
    recipientId: c,
    payerSector: 'agent',
    payerId: d,
    revenueSector: 'agent',
    revenueId: a,
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: r.state.world.clock.now,
    endAt: r.state.world.clock.now + 7200000,
    reservationRefs: [],
    ...extra,
  });
  const engagement = () => r.state.world.serviceEngagements!.engagements.svc!;
  const op = (actor: string, name: string, extra: Record<string, unknown> = {}) =>
    ok(actor, `engagements.${name}`, {
      id: 'svc',
      expectedRevision: engagement().revision,
      ...extra,
    });
  const prepare = (extra: Record<string, unknown> = {}) => {
    ok(a, 'engagements.offer', terms(extra));
    op(c, 'accept');
    op(d, 'fund');
  };
  const supply = (items: Record<string, number>) => {
    ok(d, 'stocks.create', { id: 's', title: '独立供料', locationId: location });
    ok(d, 'stocks.deposit', { id: 's', expectedRevision: 1, items });
    ok(d, 'materials.reserve', {
      id: 'input',
      stockId: 's',
      expectedStockRevision: 2,
      beneficiaryKind: 'resident',
      beneficiaryId: a,
      consumerDomain: 'services',
      consumerId: 'svc',
      items,
      terms: '只给这个约定使用',
      expiresAt: r.state.world.clock.now + 7200000,
    });
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return {
    r,
    root,
    a,
    b,
    c,
    d,
    location,
    call,
    ok,
    time,
    terms,
    engagement,
    op,
    prepare,
    supply,
    replay,
  };
}
test('service CLI preserves independent consent, actual overlap, sponsor refunds, query privacy and restart', () => {
  const h = fixture();
  const payerBalance = h.r.state.world.agents[h.d]!.balance;
  h.ok(h.a, 'engagements.models');
  h.ok(h.a, 'engagements.facilities');
  h.ok(h.a, 'engagements.offer', h.terms());
  expect(h.call(h.d, 'engagements.accept', { id: 'svc', expectedRevision: 1 }).error).toBe(
    'service-recipient-consent-required',
  );
  h.op(h.c, 'accept');
  h.op(h.d, 'fund');
  h.op(h.b, 'start', { until: h.engagement().endAt });
  h.time(60000);
  expect(h.engagement().progressMs).toBe(0);
  h.op(h.c, 'start', { until: h.engagement().endAt });
  h.time(600000);
  expect(h.engagement().progressMs).toBe(600000);
  expect(h.engagement().charged).toBe(6);
  const ledger = h.ok(h.a, 'engagements.ledger', { id: 'svc', limit: 1 }).data;
  expect(JSON.stringify(ledger)).not.toMatch(
    /providerBefore|recipientBefore|educationScore|ownBefore/,
  );
  const own = h.ok(h.c, 'engagements.ledger', { id: 'svc', limit: 1 }).data;
  expect(JSON.stringify(own)).toContain('ownBefore');
  const experiences = h.r.state.experiences[h.d]!.filter((e) =>
    e.summary.includes('ResidentServiceEngagementsCommitted'),
  );
  expect(experiences.some((e) => e.summary.includes('educationScore'))).toBe(false);
  h.op(h.c, 'leave');
  expect(h.engagement().refunded).toBe(30);
  expect(h.r.state.world.agents[h.d]!.balance).toBeCloseTo(payerBalance - 6, 8);
  expect(h.r.state.world.activityTimeByAgent[h.b]!.availableAt).toBe(h.r.state.world.clock.now);
  h.replay();
});
test('CLI binds and consumes actual meal inputs, refunds the rest, and cannot withdraw bound materials', () => {
  const h = fixture();
  h.supply({ Apple: 4 });
  h.prepare({ modelId: 'meal-assistance-v1', reservationRefs: ['input@1'] });
  expect(h.call(h.d, 'materials.withdraw', { id: 'input', expectedRevision: 2 }).error).toBe(
    'material-reservation-not-offered',
  );
  h.op(h.b, 'start', { until: h.engagement().endAt });
  h.op(h.c, 'start', { until: h.engagement().endAt });
  h.time(900000);
  expect(h.r.state.world.materials!.reservations!.records.input!.allocated.Apple).toBeCloseTo(1, 9);
  h.op(h.b, 'leave');
  expect(h.r.state.world.materials!.stocks.s!.inventory.Apple).toBeCloseTo(3, 9);
  h.replay();
});
test('care uses real seeded facilities, actual elapsed time and no invented medication or qualifications', () => {
  const h = fixture();
  h.prepare({ modelId: 'supportive-care-v1' });
  h.op(h.b, 'start', { until: h.engagement().endAt });
  h.op(h.c, 'start', { until: h.engagement().endAt });
  h.time(3600000);
  expect(h.engagement().endReason).toBe('completed');
  const measured = Object.values(h.r.state.world.serviceEngagements!.settlements).reduce(
    (n, f) => n + f.recipientAfter.health - f.recipientBefore.health,
    0,
  );
  expect(measured).toBeCloseTo(4, 8);
  expect(h.engagement().charged).toBe(36);
  h.replay();
});
test('legacy worlds require explicit enabling with no automatic assets and hidden contracts stay private', () => {
  const h = fixture(false);
  expect(h.call(h.a, 'engagements.models').error).toBe('service-engagements-not-enabled');
  expect(h.r.enableServiceEngagements().ok).toBe(true);
  expect(h.r.state.world.premises!.serviceFacilityEndowments).toBeUndefined();
  h.prepare({ modelId: 'supportive-care-v1' });
  expect(
    h.call(h.b, 'engagements.start', {
      id: 'svc',
      expectedRevision: h.engagement().revision,
      until: h.engagement().endAt,
    }).error,
  ).toBe('service-facility-unavailable');
  h.op(h.c, 'cancel');
  const original = h.terms({ id: 'private', payerId: h.a });
  h.ok(h.a, 'engagements.offer', original);
  expect(h.call(h.d, 'engagements.read', { id: 'private' }).error).toBe(
    'service-engagement-not-found',
  );
  h.replay();
});
test('collective exact decisions can fund a service while nobody can vote another person into participation', () => {
  const h = fixture();
  h.ok(h.a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同服务安排',
      terms: '两人各自同意',
      members: [h.a, h.d],
      voters: [h.a, h.d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: h.r.state.world.clock.now + 100000,
  });
  h.ok(h.d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  h.ok(h.a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '服务资金' });
  h.ok(h.d, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 36, note: '本人出资' });
  h.ok(h.a, 'engagements.offer', h.terms({ payerSector: 'collective', payerId: 'pool' }));
  h.op(h.c, 'accept');
  expect(
    h.call(h.a, 'engagements.fund', { id: 'svc', expectedRevision: h.engagement().revision }).error,
  ).toBe('service-payer-authority-required');
  const proposal = (id: string, capability: string, args: Record<string, unknown>) => ({
    id,
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '精确资源决定',
    action: { kind: 'resource', capability, resourceId: 'svc', arguments: args },
    closesAt: h.r.state.world.clock.now + 10000,
    executeBefore: h.r.state.world.clock.now + 20000,
  });
  expect(
    h.call(
      h.a,
      'collectives.propose',
      proposal('bad', 'engagements.start', { expectedRevision: 2, until: h.engagement().endAt }),
    ).ok,
  ).toBe(false);
  h.ok(h.a, 'collectives.propose', proposal('pay', 'engagements.fund', { expectedRevision: 2 }));
  h.ok(h.a, 'collectives.vote', { id: 'pay', expectedRevision: 1, vote: 'yes' });
  h.ok(h.d, 'collectives.vote', { id: 'pay', expectedRevision: 2, vote: 'yes' });
  h.ok(h.a, 'collectives.decide', { id: 'pay', expectedRevision: 3 });
  h.ok(h.a, 'collectives.execute', { id: 'pay', expectedRevision: 4 }, 'pay-once');
  expect(h.engagement().fundingDecisionId).toBe('pay');
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  h.op(h.c, 'cancel');
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(36);
  h.replay();
});
