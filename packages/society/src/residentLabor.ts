import { advanceElapsedPhysiology, type ElapsedPhysiologyInput } from './elapsedPhysiology';

export const RESIDENT_LABOR_POLICY = {
  version: 'resident-enterprise-labor-v1',
  cadenceMs: 60_000,
  automaticPaymentOrder: 'actor-id-ascending',
  maxDurationMs: 86_400_000,
  maxSessions: 100_000,
} as const;
export type ResidentLaborPolicy = typeof RESIDENT_LABOR_POLICY;
export type ResidentLaborSession = {
  readonly id: string;
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly locationId: string;
  readonly occupation: string;
  readonly revision: number;
  readonly startedAt: number;
  readonly until: number;
  readonly settledAt: number;
  readonly elapsedMs: number;
  readonly energyCostPerHour: number;
  readonly satietyCostPerHour: number;
  readonly status: 'active' | 'completed' | 'interrupted';
  readonly endReason?:
    | 'completed'
    | 'participant-left'
    | 'employment-ended'
    | 'physical-unavailable';
};
export type ResidentLaborState = {
  readonly policy: ResidentLaborPolicy;
  readonly sessions: Readonly<Record<string, ResidentLaborSession>>;
  readonly activeByActor: Readonly<Record<string, string>>;
};
export type ResidentLaborEvent = {
  readonly type: 'ResidentLaborSessionChanged';
  readonly previousRevision: number;
  readonly session: ResidentLaborSession;
};
type Decision =
  | { readonly accepted: true; readonly events: readonly ResidentLaborEvent[] }
  | { readonly accepted: false; readonly reason: string };
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const key = (s: string) =>
  typeof s === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(s) &&
  !['constructor', 'prototype', '__proto__'].includes(s);
const no = (reason: string): Decision => ({ accepted: false, reason });

export function assertResidentLaborPolicy(p: ResidentLaborPolicy) {
  if (
    Object.keys(p).length !== Object.keys(RESIDENT_LABOR_POLICY).length ||
    Object.entries(RESIDENT_LABOR_POLICY).some(([k, v]) => p[k as keyof ResidentLaborPolicy] !== v)
  )
    throw Error('unsupported-resident-labor-policy');
}
export function emptyResidentLaborState(
  p: ResidentLaborPolicy = RESIDENT_LABOR_POLICY,
): ResidentLaborState {
  assertResidentLaborPolicy(p);
  return { policy: { ...p }, sessions: {}, activeByActor: {} };
}

export function startResidentLabor(input: {
  readonly state: ResidentLaborState;
  readonly actorId: string;
  readonly id: string;
  readonly enterpriseId: string;
  readonly locationId: string;
  readonly occupation: string;
  readonly at: number;
  readonly durationMs: number;
  readonly energyCostPerHour: number;
  readonly satietyCostPerHour: number;
}): Decision {
  const { state } = input;
  if (Object.hasOwn(state.sessions, input.id)) return no('labor-id-exists');
  if (state.activeByActor[input.actorId]) return no('labor-already-active');
  return decide(state, {
    type: 'ResidentLaborSessionChanged',
    previousRevision: 0,
    session: {
      id: input.id,
      actorId: input.actorId,
      enterpriseId: input.enterpriseId,
      locationId: input.locationId,
      occupation: input.occupation,
      revision: 1,
      startedAt: input.at,
      until: input.at + input.durationMs,
      settledAt: input.at,
      elapsedMs: 0,
      energyCostPerHour: input.energyCostPerHour,
      satietyCostPerHour: input.satietyCostPerHour,
      status: 'active',
    },
  });
}
export function progressResidentLabor(state: ResidentLaborState, id: string, at: number): Decision {
  const s = state.sessions[id];
  if (!s || s.status !== 'active') return no('labor-not-active');
  if (!integer(at) || at < s.settledAt) return no('invalid-labor-progress-time');
  const through = Math.min(at, s.until);
  if (through === s.settledAt) return { accepted: true, events: [] };
  return decide(state, {
    type: 'ResidentLaborSessionChanged',
    previousRevision: s.revision,
    session: {
      ...s,
      revision: s.revision + 1,
      settledAt: through,
      elapsedMs: through - s.startedAt,
      ...(through === s.until ? { status: 'completed', endReason: 'completed' } : {}),
    },
  });
}
export function stopResidentLabor(input: {
  readonly state: ResidentLaborState;
  readonly actorId: string;
  readonly id: string;
  readonly expectedRevision: number;
  readonly at: number;
  readonly reason?: 'employment-ended' | 'physical-unavailable';
}): Decision {
  const s = input.state.sessions[input.id];
  if (!s || (input.reason ? input.actorId !== 'system' : input.actorId !== s.actorId))
    return no('labor-stop-authority-required');
  if (s.status !== 'active') return no('labor-not-active');
  if (input.expectedRevision !== s.revision) return no('labor-revision-conflict');
  if (input.at !== s.settledAt) return no('labor-progress-must-be-settled');
  return decide(input.state, {
    type: 'ResidentLaborSessionChanged',
    previousRevision: s.revision,
    session: {
      ...s,
      revision: s.revision + 1,
      status: 'interrupted',
      endReason: input.reason ?? 'participant-left',
    },
  });
}

export function applyResidentLaborEvent(
  state: ResidentLaborState,
  event: ResidentLaborEvent,
): ResidentLaborState {
  assertResidentLaborPolicy(state.policy);
  const s = event.session,
    old = state.sessions[s.id];
  if (
    ![s.id, s.actorId, s.enterpriseId, s.locationId].every(key) ||
    typeof s.occupation !== 'string' ||
    !s.occupation.trim() ||
    s.occupation.length > 200 ||
    ![s.revision, event.previousRevision, s.startedAt, s.until, s.settledAt, s.elapsedMs].every(
      integer,
    ) ||
    s.revision !== event.previousRevision + 1 ||
    s.until <= s.startedAt ||
    s.until - s.startedAt > state.policy.maxDurationMs ||
    s.settledAt < s.startedAt ||
    s.settledAt > s.until ||
    s.elapsedMs !== s.settledAt - s.startedAt ||
    ![s.energyCostPerHour, s.satietyCostPerHour].every((n) => Number.isFinite(n) && n >= 0) ||
    !['active', 'completed', 'interrupted'].includes(s.status) ||
    (s.status === 'completed') !== (s.settledAt === s.until) ||
    (s.status === 'active'
      ? s.endReason !== undefined
      : s.status === 'completed'
        ? s.endReason !== 'completed'
        : !['participant-left', 'employment-ended', 'physical-unavailable'].includes(
            s.endReason ?? '',
          ))
  )
    throw Error('invalid-resident-labor-event');
  if (!old) {
    if (
      event.previousRevision !== 0 ||
      s.status !== 'active' ||
      s.elapsedMs !== 0 ||
      state.activeByActor[s.actorId] ||
      Object.keys(state.sessions).length >= state.policy.maxSessions
    )
      throw Error('invalid-labor-start');
  } else if (
    old.status !== 'active' ||
    old.revision !== event.previousRevision ||
    state.activeByActor[s.actorId] !== s.id ||
    (
      [
        'actorId',
        'enterpriseId',
        'locationId',
        'occupation',
        'startedAt',
        'until',
        'energyCostPerHour',
        'satietyCostPerHour',
      ] as const
    ).some((k) => old[k] !== s[k]) ||
    (s.status === 'interrupted' ? s.settledAt !== old.settledAt : s.settledAt <= old.settledAt)
  )
    throw Error('invalid-labor-transition');
  const activeByActor = { ...state.activeByActor };
  if (s.status === 'active') activeByActor[s.actorId] = s.id;
  else delete activeByActor[s.actorId];
  return { ...state, sessions: { ...state.sessions, [s.id]: structuredClone(s) }, activeByActor };
}
function decide(state: ResidentLaborState, event: ResidentLaborEvent): Decision {
  try {
    applyResidentLaborEvent(state, event);
    return { accepted: true, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-resident-labor');
  }
}

/** Real work and passive decay share one integral; paying a wage does not itself change the body. */
export function advanceElapsedLaborPhysiology(
  input: Omit<ElapsedPhysiologyInput, 'sleep'> & {
    readonly labor: Pick<ResidentLaborSession, 'energyCostPerHour' | 'satietyCostPerHour'>;
  },
) {
  if (
    ![input.labor.energyCostPerHour, input.labor.satietyCostPerHour].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  )
    throw Error('invalid-labor-effort-rate');
  return advanceElapsedPhysiology({
    previous: input.previous,
    elapsedMs: input.elapsedMs,
    decay: {
      energyPerHour: input.decay.energyPerHour + input.labor.energyCostPerHour,
      satietyPerHour: input.decay.satietyPerHour + input.labor.satietyCostPerHour,
    },
    ...(input.deprivation ? { deprivation: input.deprivation } : {}),
  });
}
