import { authorizePremisesPrincipal, principalPremisesReceipt } from './principal';
import { authorizeController } from '@aivilization/authority';
import {
  affordableWorkMs,
  materialEffortCost,
  materialId,
  type ProductionSession,
  type ProductionEndReason,
} from '@aivilization/materials';
import type { PremisesState, PremisesPorts, ConstructionProject, PremisesEvent } from './model';
import type { ConstructionDecision } from './projects';
export type ConstructionWorkDecision = ConstructionDecision & {
  readonly reservation?: {
    readonly actorId: string;
    readonly locationId: string;
    readonly until: number;
  };
  readonly release?: ProductionSession;
  readonly effort?: {
    readonly actorId: string;
    readonly projectId: string;
    readonly from: number;
    readonly through: number;
    readonly workMs: number;
    readonly energyCost: number;
    readonly satietyCost: number;
  };
};
const no = (reason: string): ConstructionWorkDecision => ({ accepted: false, reason });
const capable = (b: ReturnType<PremisesPorts['body']>) =>
  !!b && b.capable && [b.energy, b.satiety].every((n) => Number.isFinite(n) && n >= 0);
const withoutSession = (p: ConstructionProject) => {
  const { session, ...rest } = p;
  void session;
  return rest;
};
export function startConstruction(
  s: PremisesState,
  actorId: string,
  at: number,
  id: string,
  expectedRevision: number,
  until: number,
  ports: PremisesPorts,
): ConstructionWorkDecision {
  const p = s.projects[id];
  if (!p || p.status !== 'open') return no('construction-not-open');
  if (p.revision !== expectedRevision || p.revision >= Number.MAX_SAFE_INTEGER)
    return no('construction-revision-conflict');
  if (
    !Number.isSafeInteger(at) ||
    at < p.at ||
    !ports.exists(actorId) ||
    !p.workers.includes(actorId)
  )
    return no('construction-worker-not-authorized');
  if (p.session) return no('construction-already-working');
  if (!ports.present(actorId, p.workLocationId) || !ports.idle(actorId))
    return no('construction-presence-and-idle-required');
  const b = ports.body(actorId);
  if (!capable(b)) return no('construction-worker-unavailable');
  if (
    !Number.isSafeInteger(until) ||
    until <= at ||
    until - at > s.policy.maxShiftMs ||
    until - at > p.plan.workMs - p.progressMs
  )
    return no('invalid-construction-work-duration');
  const energy =
      materialEffortCost(p.progressMs + until - at, p.plan.workMs, p.plan.energyCost) -
      materialEffortCost(p.progressMs, p.plan.workMs, p.plan.energyCost),
    satiety =
      materialEffortCost(p.progressMs + until - at, p.plan.workMs, p.plan.satietyCost) -
      materialEffortCost(p.progressMs, p.plan.workMs, p.plan.satietyCost);
  if (energy > b!.energy || satiety > b!.satiety)
    return no('insufficient-construction-effort-budget');
  return {
    accepted: true,
    events: [
      {
        type: 'ConstructionProjectChanged',
        project: {
          ...p,
          session: { actorId, startedAt: at, settledAt: at, until, workedMs: 0 },
          revision: p.revision + 1,
          at,
        },
      },
    ],
    materials: [],
    reservation: { actorId, locationId: p.workLocationId, until },
  };
}
/** Records actual work; completion/cancellation then atomically finalizes material and physical effects in lifecycle. */
export function progressConstruction(
  s: PremisesState,
  actorId: string,
  at: number,
  id: string,
  evidenceId: string,
  ports: PremisesPorts,
  mode: 'tick' | 'leave' | 'cancel' = 'tick',
): ConstructionWorkDecision {
  const p = s.projects[id];
  if (!p || p.status !== 'open') return no('construction-not-open');
  if (
    !Number.isSafeInteger(at) ||
    at < p.at ||
    !materialId(evidenceId) ||
    p.revision >= Number.MAX_SAFE_INTEGER
  )
    return no('invalid-construction-time-or-evidence');
  const session = p.session;
  if (mode === 'leave' && session?.actorId !== actorId)
    return no('personal-construction-participation-required');
  const proof =
    mode === 'cancel' && p.principalAuthorization
      ? authorizePremisesPrincipal(
          s,
          actorId,
          { type: 'cancel-construction', id: p.id, expectedRevision: p.revision },
          ports,
        )
      : undefined;
  if (
    mode === 'cancel' &&
    (p.principalAuthorization
      ? !proof
      : !(p.controller.kind === 'resident' || p.controller.kind === 'collective') ||
        !authorizeController(
          { kind: p.controller.kind, id: p.controller.id },
          actorId,
          ports.authorize,
        ))
  )
    return no('construction-controller-authority-required');
  if (mode === 'tick' && (!session || session.settledAt === at))
    return { accepted: true, events: [], materials: [] };
  let workMs = 0,
    through = session?.settledAt ?? at;
  if (session) {
    const b = ports.body(session.actorId);
    if (at < session.settledAt) return no('invalid-construction-time');
    if (
      ports.exists(session.actorId) &&
      ports.present(session.actorId, p.workLocationId) &&
      ports.sessionReserved(p) &&
      capable(b)
    )
      workMs = affordableWorkMs({
        progressMs: p.progressMs,
        remainingMs: p.plan.workMs - p.progressMs,
        elapsedMs: Math.min(at, session.until) - session.settledAt,
        unitMs: p.plan.workMs,
        energyCost: p.plan.energyCost,
        satietyCost: p.plan.satietyCost,
        availableEnergy: b!.energy,
        availableSatiety: b!.satiety,
      });
    through = session.settledAt + workMs;
  }
  const progressMs = p.progressMs + workMs,
    finished = progressMs === p.plan.workMs,
    continuing = !!session && mode === 'tick' && !finished && at < session.until && through === at;
  const endReason: ProductionEndReason | undefined = continuing
    ? undefined
    : finished
      ? 'completed'
      : mode === 'cancel'
        ? 'cancelled'
        : mode === 'leave'
          ? 'left'
          : session && !ports.sessionReserved(p)
            ? 'reservation-mismatch'
            : session &&
                (!ports.exists(session.actorId) ||
                  !ports.present(session.actorId, p.workLocationId) ||
                  !capable(ports.body(session.actorId)))
              ? 'worker-unavailable'
              : session && through < Math.min(at, session.until)
                ? 'effort-exhausted'
                : 'shift-ended';
  const project: ConstructionProject = {
    ...withoutSession(p),
    progressMs,
    revision: p.revision + 1,
    at,
    ...(continuing && session
      ? { session: { ...session, settledAt: at, workedMs: session.workedMs + workMs } }
      : {}),
    ...(session && endReason
      ? { lastStop: { actorId: session.actorId, at, reason: endReason } }
      : {}),
  };
  const events: PremisesEvent[] = [
    { type: 'ConstructionProjectChanged', project },
    ...(proof ? [principalPremisesReceipt(evidenceId, at, proof)] : []),
  ];
  return {
    accepted: true,
    events,
    materials: [],
    ...(session && !continuing && ports.sessionReserved(p) ? { release: session } : {}),
    ...(session && workMs > 0
      ? {
          effort: {
            actorId: session.actorId,
            projectId: p.id,
            from: session.settledAt,
            through,
            workMs,
            energyCost:
              materialEffortCost(progressMs, p.plan.workMs, p.plan.energyCost) -
              materialEffortCost(p.progressMs, p.plan.workMs, p.plan.energyCost),
            satietyCost:
              materialEffortCost(progressMs, p.plan.workMs, p.plan.satietyCost) -
              materialEffortCost(p.progressMs, p.plan.workMs, p.plan.satietyCost),
          },
        }
      : {}),
  };
}
export function nextConstructionBoundary(s: PremisesState, now: number): number | undefined {
  let next: number | undefined;
  for (const p of Object.values(s.projects))
    if (p.session) {
      const n = Math.min(
        p.session.until,
        Math.floor(now / s.policy.settlementIntervalMs + 1) * s.policy.settlementIntervalMs,
      );
      if (n > now) next = next === undefined ? n : Math.min(next, n);
    }
  return next;
}

/** Application-verified system interruption. Does not cancel the project or settle its materials. */
export function interruptConstruction(
  s: PremisesState,
  id: string,
  at: number,
): ConstructionWorkDecision {
  const p = s.projects[id],
    session = p?.session;
  if (!p || p.status !== 'open' || !session) return no('active-construction-required');
  if (!Number.isSafeInteger(at) || at !== session.settledAt || at !== p.at)
    return no('construction-interruption-needs-settled-boundary');
  if (p.revision >= Number.MAX_SAFE_INTEGER) return no('construction-revision-conflict');
  return {
    accepted: true,
    materials: [],
    release: session,
    events: [
      {
        type: 'ConstructionProjectChanged',
        project: {
          ...withoutSession(p),
          revision: p.revision + 1,
          lastStop: { actorId: session.actorId, at, reason: 'worker-unavailable' },
        },
      },
    ],
  };
}
