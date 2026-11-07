import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import type { ServicePayer, ServiceEngagementsState } from './engagementModel';
export const SERVICE_ENGAGEMENT_ESCROW = economicAccount(
  'public-service',
  'resident-service-engagements',
);
export const serviceMoneyMicros = (n: number): number => {
  const value = Math.round(n * 1e6);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    !Number.isSafeInteger(value) ||
    Math.abs(value / 1e6 - n) > 1e-10
  )
    throw new Error('invalid-service-money');
  return value;
};
export function cumulativeServiceCharge(pricePerHour: number, progressMs: number) {
  if (!Number.isSafeInteger(progressMs) || progressMs < 0)
    throw new Error('invalid-service-progress');
  const micros = (BigInt(serviceMoneyMicros(pricePerHour)) * BigInt(progressMs)) / 3600000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('service-money-overflow');
  return Number(micros) / 1e6;
}
export const cumulativeProviderPay = (charge: number, bps: number) => {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000)
    throw new Error('invalid-service-share');
  return Number((BigInt(serviceMoneyMicros(charge)) * BigInt(bps)) / 10000n) / 1e6;
};
export const serviceMoneyDifference = (after: number, before: number) =>
  (serviceMoneyMicros(after) - serviceMoneyMicros(before)) / 1e6;
export function engagementMoneyTransfer(
  id: string,
  account: ServicePayer,
  amount: number,
  funding: boolean,
) {
  const other = economicAccount(account.sector, account.id);
  return createMoneyTransfer({
    transactionId: id,
    reason: funding ? 'service-engagement-funded' : 'service-engagement-settled',
    from: funding ? other : SERVICE_ENGAGEMENT_ESCROW,
    to: funding ? SERVICE_ENGAGEMENT_ESCROW : other,
    amount,
  });
}

/** Reserve refund/revenue headroom when funds become committed, not when a stranger merely names a payer. */
export function serviceReservedCommonIncoming(
  s: ServiceEngagementsState | undefined,
  accountId: string,
) {
  return Object.values(s?.engagements ?? {}).reduce((sum, e) => {
    if (e.status !== 'funded') return sum;
    const refund = e.payer.sector === 'collective' && e.payer.id === accountId ? e.escrow : 0;
    const revenue =
      e.revenue.sector === 'collective' && e.revenue.id === accountId
        ? serviceMoneyDifference(
            serviceMoneyDifference(
              e.maximumCharge,
              cumulativeProviderPay(e.maximumCharge, e.providerShareBps),
            ),
            e.revenuePaid,
          )
        : 0;
    return sum + Math.max(refund, revenue);
  }, 0);
}
