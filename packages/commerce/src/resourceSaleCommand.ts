import { principalId } from '@aivilization/authority';
import type { PrincipalTradeAccount } from './principalTradeModel';
import { RESOURCE_SALES_POLICY as POLICY, type ResourceSaleCommand } from './resourceSaleModel';
import { tradeMoneyMicros } from './tradeFacts';

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    throw Error('invalid-resource-sale-command-fields');
  return value as Record<string, unknown>;
}
function text(v: unknown, max: number) {
  if (typeof v !== 'string' || !v.trim() || v.length > max)
    throw Error('invalid-resource-sale-command-text');
  return v;
}
function id(v: unknown, max = 160) {
  const s = text(v, max);
  if (!principalId(s)) throw Error('invalid-resource-sale-command-id');
  return s;
}
function integer(v: unknown, min: number) {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min)
    throw Error('invalid-resource-sale-command-integer');
  return v;
}
function account(v: unknown): PrincipalTradeAccount {
  const a = record(v, ['sector', 'id']),
    sector = a.sector,
    accountId = id(a.id);
  if (
    sector !== 'agent' &&
    sector !== 'collective' &&
    sector !== 'enterprise' &&
    sector !== 'treasury'
  )
    throw Error('invalid-resource-sale-command-account');
  if (sector === 'treasury' && accountId !== 'public-treasury')
    throw Error('invalid-resource-sale-command-treasury');
  return { sector, id: accountId };
}
/** No actor, source evidence, arbitrary effects or reusable authority is accepted from the caller. */
export function decodeResourceSaleCommand(value: unknown): ResourceSaleCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('type' in value))
    throw Error('invalid-resource-sale-command');
  if (value.type === 'offer') {
    const c = record(value, [
        'type',
        'id',
        'title',
        'terms',
        'resource',
        'payer',
        'revenue',
        'amount',
        'acceptBy',
      ]),
      r = record(c.resource, ['kind', 'id', 'expectedRevision']);
    if (r.kind !== 'premises' && r.kind !== 'stock' && r.kind !== 'vehicle')
      throw Error('resource-sale-kind-not-connected');
    if (
      typeof c.amount !== 'number' ||
      !Number.isFinite(c.amount) ||
      c.amount <= 0 ||
      c.amount > POLICY.maxAmount
    )
      throw Error('invalid-resource-sale-command-amount');
    tradeMoneyMicros(c.amount);
    return {
      type: 'offer',
      id: id(c.id, 60),
      title: text(c.title, 120),
      terms: text(c.terms, POLICY.maxTermsChars),
      resource: {
        kind: r.kind,
        id: id(r.id),
        expectedRevision: integer(r.expectedRevision, 1),
      },
      payer: account(c.payer),
      revenue: account(c.revenue),
      amount: c.amount,
      acceptBy: integer(c.acceptBy, 0),
    };
  }
  if (value.type !== 'accept' && value.type !== 'withdraw' && value.type !== 'decline')
    throw Error('invalid-resource-sale-command-operation');
  const c = record(value, ['type', 'id', 'expectedRevision']);
  return { type: value.type, id: id(c.id, 60), expectedRevision: integer(c.expectedRevision, 1) };
}
