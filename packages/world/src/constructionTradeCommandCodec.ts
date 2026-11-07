import {
  assertPrincipalOperationRequest,
  samePrincipalRequest,
  type PrincipalOperationRequest,
  type ResourcePrincipal,
} from '@aivilization/authority';
import {
  constructionTradeRequest,
  type ConstructionTradeCommand,
  type PrincipalTradeAccount,
} from '@aivilization/commerce';
const fail = (): never => {
  throw Error('invalid-construction-trade-command');
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail();
const exact = (v: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) fail();
};
const str = (v: unknown): string => (typeof v === 'string' ? v : fail());
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail();
const integer = (v: unknown): number => (Number.isSafeInteger(num(v)) ? num(v) : fail());
function principal(v: unknown): ResourcePrincipal {
  const p = object(v);
  exact(p, ['kind', 'id']);
  const kind = p.kind;
  if (kind !== 'resident' && kind !== 'enterprise' && kind !== 'collective' && kind !== 'public')
    return fail();
  return { kind, id: str(p.id) };
}
function account(v: unknown): PrincipalTradeAccount {
  const a = object(v);
  exact(a, ['sector', 'id']);
  const sector = a.sector;
  if (
    sector !== 'agent' &&
    sector !== 'enterprise' &&
    sector !== 'collective' &&
    sector !== 'treasury'
  )
    return fail();
  return { sector, id: str(a.id) };
}
function command(v: unknown): ConstructionTradeCommand {
  const c = object(v);
  if (c.type === 'offer') {
    exact(c, ['type', 'terms']);
    const t = object(c.terms);
    exact(t, [
      'id',
      'projectId',
      'sourceRevision',
      'seller',
      'buyer',
      'payer',
      'revenue',
      'amount',
      'acceptBy',
      'title',
      'terms',
    ]);
    return {
      type: 'offer',
      terms: {
        id: str(t.id),
        projectId: str(t.projectId),
        sourceRevision: integer(t.sourceRevision),
        seller: principal(t.seller),
        buyer: principal(t.buyer),
        payer: account(t.payer),
        revenue: account(t.revenue),
        amount: num(t.amount),
        acceptBy: integer(t.acceptBy),
        title: str(t.title),
        terms: str(t.terms),
      },
    };
  }
  const type = c.type;
  if (
    type !== 'accept' &&
    type !== 'observe' &&
    type !== 'withdraw' &&
    type !== 'propose-settlement' &&
    type !== 'accept-settlement'
  )
    return fail();
  const extra =
    type === 'propose-settlement'
      ? ['proposalId', 'paySeller', 'text']
      : type === 'accept-settlement'
        ? ['proposalId']
        : [];
  exact(c, ['type', 'id', 'expectedRevision', 'side', ...extra]);
  const side = c.side;
  if (side !== 'seller' && side !== 'buyer') return fail();
  const base = { id: str(c.id), expectedRevision: integer(c.expectedRevision), side } as const;
  if (type === 'propose-settlement')
    return {
      ...base,
      type,
      proposalId: str(c.proposalId),
      paySeller: num(c.paySeller),
      text: str(c.text),
    };
  if (type === 'accept-settlement') return { ...base, type, proposalId: str(c.proposalId) };
  return { ...base, type };
}
/** Decode untrusted operation data without silently dropping fields or changing the approved request. */
export function decodeConstructionTradeOperation(
  request: PrincipalOperationRequest,
): ConstructionTradeCommand {
  assertPrincipalOperationRequest(request);
  const decoded = command(request.operation.arguments);
  if (!samePrincipalRequest(request, constructionTradeRequest(decoded))) return fail();
  return decoded;
}
