/** Registered residence is a personal world fact, distinct from title, current permission and physical presence. */
export const HOUSING_OCCUPANCY_POLICY = { version: 'resident-housing-occupancy-v1' } as const;
export type HousingOccupancyState = {
  readonly policy: typeof HOUSING_OCCUPANCY_POLICY;
  readonly revisions: Readonly<Record<string, number>>;
};
export type HousingVacated = {
  readonly policyVersion: typeof HOUSING_OCCUPANCY_POLICY.version;
  readonly actorId: string;
  readonly at: number;
  readonly previousRevision: number;
  readonly revision: number;
  readonly previousResidenceId: string;
};
const id = (s: string) =>
  typeof s === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(s) &&
  !['__proto__', 'constructor', 'prototype'].includes(s);
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function assertHousingOccupancyState(s: HousingOccupancyState) {
  if (
    s.policy.version !== HOUSING_OCCUPANCY_POLICY.version ||
    Object.keys(s.policy).length !== 1 ||
    !s.revisions ||
    Array.isArray(s.revisions) ||
    Object.entries(s.revisions).some(([k, v]) => !id(k) || !Number.isSafeInteger(v) || v < 1)
  )
    throw Error('invalid-housing-occupancy-state');
}
export const housingOccupancyRevision = (s: HousingOccupancyState, actorId: string) =>
  Object.hasOwn(s.revisions, actorId) ? s.revisions[actorId]! : 1;
export function recordHousingOccupancyChange(
  s: HousingOccupancyState,
  actorId: string,
): HousingOccupancyState {
  assertHousingOccupancyState(s);
  if (!id(actorId)) throw Error('invalid-housing-occupancy-actor');
  const revision = housingOccupancyRevision(s, actorId) + 1;
  if (!Number.isSafeInteger(revision)) throw Error('housing-occupancy-revision-limit');
  return { ...s, revisions: { ...s.revisions, [actorId]: revision } };
}
export function decideHousingDeparture(input: {
  state: HousingOccupancyState;
  actorId: string;
  at: number;
  currentResidenceId: string | null;
  expectedResidenceId: string;
  expectedRevision: number;
}) {
  const { state, actorId, at, currentResidenceId, expectedResidenceId, expectedRevision } = input;
  assertHousingOccupancyState(state);
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!id(actorId) || !id(expectedResidenceId) || !time(at)) return no('invalid-housing-departure');
  if (!currentResidenceId) return no('housing-residence-not-registered');
  if (
    currentResidenceId !== expectedResidenceId ||
    expectedRevision !== housingOccupancyRevision(state, actorId)
  )
    return no('housing-occupancy-revision-conflict');
  const next = recordHousingOccupancyChange(state, actorId);
  const event: HousingVacated = {
    policyVersion: state.policy.version,
    actorId,
    at,
    previousRevision: expectedRevision,
    revision: housingOccupancyRevision(next, actorId),
    previousResidenceId: currentResidenceId,
  };
  return { accepted: true as const, event };
}
export function applyHousingDeparture(
  state: HousingOccupancyState,
  currentResidenceId: string | null,
  e: HousingVacated,
): HousingOccupancyState {
  if (
    e.policyVersion !== state.policy.version ||
    !id(e.actorId) ||
    !id(e.previousResidenceId) ||
    !time(e.at) ||
    e.previousResidenceId !== currentResidenceId ||
    e.previousRevision !== housingOccupancyRevision(state, e.actorId) ||
    e.revision !== e.previousRevision + 1
  )
    throw Error('housing-departure-source-mismatch');
  return recordHousingOccupancyChange(state, e.actorId);
}
