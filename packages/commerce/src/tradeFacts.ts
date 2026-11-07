import { sameController, validController, validControllerId } from '@aivilization/authority';
import { validPermitTradeBasis, validPermitTradeEvidence } from './tradePermitFacts';
import {
  EVIDENCE_TRADE_POLICY,
  type TradeAccount,
  type TradeBasis,
  type TradeEvidence,
  type TradeTerms,
} from './tradeModel';

/** Journal serialization can reorder keys; facts are compared structurally, never as JSON strings. */
export function tradeFactsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => tradeFactsEqual(v, b[i]))
    );
  const x = a as Readonly<Record<string, unknown>>,
    y = b as Readonly<Record<string, unknown>>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && tradeFactsEqual(x[k], y[k]))
  );
}
export function tradeMoneyMicros(n: number) {
  const value = Math.round(n * 1e6);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    !Number.isSafeInteger(value) ||
    Math.abs(value / 1e6 - n) > 1e-10
  )
    throw Error('invalid-trade-money');
  return value;
}
export const tradeMoneyDifference = (a: number, b: number) =>
  (tradeMoneyMicros(a) - tradeMoneyMicros(b)) / 1e6;
const time = (t: number) => Number.isSafeInteger(t) && t >= 0;
export const validTradeAccount = (a: TradeAccount) =>
  ['agent', 'collective'].includes(a.sector) && validControllerId(a.id);
export function validTradeBasis(b: TradeBasis): boolean {
  if (
    !validControllerId(b.id) ||
    !validController(b.seller) ||
    !validController(b.buyer) ||
    sameController(b.seller, b.buyer) ||
    !time(b.createdAt)
  )
    return false;
  if (b.kind === 'permit') return validPermitTradeBasis(b);
  if (b.kind === 'freight') {
    const entries = Object.entries(b.items);
    return (
      [b.sourceStockId, b.destinationStockId].every(validControllerId) &&
      b.sourceStockId !== b.destinationStockId &&
      !!b.sourceLocationId &&
      !!b.destinationLocationId &&
      b.sourceLocationId !== b.destinationLocationId &&
      time(b.deadline) &&
      b.deadline > b.createdAt &&
      entries.length > 0 &&
      entries.length <= 100 &&
      entries.every(
        ([k, n]) =>
          !!k.trim() &&
          k.length <= 128 &&
          !Object.hasOwn(Object.prototype, k) &&
          Number.isFinite(n) &&
          n > 0 &&
          n <= 1e9,
      )
    );
  }
  return (
    b.kind === 'service' &&
    [b.providerId, b.recipientId].every(validControllerId) &&
    b.providerId !== b.recipientId &&
    !!b.locationId &&
    b.pricePerHour === 0 &&
    time(b.startAt) &&
    time(b.endAt) &&
    b.endAt > b.startAt &&
    time(b.maxDurationMs) &&
    b.maxDurationMs > 0 &&
    b.maxDurationMs <= b.endAt - b.startAt
  );
}
export function validTradeEvidence(e: TradeEvidence, at: number): boolean {
  if (
    !validTradeBasis(e.basis) ||
    !Number.isSafeInteger(e.revision) ||
    e.revision < 1 ||
    !time(e.at) ||
    e.at < e.basis.createdAt ||
    e.at > at
  )
    return false;
  if (e.sourceVersion === 'premises-provision-v1')
    return e.basis.kind === 'permit' && validPermitTradeEvidence(e);
  if (e.sourceVersion === 'resident-logistics-v1')
    return (
      e.basis.kind === 'freight' &&
      [
        'offered',
        'accepted',
        'funded',
        'loaded',
        'return-required',
        'delivered',
        'returned',
        'cancelled',
      ].includes(e.status)
    );
  return (
    e.sourceVersion === 'resident-service-engagements-v1' &&
    e.basis.kind === 'service' &&
    ['offered', 'accepted', 'funded', 'ended'].includes(e.status) &&
    time(e.progressMs) &&
    e.progressMs <= e.basis.maxDurationMs &&
    typeof e.hasPresence === 'boolean' &&
    (e.status === 'funded' || (!e.hasPresence && (e.status === 'ended' || e.progressMs === 0)))
  );
}
export function tradeSourceReady(e: TradeEvidence) {
  if (e.sourceVersion === 'premises-provision-v1')
    return e.status === 'offered' && !e.provision && e.acceptedAt === undefined;
  return (
    ['offered', 'accepted', 'funded'].includes(e.status) &&
    (e.sourceVersion === 'resident-logistics-v1' || (!e.hasPresence && e.progressMs === 0))
  );
}
/** This is price arithmetic over recorded delivery/time facts, never a quality judgment. */
export function tradeSourceEarned(e: TradeEvidence, amount: number): number | undefined {
  if (e.sourceVersion === 'premises-provision-v1') {
    if (!['released', 'expired', 'withdrawn'].includes(e.status)) return undefined;
    if (e.acceptedAt === undefined) return 0;
    const q = e.provision;
    if (!q || q.settledAt !== Math.min(e.basis.endAt, e.closedAt!)) return undefined;
    return (
      Number(
        (BigInt(tradeMoneyMicros(amount)) * BigInt(q.availableMs)) /
          BigInt(e.basis.endAt - e.basis.startAt),
      ) / 1e6
    );
  }
  if (e.sourceVersion === 'resident-logistics-v1') {
    if (e.status === 'delivered') return amount;
    return ['returned', 'cancelled'].includes(e.status) ? 0 : undefined;
  }
  if (e.status !== 'ended') return undefined;
  return (
    Number(
      (BigInt(tradeMoneyMicros(amount)) * BigInt(e.progressMs)) / BigInt(e.basis.maxDurationMs),
    ) / 1e6
  );
}
export function validTradeTerms(t: TradeTerms, at: number): boolean {
  if (
    !validControllerId(t.id) ||
    t.id.length > 60 ||
    !t.title.trim() ||
    t.title.length > 120 ||
    !t.terms.trim() ||
    t.terms.length > EVIDENCE_TRADE_POLICY.maxTermsChars ||
    !validTradeBasis(t.source) ||
    t.source.createdAt > at ||
    !(t.payer.sector === 'treasury'
      ? t.payer.id === 'public-treasury' && t.source.kind === 'freight'
      : validTradeAccount(t.payer)) ||
    !validTradeAccount(t.revenue) ||
    (t.payer.sector === t.revenue.sector && t.payer.id === t.revenue.id) ||
    !time(t.acceptBy) ||
    t.acceptBy <= at ||
    t.acceptBy > at + EVIDENCE_TRADE_POLICY.maxWindowMs ||
    t.acceptBy > (t.source.kind === 'freight' ? t.source.deadline : t.source.endAt) ||
    (t.source.kind === 'permit' && t.acceptBy > t.source.acceptBy) ||
    !Number.isFinite(t.amount) ||
    t.amount <= 0 ||
    t.amount > EVIDENCE_TRADE_POLICY.maxAmount
  )
    return false;
  try {
    return tradeMoneyMicros(t.amount) > 0;
  } catch {
    return false;
  }
}
