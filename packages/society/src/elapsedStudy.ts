import { cumulativeUnitAllocation } from '@aivilization/economy';
/** Actual study progress. Course/funding authorization and custody belong to the world adapter. */
export const ELAPSED_STUDY_POLICY = {
  version: 'resident-elapsed-study-v1',
  maxDurationMs: 86_400_000,
  maxSessions: 100_000,
  moneyScale: 1_000_000,
  quantityScale: 1_000_000_000,
  educationScale: 1_000_000_000,
} as const;
export type ElapsedStudyPolicy = typeof ELAPSED_STUDY_POLICY;
/** Integer units prevent the number of time advances from changing totals. Not CLI input. */
export type StudyAllocation = {
  readonly residentMicros: number;
  readonly treasuryMicros: number;
  readonly inventoryNanoUnits: Readonly<Record<string, number>>;
  readonly educationNanoPoints: number;
};
export type StudyTerms = {
  readonly modelVersion: string;
  readonly sourceKind: 'external-course' | 'scenario-public-course';
  readonly sourceId: string;
  readonly fundingAuthorityId: string;
  readonly allocation: StudyAllocation;
};
export type ElapsedStudySession = {
  readonly id: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly revision: number;
  readonly startedAt: number;
  readonly until: number;
  readonly settledAt: number;
  readonly elapsedMs: number;
  readonly terms: StudyTerms;
  readonly applied: StudyAllocation;
  readonly status: 'active' | 'completed' | 'interrupted';
  readonly endReason?:
    | 'completed'
    | 'participant-left'
    | 'physical-unavailable'
    | 'permission-ended'
    | 'population-departure';
};
export type ElapsedStudyState = {
  readonly policy: ElapsedStudyPolicy;
  readonly sessions: Readonly<Record<string, ElapsedStudySession>>;
  readonly activeByActor: Readonly<Record<string, string>>;
};
export type ElapsedStudyEvent = {
  readonly type: 'ElapsedStudySessionChanged';
  readonly previousRevision: number;
  readonly session: ElapsedStudySession;
};
const unit = (n: number) => Number.isSafeInteger(n) && n >= 0;
const id = (s: string) =>
  typeof s === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(s) &&
  !['__proto__', 'prototype', 'constructor'].includes(s);
const zero = (): StudyAllocation => ({
  residentMicros: 0,
  treasuryMicros: 0,
  inventoryNanoUnits: {},
  educationNanoPoints: 0,
});
const no = (reason: string) => ({ accepted: false as const, reason });
const yes = (...events: ElapsedStudyEvent[]) => ({ accepted: true as const, events });
export function assertElapsedStudyPolicy(policy: ElapsedStudyPolicy) {
  if (
    Object.keys(policy).length !== Object.keys(ELAPSED_STUDY_POLICY).length ||
    Object.entries(ELAPSED_STUDY_POLICY).some(
      ([k, v]) => policy[k as keyof ElapsedStudyPolicy] !== v,
    )
  )
    throw Error('unsupported-elapsed-study-policy');
}
export function emptyElapsedStudyState(
  policy: ElapsedStudyPolicy = ELAPSED_STUDY_POLICY,
): ElapsedStudyState {
  assertElapsedStudyPolicy(policy);
  return { policy: { ...policy }, sessions: {}, activeByActor: {} };
}
function validAllocation(a: StudyAllocation) {
  return (
    [a.residentMicros, a.treasuryMicros, a.educationNanoPoints].every(unit) &&
    unit(a.residentMicros + a.treasuryMicros) &&
    Object.keys(a.inventoryNanoUnits).length <= 64 &&
    Object.entries(a.inventoryNanoUnits).every(
      ([k, n]) =>
        k.trim().length > 0 &&
        k.length <= 120 &&
        !['__proto__', 'prototype', 'constructor'].includes(k) &&
        unit(n) &&
        n > 0,
    )
  );
}
function sameAllocation(a: StudyAllocation, b: StudyAllocation) {
  return (
    a.residentMicros === b.residentMicros &&
    a.treasuryMicros === b.treasuryMicros &&
    a.educationNanoPoints === b.educationNanoPoints &&
    Object.keys(a.inventoryNanoUnits).length === Object.keys(b.inventoryNanoUnits).length &&
    Object.entries(a.inventoryNanoUnits).every(([k, n]) => b.inventoryNanoUnits[k] === n)
  );
}
function validTerms(t: StudyTerms) {
  return (
    [t.modelVersion, t.sourceId, t.fundingAuthorityId].every(id) &&
    ['external-course', 'scenario-public-course'].includes(t.sourceKind) &&
    validAllocation(t.allocation)
  );
}
/** Cumulative proportional allocation over an immutable booked interval, using exact integer arithmetic. */
export function studyAllocationAt(
  total: StudyAllocation,
  elapsedMs: number,
  durationMs: number,
): StudyAllocation {
  if (
    !validAllocation(total) ||
    !unit(elapsedMs) ||
    !unit(durationMs) ||
    durationMs < 1 ||
    elapsedMs > durationMs
  )
    throw Error('invalid-study-allocation-time');
  const share = (n: number) => cumulativeUnitAllocation(n, elapsedMs, durationMs);
  return {
    residentMicros: share(total.residentMicros),
    treasuryMicros: share(total.treasuryMicros),
    educationNanoPoints: share(total.educationNanoPoints),
    inventoryNanoUnits: Object.fromEntries(
      Object.entries(total.inventoryNanoUnits)
        .map(([k, n]) => [k, share(n)] as const)
        .filter(([, n]) => n > 0),
    ),
  };
}
export function studyAllocationDifference(
  after: StudyAllocation,
  before: StudyAllocation,
): StudyAllocation {
  if (!validAllocation(after) || !validAllocation(before)) throw Error('invalid-study-allocation');
  const subtract = (a: number, b: number) => {
    if (a < b) throw Error('study-allocation-regressed');
    return a - b;
  };
  return {
    residentMicros: subtract(after.residentMicros, before.residentMicros),
    treasuryMicros: subtract(after.treasuryMicros, before.treasuryMicros),
    educationNanoPoints: subtract(after.educationNanoPoints, before.educationNanoPoints),
    inventoryNanoUnits: Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(after.inventoryNanoUnits),
          ...Object.keys(before.inventoryNanoUnits),
        ]),
      ]
        .map(
          (k) =>
            [
              k,
              subtract(after.inventoryNanoUnits[k] ?? 0, before.inventoryNanoUnits[k] ?? 0),
            ] as const,
        )
        .filter(([, n]) => n > 0),
    ),
  };
}
export function startElapsedStudy(input: {
  state: ElapsedStudyState;
  actorId: string;
  id: string;
  locationId: string;
  at: number;
  durationMs: number;
  terms: StudyTerms;
}) {
  const { state, actorId, locationId, at, durationMs, terms } = input;
  assertElapsedStudyPolicy(state.policy);
  if (
    ![input.id, actorId, locationId].every(id) ||
    !unit(at) ||
    !unit(durationMs) ||
    durationMs < 1 ||
    durationMs > state.policy.maxDurationMs ||
    !unit(at + durationMs) ||
    !validTerms(terms)
  )
    return no('invalid-study-definition');
  if (Object.hasOwn(state.sessions, input.id)) return no('study-id-exists');
  if (state.activeByActor[actorId]) return no('study-already-active');
  if (Object.keys(state.sessions).length >= state.policy.maxSessions)
    return no('study-history-limit');
  return yes({
    type: 'ElapsedStudySessionChanged',
    previousRevision: 0,
    session: {
      id: input.id,
      actorId,
      locationId,
      revision: 1,
      startedAt: at,
      until: at + durationMs,
      settledAt: at,
      elapsedMs: 0,
      terms: structuredClone(terms),
      applied: zero(),
      status: 'active',
    },
  });
}
export function progressElapsedStudy(state: ElapsedStudyState, studyId: string, at: number) {
  const previous = state.sessions[studyId];
  if (!previous || previous.status !== 'active') return no('study-not-active');
  if (previous.revision >= Number.MAX_SAFE_INTEGER) return no('study-revision-limit');
  if (!unit(at) || at < previous.settledAt) return no('invalid-study-progress-time');
  const settledAt = Math.min(at, previous.until);
  if (settledAt === previous.settledAt) return yes();
  const elapsedMs = settledAt - previous.startedAt;
  return yes({
    type: 'ElapsedStudySessionChanged',
    previousRevision: previous.revision,
    session: {
      ...previous,
      revision: previous.revision + 1,
      settledAt,
      elapsedMs,
      applied: studyAllocationAt(
        previous.terms.allocation,
        elapsedMs,
        previous.until - previous.startedAt,
      ),
      status: settledAt === previous.until ? 'completed' : 'active',
      ...(settledAt === previous.until ? { endReason: 'completed' as const } : {}),
    },
  });
}
export function stopElapsedStudy(input: {
  state: ElapsedStudyState;
  id: string;
  expectedRevision: number;
  at: number;
  actorId: string;
  reason?: 'physical-unavailable' | 'permission-ended' | 'population-departure';
}) {
  const previous = input.state.sessions[input.id];
  if (!previous || (input.reason ? input.actorId !== 'system' : previous.actorId !== input.actorId))
    return no('study-stop-authority-required');
  if (previous.revision !== input.expectedRevision) return no('study-revision-conflict');
  if (previous.status !== 'active') return no('study-not-active');
  if (previous.revision >= Number.MAX_SAFE_INTEGER) return no('study-revision-limit');
  if (!unit(input.at) || input.at !== previous.settledAt)
    return no('study-progress-must-be-settled');
  return yes({
    type: 'ElapsedStudySessionChanged',
    previousRevision: previous.revision,
    session: {
      ...previous,
      revision: previous.revision + 1,
      status: 'interrupted',
      endReason: input.reason ?? 'participant-left',
    },
  });
}
/** Replay checks the committed transition and its conservation proof, not live policy or payment eligibility. */
export function applyElapsedStudyEvent(
  state: ElapsedStudyState,
  event: ElapsedStudyEvent,
): ElapsedStudyState {
  const s = event.session,
    previous = state.sessions[s.id];
  if (
    ![s.id, s.actorId, s.locationId].every(id) ||
    !validTerms(s.terms) ||
    ![s.startedAt, s.until, s.settledAt, s.elapsedMs, s.revision, event.previousRevision].every(
      unit,
    ) ||
    s.revision !== event.previousRevision + 1 ||
    s.until <= s.startedAt ||
    s.until - s.startedAt > state.policy.maxDurationMs ||
    s.settledAt < s.startedAt ||
    s.settledAt > s.until ||
    s.elapsedMs !== s.settledAt - s.startedAt ||
    !['active', 'completed', 'interrupted'].includes(s.status) ||
    (s.status === 'active'
      ? s.endReason !== undefined || s.settledAt === s.until
      : s.status === 'completed'
        ? s.endReason !== 'completed' || s.settledAt !== s.until
        : ![
            'participant-left',
            'physical-unavailable',
            'permission-ended',
            'population-departure',
          ].includes(s.endReason ?? '') || s.settledAt === s.until) ||
    !sameAllocation(
      s.applied,
      studyAllocationAt(s.terms.allocation, s.elapsedMs, s.until - s.startedAt),
    )
  )
    throw Error('invalid-study-event');
  if (!previous) {
    if (
      event.previousRevision !== 0 ||
      s.status !== 'active' ||
      s.elapsedMs !== 0 ||
      state.activeByActor[s.actorId] ||
      Object.keys(state.sessions).length >= state.policy.maxSessions
    )
      throw Error('invalid-study-start');
  } else {
    if (
      previous.revision !== event.previousRevision ||
      previous.status !== 'active' ||
      state.activeByActor[s.actorId] !== s.id ||
      ['actorId', 'locationId', 'startedAt', 'until'].some(
        (k) => previous[k as keyof ElapsedStudySession] !== s[k as keyof ElapsedStudySession],
      ) ||
      ['sourceId', 'sourceKind', 'modelVersion', 'fundingAuthorityId'].some(
        (k) => previous.terms[k as keyof StudyTerms] !== s.terms[k as keyof StudyTerms],
      ) ||
      !sameAllocation(previous.terms.allocation, s.terms.allocation) ||
      (s.status === 'interrupted'
        ? s.settledAt !== previous.settledAt
        : s.settledAt <= previous.settledAt)
    )
      throw Error('invalid-study-transition');
  }
  const activeByActor = { ...state.activeByActor };
  if (s.status === 'active') activeByActor[s.actorId] = s.id;
  else delete activeByActor[s.actorId];
  return { ...state, sessions: { ...state.sessions, [s.id]: s }, activeByActor };
}
/** The adapter must atomically apply these reserve/use/refund instructions with the session event. */
export function elapsedStudyEffects(state: ElapsedStudyState, event: ElapsedStudyEvent) {
  applyElapsedStudyEvent(state, event);
  const previous = state.sessions[event.session.id],
    s = event.session;
  const remainder =
    s.status === 'active' ? zero() : studyAllocationDifference(s.terms.allocation, s.applied);
  // Unperformed education is cancelled, never refunded into a person's knowledge.
  return {
    reserve: previous ? zero() : { ...s.terms.allocation, educationNanoPoints: 0 },
    applied: studyAllocationDifference(s.applied, previous?.applied ?? zero()),
    refund: { ...remainder, educationNanoPoints: 0 },
    reserveTime: !previous,
    releaseTime: s.status !== 'active',
  };
}
