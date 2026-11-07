import { residentLogisticsEvent } from './residentLogistics';
import { expect, test } from 'vitest';
import {
  EVIDENCE_TRADE_POLICY,
  decideEvidenceTrade,
  emptyEvidenceTradeState,
  type EvidenceTradeCommand,
} from '@aivilization/commerce';
import { SERVICE_ENGAGEMENTS_POLICY, type ServiceEngagementCommand } from '@aivilization/services';
import { freightWorldFixture } from './testFixtures/residentFreight';
import {
  advanceResidentEvidenceTrade,
  enableResidentEvidenceTradeEvent,
  residentEvidenceTradeEvent,
} from './residentEvidenceTrade';
import {
  enableResidentServiceEngagementsEvent,
  residentServiceEngagementEvent,
  advanceResidentServiceEngagements,
} from './residentServiceEngagements';
import { residentEvidenceTradePorts, residentTradeEvidence } from './evidenceTradePorts';
import { applyWorldEvent } from './projection';
function fixture() {
  const t = freightWorldFixture();
  t.ok(
    enableResidentServiceEngagementsEvent({ ...t.context(), policy: SERVICE_ENGAGEMENTS_POLICY }),
  );
  t.ok(enableResidentEvidenceTradeEvent({ ...t.context(), policy: EVIDENCE_TRADE_POLICY }));
  const act = (actor: string, command: EvidenceTradeCommand) =>
    residentEvidenceTradeEvent({ ...t.context(actor), command });
  const op = (actor: string, type: 'accept' | 'confirm' | 'observe' | 'withdraw' | 'waive') =>
    act(actor, { type, id: 'trade', expectedRevision: t.w.residentTrade!.orders.trade!.revision });
  const offer = () => {
    t.ready();
    t.ok(
      act('source', {
        type: 'offer',
        id: 'trade',
        source: {
          kind: 'freight',
          id: 'parcel',
          expectedRevision: t.w.logistics!.freight.parcel!.revision,
        },
        amount: 30,
        payer: { sector: 'agent', id: 'recipient' },
        revenue: { sector: 'agent', id: 'source' },
        acceptBy: 600000,
        title: 'Actual wood order',
        terms: 'Four units, actual delivery then independent confirmation',
      }),
    );
  };
  const advance = () => t.commit(advanceResidentEvidenceTrade(t.context('system')));
  return { t, act, op, offer, advance };
}
test('real freight arrives before order fulfillment, funds transfer once and all domain journals replay', () => {
  const { t, op, offer, advance } = fixture();
  offer();
  const before = t.w;
  expect(t.freight('carrier', 'load')).toMatchObject({
    accepted: false,
    reason: 'trade-payment-or-offer-release-required',
  });
  expect(t.w).toBe(before);
  const { residentTrade: omittedTrade, ...withoutTrade } = t.w;
  void omittedTrade;
  const forgedStart = residentLogisticsEvent({
    ...t.context('carrier'),
    projection: withoutTrade,
    command: {
      type: 'load',
      id: 'parcel',
      expectedRevision: t.w.logistics!.freight.parcel!.revision,
    },
  });
  if (!forgedStart.accepted) throw Error(forgedStart.reason);
  expect(() => applyWorldEvent(t.w, forgedStart.events[0]!)).toThrow(
    'trade-unfunded-freight-cannot-start',
  );

  t.ok(op('recipient', 'accept'));
  expect(t.w.agents.recipient!.balance).toBe(70);
  t.ok(t.freight('carrier', 'load'));
  t.commit(t.move('carrier'));
  t.arrive();
  expect(op('recipient', 'confirm')).toMatchObject({
    accepted: false,
    reason: 'trade-buyer-delivery-confirmation-required',
  });
  t.ok(t.freight('carrier', 'deliver'));
  const goods = t.w.materials;
  advance();
  expect(t.w.materials).toBe(goods);
  expect(t.w.residentTrade!.orders.trade).toMatchObject({
    status: 'awaiting-confirmation',
    escrow: 30,
  });
  t.ok(op('recipient', 'confirm'));
  expect(t.w.agents.source!.balance).toBe(130);
  expect(t.w.agents.carrier!.balance).toBe(108);
  expect(t.w.agents.payer!.balance).toBe(92);
  expect(t.w.materials!.stocks['recipient-stock']!.inventory).toEqual({ Wood: 4 });
  expect(op('recipient', 'confirm').accepted).toBe(false);
  advance();
  t.replay();
});
test('an in-transit cancellation refunds trade only after actual return; freight fees remain separate', () => {
  const { t, op, offer, advance } = fixture();
  offer();
  t.ok(op('recipient', 'accept'));
  t.ok(t.freight('carrier', 'load'));
  t.commit(t.move('carrier'));
  t.ok(t.freight('source', 'cancel'));
  expect(op('recipient', 'withdraw')).toMatchObject({
    accepted: false,
    reason: 'trade-unfunded-offer-required',
  });
  advance();
  expect(t.w.residentTrade!.orders.trade!.escrow).toBe(30);
  t.arrive();
  t.commit(t.move('carrier', 'west'));
  t.arrive();
  t.ok(t.freight('carrier', 'return'));
  advance();
  expect(t.w.residentTrade!.orders.trade).toMatchObject({ status: 'refunded', refunded: 30 });
  expect(t.w.agents.recipient!.balance).toBe(100);
  expect(t.w.agents.payer!.balance).toBe(97);
  expect(t.w.agents.carrier!.balance).toBe(103);
  expect(t.w.materials!.stocks['source-stock']!.inventory.Wood).toBe(8);
  t.replay();
});
test('world replay rejects a self-consistent commerce proof when its owning source never delivered', () => {
  const { t, op, offer } = fixture();
  offer();
  t.ok(op('recipient', 'accept'));
  const context = t.context('recipient'),
    ports = residentEvidenceTradePorts(t.w, context.authorization),
    trueEvidence = residentTradeEvidence(t.w, { kind: 'freight', id: 'parcel' });
  if (!trueEvidence || trueEvidence.sourceVersion !== 'resident-logistics-v1')
    throw Error('fixture');
  const dishonest = decideEvidenceTrade(
    t.w.residentTrade!,
    'recipient',
    t.w.clock.now,
    { type: 'observe', id: 'trade', expectedRevision: t.w.residentTrade!.orders.trade!.revision },
    {
      ...ports,
      evidence: () => ({
        ...trueEvidence,
        revision: trueEvidence.revision + 2,
        status: 'delivered',
      }),
    },
  );
  if (!dishonest.accepted) throw Error(dishonest.reason);
  const valid = t.events.find(
    (e) => e.type === 'ResidentEvidenceTradeCommitted' && e.payload.actorId === 'recipient',
  );
  if (!valid || valid.type !== 'ResidentEvidenceTradeCommitted') throw Error('fixture');
  expect(() =>
    applyWorldEvent(t.w, {
      ...valid,
      payload: {
        ...valid.payload,
        events: dishonest.events,
        transactions: dishonest.transactions,
        evidenceReads: dishonest.evidenceReads,
        commonAccountEvents: [],
      },
    }),
  ).toThrow('trade-owning-domain-evidence-mismatch');
  expect(t.w.residentTrade!.orders.trade!.status).toBe('funded');
  expect(t.w.materials!.stocks['recipient-stock']!.inventory).toEqual({});
});
test('actual service time supports sponsored payment while bodily acceptance and labor stay personal', () => {
  const { t, act, op, advance } = fixture();
  const service = (actor: string, command: ServiceEngagementCommand) =>
    residentServiceEngagementEvent({ ...t.context(actor), command });
  const svc = (actor: string, type: 'accept' | 'fund' | 'leave') =>
    service(actor, {
      type,
      id: 'care',
      expectedRevision: t.w.serviceEngagements!.engagements.care!.revision,
    });
  t.ok(
    service('source', {
      type: 'offer',
      id: 'care',
      controller: { kind: 'resident', id: 'source' },
      title: 'Resident care',
      terms: 'Actual assistance',
      locationId: 'west',
      providerId: 'carrier',
      recipientId: 'friend',
      payer: { sector: 'agent', id: 'payer' },
      revenue: { sector: 'agent', id: 'source' },
      providerShareBps: 0,
      pricePerHour: 0,
      modelId: 'personal-assistance-v1',
      maxDurationMs: 60000,
      startAt: 0,
      endAt: 120000,
      materials: [],
    }),
  );
  t.ok(svc('friend', 'accept'));
  t.ok(svc('payer', 'fund'));
  t.ok(
    act('source', {
      type: 'offer',
      id: 'trade',
      source: {
        kind: 'service',
        id: 'care',
        expectedRevision: t.w.serviceEngagements!.engagements.care!.revision,
      },
      amount: 20,
      payer: { sector: 'agent', id: 'payer' },
      revenue: { sector: 'agent', id: 'source' },
      acceptBy: 10000,
      title: 'Sponsored assistance',
      terms: 'Thirty seconds earns half the agreed amount',
    }),
  );
  const start = (actor: string) =>
    service(actor, {
      type: 'start',
      id: 'care',
      expectedRevision: t.w.serviceEngagements!.engagements.care!.revision,
      until: 60000,
    });
  expect(start('carrier')).toMatchObject({
    accepted: false,
    reason: 'trade-payment-or-offer-release-required',
  });

  const { residentTrade: omittedTrade, ...withoutTrade } = t.w;
  void omittedTrade;
  const forgedStart = residentServiceEngagementEvent({
    ...t.context('carrier'),
    projection: withoutTrade,
    command: {
      type: 'start',
      id: 'care',
      expectedRevision: t.w.serviceEngagements!.engagements.care!.revision,
      until: 60000,
    },
  });
  if (!forgedStart.accepted) throw Error(forgedStart.reason);
  expect(() => applyWorldEvent(t.w, forgedStart.events[0]!)).toThrow(
    'trade-unfunded-service-cannot-start',
  );
  expect(op('friend', 'accept')).toMatchObject({
    accepted: false,
    reason: 'trade-party-authority-required',
  });
  t.ok(op('payer', 'accept'));
  t.ok(start('carrier'));
  t.ok(start('friend'));
  t.time(30000);
  t.commit(advanceResidentServiceEngagements(t.context('system')));
  t.ok(svc('friend', 'leave'));
  advance();
  expect(t.w.serviceEngagements!.engagements.care).toMatchObject({
    status: 'ended',
    progressMs: 30000,
    charged: 0,
  });
  expect(t.w.residentTrade!.orders.trade).toMatchObject({
    earned: 10,
    refunded: 10,
    escrow: 10,
    status: 'awaiting-confirmation',
  });
  t.ok(op('payer', 'confirm'));
  expect(t.w.agents.payer!.balance).toBe(90);
  expect(t.w.agents.source!.balance).toBe(110);
  expect(t.w.agents.carrier!.balance).toBe(100); // No invented wage allocation.
  t.replay();
});
test('old worlds do not acquire orders during replay and explicit enablement preserves existing goods, bodies and money', () => {
  const t = freightWorldFixture();
  expect(t.w.residentTrade).toBeUndefined();
  expect(
    enableResidentEvidenceTradeEvent({ ...t.context(), policy: EVIDENCE_TRADE_POLICY }),
  ).toMatchObject({ accepted: false, reason: 'evidence-trade-physical-domains-required' });
  t.ok(
    enableResidentServiceEngagementsEvent({ ...t.context(), policy: SERVICE_ENGAGEMENTS_POLICY }),
  );
  const before = t.w;
  t.ok(enableResidentEvidenceTradeEvent({ ...t.context(), policy: EVIDENCE_TRADE_POLICY }));
  expect(t.w.residentTrade).toEqual(emptyEvidenceTradeState());
  expect(t.w.agents).toEqual(before.agents);
  expect(t.w.materials).toEqual(before.materials);
  expect(
    enableResidentEvidenceTradeEvent({ ...t.context(), policy: EVIDENCE_TRADE_POLICY }),
  ).toMatchObject({ accepted: false, reason: 'evidence-trade-already-enabled' });
  t.replay();
});
