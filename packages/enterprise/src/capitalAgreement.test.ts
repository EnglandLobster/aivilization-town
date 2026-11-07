import {
  capitalPayments,
  capitalEscrowMicros,
  capitalAccountObligations,
  capitalReservedIncomingMicros,
} from './capitalRights';
import { expect, test } from 'vitest';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  initialEnterpriseCapital,
  decideCapitalAgreement,
  applyCapitalEvent,
  capitalHeldMicros,
  expireCapitalAgreements,
} from './capitalAgreement';
import {
  capitalAccountKey,
  type CapitalCommand,
  type CapitalEvent,
  type CapitalAccount,
  type CapitalManagement,
} from './capitalModel';
import { assertCapitalPositions } from './capitalValidation';
const founder: CapitalAccount = { sector: 'agent', id: 'founder' },
  investor: CapitalAccount = { sector: 'agent', id: 'investor' },
  fund: CapitalAccount = { sector: 'collective', id: 'fund' };
function fixture() {
  const initial = initialEnterpriseCapital([{ account: founder, weight: 1 }]);
  let state = initial;
  const events: CapitalEvent[] = [],
    cash: Record<string, number> = {
      'agent:founder': 100_000_000,
      'agent:investor': 60_000_000,
      'collective:fund': 40_000_000,
      escrow: 0,
      enterprise: 10_000_000,
    };
  let management: CapitalManagement = {
    controller: { kind: 'resident', id: 'manager' },
    controlVersion: 1,
  };
  const account = (a: CapitalAccount) =>
    Object.hasOwn(cash, capitalAccountKey(a))
      ? {
          controller:
            a.sector === 'agent'
              ? { kind: 'resident' as const, id: a.id }
              : { kind: 'collective' as const, id: 'club' },
          balanceMicros: cash[capitalAccountKey(a)]!,
          open: true,
        }
      : undefined;
  const decide = (
    actorId: string,
    command: CapitalCommand,
    at = 1,
    authorize: ControlAuthorizationPort = personalControlAuthorization(actorId),
  ) => decideCapitalAgreement({ state, actorId, command, at, management, account, authorize });
  const commit = (event: CapitalEvent) => {
    const next = applyCapitalEvent(state, event);
    for (const f of event.flows) {
      const from = f.from.sector === 'escrow' ? 'escrow' : capitalAccountKey(f.from),
        to =
          f.to.sector === 'escrow' || f.to.sector === 'enterprise'
            ? f.to.sector
            : capitalAccountKey(f.to);
      cash[from]! -= f.amountMicros;
      cash[to]! += f.amountMicros;
    }
    state = next;
    events.push(event);
  };
  const ok = (actor: string, c: CapitalCommand, at = 1, authorize?: ControlAuthorizationPort) => {
    const d = decide(actor, c, at, authorize);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    d.events.forEach(commit);
  };
  const proposal = (id = 'round'): CapitalCommand => ({
    type: 'propose',
    id,
    terms: 'Residents choose rights, not management or debt',
    expectedEquityVersion: state.equityVersion,
    expiresAt: 1000,
    positions: [
      { account: founder, weight: 60 },
      { account: investor, weight: 30 },
      { account: fund, weight: 10 },
    ],
    contributions: [
      { account: investor, amountMicros: 30_000_000 },
      { account: fund, amountMicros: 10_000_000 },
    ],
    disbursements: [{ account: { sector: 'enterprise' }, amountMicros: 40_000_000 }],
  });
  const revision = (id = 'round') => state.agreements[id]!.revision;
  const group: ControlAuthorizationPort = (c) =>
    c.kind === 'collective' && c.id === 'club'
      ? { actorId: 'delegate', decisionId: 'exact-fund-consent' }
      : undefined;
  const acceptAll = () => {
    ok('founder', { type: 'accept', id: 'round', expectedRevision: revision(), account: founder });
    ok('investor', {
      type: 'accept',
      id: 'round',
      expectedRevision: revision(),
      account: investor,
    });
    ok(
      'delegate',
      { type: 'accept', id: 'round', expectedRevision: revision(), account: fund },
      1,
      group,
    );
  };
  return {
    initial,
    events,
    cash,
    decide,
    ok,
    commit,
    proposal,
    revision,
    group,
    acceptAll,
    get state() {
      return state;
    },
    set management(v: CapitalManagement) {
      management = v;
    },
    replay: () => expect(events.reduce(applyCapitalEvent, initial)).toEqual(state),
  };
}
test('independent real personal and collective subscriptions hold funds before unanimous rights and separate company authorization become effective', () => {
  const t = fixture();
  t.ok('founder', t.proposal());
  expect(t.state.positions).toEqual(t.initial.positions);
  expect(t.cash.enterprise).toBe(10_000_000);
  expect(
    t.decide('manager', { type: 'execute', id: 'round', expectedRevision: t.revision() }).accepted,
  ).toBe(false);
  expect(
    t.decide('delegate', {
      type: 'accept',
      id: 'round',
      expectedRevision: t.revision(),
      account: fund,
    }).accepted,
  ).toBe(false);
  t.acceptAll();
  expect(t.cash.escrow).toBe(40_000_000);
  expect(t.cash.enterprise).toBe(10_000_000);
  expect(t.state.positions).toEqual(t.initial.positions);
  expect(
    t.decide('founder', { type: 'execute', id: 'round', expectedRevision: t.revision() }).accepted,
  ).toBe(false);
  t.ok('manager', {
    type: 'authorize',
    id: 'round',
    expectedRevision: t.revision(),
    expectedControlVersion: 1,
  });
  t.ok('founder', { type: 'execute', id: 'round', expectedRevision: t.revision() });
  expect(t.state.equityVersion).toBe(2);
  expect(t.state.positions.map((p) => p.weight)).toEqual([60, 30, 10]);
  expect(t.cash).toEqual({
    'agent:founder': 100_000_000,
    'agent:investor': 30_000_000,
    'collective:fund': 30_000_000,
    escrow: 0,
    enterprise: 50_000_000,
  });
  expect(Object.values(t.cash).reduce((s, n) => s + n, 0)).toBe(210_000_000);
  t.replay();
});
test('a changed manager cannot erase rights or accept for investors; precise new financial authorization is required', () => {
  const t = fixture();
  t.ok('founder', t.proposal());
  t.acceptAll();
  t.ok('manager', {
    type: 'authorize',
    id: 'round',
    expectedRevision: t.revision(),
    expectedControlVersion: 1,
  });
  t.management = { controller: { kind: 'resident', id: 'next-manager' }, controlVersion: 3 };
  expect(
    t.decide('founder', { type: 'execute', id: 'round', expectedRevision: t.revision() }).accepted,
  ).toBe(false);
  expect(
    t.decide('manager', {
      type: 'authorize',
      id: 'round',
      expectedRevision: t.revision(),
      expectedControlVersion: 3,
    }).accepted,
  ).toBe(false);
  t.ok('next-manager', {
    type: 'authorize',
    id: 'round',
    expectedRevision: t.revision(),
    expectedControlVersion: 3,
  });
  t.ok('investor', { type: 'execute', id: 'round', expectedRevision: t.revision() });
  t.replay();
});
test('insufficient funding, forged consent and changed revision leave rights and protected cash unchanged; expiry refunds the original account', () => {
  const t = fixture();
  t.ok('founder', t.proposal());
  t.cash['agent:investor'] = 20_000_000;
  expect(
    t.decide('investor', {
      type: 'accept',
      id: 'round',
      expectedRevision: t.revision(),
      account: investor,
    }),
  ).toMatchObject({ accepted: false, reason: 'capital-contribution-unfunded' });
  expect(
    t.decide('founder', {
      type: 'accept',
      id: 'round',
      expectedRevision: t.revision(),
      account: investor,
    }),
  ).toMatchObject({ accepted: false, reason: 'capital-account-authority-required' });
  t.ok(
    'delegate',
    { type: 'accept', id: 'round', expectedRevision: t.revision(), account: fund },
    1,
    t.group,
  );
  expect(capitalHeldMicros(t.state.agreements.round!)).toBe(10_000_000);
  expect(t.decide('founder', { type: 'cancel', id: 'round', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  expect(
    t.decide('outsider', { type: 'cancel', id: 'round', expectedRevision: t.revision() }).accepted,
  ).toBe(false);
  const expiry = expireCapitalAgreements(t.state, 1000);
  expect(expiry).toHaveLength(1);
  expiry.forEach(t.commit);
  expect(t.state.agreements.round).toMatchObject({ status: 'cancelled', endReason: 'expired' });
  expect(t.cash['collective:fund']).toBe(40_000_000);
  expect(t.cash.escrow).toBe(0);
  expect(t.state.positions).toEqual(t.initial.positions);
  expect(expireCapitalAgreements(t.state, 1001)).toEqual([]);
  t.replay();
});
test('competing capital agreements cannot issue both sets of rights; superseded contracts preserve then refund actual held funds', () => {
  const t = fixture();
  t.ok('founder', t.proposal());
  t.ok('founder', t.proposal('competing'));
  t.ok('investor', { type: 'accept', id: 'competing', expectedRevision: 1, account: investor });
  t.acceptAll();
  t.ok('manager', {
    type: 'authorize',
    id: 'round',
    expectedRevision: t.revision(),
    expectedControlVersion: 1,
  });
  t.ok('founder', { type: 'execute', id: 'round', expectedRevision: t.revision() });
  expect(t.cash.escrow).toBe(30_000_000);
  expect(
    t.decide('founder', {
      type: 'accept',
      id: 'competing',
      expectedRevision: t.revision('competing'),
      account: founder,
    }),
  ).toMatchObject({ accepted: false, reason: 'capital-equity-version-conflict' });
  expireCapitalAgreements(t.state, 2).forEach(t.commit);
  expect(t.state.agreements.competing).toMatchObject({
    status: 'cancelled',
    endReason: 'equity-version-changed',
  });
  expect(t.cash.escrow).toBe(0);
  t.replay();
});
test('secondary rights payment does not capitalize the firm or give the manager the sale proceeds', () => {
  const t = fixture();
  t.ok('founder', {
    type: 'propose',
    id: 'sale',
    expectedEquityVersion: 1,
    expiresAt: 1000,
    terms: 'An agreed ownership restatement, no operating-control transfer',
    positions: [
      { account: founder, weight: 0.5 },
      { account: investor, weight: 0.5 },
    ],
    contributions: [{ account: investor, amountMicros: 20_000_000 }],
    disbursements: [{ account: founder, amountMicros: 20_000_000 }],
  });
  for (const account of [founder, investor])
    t.ok(account.id, { type: 'accept', id: 'sale', expectedRevision: t.revision('sale'), account });
  t.ok('investor', { type: 'execute', id: 'sale', expectedRevision: t.revision('sale') });
  expect(t.cash.enterprise).toBe(10_000_000);
  expect(t.cash['agent:founder']).toBe(120_000_000);
  expect(t.cash['agent:investor']).toBe(40_000_000);
  t.replay();
});
test('tampered terms, transfers and missing previous consent cannot replay as capital facts; fractional legacy weights are retained', () => {
  const t = fixture();
  t.ok('founder', t.proposal());
  const d = t.decide('investor', {
    type: 'accept',
    id: 'round',
    expectedRevision: t.revision(),
    account: investor,
  });
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  expect(() => applyCapitalEvent(t.state, { ...e, flows: [] })).toThrow(
    'capital-event-transfers-mismatch',
  );
  expect(() =>
    applyCapitalEvent(t.state, { ...e, agreement: { ...e.agreement, terms: 'Different deal' } }),
  ).toThrow('capital-agreement-terms-changed');
  expect(() => applyCapitalEvent(t.state, { ...e, actorId: 'founder' })).toThrow(
    'capital-consent-source-mismatch',
  );
  expect(
    initialEnterpriseCapital([
      { account: founder, weight: 1 / 3 },
      { account: investor, weight: 2 / 3 },
    ]).positions,
  ).toEqual([
    { account: founder, weight: 1 / 3 },
    { account: investor, weight: 2 / 3 },
  ]);
  for (const weights of [
    [Infinity, 1],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [-1, 2],
    [0, 1],
  ])
    expect(() =>
      assertCapitalPositions([
        { account: founder, weight: weights[0]! },
        { account: investor, weight: weights[1]! },
      ]),
    ).toThrow();
  t.replay();
});

test('cash distributions use actual personal and collective rights without fabricating a manager share or losing the residual', () => {
  const positions = [
    { account: founder, weight: 1 },
    { account: fund, weight: 2 },
  ];
  const payments = capitalPayments(positions, 0.3);
  expect(payments.map((p) => p.account)).toEqual([founder, fund]);
  expect(payments[0]!.amount).toBeCloseTo(0.1, 15);
  expect(payments.reduce((sum, p) => sum + p.amount, 0)).toBe(0.3);
  expect(capitalPayments([...positions].reverse(), 0.3)).toEqual(payments);
  expect(capitalPayments(positions, 0).map((p) => p.amount)).toEqual([0, 0]);
  expect(() => capitalPayments(positions, Infinity)).toThrow('invalid-capital-payment-total');
  const extreme = capitalPayments(
    [
      { account: founder, weight: 1e30 },
      { account: investor, weight: 1 },
      { account: fund, weight: 1 },
    ],
    1e30,
  );
  expect(extreme.map((p) => p.account)).toEqual([founder, investor, fund]);
  expect(extreme[0]!.amount).toBe(1e30);
  expect(extreme[1]!.amount).toBeCloseTo(1, 14);
  expect(extreme[2]!.amount).toBeCloseTo(1, 14);
  expect(extreme.reduce((sum, p) => sum + p.amount, 0)).toBe(1e30);
});
test('accepted funding protects original refund headroom and accounts cannot close while they own rights', () => {
  const t = fixture();
  t.ok('founder', t.proposal());
  expect(capitalAccountObligations(t.state, fund)).toBe(false);
  expect(capitalReservedIncomingMicros(t.state, fund)).toBe(0);
  t.ok(
    'delegate',
    { type: 'accept', id: 'round', expectedRevision: t.revision(), account: fund },
    1,
    t.group,
  );
  expect(capitalAccountObligations(t.state, fund)).toBe(true);
  expect(capitalEscrowMicros(t.state)).toBe(10_000_000);
  expect(capitalReservedIncomingMicros(t.state, fund)).toBe(10_000_000);
  t.ok('founder', { type: 'cancel', id: 'round', expectedRevision: t.revision() });
  expect(capitalReservedIncomingMicros(t.state, fund)).toBe(0);
  expect(capitalEscrowMicros(t.state)).toBe(0);
  expect(capitalAccountObligations(t.state, fund)).toBe(false);
  expect(capitalAccountObligations(t.state, founder)).toBe(true);
  t.replay();
});

test('a collective proposal remains controlled by the collective rather than its former human delegate', () => {
  const t = fixture();
  t.management = { controller: { kind: 'collective', id: 'club' }, controlVersion: 2 };
  t.ok('delegate', t.proposal(), 1, t.group);
  const command: CapitalCommand = { type: 'cancel', id: 'round', expectedRevision: t.revision() };
  expect(t.decide('delegate', command, 2).accepted).toBe(false);
  t.ok('successor', command, 2, (c) =>
    c.kind === 'collective' && c.id === 'club'
      ? { actorId: 'successor', decisionId: 'independently-approved-withdrawal' }
      : undefined,
  );
  expect(t.state.agreements.round!.status).toBe('cancelled');
  expect(t.events.reduce(applyCapitalEvent, t.initial)).toEqual(t.state);
});
