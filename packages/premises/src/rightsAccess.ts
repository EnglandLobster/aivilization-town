import type {
  PremisesPermit,
  PremisesRightsState,
  PremisesUseScope,
  AnyPremisesPermitTerms,
} from './rightsModel';

/** Historical validity is retained after expiry/release so elapsed real work is never erased. */
export function permitEffectiveAt(p: PremisesPermit, at: number) {
  return (
    !!p.accepted &&
    at >= p.accepted.at &&
    at >= p.startAt &&
    at < p.endAt &&
    (!p.closed || at < p.closed.at)
  );
}
export function conflictingPremisesPermit(s: PremisesRightsState, terms: AnyPremisesPermitTerms) {
  return Object.values(s.permits).find(
    (p) =>
      p.id !== terms.id &&
      p.accepted &&
      p.buildingId === terms.buildingId &&
      (p.mode === 'exclusive' || terms.mode === 'exclusive') &&
      p.scopes.some((scope) => terms.scopes.includes(scope)) &&
      Math.max(p.startAt, p.accepted.at, terms.startAt) <
        Math.min(p.endAt, p.closed?.at ?? p.endAt, terms.endAt),
  );
}
export function premisesPermitAllows(
  s: PremisesRightsState | undefined,
  buildingId: string,
  actorId: string,
  scope: PremisesUseScope,
  at: number,
  baseline: boolean,
) {
  const active = Object.values(s?.permits ?? {}).filter(
    (p) => p.buildingId === buildingId && permitEffectiveAt(p, at),
  );
  if (
    scope !== 'entry' &&
    active.some(
      (p) => p.mode === 'exclusive' && p.scopes.includes(scope) && !p.users.includes(actorId),
    )
  )
    return false;
  return (
    baseline ||
    active.some((p) => p.users.includes(actorId) && (scope === 'entry' || p.scopes.includes(scope)))
  );
}
/** The first future loss of permission; a newly starting exclusive right can bound a legacy ACL too. */
export function premisesPermitUseUntil(
  s: PremisesRightsState | undefined,
  buildingId: string,
  actorId: string,
  scope: PremisesUseScope,
  at: number,
  baseline: boolean,
) {
  if (!premisesPermitAllows(s, buildingId, actorId, scope, at, baseline)) return at;
  const boundaries = [
    ...new Set(
      Object.values(s?.permits ?? {})
        .filter((p) => p.buildingId === buildingId && p.accepted)
        .flatMap((p) => [
          Math.max(p.startAt, p.accepted!.at),
          p.endAt,
          ...(p.closed ? [p.closed.at] : []),
        ]),
    ),
  ]
    .filter((t) => t > at)
    .sort((a, b) => a - b);
  return (
    boundaries.find((t) => !premisesPermitAllows(s, buildingId, actorId, scope, t, baseline)) ??
    Number.MAX_SAFE_INTEGER
  );
}
export function premisesHasPermitObligations(
  s: PremisesRightsState | undefined,
  buildingId: string,
  at: number,
) {
  return Object.values(s?.permits ?? {}).some(
    (p) => p.buildingId === buildingId && p.status === 'accepted' && p.endAt > at,
  );
}
export function nextPremisesRightsBoundary(s: PremisesRightsState | undefined, now: number) {
  const times = Object.values(s?.permits ?? {})
    .flatMap((p) =>
      p.status === 'offered' ? [p.acceptBy] : p.status === 'accepted' ? [p.startAt, p.endAt] : [],
    )
    .filter((t) => t > now);
  return times.length ? Math.min(...times) : undefined;
}
