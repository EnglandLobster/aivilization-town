import { normalizeEnterpriseState } from '@aivilization/enterprise';
import { asAgentId } from '@aivilization/sim-core';
import { expect, test } from 'vitest';
import {
  emptyEvidenceTradeState,
  evidenceTradeEscrowBalance,
  type ConstructionTradeCommand,
} from '@aivilization/commerce';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { residentConstructionFixture } from './testFixtures/residentConstruction';
import { applyWorldEvent } from './projection';
import type { WorldEvent } from './events';
import {
  enableResidentConstructionTradeEvent,
  residentConstructionTradeOperation,
  advanceResidentConstructionTrade,
} from './residentConstructionTrade';
import { residentConstructionEvent, settleResidentConstructionEvent } from './residentPremises';
import { handleAdvanceSimulationTimeCommand } from './agentActions';
function fixture(enterpriseSeller = false) {
  const f = residentConstructionFixture();
  const initial = {
    ...f.initial,
    residentTrade: emptyEvidenceTradeState(),
    ...(enterpriseSeller
      ? {
          enterprises: {
            firm: normalizeEnterpriseState({
              enterpriseId: 'firm',
              name: '施工经营',
              ownerAgentId: asAgentId('worker'),
              occupationName: 'contractor',
              balance: 0,
              inventory: {},
              maxEmployees: 2,
              employeeAgentIds: [],
              status: 'active',
              foundedAt: 0,
              cumulativeSales: 0,
              cumulativePurchases: 0,
              cumulativeWages: 0,
            }),
          },
        }
      : {}),
  };
  let w = f.events.reduce(applyWorldEvent, initial),
    counter = 0;
  const events: WorldEvent[] = [...f.events];
  const context = (actorId = 'builder') => ({
    ...f.context(actorId),
    projection: w,
    requestId: `order-${++counter}`,
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const e of es) next = applyWorldEvent(next, e);
    w = next;
    events.push(...es);
    expect(w.moneySupply).toBe(300);
    expect(
      Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
        Object.values(w.enterprises).reduce((n, e) => n + e.balance, 0) +
        evidenceTradeEscrowBalance(w.residentTrade),
    ).toBeCloseTo(300, 8);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
    return d.events;
  };
  ok(enableResidentConstructionTradeEvent(context('system')));
  const offer: ConstructionTradeCommand = {
    type: 'offer',
    terms: {
      id: 'order',
      projectId: 'p',
      sourceRevision: w.premises!.projects.p!.revision,
      seller: enterpriseSeller
        ? { kind: 'enterprise', id: 'firm' }
        : { kind: 'resident', id: 'worker' },
      buyer: { kind: 'resident', id: 'builder' },
      payer: { sector: 'agent', id: 'builder' },
      revenue: enterpriseSeller
        ? { sector: 'enterprise', id: 'firm' }
        : { sector: 'agent', id: 'worker' },
      amount: 30,
      acceptBy: 10000,
      title: '施工交易',
      terms: '原始精确工程完成交付',
    },
  };
  const act = (actorId: string, command: ConstructionTradeCommand) =>
    residentConstructionTradeOperation({ ...context(actorId), actorId, command });
  const revision = () => w.residentTrade!.constructionOrders!.orders.order!.revision;
  const fund = () => {
    ok(act('worker', offer));
    ok(
      act('builder', { type: 'accept', id: 'order', expectedRevision: revision(), side: 'buyer' }),
    );
  };
  const advance = (deltaMs: number) =>
    commit(
      handleAdvanceSimulationTimeCommand({
        projection: w,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time-${++counter}`,
          simulationId: 'sim',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  return {
    get w() {
      return w;
    },
    context,
    commit,
    ok,
    offer,
    act,
    revision,
    fund,
    advance,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('actual construction order funds and completion settle real wallets and shared escrow in one replayable packet', () => {
  const f = fixture();
  f.fund();
  expect(f.w.agents.builder!.balance).toBe(70);
  expect(f.w.agents.worker!.balance).toBe(100);
  expect(evidenceTradeEscrowBalance(f.w.residentTrade)).toBe(30);
  f.ok(
    residentConstructionEvent({
      ...f.context('worker'),
      command: {
        type: 'start',
        id: 'p',
        revision: f.w.premises!.projects.p!.revision,
        until: 480000,
      },
    }),
  );
  f.advance(480000);
  f.ok(settleResidentConstructionEvent({ ...f.context('system'), projectId: 'p' }));
  f.ok(
    f.act('worker', {
      type: 'observe',
      id: 'order',
      expectedRevision: f.revision(),
      side: 'seller',
    }),
  );
  expect(f.w.agents.worker!.balance).toBe(130);
  expect(f.w.agents.builder!.balance).toBe(70);
  expect(evidenceTradeEscrowBalance(f.w.residentTrade)).toBe(0);
  expect(f.w.premises!.buildings.home).toBeDefined();
  f.replay();
});
test('wrong signer, stale source and forged accounting cannot publish partial wallet effects', () => {
  const f = fixture();
  f.ok(f.act('worker', f.offer));
  const before = structuredClone(f.w);
  expect(
    f.act('worker', { type: 'accept', id: 'order', expectedRevision: f.revision(), side: 'buyer' })
      .accepted,
  ).toBe(false);
  const d = f.act('builder', {
    type: 'accept',
    id: 'order',
    expectedRevision: f.revision(),
    side: 'buyer',
  });
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentConstructionTradeCommitted') throw Error('fixture');
  expect(() => applyWorldEvent(f.w, { ...e, payload: { ...e.payload, transactions: [] } })).toThrow(
    'world-packet',
  );
  const child = e.payload.events[0]!;
  expect(() =>
    applyWorldEvent(f.w, {
      ...e,
      payload: {
        ...e.payload,
        events: [
          {
            ...child,
            order: { ...child.order, evidence: { ...child.order.evidence, progressMs: 1 } },
          },
        ],
      },
    }),
  ).toThrow('owning-source');
  expect(f.w).toEqual(before);
  f.ok(d);
  f.replay();
});
test('commercial withdrawal keeps escrow and real construction obligations until independently authorized settlement', () => {
  const f = fixture();
  f.fund();
  f.ok(
    f.act('builder', {
      type: 'withdraw',
      id: 'order',
      expectedRevision: f.revision(),
      side: 'buyer',
    }),
  );
  expect(evidenceTradeEscrowBalance(f.w.residentTrade)).toBe(30);
  expect(f.w.premises!.projects.p!.status).toBe('open');
  f.ok(
    f.act('worker', {
      type: 'propose-settlement',
      id: 'order',
      expectedRevision: f.revision(),
      side: 'seller',
      proposalId: 'split',
      paySeller: 7,
      text: '双方同意部分补偿',
    }),
  );
  f.ok(
    f.act('builder', {
      type: 'accept-settlement',
      id: 'order',
      expectedRevision: f.revision(),
      side: 'buyer',
      proposalId: 'split',
    }),
  );
  expect(f.w.agents.worker!.balance).toBe(107);
  expect(f.w.agents.builder!.balance).toBe(93);
  expect(evidenceTradeEscrowBalance(f.w.residentTrade)).toBe(0);
  expect(f.w.premises!.projects.p!.status).toBe('open');
  f.replay();
});
test('explicit activation and unpaid expiry preserve old physical construction and cannot masquerade as public funding', () => {
  const f = fixture();
  expect(enableResidentConstructionTradeEvent(f.context('system')).accepted).toBe(false);
  if (f.offer.type !== 'offer') throw Error('fixture');
  expect(
    f.act('worker', {
      type: 'offer',
      terms: {
        ...f.offer.terms,
        payer: { sector: 'treasury', id: 'public-treasury' },
        buyer: { kind: 'public', id: 'town' },
      },
    }).accepted,
  ).toBe(false);
  f.ok(f.act('worker', f.offer));
  f.advance(10000);
  f.commit(advanceResidentConstructionTrade(f.context('system')));
  expect(f.w.residentTrade!.constructionOrders!.orders.order!.status).toBe('cancelled');
  expect(f.w.premises!.projects.p!.status).toBe('open');
  expect(f.w.agents.builder!.balance).toBe(100);
  f.replay();
});

test('real enterprise receives its own construction proceeds with original authority and replayable domain accounting', () => {
  const f = fixture(true);
  f.fund();
  expect(f.w.enterprises.firm!.tradeAccounting!.policyVersion).toBe(
    'enterprise-principal-trade-accounting-v2',
  );
  f.ok(
    residentConstructionEvent({
      ...f.context('worker'),
      command: {
        type: 'start',
        id: 'p',
        revision: f.w.premises!.projects.p!.revision,
        until: 480000,
      },
    }),
  );
  f.advance(480000);
  f.ok(settleResidentConstructionEvent({ ...f.context('system'), projectId: 'p' }));
  const d = f.act('worker', {
    type: 'observe',
    id: 'order',
    expectedRevision: f.revision(),
    side: 'seller',
  });
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentConstructionTradeCommitted') throw Error('fixture');
  expect(() =>
    applyWorldEvent(f.w, { ...e, payload: { ...e.payload, enterpriseEvents: [] } }),
  ).toThrow('enterprise-facts-mismatch');
  f.ok(d);
  expect(f.w.enterprises.firm).toMatchObject({
    balance: 30,
    cumulativeSales: 30,
    retainedEarnings: 30,
  });
  expect(f.w.agents.worker!.balance).toBe(100);
  expect(f.w.agents.builder!.balance).toBe(70);
  f.replay();
});
