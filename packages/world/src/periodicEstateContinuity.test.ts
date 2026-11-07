import { expect, test } from 'vitest';
import { asAgentId, asEventId, createEventEnvelope, advanceClock } from '@aivilization/sim-core';
import { estateCashBalance } from '@aivilization/economy';
import type { PeriodicCommand } from '@aivilization/commerce';
import { applyWorldEvent } from './projection';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  residentExitFixture,
  capturedResidentDeparture,
  residentDeathFixture,
} from './testFixtures/residentExit';
import { enableResidentPublicGovernanceEvent } from './residentPublicGovernance';
import {
  enablePeriodicObligationsEvent,
  residentPeriodicOperation,
  worldPeriodicRequest,
  advancePeriodicObligations,
} from './periodicObligations';
function fixture() {
  const original = residentExitFixture(),
    a = original.agents.a!;
  let w: WorldProjection = {
      ...original,
      agents: {
        a,
        b: { ...a, agentId: asAgentId('b'), balance: 0, inventory: {} },
        c: { ...a, agentId: asAgentId('c'), balance: 0, inventory: {} },
      },
    },
    n = 0;
  const events: WorldEvent[] = [];
  const ctx = () => ({
    projection: w,
    simulationId: 'sim-1',
    requestId: `periodic-estate-${++n}`,
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(w.moneySupply).toBe(original.moneySupply);
    expect(
      Object.values(w.agents).reduce((v, a) => v + a.balance, 0) +
        estateCashBalance(w.residentExits?.cash),
    ).toBeCloseTo(original.moneySupply, 10);
  };
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: {
        policyVersion: 'estate-fixture-public-v1',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 100,
        maximumTreasuryReserve: 1000,
        maximumSubsidyBalanceFloor: 100,
        maximumSubsidyPerCadence: 10,
      },
      grant: {
        id: 'town',
        source: {
          kind: 'explicit-scenario-grant',
          version: 'estate-fixture-v1',
          description: 'Engineering public scope',
        },
        residents: ['a', 'b', 'c'],
        actions: ['set-tax', 'set-budget', 'set-subsidy', 'set-procedure', 'invalidate-decision'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  const d = enablePeriodicObligationsEvent(ctx());
  if (!d.accepted) throw Error(d.reason);
  commit(d.events);
  const operate = (actorId: string, command: PeriodicCommand) => {
    const d = residentPeriodicOperation({
      ...ctx(),
      actorId,
      request: worldPeriodicRequest(w, command),
    });
    if (d.accepted) commit(d.events);
    return d;
  };
  const ready = (payer = 'a', revenue = 'b', amount = 2) => {
    const d = operate(payer, {
      type: 'offer',
      id: 'original',
      title: '原有限现金约定',
      terms: '不制造继承和身体活动',
      payer: { sector: 'agent', id: payer },
      revenue: { sector: 'agent', id: revenue },
      amount,
      firstDueAt: 60000,
      periodMs: 60000,
      periods: 2,
      acceptBy: 1000,
    });
    expect(d.accepted).toBe(true);
    expect(operate(revenue, { type: 'accept', id: 'original', expectedRevision: 1 }).accepted).toBe(
      true,
    );
  };
  const die = (id = 'a') => {
    const e = residentDeathFixture();
    commit([
      capturedResidentDeparture(w, {
        ...e,
        id: asEventId(`actual-death-${id}`),
        sequence: events.length + 1,
        payload: { ...e.payload, agentId: asAgentId(id) },
      }),
    ]);
  };
  const time = (at: number) => {
    commit([
      createEventEnvelope({
        id: `time-${at}`,
        simulationId: 'sim-1',
        sequence: events.length + 1,
        occurredAt: at,
        type: 'SimulationTimeAdvanced' as const,
        payload: {
          previous: w.clock,
          next: advanceClock(w.clock, at - w.clock.now),
          deltaMs: at - w.clock.now,
        },
      }),
    ]);
    const es = advancePeriodicObligations(ctx());
    commit(es);
    return es;
  };
  return { state: () => w, events, ready, operate, die, time };
}
test('an independently accepted promise pays from actual preserved cash after death once per original due, without a ghost resident or inherited action authority', () => {
  const f = fixture();
  f.ready();
  f.die();
  const es = f.time(60000),
    w = f.state();
  expect(w.agents.a).toBeUndefined();
  expect(w.agents.b?.balance).toBe(2);
  expect(estateCashBalance(w.residentExits?.cash)).toBeCloseTo(23.12345678, 10);
  expect(w.periodicObligations?.contracts.original?.installments['1']?.status).toBe('paid');
  expect(es).toHaveLength(1);
  const e = es[0]!;
  if (e.type !== 'ResidentPeriodicObligationsCommitted') throw Error('expected');
  expect(e.payload.estateCashEffects?.resolution.mappings[0]).toMatchObject({
    residentId: 'a',
    populationEventId: 'actual-death-a',
  });
  expect(e.payload.transactions[0]?.entries[0]?.account.sector).toBe('estate');
  expect(() => applyWorldEvent(w, e)).toThrow();
  f.time(120000);
  expect(f.state().agents.b?.balance).toBe(4);
  expect(f.state().periodicObligations?.contracts.original?.status).toBe('ended');
  expect(f.operate('a', { type: 'terminate', id: 'original', expectedRevision: 4 }).accepted).toBe(
    false,
  );
});
test('actual contractual revenue can arrive into a departed creditor account; no beneficiary is invented and the original contract subject stays fixed', () => {
  const f = fixture();
  f.ready();
  f.die('b');
  f.time(60000);
  const w = f.state();
  expect(w.agents.b).toBeUndefined();
  expect(w.agents.a?.balance).toBeCloseTo(23.12345678, 10);
  expect(estateCashBalance(w.residentExits?.cash)).toBe(2);
  expect(w.periodicObligations?.contracts.original?.revenue).toEqual({ sector: 'agent', id: 'b' });
  expect(
    f.operate('c', {
      type: 'offer',
      id: 'new',
      title: '新约定',
      terms: '不能给死者新权力',
      payer: { sector: 'agent', id: 'c' },
      revenue: { sector: 'agent', id: 'b' },
      amount: 1,
      firstDueAt: 180000,
      periodMs: 60000,
      periods: 1,
      acceptBy: 120000,
    }).accepted,
  ).toBe(false);
});
test('insufficient preserved cash records the original unpaid responsibility without burning remaining assets or manufacturing a successor subsidy', () => {
  const f = fixture();
  f.ready('a', 'b', 20);
  f.die();
  f.time(60000);
  f.time(120000);
  const w = f.state();
  expect(w.agents.b?.balance).toBe(20);
  expect(estateCashBalance(w.residentExits?.cash)).toBeCloseTo(5.12345678, 10);
  expect(w.periodicObligations?.contracts.original?.installments['2']).toMatchObject({
    status: 'unpaid',
    unpaidReason: 'periodic-insufficient-funds',
  });
});
test('a saved physical cash receipt cannot be omitted, replace its source or pay a substituted amount, and refusal leaves every pre-event aggregate unchanged', () => {
  const f = fixture();
  f.ready();
  f.die();
  f.time(60000);
  const actual = f.events.at(-1)!;
  if (actual.type !== 'ResidentPeriodicObligationsCommitted') throw Error('expected');
  // Rebuild the exact pre-payment state solely through the recorded world events.
  const source = fixture();
  source.ready();
  source.die();
  const at = createEventEnvelope({
    id: 'time-pre-payment',
    simulationId: 'sim-1',
    sequence: source.events.length + 1,
    occurredAt: 60000,
    type: 'SimulationTimeAdvanced' as const,
    payload: {
      previous: source.state().clock,
      next: advanceClock(source.state().clock, 60000),
      deltaMs: 60000,
    },
  });
  const before = applyWorldEvent(source.state(), at),
    snapshot = structuredClone(before),
    p = actual.payload;
  const { estateCashEffects: removed, ...without } = p;
  expect(removed).toBeDefined();
  expect(() => applyWorldEvent(before, { ...actual, payload: without })).toThrow();
  const estate = p.estateCashEffects;
  if (!estate) throw Error('missing');
  expect(() =>
    applyWorldEvent(before, {
      ...actual,
      payload: {
        ...p,
        estateCashEffects: {
          ...estate,
          source: { ...estate.source, id: 'unrelated' },
        },
      },
    }),
  ).toThrow('consumer-source-mismatch');
  expect(() =>
    applyWorldEvent(before, {
      ...actual,
      payload: { ...p, estateCashEffects: { ...estate, events: [] } },
    }),
  ).toThrow('receipt-coverage-mismatch');
  expect(before).toEqual(snapshot);
});
