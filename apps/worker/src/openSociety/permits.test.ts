import { expect, test } from 'vitest';
import { openPermitsFixture as fixture } from './testFixtures/openPermits';

test('real permit CLI grants independent scoped access; actor cannot inject consent or read others originals', () => {
  const t = fixture();
  expect(t.call(t.c, 'world.move', { targetLocationId: 'premises-home' }).ok).toBe(false);
  expect(t.call(t.b, 'permits.offer', { ...t.offer(), actorId: t.c }).ok).toBe(false);
  t.ok(t.b, 'permits.offer', t.offer());
  expect(t.call(t.b, 'permits.accept', { id: 'permit', expectedRevision: 1 }).error).toBe(
    'permit-grantee-authority-required',
  );
  expect(t.call(t.d, 'permits.read', { id: 'permit' }).error).toBe('permit-not-found');
  const accept = { id: 'permit', expectedRevision: 1 };
  t.ok(t.c, 'permits.accept', accept, 'accept-once');
  const permissionRevision = t.r.state.world.premisesRights!.permits.permit!.revision;
  t.ok(t.c, 'permits.accept', accept, 'accept-once');
  expect(t.r.state.world.premisesRights!.permits.permit!.revision).toBe(permissionRevision);
  expect(t.ok(t.c, 'permits.access', { buildingId: 'home' }).data).toMatchObject({
    permissions: {
      operate: { allowed: true },
      store: { allowed: true },
      reside: { allowed: false },
    },
  });
  t.ok(t.c, 'world.move', { targetLocationId: 'premises-home' });
  t.time(60000);
  t.ok(t.c, 'stocks.create', { id: 'own', title: '自己的材料', locationId: 'premises-home' });
  t.ok(t.c, 'stocks.deposit', { id: 'own', expectedRevision: 1, items: { Wood: 1 } });
  t.ok(t.c, 'permits.release', { id: 'permit', expectedRevision: 2 });
  expect(
    t.call(t.c, 'stocks.deposit', { id: 'own', expectedRevision: 2, items: { Wood: 1 } }).error,
  ).toBe('material-storage-permit-required');
  t.ok(t.c, 'stocks.withdraw', {
    id: 'own',
    expectedRevision: 2,
    recipientId: t.c,
    items: { Wood: 1 },
  });
  const others = t.r.state.experiences[t.d] ?? [];
  expect(others.some((e) => e.summary.includes('ResidentPremisesRightsCommitted'))).toBe(false);
  t.replay();
});
test('expiry scheduling settles actual production through the boundary; stale work cannot restart', () => {
  const t = fixture(),
    duration = t.r.state.world.materials!.policy.recipes.find((r) => r.id === 'book')!.workMs,
    endAt = t.r.state.world.clock.now + 60000 + duration;
  t.ok(t.b, 'permits.offer', t.offer('permit', { endAt }));
  t.ok(t.c, 'permits.accept', { id: 'permit', expectedRevision: 1 });
  t.ok(t.c, 'world.move', { targetLocationId: 'premises-home' });
  t.time(60000);
  t.ok(t.c, 'stocks.create', { id: 'own', title: '自己的材料', locationId: 'premises-home' });
  t.ok(t.c, 'stocks.deposit', { id: 'own', expectedRevision: 1, items: { Wood: 1 } });
  t.ok(t.c, 'production.create', {
    id: 'job',
    stockId: 'own',
    expectedRevision: 2,
    recipeId: 'book',
    quantity: 1,
    productName: '作品',
    description: '自己命名',
    workers: [t.c],
  });
  t.ok(t.c, 'production.start', { id: 'job', expectedRevision: 1, until: endAt });
  expect(t.call(t.c, 'permits.release', { id: 'permit', expectedRevision: 2 }).error).toBe(
    'permit-active-work-must-end-first',
  );
  t.time(duration);
  expect(t.r.state.world.materials!.productions.job).toMatchObject({
    status: 'completed',
    progressMs: duration,
  });
  expect(t.r.state.world.materials!.stocks.own!.inventory.Book).toBe(1);
  expect(t.r.state.world.premisesRights!.permits.permit!.status).toBe('expired');
  expect(t.ok(t.c, 'permits.access', { buildingId: 'home' }).data).toMatchObject({
    permissions: { operate: { allowed: false }, entry: { allowed: true } },
  });
  t.replay();
});
test('collective acceptance requires separate member votes and exact proof, membership alone never grants it', () => {
  const t = fixture(),
    now = t.r.state.world.clock.now;
  t.ok(t.c, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同工坊',
      terms: '两人独立确认',
      members: [t.c, t.d],
      voters: [t.c, t.d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: now + 86400000,
  });
  t.ok(t.d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  t.ok(
    t.b,
    'permits.offer',
    t.offer('permit', {
      granteeKind: 'collective',
      granteeId: 'club',
      users: [t.c, t.d],
      acceptBy: now + 240000,
    }),
  );
  expect(t.call(t.c, 'permits.accept', { id: 'permit', expectedRevision: 1 }).error).toBe(
    'permit-grantee-authority-required',
  );
  t.ok(t.c, 'collectives.propose', {
    id: 'accept-permit',
    collectiveId: 'club',
    expectedVersion: t.r.state.collectives!.charters.club!.version,
    terms: '接纳场所许可的原文',
    action: {
      kind: 'resource',
      capability: 'permits.accept',
      resourceId: 'permit',
      arguments: { expectedRevision: 1 },
    },
    closesAt: now + 120000,
    executeBefore: now + 180000,
  });
  for (const actor of [t.c, t.d])
    t.ok(actor, 'collectives.vote', {
      id: 'accept-permit',
      expectedRevision: t.r.state.collectives!.decisions['accept-permit']!.revision,
      vote: 'yes',
    });
  t.ok(t.c, 'collectives.decide', {
    id: 'accept-permit',
    expectedRevision: t.r.state.collectives!.decisions['accept-permit']!.revision,
  });
  t.ok(t.d, 'collectives.execute', {
    id: 'accept-permit',
    expectedRevision: t.r.state.collectives!.decisions['accept-permit']!.revision,
  });
  expect(t.r.state.world.premisesRights!.permits.permit!.accepted).toMatchObject({
    actorId: t.d,
    decisionId: 'accept-permit',
  });
  expect(t.r.state.world.activityTimeByAgent[t.c]?.availableAt ?? 0).toBeLessThanOrEqual(now);
  t.replay();
});
test('explicit enable on old journals is idempotent and adds no assets or implicit permission', () => {
  const t = fixture(false),
    world = t.r.state.world;
  expect(t.call(t.c, 'permits.rules', {}).error).toBe('premises-rights-not-enabled');
  expect(t.r.enablePremisesRights().ok).toBe(true);
  const { premisesRights, ...rest } = t.r.state.world;
  expect(rest).toEqual(world);
  expect(premisesRights?.permits).toEqual({});
  const before = t.r.state;
  expect(t.r.enablePremisesRights().ok).toBe(true);
  expect(t.r.state).toEqual(before);
  t.replay();
});
test('one large time step and multiple smaller steps expire the same offer at the exact boundary', () => {
  const a = fixture(),
    b = fixture();
  a.ok(a.b, 'permits.offer', a.offer());
  b.ok(b.b, 'permits.offer', b.offer());
  a.time(120000);
  for (let n = 0; n < 4; n++) b.time(30000);
  expect(a.r.state.world.premisesRights).toEqual(b.r.state.world.premisesRights);
  expect(a.r.state.world.premisesRights!.permits.permit!.closed?.at).toBe(
    a.r.state.world.premisesRights!.permits.permit!.acceptBy,
  );
  a.replay();
  b.replay();
});
test('batch expiry keeps each private permit participants out of the other grantees personal experiences', () => {
  const t = fixture(),
    endAt = t.r.state.world.clock.now + 60000;
  t.ok(t.b, 'permits.offer', t.offer('first', { endAt }));
  t.ok(t.c, 'permits.accept', { id: 'first', expectedRevision: 1 });
  t.ok(t.b, 'permits.offer', t.offer('second', { granteeId: t.d, users: [t.d], endAt }));
  t.ok(t.d, 'permits.accept', { id: 'second', expectedRevision: 1 });
  t.time(60000);
  const own = t.r.state.experiences[t.c]!.filter((e) =>
    e.summary.includes('ResidentPremisesRightsCommitted'),
  );
  expect(own.some((e) => e.summary.includes('expired'))).toBe(true);
  expect(own.every((e) => !e.people.includes(t.d) && !e.summary.includes('second'))).toBe(true);
  expect(t.call(t.c, 'permits.read', { id: 'second' }).error).toBe('permit-not-found');
  t.replay();
});
