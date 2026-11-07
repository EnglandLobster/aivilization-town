import { principalId } from '@aivilization/authority';
import { tradeMoneyMicros } from './tradeFacts';
import {
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  type PeriodicAccount,
  type PeriodicCommand,
  type PeriodicTerms,
} from './periodicObligationModel';
function record(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) ||
    Object.keys(v).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(v, k))
  )
    throw Error('invalid-periodic-command-fields');
  return v as Record<string, unknown>;
}
function id(v: unknown) {
  if (typeof v !== 'string' || !principalId(v) || v.length > 60) throw Error('invalid-periodic-id');
  return v;
}
function text(v: unknown, max: number) {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw Error('invalid-periodic-text');
  return v;
}
function integer(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
    throw Error('invalid-periodic-integer');
  return v;
}
export function decodePeriodicAccount(v: unknown): PeriodicAccount {
  const a = record(v, ['sector', 'id']),
    sector = a.sector;
  if (
    sector !== 'agent' &&
    sector !== 'enterprise' &&
    sector !== 'collective' &&
    sector !== 'treasury'
  )
    throw Error('invalid-periodic-account');
  const accountId = text(a.id, 160);
  if (!principalId(accountId) || (sector === 'treasury' && accountId !== 'public-treasury'))
    throw Error('invalid-periodic-account');
  return { sector, id: accountId };
}
export function assertPeriodicTerms(t: PeriodicTerms, at: number) {
  if (
    !Number.isSafeInteger(at) ||
    at < 0 ||
    t.firstDueAt <= t.acceptBy ||
    t.acceptBy <= at ||
    t.acceptBy > at + POLICY.maxOfferMs ||
    !Number.isSafeInteger(t.firstDueAt + (t.periods - 1) * t.periodMs) ||
    t.firstDueAt + (t.periods - 1) * t.periodMs > at + POLICY.maxHorizonMs ||
    tradeMoneyMicros(t.amount) * t.periods > POLICY.maxTotalMicros ||
    (t.payer.sector === t.revenue.sector && t.payer.id === t.revenue.id)
  )
    throw Error('invalid-periodic-terms-window-or-total');
}
/** Closed resident intent. Source, principal, actor, installments and financial effects cannot be supplied. */
export function decodePeriodicCommand(v: unknown): PeriodicCommand {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('type' in v))
    throw Error('invalid-periodic-command');
  if (v.type === 'offer') {
    const c = record(v, [
      'type',
      'id',
      'title',
      'terms',
      'payer',
      'revenue',
      'amount',
      'firstDueAt',
      'periodMs',
      'periods',
      'acceptBy',
    ]);
    if (typeof c.amount !== 'number' || tradeMoneyMicros(c.amount) <= 0)
      throw Error('invalid-periodic-amount');
    return {
      type: 'offer',
      id: id(c.id),
      title: text(c.title, 120),
      terms: text(c.terms, POLICY.maxTermsChars),
      payer: decodePeriodicAccount(c.payer),
      revenue: decodePeriodicAccount(c.revenue),
      amount: c.amount,
      firstDueAt: integer(c.firstDueAt, 0),
      periodMs: integer(c.periodMs, POLICY.minPeriodMs, POLICY.maxHorizonMs),
      periods: integer(c.periods, 1, POLICY.maxPeriods),
      acceptBy: integer(c.acceptBy, 0),
    };
  }
  const type = v.type;
  if (
    type !== 'accept' &&
    type !== 'withdraw' &&
    type !== 'decline' &&
    type !== 'terminate' &&
    type !== 'settle' &&
    type !== 'waive'
  )
    throw Error('invalid-periodic-operation');
  const c = record(
    v,
    type === 'settle' || type === 'waive'
      ? ['type', 'id', 'expectedRevision', 'period']
      : ['type', 'id', 'expectedRevision'],
  );
  const base = { id: id(c.id), expectedRevision: integer(c.expectedRevision, 1) };
  return type === 'settle' || type === 'waive'
    ? { ...base, type, period: integer(c.period, 1, POLICY.maxPeriods) }
    : { ...base, type };
}
