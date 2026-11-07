import { cumulativeUnitAllocation } from '@aivilization/economy';
import {
  earnedLaborWithholding,
  EARNED_LABOR_WITHHOLDING_VERSION,
  type EarnedLaborCompensation,
} from './wage';

export const PUBLIC_LABOR_POLICY = {
  version: 'resident-public-labor-v1',
  funding: 'treasury-prefunded-gross-wage',
  source: 'initial-public-employment-regime',
  cadenceMs: 60000,
  maxDurationMs: 86400000,
  maxSessions: 100000,
  moneyScale: 1000000,
} as const;
export type PublicLaborTerms = EarnedLaborCompensation & {
  readonly sourceKind: typeof PUBLIC_LABOR_POLICY.source;
  readonly sourceId: string;
  readonly occupation: string;
  readonly quotedWage: number;
  readonly referenceSeconds: number;
  readonly energyCostPerHour: number;
  readonly satietyCostPerHour: number;
};
export type PublicLaborSession = {
  readonly id: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly revision: number;
  readonly startedAt: number;
  readonly until: number;
  readonly settledAt: number;
  readonly elapsedMs: number;
  readonly terms: PublicLaborTerms;
  readonly earnedMicros: number;
  readonly paidMicros: number;
  readonly withheldMicros: number;
  readonly refundedMicros: number;
  readonly status: 'active' | 'completed' | 'interrupted';
  readonly endReason?:
    | 'completed'
    | 'participant-left'
    | 'employment-ended'
    | 'physical-unavailable'
    | 'permission-ended';
};
export type PublicLaborState = {
  readonly policy: typeof PUBLIC_LABOR_POLICY;
  readonly sessions: Readonly<Record<string, PublicLaborSession>>;
  readonly activeByActor: Readonly<Record<string, string>>;
};
export type PublicLaborEvent = {
  readonly type: 'PublicLaborSessionChanged';
  readonly previousRevision: number;
  readonly session: PublicLaborSession;
};
type Decision =
  | { readonly accepted: true; readonly events: readonly PublicLaborEvent[] }
  | { readonly accepted: false; readonly reason: string };
const unit = (n: number) => Number.isSafeInteger(n) && n >= 0;
const key = (s: string) =>
  typeof s === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(s) &&
  !['__proto__', 'prototype', 'constructor'].includes(s);
const no = (reason: string): Decision => ({ accepted: false, reason });
export function assertPublicLaborPolicy(p: typeof PUBLIC_LABOR_POLICY) {
  if (
    Object.keys(p).length !== Object.keys(PUBLIC_LABOR_POLICY).length ||
    Object.entries(PUBLIC_LABOR_POLICY).some(([k, v]) => p[k as keyof typeof p] !== v)
  )
    throw Error('unsupported-public-labor-policy');
}
export function emptyPublicLaborState(): PublicLaborState {
  return { policy: { ...PUBLIC_LABOR_POLICY }, sessions: {}, activeByActor: {} };
}
function validTerms(t: PublicLaborTerms) {
  return (
    t.sourceKind === PUBLIC_LABOR_POLICY.source &&
    key(t.sourceId) &&
    typeof t.occupation === 'string' &&
    t.occupation.trim().length > 0 &&
    t.occupation.length <= 200 &&
    typeof t.taxPolicyVersion === 'string' &&
    t.taxPolicyVersion.length > 0 &&
    t.taxPolicyVersion.length <= 200 &&
    t.withholdingVersion === EARNED_LABOR_WITHHOLDING_VERSION &&
    [t.grossMicros, t.taxMicros].every(unit) &&
    t.taxMicros <= t.grossMicros &&
    [t.quotedWage, t.referenceSeconds, t.energyCostPerHour, t.satietyCostPerHour].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) &&
    t.referenceSeconds > 0
  );
}
function decision(state: PublicLaborState, event: PublicLaborEvent): Decision {
  try {
    applyPublicLaborEvent(state, event);
    return { accepted: true, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-public-labor');
  }
}
export function startPublicLabor(input: {
  state: PublicLaborState;
  id: string;
  actorId: string;
  locationId: string;
  at: number;
  durationMs: number;
  terms: PublicLaborTerms;
  availableTreasuryMicros: number;
}): Decision {
  if (!unit(input.availableTreasuryMicros) || !validTerms(input.terms))
    return no('invalid-public-labor-funding');
  if (input.availableTreasuryMicros < input.terms.grossMicros)
    return no('public-wage-full-funding-required');
  if (Object.hasOwn(input.state.sessions, input.id)) return no('public-labor-id-exists');
  return decision(input.state, {
    type: 'PublicLaborSessionChanged',
    previousRevision: 0,
    session: {
      id: input.id,
      actorId: input.actorId,
      locationId: input.locationId,
      revision: 1,
      startedAt: input.at,
      until: input.at + input.durationMs,
      settledAt: input.at,
      elapsedMs: 0,
      terms: input.terms,
      earnedMicros: 0,
      paidMicros: 0,
      withheldMicros: 0,
      refundedMicros: 0,
      status: 'active',
    },
  });
}
export function progressPublicLabor(state: PublicLaborState, id: string, at: number): Decision {
  const old = state.sessions[id];
  if (!old || old.status !== 'active') return no('public-labor-not-active');
  if (!unit(at) || at < old.settledAt) return no('invalid-public-labor-time');
  const through = Math.min(at, old.until);
  if (through === old.settledAt) return { accepted: true, events: [] };
  const elapsedMs = through - old.startedAt,
    earnedMicros = cumulativeUnitAllocation(
      old.terms.grossMicros,
      elapsedMs,
      old.until - old.startedAt,
    );
  return decision(state, {
    type: 'PublicLaborSessionChanged',
    previousRevision: old.revision,
    session: {
      ...old,
      revision: old.revision + 1,
      settledAt: through,
      elapsedMs,
      earnedMicros,
      paidMicros: earnedMicros,
      withheldMicros: earnedLaborWithholding(old.terms, earnedMicros),
      ...(through === old.until
        ? { status: 'completed' as const, endReason: 'completed' as const }
        : {}),
    },
  });
}
export function stopPublicLabor(input: {
  state: PublicLaborState;
  id: string;
  actorId: string;
  expectedRevision: number;
  at: number;
  reason?: 'employment-ended' | 'physical-unavailable' | 'permission-ended';
}): Decision {
  const old = input.state.sessions[input.id];
  if (!old || (input.reason ? input.actorId !== 'system' : input.actorId !== old.actorId))
    return no('public-labor-stop-authority-required');
  if (old.status !== 'active') return no('public-labor-not-active');
  if (old.revision !== input.expectedRevision) return no('public-labor-revision-conflict');
  if (input.at !== old.settledAt) return no('public-labor-progress-must-be-settled');
  return decision(input.state, {
    type: 'PublicLaborSessionChanged',
    previousRevision: old.revision,
    session: {
      ...old,
      revision: old.revision + 1,
      status: 'interrupted',
      endReason: input.reason ?? 'participant-left',
      refundedMicros: old.terms.grossMicros - old.paidMicros,
    },
  });
}
/** Validate source-bound, cumulative financial facts. Live treasury/occupation rules are not rerun on replay. */
export function applyPublicLaborEvent(
  state: PublicLaborState,
  event: PublicLaborEvent,
): PublicLaborState {
  assertPublicLaborPolicy(state.policy);
  const s = event.session,
    old = state.sessions[s.id];
  if (
    event.type !== 'PublicLaborSessionChanged' ||
    ![s.id, s.actorId, s.locationId].every(key) ||
    !validTerms(s.terms) ||
    ![
      event.previousRevision,
      s.revision,
      s.startedAt,
      s.until,
      s.settledAt,
      s.elapsedMs,
      s.earnedMicros,
      s.paidMicros,
      s.withheldMicros,
      s.refundedMicros,
    ].every(unit) ||
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
            'employment-ended',
            'physical-unavailable',
            'permission-ended',
          ].includes(s.endReason ?? '') || s.settledAt === s.until) ||
    s.earnedMicros !==
      cumulativeUnitAllocation(s.terms.grossMicros, s.elapsedMs, s.until - s.startedAt) ||
    s.paidMicros !== s.earnedMicros ||
    s.withheldMicros !== earnedLaborWithholding(s.terms, s.paidMicros) ||
    s.refundedMicros !== (s.status === 'active' ? 0 : s.terms.grossMicros - s.paidMicros)
  )
    throw Error('invalid-public-labor-event');
  if (!old) {
    if (
      event.previousRevision !== 0 ||
      s.status !== 'active' ||
      s.elapsedMs !== 0 ||
      state.activeByActor[s.actorId] ||
      Object.keys(state.sessions).length >= state.policy.maxSessions
    )
      throw Error('invalid-public-labor-start');
  } else if (
    old.revision !== event.previousRevision ||
    old.status !== 'active' ||
    state.activeByActor[s.actorId] !== s.id ||
    (['actorId', 'locationId', 'startedAt', 'until'] as const).some((k) => s[k] !== old[k]) ||
    Object.keys(s.terms).length !== Object.keys(old.terms).length ||
    Object.entries(old.terms).some(([k, v]) => s.terms[k as keyof PublicLaborTerms] !== v) ||
    (s.status === 'interrupted' ? s.settledAt !== old.settledAt : s.settledAt <= old.settledAt)
  )
    throw Error('invalid-public-labor-transition');
  const activeByActor = { ...state.activeByActor };
  if (s.status === 'active') activeByActor[s.actorId] = s.id;
  else delete activeByActor[s.actorId];
  const next = {
    ...state,
    sessions: { ...state.sessions, [s.id]: structuredClone(s) },
    activeByActor,
  };
  publicLaborEscrowBalance(next);
  return next;
}
export function publicLaborEffects(state: PublicLaborState, event: PublicLaborEvent) {
  applyPublicLaborEvent(state, event);
  const s = event.session,
    old = state.sessions[s.id];
  return {
    reservedMicros: old ? 0 : s.terms.grossMicros,
    paidMicros: s.paidMicros - (old?.paidMicros ?? 0),
    withheldMicros: s.withheldMicros - (old?.withheldMicros ?? 0),
    refundedMicros: s.refundedMicros - (old?.refundedMicros ?? 0),
  };
}
export function publicLaborEscrowBalance(state: PublicLaborState | undefined): number {
  let micros = 0;
  for (const s of Object.values(state?.sessions ?? {})) {
    micros += s.terms.grossMicros - s.paidMicros - s.refundedMicros;
    if (!unit(micros)) throw Error('public-labor-escrow-overflow');
  }
  return micros / PUBLIC_LABOR_POLICY.moneyScale;
}
