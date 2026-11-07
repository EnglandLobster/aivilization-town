import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
  type EconomicAccount,
} from '@aivilization/economy';
import {
  applyPublicLaborEvent,
  publicLaborEffects,
  type PublicLaborEvent,
  type PublicLaborState,
} from '@aivilization/society';
export const PUBLIC_LABOR_ESCROW_ACCOUNT = economicAccount(
  'public-service',
  'resident-public-labor',
);
export function publicLaborTransactions(
  state: PublicLaborState,
  events: readonly PublicLaborEvent[],
  eventId: string,
): AccountingTransaction[] {
  let current = state;
  const result: AccountingTransaction[] = [],
    treasury = economicAccount('treasury', 'public-treasury');
  for (const [i, e] of events.entries()) {
    const fx = publicLaborEffects(current, e),
      actor = economicAccount('agent', e.session.actorId);
    const transfers: readonly (readonly [EconomicAccount, EconomicAccount, number, string])[] = [
      [treasury, PUBLIC_LABOR_ESCROW_ACCOUNT, fx.reservedMicros, 'reserve'],
      [PUBLIC_LABOR_ESCROW_ACCOUNT, actor, fx.paidMicros - fx.withheldMicros, 'earned-net'],
      [PUBLIC_LABOR_ESCROW_ACCOUNT, treasury, fx.withheldMicros, 'income-tax'],
      [PUBLIC_LABOR_ESCROW_ACCOUNT, treasury, fx.refundedMicros, 'unearned-refund'],
    ];
    for (const [from, to, micros, reason] of transfers)
      if (micros > 0)
        result.push(
          createMoneyTransfer({
            transactionId: `${eventId}:${i}:${reason}`,
            reason: `public-labor-${reason}`,
            from,
            to,
            amount: micros / 1e6,
          }),
        );
    current = applyPublicLaborEvent(current, e);
  }
  return result;
}
