import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import { applyWorldEvent } from './projection';
import { advanceResidentLogistics, residentLogisticsEvent } from './residentLogistics';
import { freightWorldFixture } from './testFixtures/residentFreight';
import {
  capturedResidentDeparture,
  residentDeathFixture,
  residentExitFixture,
} from './testFixtures/residentExit';

for (const loaded of [false, true])
  test(`original freight payer exit preserves physical custody and refunds original cash (loaded ${loaded})`, () => {
    const t = freightWorldFixture();
    t.ready();
    if (loaded) t.ok(t.freight('carrier', 'load'));
    const prepared = { ...t.w, residentExits: residentExitFixture().residentExits };
    const death = residentDeathFixture();
    const w = applyWorldEvent(
      prepared,
      capturedResidentDeparture(prepared, {
        ...death,
        payload: { ...death.payload, agentId: asAgentId('payer') },
      }),
    );
    const before = structuredClone(w);
    const cancel = residentLogisticsEvent({
      ...t.context('source'),
      projection: w,
      command: {
        type: 'cancel',
        id: 'parcel',
        expectedRevision: w.logistics!.freight.parcel!.revision,
      },
    });
    if (!cancel.accepted) throw Error(cancel.reason);
    const cancelled = cancel.events.reduce(applyWorldEvent, w);
    let after = cancelled;
    let settlement = cancel.events[0]!;
    if (loaded) {
      expect(cancelled.logistics!.freight.parcel).toMatchObject({
        status: 'return-required',
        escrow: 8,
      });
      expect(cancelled.materials!.custodies!.records.parcel!.held).toEqual({ Wood: 4 });
      expect(Object.values(cancelled.residentExits!.cash.accounts)[0]!.balance).toBe(92);
      const returned = residentLogisticsEvent({
        ...t.context('carrier'),
        projection: cancelled,
        command: {
          type: 'return',
          id: 'parcel',
          expectedRevision: cancelled.logistics!.freight.parcel!.revision,
        },
      });
      if (!returned.accepted) throw Error(returned.reason);
      after = returned.events.reduce(applyWorldEvent, cancelled);
      settlement = returned.events[0]!;
    }
    expect(after.agents.payer).toBeUndefined();
    expect(after.agents.carrier!.balance).toBe(loaded ? 103 : 100);
    const estate = Object.values(after.residentExits!.cash.accounts)[0]!;
    expect(estate.balance).toBe(loaded ? 97 : 100);
    expect(after.logistics!.freight.parcel).toMatchObject({
      status: loaded ? 'returned' : 'cancelled',
      escrow: 0,
    });
    expect(after.materials!.stocks['source-stock']!.inventory).toEqual({ Wood: 8 });
    expect(Object.values(after.agents).reduce((n, a) => n + a.balance, estate.balance)).toBe(
      after.moneySupply,
    );
    if (settlement.type !== 'ResidentLogisticsCommitted') throw Error('expected logistics');
    const settlementBefore = loaded ? cancelled : w;
    const { estateCashBatch, ...without } = settlement.payload;
    expect(estateCashBatch).toBeDefined();
    expect(() => applyWorldEvent(settlementBefore, { ...settlement, payload: without })).toThrow(
      'logistics-estate-receipt-coverage-mismatch',
    );
    expect(() =>
      applyWorldEvent(settlementBefore, {
        ...settlement,
        payload: {
          ...settlement.payload,
          estateCashBatch: {
            ...estateCashBatch!,
            source: {
              ...estateCashBatch!.source,
              revision: estateCashBatch!.source.revision + 1,
            },
          },
        },
      }),
    ).toThrow();
    expect(
      residentLogisticsEvent({
        ...t.context('payer'),
        projection: w,
        command: {
          type: 'cancel',
          id: 'parcel',
          expectedRevision: w.logistics!.freight.parcel!.revision,
        },
      }),
    ).toMatchObject({ accepted: false, reason: 'invalid-freight-actor-time-or-id' });
    expect(applyWorldEvent(structuredClone(settlementBefore), settlement)).toEqual(after);
    expect(() => applyWorldEvent(after, settlement)).toThrow();
    expect(w).toEqual(before);
  });

test('deadline refund returns original escrow to departed payer without pretending they cancelled', () => {
  const t = freightWorldFixture();
  t.ready();
  const prepared = { ...t.w, residentExits: residentExitFixture().residentExits };
  const death = residentDeathFixture();
  const departed = applyWorldEvent(
    prepared,
    capturedResidentDeparture(prepared, {
      ...death,
      payload: { ...death.payload, agentId: asAgentId('payer') },
    }),
  );
  const w = { ...departed, clock: { ...departed.clock, now: t.terms.deadline } };
  const before = structuredClone(w);
  const events = advanceResidentLogistics({ ...t.context('system'), projection: w });
  const after = events.reduce(applyWorldEvent, w);
  expect(after.logistics!.freight.parcel).toMatchObject({
    status: 'cancelled',
    escrow: 0,
    refunded: 8,
  });
  expect(Object.values(after.residentExits!.cash.accounts)[0]!.balance).toBe(100);
  expect(after.agents.payer).toBeUndefined();
  expect(after.agents.carrier!.balance).toBe(100);
  expect(after.materials!.stocks['source-stock']!.inventory).toEqual({ Wood: 8 });
  const event = events[0]!;
  if (event.type !== 'ResidentLogisticsCommitted') throw Error('expected logistics');
  expect(event.payload.actorId).toBe('system');
  const receipt = event.payload.events.find((e) => e.type === 'FreightReceiptRecorded');
  expect(receipt).toMatchObject({
    type: 'FreightReceiptRecorded',
    receipt: {
      actorId: 'system',
      operation: 'expire',
    },
  });
  expect(Object.values(after.agents).reduce((n, a) => n + a.balance, 100)).toBe(after.moneySupply);
  expect(events.reduce(applyWorldEvent, structuredClone(w))).toEqual(after);
  expect(advanceResidentLogistics({ ...t.context('system'), projection: after })).toEqual([]);
  expect(w).toEqual(before);
});
