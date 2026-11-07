import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
  type EconomicAccount,
} from '@aivilization/economy';
import {
  elapsedStudyEffects,
  type ElapsedStudyEvent,
  type ElapsedStudyState,
} from '@aivilization/society';

export const STUDY_ESCROW_ACCOUNT = economicAccount('public-service', 'resident-study');
/** Only the owning process determines earned portions. This maps integer allocations to balanced transfers. */
export function studyAccountingTransactions(
  state: ElapsedStudyState,
  event: ElapsedStudyEvent,
  transactionId: string,
): AccountingTransaction[] {
  const fx = elapsedStudyEffects(state, event),
    actor = economicAccount('agent', event.session.actorId),
    treasury = economicAccount('treasury', 'public-treasury'),
    external = economicAccount('external', 'education-services'),
    publicEducation = economicAccount('public-service', 'education');
  const transfers: readonly (readonly [EconomicAccount, EconomicAccount, number, string])[] = [
    [actor, STUDY_ESCROW_ACCOUNT, fx.reserve.residentMicros, 'reserve-personal'],
    [treasury, STUDY_ESCROW_ACCOUNT, fx.reserve.treasuryMicros, 'reserve-public'],
    [STUDY_ESCROW_ACCOUNT, external, fx.applied.residentMicros, 'earned-personal'],
    [STUDY_ESCROW_ACCOUNT, publicEducation, fx.applied.treasuryMicros, 'earned-public'],
    [STUDY_ESCROW_ACCOUNT, actor, fx.refund.residentMicros, 'refund-personal'],
    [STUDY_ESCROW_ACCOUNT, treasury, fx.refund.treasuryMicros, 'refund-public'],
  ];
  return transfers.flatMap(([from, to, amount, reason]) => {
    return amount === 0
      ? []
      : [
          createMoneyTransfer({
            transactionId: `${transactionId}:${reason}`,
            reason: `resident-study-${reason}`,
            from,
            to,
            amount: amount / 1_000_000,
          }),
        ];
  });
}
