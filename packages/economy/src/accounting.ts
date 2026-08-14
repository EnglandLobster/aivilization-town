export type EconomicAccountSector =
  | 'agent'
  | 'enterprise'
  | 'treasury'
  | 'public-service'
  | 'bank'
  | 'market'
  | 'external'
  | 'monetary-authority';

export type EconomicAccount = {
  readonly accountId: string;
  readonly sector: EconomicAccountSector;
};

export type AccountingEntry = {
  readonly account: EconomicAccount;
  /** Signed balance delta: positive credits the account, negative debits it. */
  readonly amount: number;
};

export type AccountingTransaction = {
  readonly transactionId: string;
  readonly reason: string;
  readonly entries: readonly AccountingEntry[];
};

const CIRCULATING_MONEY_SECTORS: ReadonlySet<EconomicAccountSector> = new Set([
  'agent',
  'enterprise',
  'treasury',
  'public-service',
  'bank',
]);

export function economicAccount(sector: EconomicAccountSector, ownerId: string): EconomicAccount {
  if (ownerId.trim().length === 0) {
    throw new Error('economic account ownerId must not be empty');
  }
  return { accountId: `${sector}:${ownerId.trim()}`, sector };
}

export function createMoneyTransfer(input: {
  readonly transactionId: string;
  readonly reason: string;
  readonly from: EconomicAccount;
  readonly to: EconomicAccount;
  readonly amount: number;
}): AccountingTransaction {
  assertPositiveFinite(input.amount, 'accounting transfer amount');
  return createAccountingTransaction({
    transactionId: input.transactionId,
    reason: input.reason,
    entries: [
      { account: input.from, amount: -input.amount },
      { account: input.to, amount: input.amount },
    ],
  });
}

export function createAccountingTransaction(input: AccountingTransaction): AccountingTransaction {
  if (input.transactionId.trim().length === 0) {
    throw new Error('accounting transactionId must not be empty');
  }
  if (input.reason.trim().length === 0) {
    throw new Error('accounting reason must not be empty');
  }
  if (input.entries.length < 2) {
    throw new Error('accounting transaction requires at least two entries');
  }
  for (const entry of input.entries) {
    if (!Number.isFinite(entry.amount) || entry.amount === 0) {
      throw new Error('accounting entry amount must be non-zero finite');
    }
  }
  const total = input.entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (Math.abs(total) > 1e-9) {
    throw new Error(`accounting transaction is unbalanced by ${total}`);
  }
  return {
    transactionId: input.transactionId.trim(),
    reason: input.reason.trim(),
    entries: input.entries.map((entry) => ({
      account: { ...entry.account },
      amount: entry.amount,
    })),
  };
}

/**
 * The simulation's moneySupply tracks spendable balances owned by domestic
 * actors and public accounts (agents, enterprises, the treasury, public
 * services, and the town bank). AMM reserves, the external sector and the
 * monetary authority are counterpart accounts outside that circulation scope.
 */
export function calculateCirculatingMoneyDelta(transaction: AccountingTransaction): number {
  createAccountingTransaction(transaction);
  return transaction.entries
    .filter((entry) => CIRCULATING_MONEY_SECTORS.has(entry.account.sector))
    .reduce((sum, entry) => sum + entry.amount, 0);
}

export function assertMoneySupplyDelta(input: {
  readonly transaction: AccountingTransaction;
  readonly moneySupplyDelta: number;
}): void {
  const expected = calculateCirculatingMoneyDelta(input.transaction);
  if (Math.abs(expected - input.moneySupplyDelta) > 1e-9) {
    throw new Error(
      `money supply delta ${input.moneySupplyDelta} does not match accounting transaction ${expected}`,
    );
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}
