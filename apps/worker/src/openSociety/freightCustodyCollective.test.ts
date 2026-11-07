import { expect, test } from 'vitest';
import { openFreightFixture } from './testFixtures/openFreight';
import { applyOpenSocietyEffects } from './state';
import { executeCollectiveResource } from './collectiveResources';
import { applyWorldEvent } from '@aivilization/world';
function fixture() {
  const h = openFreightFixture();
  h.ok(h.a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同费用',
      terms: '双方确认',
      members: [h.a, h.d],
      voters: [h.a, h.d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: 100000,
  });
  h.ok(h.d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  h.ok(h.a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '费用' });
  h.ok(h.d, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 8, note: '这一次' });
  const approve = (id: string, capability: string, args: Record<string, unknown>) => {
    h.ok(h.a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: h.r.state.collectives!.charters.club!.version,
      terms: '只执行所列动作',
      action: { kind: 'resource', capability, resourceId: 'parcel', arguments: args },
      closesAt: 10000,
      executeBefore: 20000,
    });
    for (const actor of [h.a, h.d])
      h.ok(actor, 'collectives.vote', {
        id,
        expectedRevision: h.r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    h.ok(h.a, 'collectives.decide', {
      id,
      expectedRevision: h.r.state.collectives!.decisions[id]!.revision,
    });
  };
  const execute = (id: string, actor = h.d) =>
    h.ok(actor, 'collectives.execute', {
      id,
      expectedRevision: h.r.state.collectives!.decisions[id]!.revision,
    });
  h.prepare(false, true);
  approve('pay', 'freight.fund', { expectedRevision: h.freight().revision });
  execute('pay');
  h.op(h.b, 'load');
  expect(h.r.enableFreightCustody().ok).toBe(true);
  expect(
    h.call(h.b, 'freight.handoff', {
      id: 'parcel',
      action: 'propose',
      handoffId: 'relay',
      nextCarrierId: h.outsider,
      expiresAt: 100000,
    }).error,
  ).toBe('custody-collective-grant-adapter-required');
  expect(h.r.enableCollectiveFreightCustody().ok).toBe(true);
  const act = (actor: string, action: string, args: Record<string, unknown> = {}) =>
    h.ok(actor, 'freight.handoff', { id: 'parcel', handoffId: 'relay', action, ...args });
  act(h.b, 'propose', { nextCarrierId: h.outsider, expiresAt: 100000 });
  for (const [i, [actor, role]] of [
    [h.a, 'source'],
    [h.c, 'recipient'],
    [h.b, 'previous-carrier'],
  ].entries())
    act(actor!, 'consent', { role, expectedRevision: i + 1 });
  return { ...h, approve, execute, act };
}
test('consumed exact collective consent remains usable for personal physical acceptance, return and refund', () => {
  const h = fixture();
  expect(
    h.call(h.d, 'freight.handoff', {
      id: 'parcel',
      handoffId: 'relay',
      action: 'consent',
      role: 'payer',
      expectedRevision: 4,
    }).error,
  ).toBe('custody-principal-consent-required');
  h.approve('consent', 'freight.handoff', {
    handoffId: 'relay',
    action: 'consent',
    role: 'payer',
    expectedRevision: 4,
  });
  h.execute('consent');
  expect(h.r.state.collectives!.decisions.consent!.status).toBe('executed');
  expect(
    h.call(h.d, 'freight.handoff', {
      id: 'parcel',
      handoffId: 'relay',
      action: 'withdraw',
      expectedRevision: 5,
    }).error,
  ).toBe('custody-withdrawal-party-required');
  h.time(25000);
  expect(h.r.state.collectives!.decisions.consent!.executeBefore).toBeLessThan(
    h.r.state.world.clock.now,
  );
  h.act(h.outsider, 'accept', { expectedRevision: 5 });
  h.op(h.outsider, 'return');
  expect(h.freight()).toMatchObject({ status: 'returned', paid: 3, refunded: 5, carrierId: h.b });
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(5);
  expect(h.r.state.world.materials!.stocks.src!.inventory).toEqual({ Wood: 8 });
  h.replay();
});
test('collective signature and decision consumption are inseparable; standalone world replay cannot trust a claimed proof', () => {
  const h = fixture();
  h.approve('consent', 'freight.handoff', {
    handoffId: 'relay',
    action: 'consent',
    role: 'payer',
    expectedRevision: 4,
  });
  const before = structuredClone(h.r.state),
    d = executeCollectiveResource(
      h.r.state,
      h.r.manifest,
      h.d,
      'consent',
      h.r.state.collectives!.decisions.consent!.revision,
      'proof',
    );
  expect(() => applyOpenSocietyEffects(h.r.state, { ...d.effects, collectiveEvents: [] })).toThrow(
    'custody-exact-collective-decision-required',
  );
  expect(() =>
    applyOpenSocietyEffects(h.r.state, { collectiveEvents: d.effects.collectiveEvents }),
  ).toThrow('custody-collective-consumption-needs-exact-effect');
  expect(() => applyWorldEvent(h.r.state.world, d.effects.worldEvents![0]!)).toThrow(
    'custody-exact-collective-decision-required',
  );
  expect(() =>
    applyOpenSocietyEffects(h.r.state, {
      ...d.effects,
      worldEvents: [...d.effects.worldEvents!, ...d.effects.worldEvents!],
    }),
  ).toThrow('custody-collective-consumption-needs-exact-effect');
  expect(h.r.state).toEqual(before);
  const next = applyOpenSocietyEffects(h.r.state, d.effects);
  expect(next.collectives!.decisions.consent!.status).toBe('executed');
  expect(next.world.logistics!.custody!.proposals.relay!.consents.payer).toMatchObject({
    decisionId: 'consent',
    actorId: h.d,
  });
  h.execute('consent');
  h.approve('withdraw', 'freight.handoff', {
    handoffId: 'relay',
    action: 'withdraw',
    expectedRevision: 5,
  });
  h.execute('withdraw');
  expect(h.r.state.world.logistics!.custody!.proposals.relay!.status).toBe('withdrawn');
  expect(h.freight().status).toBe('loaded');
  expect(h.freight().escrow).toBe(8);
  h.replay();
});
test('charter version changes invalidate unexecuted custody use without erasing cargo or previously recorded consent', () => {
  const h = fixture();
  h.approve('consent', 'freight.handoff', {
    handoffId: 'relay',
    action: 'consent',
    role: 'payer',
    expectedRevision: 4,
  });
  h.execute('consent');
  const materials = structuredClone(h.r.state.world.materials);
  h.ok(h.d, 'collectives.leave', {
    id: 'club',
    expectedRevision: h.r.state.collectives!.charters.club!.revision,
  });
  expect(
    h.call(h.outsider, 'freight.handoff', {
      id: 'parcel',
      handoffId: 'relay',
      action: 'accept',
      expectedRevision: 5,
    }).error,
  ).toBe('custody-consent-authority-no-longer-valid');
  expect(h.r.state.world.materials).toEqual(materials);
  expect(h.r.state.world.logistics!.custody!.proposals.relay!.consents.payer).toMatchObject({
    decisionId: 'consent',
  });
  expect(h.r.state.world.logistics!.custody!.holders.parcel).toBeUndefined();
  h.replay();
});
