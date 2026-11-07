import type { ControlCommand } from '@aivilization/authority';
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Readonly<Record<string, unknown>>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/** CLI shape only. Owning domains still decide versions, authority, expiry and resource constraints. */
export function parseResourceControlArguments(
  name: string,
  args: Readonly<Record<string, unknown>>,
): { readonly expectedRevision: number; readonly control: ControlCommand } | undefined {
  const keys = ['expectedRevision', 'expectedControlVersion'];
  if (!revision(args.expectedRevision) || !revision(args.expectedControlVersion)) return undefined;
  const base = { expectedRevision: args.expectedRevision },
    expectedVersion = args.expectedControlVersion;
  if ((name === 'resources.accept' || name === 'resources.cancel') && exact(args, keys))
    return {
      ...base,
      control: { type: name === 'resources.accept' ? 'accept' : 'cancel', expectedVersion },
    };
  const target = args.target;
  if (
    name !== 'resources.offer' ||
    !exact(args, [...keys, 'target', 'expiresAt', 'terms']) ||
    !object(target) ||
    !exact(target, ['kind', 'id']) ||
    (target.kind !== 'resident' && target.kind !== 'collective') ||
    typeof target.id !== 'string' ||
    !revision(args.expiresAt) ||
    typeof args.terms !== 'string'
  )
    return undefined;
  return {
    ...base,
    control: {
      type: 'offer',
      expectedVersion,
      target: { kind: target.kind, id: target.id },
      expiresAt: args.expiresAt,
      terms: args.terms,
    },
  };
}
