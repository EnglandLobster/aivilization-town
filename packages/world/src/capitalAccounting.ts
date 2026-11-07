import {
  economicAccount,
  createAccountingTransaction,
  type AccountingTransaction,
} from '@aivilization/economy';
import {
  CAPITAL_AGREEMENTS_POLICY,
  capitalEscrowMicros,
  type EnterpriseCapitalEvent,
  type CapitalAccount,
  type EnterpriseState,
} from '@aivilization/enterprise';
export const CAPITAL_ESCROW_ACCOUNT = economicAccount('public-service', 'resident-capital');
export function worldCapitalEscrowBalance(
  enterprises: Readonly<Record<string, EnterpriseState>>,
): number {
  return (
    Object.values(enterprises).reduce((sum, e) => sum + capitalEscrowMicros(e.capital), 0) /
    CAPITAL_AGREEMENTS_POLICY.moneyScale
  );
}
/** Derive the exact mechanical ledger from recorded domain flows, not prices or a model interpretation. */
export function capitalTransactions(
  enterpriseId: string,
  events: readonly EnterpriseCapitalEvent[],
  requestId: string,
): readonly AccountingTransaction[] {
  let ordinal = 0;
  const transactions: AccountingTransaction[] = [];
  const transfer = (
    from: ReturnType<typeof economicAccount>,
    to: ReturnType<typeof economicAccount>,
    amount: number,
  ) => {
    if (amount === 0) return;
    transactions.push(
      createAccountingTransaction({
        transactionId: `${requestId}-capital-${ordinal++}`,
        reason: 'enterprise-capital',
        entries: [
          { account: from, amount: -amount },
          { account: to, amount },
        ],
      }),
    );
  };
  const account = (a: CapitalAccount | { sector: 'enterprise' } | { sector: 'escrow' }) =>
    a.sector === 'escrow'
      ? CAPITAL_ESCROW_ACCOUNT
      : a.sector === 'enterprise'
        ? economicAccount('enterprise', enterpriseId)
        : economicAccount(a.sector, a.id);
  for (const event of events) {
    if (event.type === 'EnterpriseCapitalAgreementCommitted')
      for (const flow of event.event.flows)
        transfer(
          account(flow.from),
          account(flow.to),
          flow.amountMicros / CAPITAL_AGREEMENTS_POLICY.moneyScale,
        );
    else if (
      event.type === 'EnterpriseCapitalDividendPaid' ||
      event.type === 'EnterpriseCapitalClosed'
    ) {
      transfer(
        economicAccount('enterprise', enterpriseId),
        CAPITAL_ESCROW_ACCOUNT,
        event.totalAmount,
      );
      for (const payment of event.payments)
        transfer(CAPITAL_ESCROW_ACCOUNT, account(payment.account), payment.amount);
    }
  }
  return transactions;
}
