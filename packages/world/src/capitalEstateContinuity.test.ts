import { expect, test } from 'vitest';
import { asAgentId, asEventId, createCommandEnvelope } from '@aivilization/sim-core';
import { normalizeEnterpriseState, type CapitalCommand } from '@aivilization/enterprise';
import { estateCashBalance } from '@aivilization/economy';
import {
  residentExitFixture,
  residentDeathFixture,
  capturedResidentDeparture,
} from './testFixtures/residentExit';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { residentCapitalCommand } from './capital';
import { enableResidentCapitalEvent, capitalCommit } from './capitalSettlement';
import { worldCapitalEscrowBalance } from './capitalAccounting';
import { handleAdvanceSimulationTimeCommand } from './handlers/timeAdvance';
import { capitalEstateCashSource } from './capitalEstateContinuity';
function fixture(earned = 10) {
  const f = residentExitFixture(),
    a = f.agents.a!;
  const seed: WorldProjection = {
    ...f,
    moneySupply: 220,
    agents: {
      a: { ...a, balance: 100, inventory: {} },
      b: { ...a, agentId: asAgentId('b'), balance: 100, inventory: {} },
    },
    enterprises: {
      firm: normalizeEnterpriseState({
        enterpriseId: 'firm',
        name: 'Existing firm',
        ownerAgentId: asAgentId('a'),
        occupationName: 'Work',
        balance: 20,
        inventory: { Wood: 2 },
        maxEmployees: 3,
        employeeAgentIds: [],
        status: 'active',
        foundedAt: 0,
        cumulativeSales: earned,
        cumulativePurchases: 0,
        cumulativeWages: 0,
        retainedEarnings: earned,
      }),
    },
  };
  let w = seed,
    serial = 0;
  const events: WorldEvent[] = [];
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    enterpriseId: 'firm',
    simulationId: 'capital-estate-test',
    requestId: `capital-${++serial}`,
    nextSequence: events.length + 1,
  });
  const total = () =>
    Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
    Object.values(w.enterprises).reduce((n, e) => n + e.balance, 0) +
    estateCashBalance(w.residentExits!.cash) +
    worldCapitalEscrowBalance(w.enterprises);
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(total()).toBeCloseTo(220, 8);
    expect(w.moneySupply).toBe(220);
  };
  commit([enableResidentCapitalEvent(ctx())]);
  const ok = (actor: string, command: CapitalCommand | { type: 'initialize' }) => {
    const d = residentCapitalCommand({ ...ctx(actor), command });
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
    return d;
  };
  ok('a', { type: 'initialize' });
  const die = (id: string) => {
    const base = residentDeathFixture();
    commit([
      capturedResidentDeparture(w, {
        ...base,
        id: asEventId(`actual-death-${id}`),
        sequence: events.length + 1,
        payload: { ...base.payload, agentId: asAgentId(id) },
      }),
    ]);
  };
  const time = (deltaMs: number) => {
    const c = createCommandEnvelope({
      id: `time-${++serial}`,
      simulationId: 'capital-estate-test',
      source: 'system',
      type: 'AdvanceSimulationTime',
      issuedAt: w.clock.now,
      payload: { deltaMs },
    });
    commit(
      handleAdvanceSimulationTimeCommand({
        command: c,
        projection: w,
        nextSequence: events.length + 1,
      }),
    );
  };
  return {
    seed,
    events,
    ctx,
    commit,
    ok,
    die,
    time,
    get w() {
      return w;
    },
    replay: () => expect(events.reduce(applyWorldEvent, seed)).toEqual(w),
  };
}
const proposal: CapitalCommand = {
  type: 'propose',
  id: 'round',
  terms: 'Original independently accepted protected contribution',
  expectedEquityVersion: 1,
  expiresAt: 500,
  positions: [
    { account: { sector: 'agent', id: 'a' }, weight: 1 },
    { account: { sector: 'agent', id: 'b' }, weight: 1 },
  ],
  contributions: [{ account: { sector: 'agent', id: 'b' }, amountMicros: 20000000 }],
  disbursements: [{ account: { sector: 'enterprise' }, amountMicros: 20000000 }],
};
function funded() {
  const t = fixture();
  t.ok('a', proposal);
  t.ok('b', {
    type: 'accept',
    id: 'round',
    expectedRevision: t.w.enterprises.firm!.capital!.agreements.round!.revision,
    account: { sector: 'agent', id: 'b' },
  });
  return t;
}
function dividend(t: ReturnType<typeof fixture>, paidAt = 0) {
  return capitalCommit({
    ...t.ctx('system'),
    invocation: { kind: 'automatic' },
    events: [
      {
        type: 'EnterpriseCapitalDividendPaid',
        dividendPolicyVersion: 'earned-fixture-v1',
        equityVersion: 1,
        totalAmount: 10,
        paidAt,
        payments: [{ account: { sector: 'agent', id: 'a' }, amount: 10 }],
      },
    ],
  });
}
test('the original deceased shareholder receives earned income in actual custody while enterprise assets, rights and management stay separate', () => {
  const t = fixture();
  t.die('a');
  const before = t.w,
    res = dividend(t);
  if (!res.accepted) throw Error(res.reason);
  const e = res.events[0]!;
  if (e.type !== 'ResidentCapitalCommitted') throw Error('expected');
  expect(e.payload.estateCashEffects?.resolution.mappings[0]?.residentId).toBe('a');
  t.commit(res.events);
  expect(t.w.agents.a).toBeUndefined();
  expect(t.w.agents.b!.balance).toBe(100);
  expect(estateCashBalance(t.w.residentExits!.cash)).toBe(110);
  expect(t.w.enterprises.firm!.balance).toBe(10);
  expect(t.w.enterprises.firm!.capital!.positions).toEqual(
    before.enterprises.firm!.capital!.positions,
  );
  expect(t.w.enterprises.firm!.ownerAgentId).toBe('a');
  expect(t.w.enterprises.firm!.inventory).toEqual({ Wood: 2 });
  expect(() => applyWorldEvent(t.w, e)).toThrow('unearned-capital-dividend');
  t.replay();
});
test('expired original contribution refunds the original departed payer, with exact retained obligation and no substitute body', () => {
  const t = funded();
  expect(t.w.agents.b!.balance).toBe(80);
  expect(worldCapitalEscrowBalance(t.w.enterprises)).toBe(20);
  t.die('b');
  t.time(1500);
  expect(t.w.agents.b).toBeUndefined();
  expect(estateCashBalance(t.w.residentExits!.cash)).toBe(100);
  expect(t.w.enterprises.firm!.capital!.agreements.round).toMatchObject({
    status: 'cancelled',
    endReason: 'expired',
    endedAt: 500,
  });
  expect(t.w.enterprises.firm!.balance).toBe(20);
  expect(worldCapitalEscrowBalance(t.w.enterprises)).toBe(0);
  t.replay();
});
test('whole advance and exact boundary advance refund the same original account and preserve assets without duplicated receipt', () => {
  const a = funded(),
    b = funded();
  a.die('b');
  b.die('b');
  a.time(1500);
  b.time(500);
  b.time(1000);
  expect(a.w.agents).toEqual(b.w.agents);
  expect(a.w.enterprises).toEqual(b.w.enterprises);
  expect(a.w.residentExits).toEqual(b.w.residentExits);
  expect(
    a.w.residentExits!.cash.accounts[Object.values(a.w.residentExits!.records)[0]!.cashAccountId]!
      .settledSources,
  ).toEqual(
    b.w.residentExits!.cash.accounts[Object.values(b.w.residentExits!.records)[0]!.cashAccountId]!
      .settledSources,
  );
  a.replay();
  b.replay();
});
test('missing, forged or stale owning cash proof refuses atomically, and a callback cannot replace the original shareholder', () => {
  const t = fixture();
  t.die('a');
  const d = dividend(t);
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentCapitalCommitted' || !e.payload.estateCashEffects)
    throw Error('expected');
  const before = structuredClone(t.w);
  for (const mutate of [
    (x: typeof e) => {
      Reflect.deleteProperty(x.payload, 'estateCashEffects');
    },
    (x: typeof e) => Object.assign(x.payload, { estateCashPolicyVersion: 'invalid' }),
    (x: typeof e) => Object.assign(x.payload.estateCashEffects!.events[0]!, { at: 99 }),
    (x: typeof e) => Object.assign(x.payload.estateCashEffects!.source, { revision: 999 }),
    (x: typeof e) =>
      Object.assign(x.payload.estateCashEffects!.resolution.mappings[0]!, { estateRevision: 99 }),
    (x: typeof e) => {
      const event = x.payload.events[0]!;
      if (event.type !== 'EnterpriseCapitalDividendPaid') throw Error('expected');
      Object.assign(event.payments[0]!, { account: { sector: 'agent', id: 'b' } });
    },
  ]) {
    const x = structuredClone(e);
    mutate(x);
    expect(() => applyWorldEvent(t.w, x)).toThrow();
    expect(t.w).toEqual(before);
  }
});
test('unchanged living settlements omit the new channel; long or ambiguous source IDs are bounded and retain exact structured references', () => {
  const t = fixture(),
    d = dividend(t);
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentCapitalCommitted') throw Error('expected');
  expect(e.payload.estateCashEffects).toBeUndefined();
  t.commit(d.events);
  t.replay();
  const fact = e.payload.events[0]!;
  const a = capitalEstateCashSource('x'.repeat(200), [fact]);
  expect(a.id.length).toBeLessThan(160);
  expect(capitalEstateCashSource('a:b', [fact]).id).not.toBe(
    capitalEstateCashSource('a', [fact]).id,
  );
});

test('two genuinely earned distributions advance one stable original-source cursor without another body or duplicate payout', () => {
  const t = fixture(20);
  t.die('a');
  const first = dividend(t);
  if (!first.accepted) throw Error(first.reason);
  t.commit(first.events);
  t.time(1);
  const second = dividend(t, 1);
  if (!second.accepted) throw Error(second.reason);
  t.commit(second.events);
  const r = Object.values(t.w.residentExits!.records)[0]!,
    cash = t.w.residentExits!.cash.accounts[r.cashAccountId]!;
  expect(cash.balance).toBe(120);
  expect(t.w.enterprises.firm!.balance).toBe(0);
  expect(t.w.enterprises.firm!.retainedEarnings).toBe(0);
  expect(Object.values(cash.settledSources)).toHaveLength(1);
  expect(Object.values(cash.settledSources)[0]!.revision).toBe(2);
  expect(t.w.agents.a).toBeUndefined();
  t.replay();
});
