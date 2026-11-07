import { advanceClock } from '@aivilization/sim-core';
import { assertResidentExitSnapshot } from './residentExitPreservation';
import { expect, test } from 'vitest';
import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import { applyWorldEvent } from './projection';
import { residentExitFixture, capturedResidentDeparture } from './testFixtures/residentExit';
import {
  prepareResidentEstateCashEffects,
  applyResidentEstateCashEffects,
} from './residentEstateCashEffects';
const source = {
  context: 'periodic-obligations' as const,
  id: 'existing-contract',
  revision: 3,
  policyVersion: 'resident-periodic-obligations-v1',
};
const ledger = (amount = 2) => [
  createMoneyTransfer({
    transactionId: 'periodic-original-payout',
    reason: 'periodic-obligation-paid',
    from: economicAccount('agent', 'a'),
    to: economicAccount('public-service', 'resident-periodic-obligations'),
    amount,
  }),
];
const fixture = () => {
  const w = residentExitFixture();
  return applyWorldEvent(w, capturedResidentDeparture(w));
};
test('a closed consumer prepares physical-cash receipts and replays them without changing the original counterparty or making a fake actor', () => {
  const w = fixture(),
    raw = ledger(),
    p = prepareResidentEstateCashEffects(w, source, raw),
    next = applyResidentEstateCashEffects(w, source, raw, p);
  expect(next?.cash.accounts['estate-10']?.balance).toBe(w.moneySupply - 2);
  expect(
    next?.cash.accounts['estate-10']?.settledSources['periodic-obligations:existing-contract'],
  ).toMatchObject({ revision: 3, transactionId: raw[0]?.transactionId });
  expect(p.events).toHaveLength(1);
  expect(p.events[0]?.type).toBe('EstateCashSettled');
  expect(w.residentExits?.cash.accounts['estate-10']?.balance).toBe(w.moneySupply);
  expect(w.agents.a).toBeUndefined();
  expect(p).not.toHaveProperty('actorId');
  expect(() =>
    applyResidentEstateCashEffects({ ...w, residentExits: next! }, source, raw, p),
  ).toThrow('physical-account-proof-mismatch');
});
test('original consumer refunds enter the same preserved account while balances and responsibilities stay in their owning domains', () => {
  const w = fixture(),
    raw = [
      createMoneyTransfer({
        transactionId: 'refund-original-escrow',
        reason: 'original-consumer-refund',
        from: economicAccount('public-service', 'resident-periodic-obligations'),
        to: economicAccount('agent', 'a'),
        amount: 2,
      }),
    ];
  const p = prepareResidentEstateCashEffects(w, source, raw);
  expect(
    applyResidentEstateCashEffects(w, source, raw, p)?.cash.accounts['estate-10']?.balance,
  ).toBe(w.moneySupply + 2);
});
test('missing receipts, unrelated or forged consumer version/reference/ledger, and reusing a source revision cannot masquerade as physical cash settlement', () => {
  const w = fixture(),
    raw = ledger(),
    p = prepareResidentEstateCashEffects(w, source, raw);
  expect(() => applyResidentEstateCashEffects(w, source, raw, { ...p, events: [] })).toThrow(
    'receipt-coverage-mismatch',
  );
  expect(() => applyResidentEstateCashEffects(w, { ...source, id: 'unrelated' }, raw, p)).toThrow(
    'consumer-source-mismatch',
  );
  const e = p.events[0]!;
  if (e.type !== 'EstateCashSettled') throw Error('expected');
  expect(() =>
    applyResidentEstateCashEffects(w, source, raw, {
      ...p,
      events: [{ ...e, source: { ...source, id: 'unrelated' } }],
    }),
  ).toThrow('owning-cash-receipt-mismatch');
  expect(() =>
    prepareResidentEstateCashEffects(w, { ...source, policyVersion: 'unsupported' }, raw),
  ).toThrow('owning-settlement-source');
  const next = applyResidentEstateCashEffects(w, source, raw, p)!;
  expect(() =>
    prepareResidentEstateCashEffects({ ...w, residentExits: next }, source, raw),
  ).toThrow('owning-source-already-settled');
});
test('overdraft or wrong actual clearing account is rejected during preparation, while legacy living-only cash needs no estate receipts', () => {
  const w = fixture();
  expect(() => prepareResidentEstateCashEffects(w, source, ledger(30))).toThrow(
    'overdraft-or-money-range',
  );
  const wrong = [
    createMoneyTransfer({
      transactionId: 'wrong-consumer',
      reason: 'unsupported',
      from: economicAccount('agent', 'a'),
      to: economicAccount('public-service', 'resident-logistics'),
      amount: 2,
    }),
  ];
  expect(() => prepareResidentEstateCashEffects(w, source, wrong)).toThrow();
  const living = residentExitFixture(),
    raw = ledger(),
    p = prepareResidentEstateCashEffects(living, source, raw);
  expect(p.events).toEqual([]);
  expect(p.resolution.mappings).toEqual([]);
  expect(applyResidentEstateCashEffects(living, source, raw, p)).toEqual(living.residentExits);
});

test('actual owning settlement boundary is preserved independently of a longer command end, and future or substituted custody time is rejected', () => {
  const base = fixture(),
    w = { ...base, clock: advanceClock(base.clock, 100) },
    raw = ledger();
  const p = prepareResidentEstateCashEffects(w, source, raw, 50);
  expect(p.events[0]).toMatchObject({ type: 'EstateCashSettled', at: 50 });
  const next = applyResidentEstateCashEffects(w, source, raw, p, 50)!;
  expect(next.cash.accounts['estate-10']!.at).toBe(50);
  assertResidentExitSnapshot({ ...w, residentExits: next });
  for (const at of [-1, 101, NaN, Infinity]) {
    expect(() => prepareResidentEstateCashEffects(w, source, raw, at)).toThrow(
      'invalid-settlement-time',
    );
    expect(() => applyResidentEstateCashEffects(w, source, raw, p, at)).toThrow(
      'invalid-settlement-time',
    );
  }
  expect(() => applyResidentEstateCashEffects(w, source, raw, p, 51)).toThrow(
    'owning-cash-receipt-mismatch',
  );
  const future = structuredClone(next);
  Object.assign(future.cash.accounts['estate-10']!, { at: 999 });
  expect(() => assertResidentExitSnapshot({ ...w, residentExits: future })).toThrow(
    'custody-time-unobserved',
  );
});
