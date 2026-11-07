import { ELAPSED_PHYSIOLOGY_VERSION } from './elapsedPhysiology';

export const RESIDENT_REST_POLICY = {
  version: 'resident-rest-v1',
  physiologyVersion: ELAPSED_PHYSIOLOGY_VERSION,
  cadenceMs: 60000,
  maxDurationMs: 86400000,
  maxSessions: 100000,
} as const;
export type ResidentRestPolicy = typeof RESIDENT_REST_POLICY;
export type ResidentRestSession = {
  readonly id: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly revision: number;
  readonly startedAt: number;
  readonly until: number;
  readonly settledAt: number;
  readonly elapsedMs: number;
  readonly energyPerSecond: number;
  readonly maximum: number;
  readonly status: 'active' | 'completed' | 'interrupted';
};
export type ResidentRestState = {
  readonly policy: ResidentRestPolicy;
  readonly sessions: Readonly<Record<string, ResidentRestSession>>;
  readonly activeByActor: Readonly<Record<string, string>>;
};
export type ResidentRestEvent = {
  readonly type: 'ResidentRestSessionChanged';
  readonly previousRevision: number;
  readonly session: ResidentRestSession;
};
export function assertResidentRestPolicy(policy: ResidentRestPolicy): void {
  if (
    Object.keys(policy).length !== Object.keys(RESIDENT_REST_POLICY).length ||
    Object.entries(RESIDENT_REST_POLICY).some(
      ([k, v]) => policy[k as keyof ResidentRestPolicy] !== v,
    )
  )
    throw Error('unsupported-resident-rest-policy');
}
export function emptyResidentRestState(
  policy: ResidentRestPolicy = RESIDENT_REST_POLICY,
): ResidentRestState {
  assertResidentRestPolicy(policy);
  return { policy: { ...policy }, sessions: {}, activeByActor: {} };
}
const validId = (s: string) =>
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(s) &&
  !['__proto__', 'constructor', 'prototype'].includes(s);
const time = (n: number) => Number.isSafeInteger(n) && n >= 0;
const physical = (n: number) => Number.isFinite(n) && n >= 0;
const no = (reason: string) => ({ accepted: false as const, reason });
const yes = (...events: ResidentRestEvent[]) => ({ accepted: true as const, events });

/** Location, presence and other activities are world authority checks; no other body may start this session. */
export function startResidentRest(input: {
  readonly state: ResidentRestState;
  readonly actorId: string;
  readonly id: string;
  readonly locationId: string;
  readonly at: number;
  readonly durationMs: number;
  readonly energyPerSecond: number;
  readonly maximum: number;
}) {
  const { state, actorId, id, locationId, at, durationMs, energyPerSecond, maximum } = input;
  assertResidentRestPolicy(state.policy);
  if (
    ![actorId, id, locationId].every(validId) ||
    !time(at) ||
    !time(durationMs) ||
    durationMs < 1 ||
    durationMs > state.policy.maxDurationMs ||
    !time(at + durationMs) ||
    !physical(energyPerSecond) ||
    !physical(maximum)
  )
    return no('invalid-resident-rest');
  if (Object.hasOwn(state.sessions, id)) return no('rest-id-exists');
  if (state.activeByActor[actorId]) return no('rest-already-active');
  if (Object.keys(state.sessions).length >= state.policy.maxSessions)
    return no('rest-history-limit');
  return yes({
    type: 'ResidentRestSessionChanged',
    previousRevision: 0,
    session: {
      id,
      actorId,
      locationId,
      revision: 1,
      startedAt: at,
      until: at + durationMs,
      settledAt: at,
      elapsedMs: 0,
      energyPerSecond,
      maximum,
      status: 'active',
    },
  });
}

/** Only elapsed duration is recorded here; society's physical integrator owns body effects. */
export function progressResidentRest(state: ResidentRestState, id: string, at: number) {
  const previous = state.sessions[id];
  if (!previous || previous.status !== 'active') return no('rest-not-active');
  if (!time(at) || at < previous.settledAt) return no('invalid-rest-progress-time');
  const settledAt = Math.min(at, previous.until);
  if (settledAt === previous.settledAt) return yes();
  return yes({
    type: 'ResidentRestSessionChanged',
    previousRevision: previous.revision,
    session: {
      ...previous,
      revision: previous.revision + 1,
      settledAt,
      elapsedMs: settledAt - previous.startedAt,
      status: settledAt === previous.until ? 'completed' : 'active',
    },
  });
}

export function interruptResidentRest(input: {
  readonly systemReason?: 'population-departure';
  readonly state: ResidentRestState;
  readonly actorId: string;
  readonly id: string;
  readonly expectedRevision: number;
  readonly at: number;
}) {
  const previous = input.state.sessions[input.id];
  if (
    !previous ||
    (input.systemReason ? input.actorId !== 'system' : previous.actorId !== input.actorId)
  )
    return no('own-rest-required');
  if (previous.revision !== input.expectedRevision) return no('rest-revision-conflict');
  if (previous.status !== 'active') return no('rest-not-active');
  if (!time(input.at) || input.at !== previous.settledAt)
    return no('rest-progress-must-be-settled');
  return yes({
    type: 'ResidentRestSessionChanged',
    previousRevision: previous.revision,
    session: { ...previous, revision: previous.revision + 1, status: 'interrupted' },
  });
}

/** Replay validates the recorded transition; it does not recompute recovery from today's policy. */
export function applyResidentRestEvent(
  state: ResidentRestState,
  event: ResidentRestEvent,
): ResidentRestState {
  const s = event.session,
    previous = state.sessions[s.id];
  if (
    ![s.id, s.actorId, s.locationId].every(validId) ||
    ![s.startedAt, s.until, s.settledAt, s.elapsedMs, s.revision, event.previousRevision].every(
      time,
    ) ||
    s.revision !== event.previousRevision + 1 ||
    s.until <= s.startedAt ||
    s.until - s.startedAt > state.policy.maxDurationMs ||
    s.settledAt < s.startedAt ||
    s.settledAt > s.until ||
    s.elapsedMs !== s.settledAt - s.startedAt ||
    !physical(s.energyPerSecond) ||
    !physical(s.maximum) ||
    !['active', 'completed', 'interrupted'].includes(s.status) ||
    (s.status === 'completed') !== (s.settledAt === s.until)
  )
    throw Error('invalid-rest-event');
  if (!previous) {
    if (
      event.previousRevision !== 0 ||
      s.status !== 'active' ||
      s.elapsedMs !== 0 ||
      Object.keys(state.sessions).length >= state.policy.maxSessions ||
      state.activeByActor[s.actorId]
    )
      throw Error('invalid-rest-start');
  } else {
    if (
      previous.revision !== event.previousRevision ||
      previous.status !== 'active' ||
      state.activeByActor[s.actorId] !== s.id ||
      ['actorId', 'locationId', 'startedAt', 'until', 'energyPerSecond', 'maximum'].some(
        (key) => previous[key as keyof ResidentRestSession] !== s[key as keyof ResidentRestSession],
      ) ||
      s.settledAt < previous.settledAt ||
      (s.status === 'interrupted'
        ? s.settledAt !== previous.settledAt
        : s.settledAt <= previous.settledAt)
    )
      throw Error('invalid-rest-transition');
  }
  const activeByActor = { ...state.activeByActor };
  if (s.status === 'active') activeByActor[s.actorId] = s.id;
  else delete activeByActor[s.actorId];
  return { ...state, sessions: { ...state.sessions, [s.id]: s }, activeByActor };
}
