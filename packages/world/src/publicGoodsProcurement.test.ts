import { expect, test } from 'vitest';
import { EVIDENCE_TRADE_POLICY, type EvidenceTradeCommand } from '@aivilization/commerce';
import { SERVICE_ENGAGEMENTS_POLICY } from '@aivilization/services';
import type { PublicCommand } from '@aivilization/governance';
import { freightWorldFixture } from './testFixtures/residentFreight';
import { enableResidentServiceEngagementsEvent } from './residentServiceEngagements';
import {
  enableResidentEvidenceTradeEvent,
  residentEvidenceTradeEvent,
  advanceResidentEvidenceTrade,
} from './residentEvidenceTrade';
import {
  enableResidentPublicGovernanceEvent,
  residentPublicGovernanceCommand,
} from './residentPublicGovernance';
import { enableResidentPublicProcurementEvent } from './publicServiceProcurement';
import { enableResidentPublicGoodsProcurementEvent } from './publicGoodsProcurement';
import { applyWorldEvent } from './projection';

function fixture(treasury = 100) {
  const t = freightWorldFixture({ treasury });
  t.ok(
    enableResidentServiceEngagementsEvent({ ...t.context(), policy: SERVICE_ENGAGEMENTS_POLICY }),
  );
  t.ok(enableResidentEvidenceTradeEvent({ ...t.context(), policy: EVIDENCE_TRADE_POLICY }));
  t.commit([
    enableResidentPublicGovernanceEvent({
      ...t.context(),
      institutionPolicy: {
        policyVersion: 'test-v1',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 100,
        maximumTreasuryReserve: 1000,
        maximumSubsidyBalanceFloor: 100,
        maximumSubsidyPerCadence: 10,
      },
      grant: {
        id: 'town',
        source: { kind: 'explicit-scenario-grant', version: 'test-v1', description: 'Test grant' },
        residents: ['source', 'recipient', 'friend'],
        actions: ['set-tax', 'set-budget', 'set-subsidy', 'set-procedure', 'invalidate-decision'],
      },
      procedure: {
        electorate: ['source', 'recipient', 'friend'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 10000,
        executors: 'electorate',
      },
    }),
  ]);
  t.commit([enableResidentPublicProcurementEvent(t.context())]);
  t.commit([enableResidentPublicGoodsProcurementEvent(t.context())]);
  t.ready();
  const trade = (actor: string, command: EvidenceTradeCommand) =>
    residentEvidenceTradeEvent({ ...t.context(actor), command });
  t.ok(
    trade('source', {
      type: 'offer',
      id: 'order',
      source: {
        kind: 'freight',
        id: 'parcel',
        expectedRevision: t.w.logistics!.freight.parcel!.revision,
      },
      payer: { sector: 'treasury', id: 'public-treasury' },
      revenue: { sector: 'agent', id: 'source' },
      amount: 30,
      acceptBy: 600000,
      title: 'Publicly funded wood',
      terms: 'Named recipient owns actual delivered wood',
    }),
  );
  const op = (actor: string, type: 'accept' | 'fund' | 'confirm' | 'withdraw') =>
    trade(actor, {
      type,
      id: 'order',
      expectedRevision: t.w.residentTrade!.orders.order!.revision,
    });
  const gov = (
    actor: string,
    command: PublicCommand | { type: 'execute'; id: string; expectedRevision: number },
  ) => residentPublicGovernanceCommand({ ...t.context(actor), command });
  const revision = () => t.w.publicGovernance!.authority.proposals.purchase!.revision;
  const approve = () => {
    t.ok(
      gov('friend', {
        type: 'propose',
        id: 'purchase',
        text: 'Our chosen purchase',
        expectedProcedureRevision: 1,
        closesAt: t.w.clock.now + 100,
        action: { kind: 'fund-goods', orderId: 'order', expectedRevision: 2, amount: 30 },
      }),
    );
    for (const actor of ['source', 'friend'])
      t.ok(
        gov(actor, { type: 'vote', id: 'purchase', expectedRevision: revision(), choice: 'yes' }),
      );
    t.time(100);
    t.ok(gov('friend', { type: 'close', id: 'purchase', expectedRevision: revision() }));
  };
  const fund = () =>
    gov('friend', { type: 'execute', id: 'purchase', expectedRevision: revision() });
  const settle = () => t.commit(advanceResidentEvidenceTrade(t.context('system')));
  return { t, op, approve, fund, settle };
}

test('buyer consent does not debit treasury; exact public decision funds actual freight once, with conservation and replay', () => {
  const { t, op, approve, fund, settle } = fixture();
  expect(op('friend', 'accept').accepted).toBe(false);
  t.ok(op('recipient', 'accept'));
  expect(t.w.treasury).toBe(100);
  expect(t.w.residentTrade!.orders.order).toMatchObject({ status: 'accepted', escrow: 0 });
  expect(op('friend', 'fund').accepted).toBe(false);
  expect(t.freight('carrier', 'load').accepted).toBe(false);
  approve();
  const before = t.w,
    decision = fund();
  if (!decision.accepted) throw Error(decision.reason);
  const event = decision.events[0]!;
  if (event.type !== 'ResidentPublicGovernanceCommitted' || !event.payload.goodsCommit)
    throw Error('fixture');
  expect(() =>
    applyWorldEvent(before, {
      ...event,
      type: 'ResidentEvidenceTradeCommitted',
      payload: event.payload.goodsCommit!,
    }),
  ).toThrow('exact-public-goods-composite-event-required');
  const { goodsCommit: omitted, ...withoutGoods } = event.payload;
  void omitted;
  expect(() => applyWorldEvent(before, { ...event, payload: withoutGoods })).toThrow(
    'public-goods-effect-mismatch',
  );
  const reserveWorld = {
    ...before,
    governance: {
      ...before.governance!,
      publicBudget: { ...before.governance!.publicBudget!, minimumTreasuryReserve: 71 },
    },
  };
  expect(() => applyWorldEvent(reserveWorld, event)).toThrow(
    'public-goods-treasury-reserve-violated',
  );
  const reserveDecision = residentPublicGovernanceCommand({
    ...t.context('friend'),
    projection: reserveWorld,
    command: {
      type: 'execute',
      id: 'purchase',
      expectedRevision: before.publicGovernance!.authority.proposals.purchase!.revision,
    },
  });
  expect(reserveDecision.accepted).toBe(false);
  t.ok(decision);
  expect(t.w.treasury).toBe(70);
  expect(t.w.agents.recipient!.balance).toBe(100);
  expect(fund().accepted).toBe(false);
  t.ok(t.freight('carrier', 'load'));
  t.commit(t.move('carrier'));
  t.arrive();
  t.ok(t.freight('carrier', 'deliver'));
  settle();
  expect(op('friend', 'confirm').accepted).toBe(false);
  t.ok(op('recipient', 'confirm'));
  expect(t.w.agents.source!.balance).toBe(130);
  expect(t.w.materials!.stocks['recipient-stock']!.inventory).toEqual({ Wood: 4 });
  expect(t.w.residentTrade!.orders.order).toMatchObject({
    status: 'completed',
    paid: 30,
    fundingDecisionId: 'purchase',
  });
  t.replay();
});

test('insufficient treasury and withdrawn consent preserve the unconsumed public decision', () => {
  const { t, op, approve, fund } = fixture(29);
  t.ok(op('recipient', 'accept'));
  approve();
  const before = t.w;
  expect(fund().accepted).toBe(false);
  expect(t.w).toBe(before);
  expect(t.w.publicGovernance!.authority.proposals.purchase!.status).toBe('approved');
  t.ok(op('recipient', 'withdraw'));
  expect(fund().accepted).toBe(false);
  expect(t.w.treasury).toBe(29);
  t.replay();
});

test('cancelled loaded goods refund their original treasury only after physical return', () => {
  const { t, op, approve, fund, settle } = fixture();
  t.ok(op('recipient', 'accept'));
  approve();
  t.ok(fund());
  t.ok(t.freight('carrier', 'load'));
  t.commit(t.move('carrier'));
  t.ok(t.freight('source', 'cancel'));
  settle();
  expect(t.w.treasury).toBe(70);
  t.arrive();
  t.commit(t.move('carrier', 'west'));
  t.arrive();
  t.ok(t.freight('carrier', 'return'));
  settle();
  expect(t.w.treasury).toBe(100);
  expect(t.w.agents.recipient!.balance).toBe(100);
  expect(t.w.residentTrade!.orders.order).toMatchObject({ status: 'refunded', refunded: 30 });
  expect(t.w.materials!.stocks['source-stock']!.inventory.Wood).toBe(8);
  t.replay();
});
