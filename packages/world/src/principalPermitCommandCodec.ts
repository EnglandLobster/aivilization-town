import type {
  PrincipalOperationRequest,
  PrincipalValue,
  ResourcePrincipal,
} from '@aivilization/authority';
import type { PrincipalPremisesRightsCommand, PremisesUseScope } from '@aivilization/premises';
const fail = (): never => {
  throw Error('invalid-principal-permit-command');
};
const object = (v: unknown): v is Readonly<Record<string, PrincipalValue>> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Readonly<Record<string, PrincipalValue>>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const str = (v: PrincipalValue | undefined): string => (typeof v === 'string' ? v : fail());
const num = (v: PrincipalValue | undefined): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fail();
function principal(v: PrincipalValue | undefined): ResourcePrincipal {
  if (!object(v) || !exact(v, ['kind', 'id'])) return fail();
  const kind = v.kind;
  if (kind !== 'resident' && kind !== 'collective' && kind !== 'enterprise' && kind !== 'public')
    return fail();
  return { kind, id: str(v.id) };
}
export function decodePrincipalPermitOperation(
  r: PrincipalOperationRequest,
): PrincipalPremisesRightsCommand {
  const c = r.operation.arguments;
  if (r.operation.capability !== `permits.${str(c.type)}`) return fail();
  if (c.type === 'offer') {
    const t = c.terms;
    if (
      !exact(c, ['type', 'terms', 'buildingRevision']) ||
      !object(t) ||
      !exact(t, [
        'id',
        'buildingId',
        'grantee',
        'users',
        'scopes',
        'mode',
        'title',
        'terms',
        'startAt',
        'endAt',
        'acceptBy',
      ]) ||
      !Array.isArray(t.users) ||
      !Array.isArray(t.scopes) ||
      (t.mode !== 'shared' && t.mode !== 'exclusive')
    )
      return fail();
    const scopes: PremisesUseScope[] = t.scopes.map(
      (v: unknown): PremisesUseScope =>
        v === 'entry' || v === 'operate' || v === 'store' || v === 'reside' ? v : fail(),
    );
    return {
      type: 'offer',
      buildingRevision: num(c.buildingRevision),
      terms: {
        id: str(t.id),
        buildingId: str(t.buildingId),
        grantee: principal(t.grantee),
        users: t.users.map(str),
        scopes,
        mode: t.mode,
        title: str(t.title),
        terms: str(t.terms),
        startAt: num(t.startAt),
        endAt: num(t.endAt),
        acceptBy: num(t.acceptBy),
      },
    };
  }
  if ((c.type === 'accept' || c.type === 'release') && exact(c, ['type', 'id', 'revision']))
    return { type: c.type, id: str(c.id), revision: num(c.revision) };
  if (
    c.type === 'withdraw' &&
    exact(c, ['type', 'id', 'revision', 'side']) &&
    (c.side === 'issuer' || c.side === 'grantee')
  )
    return { type: 'withdraw', id: str(c.id), revision: num(c.revision), side: c.side };
  return fail();
}
