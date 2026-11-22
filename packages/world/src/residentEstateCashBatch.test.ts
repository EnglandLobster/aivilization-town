import { expect, test } from 'vitest';
import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import { residentExitFixture, capturedResidentDeparture } from './testFixtures/residentExit';
import { applyWorldEvent } from './projection';
import {
  prepareResidentEstateCashBatch,
  applyResidentEstateCashBatch,
} from './residentEstateCashBatch';
const source = {
  context: 'earned-wages' as const,
  id: 'original-wage',
  revision: 4,
  policyVersion: 'resident-earned-wage-estate-v1',
};
const payment = (id: string, amount: number, incoming = true) =>
  createMoneyTransfer({
    transactionId: id,
    reason: 'original-wage-flow',
    from: economicAccount(
      incoming ? 'public-service' : 'agent',
      incoming ? 'resident-earned-wages' : 'a',
    ),
    to: economicAccount(
      incoming ? 'agent' : 'public-service',
      incoming ? 'a' : 'resident-earned-wages',
    ),
    amount,
  });
const fixture = () => {
  const w = residentExitFixture();
  return applyWorldEvent(w, capturedResidentDeparture(w));
};
test('one consumer revision retains distinct income/refund rows to the same estate and replays their successive balances', () => {
  const w = fixture(),
    before = structuredClone(w),
    tx = [payment('income', 2), payment('refund', 3)];
  const p = prepareResidentEstateCashBatch(w, source, tx),
    r = applyResidentEstateCashBatch(w, source, tx, p);
  expect(p.effects).toHaveLength(2);
  expect(p.effects[0]!.source.id).not.toBe(p.effects[1]!.source.id);
  expect(r.transactions.map((t) => t.transactionId)).toEqual(['income', 'refund']);
  expect(r.residentExits.cash.accounts['estate-10']!.balance).toBe(w.moneySupply + 5);
  expect(r.residentExits.cash.accounts['estate-10']!.revision).toBe(3);
  expect(w).toEqual(before);
  expect(applyResidentEstateCashBatch(structuredClone(w), source, tx, p)).toEqual(r);
  expect(() =>
    applyResidentEstateCashBatch({ ...w, residentExits: r.residentExits }, source, tx, p),
  ).toThrow();
});
test('gross outgoing rows cannot use a later refund to conceal an overdraft; missing, reordered, forged and duplicate evidence rejects atomically', () => {
  const w = fixture(),
    before = structuredClone(w),
    tx = [payment('income', 2), payment('refund', 3)],
    p = prepareResidentEstateCashBatch(w, source, tx);
  expect(() =>
    prepareResidentEstateCashBatch(w, source, [
      payment('outgoing', 30, false),
      payment('refund', 30),
    ]),
  ).toThrow('overdraft');
  expect(() => prepareResidentEstateCashBatch(w, source, [tx[0]!, tx[0]!])).toThrow(
    'duplicate-transaction',
  );
  expect(() =>
    applyResidentEstateCashBatch(w, source, tx, { ...p, effects: p.effects.slice(1) }),
  ).toThrow('coverage');
  expect(() =>
    applyResidentEstateCashBatch(w, source, tx, { ...p, effects: [...p.effects].reverse() }),
  ).toThrow();
  expect(() => applyResidentEstateCashBatch(w, { ...source, id: 'forged' }, tx, p)).toThrow(
    'source',
  );
  expect(() =>
    applyResidentEstateCashBatch(w, source, [payment('income', 9), tx[1]!], p),
  ).toThrow();
  expect(w).toEqual(before);
});
