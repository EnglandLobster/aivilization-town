import { expect, test } from 'vitest';
import { openFreightFixture } from './testFixtures/openFreight';

function prepared() {
  const h = openFreightFixture();
  h.prepare();
  h.op(h.b, 'load');
  expect(h.r.enableFreightCustody().ok).toBe(true);
  const act = (
    actor: string,
    action: string,
    extra: Record<string, unknown> = {},
    requestId?: string,
  ) =>
    h.ok(
      actor,
      'freight.handoff',
      { id: 'parcel', handoffId: 'handoff', action, ...extra },
      requestId,
    );
  act(h.b, 'propose', { nextCarrierId: h.outsider, expiresAt: h.r.state.world.clock.now + 100000 });
  return { ...h, act };
}
test('authenticated handoff is discoverable, independent, personally executed, idempotent and durable through real delivery', () => {
  const h = prepared();
  expect(h.ok(h.outsider, 'freight.read', { id: 'parcel' }).ok).toBe(true);
  expect(h.ok(h.outsider, 'freight.handoffs', { id: 'parcel', limit: 1 }).ok).toBe(true);
  expect(
    h.call(h.outsider, 'freight.handoff', {
      id: 'parcel',
      handoffId: 'handoff',
      action: 'accept',
      expectedRevision: 1,
    }).error,
  ).toBe('custody-independent-consents-required');
  for (const [i, [actor, role]] of [
    [h.a, 'source'],
    [h.c, 'recipient'],
    [h.d, 'payer'],
    [h.b, 'previous-carrier'],
  ].entries())
    h.act(actor!, 'consent', { role, expectedRevision: i + 1 });
  const before = structuredClone(h.r.state.world),
    originalBalance = before.agents[h.b]!.balance;
  h.act(h.outsider, 'accept', { expectedRevision: 5 }, 'same-accept');
  h.act(h.outsider, 'accept', { expectedRevision: 5 }, 'same-accept');
  expect(h.r.state.world.logistics!.custody!.proposals.handoff!.revision).toBe(6);
  expect(h.r.state.world.materials).toEqual(before.materials);
  expect(h.r.state.world.agents).toEqual(before.agents);
  expect(
    h.call(h.b, 'freight.return', { id: 'parcel', expectedRevision: h.freight().revision }).error,
  ).toBe('freight-personal-carrier-required');
  h.ok(h.outsider, 'world.move', { targetLocationId: h.east });
  h.time(h.r.state.world.transitByAgent![h.outsider]!.arrivesAt - h.r.state.world.clock.now);
  h.op(h.outsider, 'deliver');
  expect(h.r.state.world.materials!.stocks.dst!.inventory).toEqual({ Wood: 4 });
  expect(h.r.state.world.agents[h.b]!.balance).toBe(originalBalance + 8);
  expect(h.freight().carrierId).toBe(h.b);
  h.replay();
});
test('old journal needs explicit idempotent activation; uninvited readers and forged actor arguments cannot obtain custody', () => {
  const h = openFreightFixture();
  h.prepare();
  h.op(h.b, 'load');
  expect(h.call(h.outsider, 'freight.read', { id: 'parcel' }).error).toBe('freight-not-found');
  expect(h.call(h.b, 'freight.handoffs', { id: 'parcel' }).error).toBe(
    'freight-custody-not-enabled',
  );
  expect(h.ok(h.b, 'freight.rules').data).toMatchObject({ handoff: { enabled: false } });
  const manifest = structuredClone(h.r.manifest),
    before = structuredClone(h.r.state.world);
  expect(h.r.enableFreightCustody().ok).toBe(true);
  const revision = h.r.state.revision;
  expect(h.r.enableFreightCustody().ok).toBe(true);
  expect(h.r.state.revision).toBe(revision);
  expect(h.r.manifest).toEqual(manifest);
  expect(h.r.state.world.materials).toEqual(before.materials);
  expect(h.ok(h.b, 'freight.rules').data).toMatchObject({
    handoff: { enabled: true, scope: 'personal-stationary-handoff' },
  });
  expect(h.call(h.outsider, 'freight.handoffs', { id: 'parcel' }).error).toBe('freight-not-found');
  expect(
    h.call(h.b, 'freight.handoff', {
      id: 'parcel',
      handoffId: 'x',
      action: 'propose',
      nextCarrierId: h.outsider,
      expiresAt: 100000,
      actorId: h.a,
    }).ok,
  ).toBe(false);
  expect(Object.keys(h.r.state.world.logistics!.custody!.proposals)).toHaveLength(0);
  h.replay();
});
test('withdrawal removes invitation access and prevents execution without rewriting previous consent', () => {
  const h = prepared();
  h.act(h.a, 'consent', { role: 'source', expectedRevision: 1 });
  h.act(h.outsider, 'withdraw', { expectedRevision: 2 });
  expect(h.call(h.outsider, 'freight.read', { id: 'parcel' }).error).toBe('freight-not-found');
  expect(
    h.call(h.outsider, 'freight.handoff', {
      id: 'parcel',
      handoffId: 'handoff',
      action: 'accept',
      expectedRevision: 3,
    }).error,
  ).toBe('custody-proposal-stale');
  expect(h.r.state.world.logistics!.custody!.proposals.handoff!.consents.source).toEqual({
    actorId: h.a,
  });
  h.replay();
});
