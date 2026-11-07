import type { PrincipalOperationRequest, PrincipalValue } from '@aivilization/authority';
import type { PrincipalTradeCommand, PrincipalTradeAccount } from '@aivilization/commerce';
const fail = (): never => {
  throw Error('invalid-principal-trade-command');
};
const object = (v: unknown): v is Readonly<Record<string, PrincipalValue>> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Readonly<Record<string, PrincipalValue>>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const str = (v: PrincipalValue | undefined): string => (typeof v === 'string' ? v : fail());
const num = (v: PrincipalValue | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail();
const integer = (v: PrincipalValue | undefined): number =>
  Number.isSafeInteger(num(v)) ? num(v) : fail();
function account(v: PrincipalValue | undefined): PrincipalTradeAccount {
  if (!object(v) || !exact(v, ['sector', 'id'])) return fail();
  const sector = v.sector;
  if (
    sector !== 'agent' &&
    sector !== 'collective' &&
    sector !== 'enterprise' &&
    sector !== 'treasury'
  )
    return fail();
  return { sector, id: str(v.id) };
}
export function decodePrincipalTradeOperation(r: PrincipalOperationRequest): PrincipalTradeCommand {
  const c = r.operation.arguments;
  if (r.operation.capability !== `trades.${str(c.type)}`) return fail();
  if (c.type === 'offer') {
    const s = c.source;
    if (
      !exact(c, [
        'type',
        'id',
        'title',
        'terms',
        'source',
        'payer',
        'revenue',
        'amount',
        'acceptBy',
      ]) ||
      !object(s) ||
      !exact(s, ['kind', 'id', 'expectedRevision']) ||
      s.kind !== 'permit'
    )
      return fail();
    return {
      type: 'offer',
      id: str(c.id),
      title: str(c.title),
      terms: str(c.terms),
      source: { kind: 'permit', id: str(s.id), expectedRevision: integer(s.expectedRevision) },
      payer: account(c.payer),
      revenue: account(c.revenue),
      amount: num(c.amount),
      acceptBy: integer(c.acceptBy),
    };
  }
  if (c.type === 'accept' && exact(c, ['type', 'id', 'expectedRevision']))
    return { type: 'accept', id: str(c.id), expectedRevision: integer(c.expectedRevision) };
  if (
    (c.type === 'withdraw' || c.type === 'observe') &&
    exact(c, ['type', 'id', 'expectedRevision', 'side']) &&
    (c.side === 'seller' || c.side === 'buyer')
  )
    return {
      type: c.type,
      id: str(c.id),
      expectedRevision: integer(c.expectedRevision),
      side: c.side,
    };
  return fail();
}
