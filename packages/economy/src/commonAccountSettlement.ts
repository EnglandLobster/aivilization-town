import { assertMoneySupplyDelta, type AccountingTransaction } from './accounting';
import { applyCommonAccountEvent, commonAccountNextBalance } from './commonAccounts';
import {
  commonAccountId,
  COMMON_ACCOUNT_SETTLEMENT_SOURCES,
  type CommonAccountSettlementContext,
  type CommonAccountSettlementVersion,
  type CommonAccountsState,
  type CommonAccountEvent,
} from './commonAccountModel';
/** The application must pair this with the owning consumer's validated settlement in the same commit. */
export function settleCommonAccountExternalTransfer(input: {
  state: CommonAccountsState;
  actorId: string;
  at: number;
  receiptId: string;
  source: {
    context: CommonAccountSettlementContext;
    referenceId: string;
    policyVersion: CommonAccountSettlementVersion;
  };
  transaction: AccountingTransaction;
}):
  | { accepted: true; state: CommonAccountsState; events: readonly CommonAccountEvent[] }
  | { accepted: false; reason: string } {
  const { state: s, transaction: t } = input,
    no = (reason: string) => ({ accepted: false as const, reason });
  const source = Object.hasOwn(COMMON_ACCOUNT_SETTLEMENT_SOURCES, input.source.context)
    ? COMMON_ACCOUNT_SETTLEMENT_SOURCES[input.source.context]
    : undefined;
  if (
    !commonAccountId(input.actorId) ||
    !commonAccountId(input.receiptId) ||
    !commonAccountId(input.source.referenceId) ||
    !Number.isSafeInteger(input.at) ||
    input.at < 0 ||
    s.receipts[input.receiptId] ||
    !source ||
    input.source.policyVersion !== source.policyVersion
  )
    return no('invalid-common-settlement-reference');
  assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
  const own = t.entries.filter((e) => e.account.sector === 'collective');
  if (
    own.length !== 1 ||
    t.entries.length !== 2 ||
    !t.entries.some(
      (e) => e.account.sector === 'public-service' && e.account.accountId === source.accountId,
    )
  )
    return no('unsupported-common-account-settlement');
  const entry = own[0]!;
  if (!entry.account.accountId.startsWith('collective:'))
    return no('invalid-common-account-reference');
  const id = entry.account.accountId.slice('collective:'.length),
    a = s.accounts[id];
  if (
    !a ||
    a.status === 'closed' ||
    (entry.amount < 0 && a.status !== 'open' && input.source.context !== 'periodic-obligations')
  )
    return no('common-account-settlement-unavailable');
  if (entry.amount < 0 && -entry.amount > s.policy.maxTransfer)
    return no('common-account-transfer-limit');
  const balance = commonAccountNextBalance(a.balance, entry.amount, s.policy.maxBalance);
  if (balance === undefined || !Number.isSafeInteger(a.revision + 1))
    return no('unrepresentable-common-account-settlement');
  const events: CommonAccountEvent[] = [
    {
      type: 'CommonAccountChanged',
      account: { ...a, balance, revision: a.revision + 1, at: input.at },
    },
    {
      type: 'CommonAccountReceiptRecorded',
      receipt: {
        id: input.receiptId,
        actorId: input.actorId,
        accountIds: [a.id],
        accountRevisions: { [a.id]: a.revision + 1 },
        at: input.at,
        operation: 'externalSettlement',
        note: '',
        source: input.source,
        transaction: t,
      },
    },
  ];
  return { accepted: true, events, state: events.reduce(applyCommonAccountEvent, s) };
}
