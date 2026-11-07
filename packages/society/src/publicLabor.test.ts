import { expect, test } from 'vitest';
import {
  applyPublicLaborEvent,
  emptyPublicLaborState,
  progressPublicLabor,
  publicLaborEffects,
  publicLaborEscrowBalance,
  startPublicLabor,
  stopPublicLabor,
  type PublicLaborEvent,
  type PublicLaborTerms,
} from './publicLabor';
import { quoteEarnedLaborCompensation } from './wage';
const terms: PublicLaborTerms = {
  ...quoteEarnedLaborCompensation({
    quotedWage: 101.000003,
    laborSeconds: 3600,
    pay: { version: 'labor-proportional-pay-v1', referenceSeconds: 3600 },
    tax: {
      policyVersion: 'test-tax',
      source: 'test',
      neutralRate: 0.1,
      incomeTaxBrackets: [{ upToAmount: null, rate: 0.1 }],
      tradeTaxRate: 0,
    },
  }),
  sourceKind: 'initial-public-employment-regime',
  sourceId: 'initial-public-employment-v1',
  occupation: 'Caretaker',
  quotedWage: 101.000003,
  referenceSeconds: 3600,
  energyCostPerHour: 5,
  satietyCostPerHour: 2,
};
function fixture() {
  const initial = emptyPublicLaborState();
  let state = initial;
  const events: PublicLaborEvent[] = [];
  let treasury = 200000000,
    net = 0,
    escrow = 0,
    withheld = 0;
  const commit = (d: ReturnType<typeof startPublicLabor>) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) {
      const f = publicLaborEffects(state, e);
      treasury += f.refundedMicros + f.withheldMicros - f.reservedMicros;
      net += f.paidMicros - f.withheldMicros;
      withheld += f.withheldMicros;
      escrow += f.reservedMicros - f.paidMicros - f.refundedMicros;
      state = applyPublicLaborEvent(state, e);
      events.push(e);
      expect(treasury + net + escrow).toBe(200000000);
      expect(publicLaborEscrowBalance(state)).toBe(escrow / 1000000);
    }
  };
  const start = (id = 'work', actorId = 'alice', durationMs = 3600000) =>
    startPublicLabor({
      state,
      id,
      actorId,
      locationId: 'place',
      at: 0,
      durationMs,
      terms,
      availableTreasuryMicros: treasury,
    });
  return {
    initial,
    events,
    commit,
    start,
    get state() {
      return state;
    },
    get balances() {
      return { treasury, net, escrow, withheld };
    },
  };
}
test('full public funding is reserved before work; no future wage or double use of treasury; early exit refunds only unearned money', () => {
  const t = fixture();
  t.commit(t.start());
  expect(t.balances).toEqual({ treasury: 98999997, net: 0, escrow: 101000003, withheld: 0 });
  expect(t.start('second', 'bob')).toMatchObject({
    accepted: false,
    reason: 'public-wage-full-funding-required',
  });
  const original = t.state;
  expect(
    startPublicLabor({
      state: t.state,
      id: 'free',
      actorId: 'alice',
      locationId: 'place',
      at: 0,
      durationMs: 1000,
      terms: { ...terms, grossMicros: 0, taxMicros: 0 },
      availableTreasuryMicros: 0,
    }).accepted,
  ).toBe(false);
  expect(
    stopPublicLabor({ state: t.state, id: 'work', actorId: 'bob', expectedRevision: 1, at: 0 })
      .accepted,
  ).toBe(false);
  expect(t.state).toEqual(original);
  t.commit(progressPublicLabor(t.state, 'work', 1200000));
  const c = t.state.sessions.work!;
  expect(c.earnedMicros).toBe(33666667);
  expect(c.withheldMicros).toBe(3366666);
  expect(
    stopPublicLabor({
      state: t.state,
      id: 'work',
      actorId: 'alice',
      expectedRevision: 1,
      at: 1200000,
    }).accepted,
  ).toBe(false);
  t.commit(
    stopPublicLabor({
      state: t.state,
      id: 'work',
      actorId: 'alice',
      expectedRevision: c.revision,
      at: 1200000,
    }),
  );
  expect(t.state.sessions.work).toMatchObject({
    status: 'interrupted',
    earnedMicros: c.earnedMicros,
    paidMicros: c.earnedMicros,
    refundedMicros: terms.grossMicros - c.earnedMicros,
  });
  expect(t.balances.escrow).toBe(0);
  expect(t.events.reduce(applyPublicLaborEvent, t.initial)).toEqual(t.state);
});
test('full payment and withholding are identical across millisecond/cadence partitions; forged source or pay cannot alter history', () => {
  const once = fixture(),
    split = fixture();
  for (const t of [once, split]) t.commit(t.start());
  once.commit(progressPublicLabor(once.state, 'work', 3600000));
  for (const at of [1, 999999, 1000000, 1200000, 3599999, 3600000])
    split.commit(progressPublicLabor(split.state, 'work', at));
  expect(once.balances).toEqual(split.balances);
  expect(once.state.sessions.work).toMatchObject({
    status: 'completed',
    paidMicros: terms.grossMicros,
    withheldMicros: terms.taxMicros,
    refundedMicros: 0,
  });
  expect(split.events.reduce(applyPublicLaborEvent, split.initial)).toEqual(split.state);
  const before = applyPublicLaborEvent(once.initial, once.events[0]!),
    e = once.events[1]!;
  expect(() =>
    applyPublicLaborEvent(before, {
      ...e,
      session: { ...e.session, paidMicros: e.session.paidMicros + 1 },
    }),
  ).toThrow('invalid-public-labor-event');
  expect(() =>
    applyPublicLaborEvent(before, { ...e, session: { ...e.session, actorId: 'bob' } }),
  ).toThrow('invalid-public-labor-transition');
  expect(() =>
    applyPublicLaborEvent(before, {
      ...e,
      session: { ...e.session, terms: { ...e.session.terms, occupation: 'Other' } },
    }),
  ).toThrow('invalid-public-labor-transition');
});
test('invalid duration, amount, future stop, and unearned declaration are refused without altering a funded record', () => {
  const t = fixture();
  for (const duration of [0, -1, 0.5, 86400001, Infinity])
    expect(t.start('invalid', 'alice', duration).accepted).toBe(false);
  t.commit(t.start());
  expect(
    stopPublicLabor({ state: t.state, id: 'work', actorId: 'alice', expectedRevision: 1, at: 1 })
      .accepted,
  ).toBe(false);
  expect(progressPublicLabor(t.state, 'work', -1).accepted).toBe(false);
  const event = t.events[0]!;
  expect(() =>
    applyPublicLaborEvent(t.initial, { ...event, session: { ...event.session, paidMicros: 1 } }),
  ).toThrow('invalid-public-labor-event');
  t.commit(
    stopPublicLabor({
      state: t.state,
      id: 'work',
      actorId: 'system',
      expectedRevision: 1,
      at: 0,
      reason: 'employment-ended',
    }),
  );
  expect(t.balances).toEqual({ treasury: 200000000, net: 0, escrow: 0, withheld: 0 });
});

test('aggregate protected funding cannot overflow exact integer accounting even when each promise is safe', () => {
  const first = startPublicLabor({
    state: emptyPublicLaborState(),
    id: 'first',
    actorId: 'alice',
    locationId: 'place',
    at: 0,
    durationMs: 3600000,
    terms: { ...terms, grossMicros: Number.MAX_SAFE_INTEGER, taxMicros: 0 },
    availableTreasuryMicros: Number.MAX_SAFE_INTEGER,
  });
  if (!first.accepted) throw Error(first.reason);
  const state = first.events.reduce(applyPublicLaborEvent, emptyPublicLaborState());
  expect(
    startPublicLabor({
      state,
      id: 'second',
      actorId: 'bob',
      locationId: 'place',
      at: 0,
      durationMs: 3600000,
      terms: { ...terms, grossMicros: 1, taxMicros: 0 },
      availableTreasuryMicros: 1,
    }),
  ).toMatchObject({ accepted: false, reason: 'public-labor-escrow-overflow' });
});
