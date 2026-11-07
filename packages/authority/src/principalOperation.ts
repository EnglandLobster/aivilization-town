/** Domain-owned arguments, frozen by the application; no executable code or authority supplied by the caller. */
export type PrincipalValue =
  | null
  | boolean
  | number
  | string
  | readonly PrincipalValue[]
  | { readonly [key: string]: PrincipalValue };
export type PrincipalOperationRequest = {
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly resourceRevision: number;
  readonly controlVersion: number;
  readonly operation: {
    readonly capability: string;
    readonly arguments: Readonly<Record<string, PrincipalValue>>;
  };
};
const id = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(v) &&
  !['__proto__', 'constructor', 'prototype'].includes(v);
const exact = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
function normalize(value: unknown, depth = 0): PrincipalValue {
  if (depth > 12) throw Error('principal-operation-too-deep');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 256) throw Error('principal-operation-array-limit');
    return value.map((v) => normalize(v, depth + 1));
  }
  if (
    value &&
    typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  ) {
    const entries = Object.entries(value);
    if (
      entries.length > 256 ||
      entries.some(([k]) => ['__proto__', 'constructor', 'prototype'].includes(k))
    )
      throw Error('invalid-principal-operation-object');
    return Object.fromEntries(
      entries
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, normalize(v, depth + 1)]),
    );
  }
  throw Error('invalid-principal-operation-value');
}
export function principalOperationKey(value: PrincipalValue): string {
  const result = JSON.stringify(normalize(value));
  if (result.length > 32768) throw Error('principal-operation-size-limit');
  return result;
}
export function assertPrincipalOperationRequest(r: PrincipalOperationRequest) {
  if (
    !exact(r, ['resourceKind', 'resourceId', 'resourceRevision', 'controlVersion', 'operation']) ||
    !id(r.resourceKind) ||
    !id(r.resourceId) ||
    !Number.isSafeInteger(r.resourceRevision) ||
    r.resourceRevision < 1 ||
    !Number.isSafeInteger(r.controlVersion) ||
    r.controlVersion < 1 ||
    !exact(r.operation, ['capability', 'arguments']) ||
    !id(r.operation.capability) ||
    !r.operation.arguments ||
    typeof r.operation.arguments !== 'object' ||
    Array.isArray(r.operation.arguments)
  )
    throw Error('invalid-principal-operation-request');
  principalOperationKey(r.operation.arguments);
}
export function samePrincipalOperation(a: PrincipalOperationRequest, b: PrincipalOperationRequest) {
  return (
    a.resourceKind === b.resourceKind &&
    a.resourceId === b.resourceId &&
    a.resourceRevision === b.resourceRevision &&
    a.controlVersion === b.controlVersion &&
    a.operation.capability === b.operation.capability &&
    principalOperationKey(a.operation.arguments) === principalOperationKey(b.operation.arguments)
  );
}
