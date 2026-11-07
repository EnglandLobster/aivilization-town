import { validControllerId } from '@aivilization/authority';
import type { PermitTradeBasis, PermitTradeEvidence } from './tradeModel';
const time = (v: number) => Number.isSafeInteger(v) && v >= 0;
export function validPermitTradeBasis(b: Omit<PermitTradeBasis, 'seller' | 'buyer'>): boolean {
  return (
    validControllerId(b.buildingId) &&
    Number.isSafeInteger(b.issuerVersion) &&
    b.issuerVersion > 0 &&
    b.users.length > 0 &&
    b.users.length <= 64 &&
    new Set(b.users).size === b.users.length &&
    b.users.every(validControllerId) &&
    b.scopes.length > 0 &&
    b.scopes.length <= 4 &&
    new Set(b.scopes).size === b.scopes.length &&
    b.scopes.every((s) => ['entry', 'operate', 'store', 'reside'].includes(s)) &&
    ['shared', 'exclusive'].includes(b.mode) &&
    !(b.mode === 'exclusive' && b.scopes.includes('entry')) &&
    !!b.title.trim() &&
    b.title.length <= 120 &&
    !!b.terms.trim() &&
    b.terms.length <= 8000 &&
    [b.startAt, b.endAt, b.acceptBy].every(time) &&
    b.endAt > b.startAt &&
    b.endAt - b.startAt <= 366 * 86400000 &&
    b.acceptBy > b.createdAt &&
    b.acceptBy <= b.endAt
  );
}
export function validPermitTradeEvidence(
  e: Omit<PermitTradeEvidence, 'basis' | 'sourceVersion'> & {
    readonly basis: Omit<PermitTradeBasis, 'seller' | 'buyer'>;
  },
): boolean {
  const q = e.provision,
    b = e.basis;
  if (
    !Number.isSafeInteger(e.permitRevision) ||
    e.permitRevision < 1 ||
    e.revision !== e.permitRevision + (q?.revision ?? 0) ||
    !['offered', 'accepted', 'withdrawn', 'released', 'expired'].includes(e.status) ||
    (e.acceptedAt !== undefined &&
      (!time(e.acceptedAt) ||
        e.acceptedAt < b.createdAt ||
        e.acceptedAt >= b.acceptBy ||
        e.acceptedAt > e.at)) ||
    (e.closedAt !== undefined &&
      (!time(e.closedAt) || e.closedAt < (e.acceptedAt ?? b.createdAt) || e.closedAt > e.at)) ||
    ['withdrawn', 'released', 'expired'].includes(e.status) !== (e.closedAt !== undefined) ||
    (e.status === 'accepted' && e.acceptedAt === undefined) ||
    (e.status === 'released' && e.acceptedAt === undefined) ||
    (['offered', 'withdrawn'].includes(e.status) && e.acceptedAt !== undefined)
  )
    return false;
  if (!q) return true;
  if (
    e.acceptedAt === undefined ||
    !validControllerId(q.orderId) ||
    q.orderId.length > 60 ||
    ![q.revision, q.settledAt, q.availableMs, q.unavailableMs].every(time) ||
    q.revision < 1 ||
    q.settledAt < e.acceptedAt ||
    q.settledAt > e.at ||
    q.settledAt > Math.min(b.endAt, e.closedAt ?? b.endAt)
  )
    return false;
  const elapsed = Math.max(0, q.settledAt - Math.max(b.startAt, e.acceptedAt));
  return q.availableMs + q.unavailableMs === elapsed;
}
