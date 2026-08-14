import { describe, expect, test } from 'vitest';
import {
  assertMoneySupplyDelta,
  calculateCirculatingMoneyDelta,
  createAccountingTransaction,
  createMoneyTransfer,
  economicAccount,
} from './accounting';

describe('double-entry economic accounting', () => {
  test('domestic transfers preserve circulating money', () => {
    const transaction = createMoneyTransfer({
      transactionId: 'payroll-1',
      reason: 'payroll',
      from: economicAccount('enterprise', 'firm-1'),
      to: economicAccount('agent', 'worker-1'),
      amount: 25,
    });
    expect(calculateCirculatingMoneyDelta(transaction)).toBe(0);
    expect(() => assertMoneySupplyDelta({ transaction, moneySupplyDelta: 0 })).not.toThrow();
  });

  test('market and monetary-authority counterparties explain supply changes', () => {
    const marketPurchase = createMoneyTransfer({
      transactionId: 'trade-1',
      reason: 'market-buy',
      from: economicAccount('agent', 'buyer-1'),
      to: economicAccount('market', 'apple'),
      amount: 10,
    });
    const mintedWage = createMoneyTransfer({
      transactionId: 'wage-1',
      reason: 'minted-wage',
      from: economicAccount('monetary-authority', 'system'),
      to: economicAccount('agent', 'worker-1'),
      amount: 20,
    });
    expect(calculateCirculatingMoneyDelta(marketPurchase)).toBe(-10);
    expect(calculateCirculatingMoneyDelta(mintedWage)).toBe(20);
  });

  test('rejects an unbalanced journal', () => {
    expect(() =>
      createAccountingTransaction({
        transactionId: 'broken',
        reason: 'broken',
        entries: [
          { account: economicAccount('agent', 'one'), amount: -10 },
          { account: economicAccount('agent', 'two'), amount: 9 },
        ],
      }),
    ).toThrow('unbalanced');
  });
});
