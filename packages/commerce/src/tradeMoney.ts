import {
  constructionTradeEscrowMicros,
  constructionTradeAccountObligations,
  constructionTradeIncomingMicros,
} from './constructionTrade';
import {
  principalTradeEscrowMicros,
  principalTradeAccountObligations,
  principalTradeReservedIncomingMicros,
} from './principalTrade';
import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import type { TradePayer, EvidenceTradeState } from './tradeModel';
import { EVIDENCE_TRADE_ESCROW } from './tradeEscrow';
export { EVIDENCE_TRADE_ESCROW } from './tradeEscrow';
export const evidenceTradeEscrowBalance = (s: EvidenceTradeState | undefined) =>
  Object.values(s?.orders ?? {}).reduce((n, o) => n + o.escrow, 0) +
  principalTradeEscrowMicros(s) / 1e6 +
  constructionTradeEscrowMicros(s?.constructionOrders) / 1e6;
export function tradeMoneyTransfer(
  receiptId: string,
  purpose: 'fund' | 'pay' | 'refund',
  account: TradePayer,
  amount: number,
) {
  return createMoneyTransfer({
    transactionId: `${receiptId}-${purpose}`,
    reason: `evidence-trade-${purpose}`,
    from: purpose === 'fund' ? economicAccount(account.sector, account.id) : EVIDENCE_TRADE_ESCROW,
    to: purpose === 'fund' ? EVIDENCE_TRADE_ESCROW : economicAccount(account.sector, account.id),
    amount,
  });
}
export function tradeAccountObligations(s: EvidenceTradeState | undefined, id: string) {
  return (
    constructionTradeAccountObligations(s?.constructionOrders, { sector: 'collective', id }) ||
    principalTradeAccountObligations(s, { sector: 'collective', id }) ||
    Object.values(s?.orders ?? {}).some(
      (o) =>
        o.escrow > 0 && [o.payer, o.revenue].some((a) => a.sector === 'collective' && a.id === id),
    )
  );
}
export function tradeReservedCommonIncoming(s: EvidenceTradeState | undefined, id: string) {
  return (
    constructionTradeIncomingMicros(s?.constructionOrders, { sector: 'collective', id }) / 1e6 +
    principalTradeReservedIncomingMicros(s, { sector: 'collective', id }) / 1e6 +
    Object.values(s?.orders ?? {}).reduce(
      (sum, o) =>
        sum +
        ([o.payer, o.revenue].some((a) => a.sector === 'collective' && a.id === id) ? o.escrow : 0),
      0,
    )
  );
}
