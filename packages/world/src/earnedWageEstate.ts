import type { EarnedWageClaim } from '@aivilization/enterprise';
import { createHash } from 'node:crypto';
import {
  createMoneyTransfer,
  economicAccount,
  type EstateCashSourceReference,
} from '@aivilization/economy';
import type { WorldProjection } from './projection';
import { residentPhysicalFinancialAccount } from './residentExitPreservation';
import {
  prepareResidentEstateCashBatch,
  applyResidentEstateCashBatch,
  type ResidentEstateCashBatch,
} from './residentEstateCashBatch';

export const EARNED_WAGE_ESTATE_VERSION = 'resident-earned-wage-estate-v1' as const;
export type EarnedWageEstatePayment = {
  readonly version: typeof EARNED_WAGE_ESTATE_VERSION;
  readonly populationEventId: string;
  readonly cash?: ResidentEstateCashBatch;
};
type Payment = {
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly claimId: string;
  readonly claimRevision: number;
  readonly transactionId: string;
  readonly paidMicros: number;
  readonly tax: number;
};
/** Only after the original enterprise payroll and cumulative tax proof have been verified.
 * The transient clearing legs sum to zero; this is not a persistent escrow or new claim. */
function facts(w: WorldProjection, p: Payment) {
  const exit = w.residentExits?.records[p.actorId];
  const account = residentPhysicalFinancialAccount(w, p.actorId);
  if (w.agents[p.actorId] || !exit || account?.kind !== 'estate-custody')
    throw Error('earned-wage-preserved-exit-required');
  if (
    ![p.paidMicros, p.tax].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    p.tax > p.paidMicros
  )
    throw Error('invalid-earned-wage-estate-allocation');
  const source: EstateCashSourceReference = {
    context: 'earned-wages',
    id: `wage-${createHash('sha256')
      .update(JSON.stringify([p.enterpriseId, p.claimId]))
      .digest('hex')}`,
    revision: p.claimRevision,
    policyVersion: EARNED_WAGE_ESTATE_VERSION,
  };
  const clearing = economicAccount('public-service', 'resident-earned-wages');
  const transfer = (
    suffix: string,
    from: ReturnType<typeof economicAccount>,
    to: ReturnType<typeof economicAccount>,
    micros: number,
  ) =>
    createMoneyTransfer({
      transactionId: `${p.transactionId}:${suffix}`,
      reason: EARNED_WAGE_ESTATE_VERSION,
      from,
      to,
      amount: micros / 1e6,
    });
  const net = p.paidMicros - p.tax;
  const transactions =
    net === 0
      ? []
      : [
          transfer('gross', economicAccount('enterprise', p.enterpriseId), clearing, p.paidMicros),
          transfer('net', clearing, economicAccount('agent', p.actorId), net),
          ...(p.tax
            ? [transfer('tax', clearing, economicAccount('treasury', 'public-treasury'), p.tax)]
            : []),
        ];
  return { source, transactions, populationEventId: exit.populationEventId };
}
export function prepareEarnedWageEstatePayment(
  w: WorldProjection,
  p: Payment,
): EarnedWageEstatePayment {
  const f = facts(w, p);
  return {
    version: EARNED_WAGE_ESTATE_VERSION,
    populationEventId: f.populationEventId,
    ...(f.transactions.length
      ? { cash: prepareResidentEstateCashBatch(w, f.source, f.transactions) }
      : {}),
  };
}
export function applyEarnedWageEstatePayment(
  w: WorldProjection,
  p: Payment,
  proof: EarnedWageEstatePayment,
) {
  const f = facts(w, p);
  if (
    proof.version !== EARNED_WAGE_ESTATE_VERSION ||
    proof.populationEventId !== f.populationEventId ||
    Boolean(proof.cash) !== Boolean(f.transactions.length)
  )
    throw Error('earned-wage-estate-proof-mismatch');
  return proof.cash
    ? applyResidentEstateCashBatch(w, f.source, f.transactions, proof.cash).residentExits
    : w.residentExits!;
}

/** An ended original claim is required; cash routing cannot terminate unfinished body work. */
export function assertEndedEstateWageCreditor(
  w: WorldProjection,
  actorId: string,
  claim: EarnedWageClaim | undefined,
): void {
  const exit = w.residentExits?.records[actorId];
  if (
    !claim ||
    claim.actorId !== actorId ||
    claim.status !== 'ended' ||
    w.agents[actorId] ||
    !exit ||
    claim.settledAt > exit.at
  )
    throw Error('ended-preserved-wage-required');
}
