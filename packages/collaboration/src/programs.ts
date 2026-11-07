import {
  assertProgramActionsPolicy,
  PROGRAM_ACTIONS_POLICY,
  ENTERPRISE_PROGRAM_ACTIONS_POLICY,
} from './programActions';
import { prepareProgramRun, assertProgramExecutionAuthority } from './programAuthorization';
export {
  prepareProgramRun,
  prepareProgramStepAuthority,
  assertProgramExecutionAuthority,
} from './programAuthorization';
import { assertProgramConditionsPolicy } from './conditionModel';
import {
  canReadProgram,
  coordinationId,
  emptyCoordinationState,
  programPrincipals,
  parseResidentProgramDefinition,
  assertCoordinationPolicy,
  type CoordinationCommand,
  type CoordinationDecision,
  type CoordinationEvent,
  type CoordinationState,
  type ProgramRun,
} from './programModel';

const no = (reason: string) => ({ accepted: false as const, reason });
const yes = (...events: CoordinationEvent[]): CoordinationDecision => ({ accepted: true, events });
export function decideCoordination(input: {
  state: CoordinationState;
  actorId: string;
  at: number;
  command: CoordinationCommand;
  exists: (id: string) => boolean;
}): CoordinationDecision {
  const { state: s, actorId: actor, at, command: c, exists } = input;
  assertCoordinationPolicy(s.policy);
  if (!exists(actor) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if (!coordinationId(c.id)) return no('invalid-coordination-id');
  if ('programId' in c && !coordinationId(c.programId)) return no('program-not-found');
  if (c.type === 'programs.publish' || c.type === 'programs.revise') {
    const old = s.programs[c.id];
    if (c.type === 'programs.publish' && old) return no('program-id-conflict');
    if (c.type === 'programs.revise' && (!old || old.ownerId !== actor))
      return no('program-not-found');
    if (c.type === 'programs.revise' && old?.revision !== c.expectedRevision)
      return no('revision-conflict');
    if (
      !old &&
      Object.values(s.programs).filter((p) => p.ownerId === actor).length >=
        s.policy.maxProgramsPerOwner
    )
      return no('program-quota');
    if (
      !c.title.trim() ||
      c.title.length > 120 ||
      !c.purpose.trim() ||
      c.purpose.length > 2000 ||
      c.runners.length < 1 ||
      c.runners.length > s.policy.maxRunners ||
      new Set(c.runners).size !== c.runners.length ||
      c.runners.some((r) => !coordinationId(r) || !exists(r))
    )
      return no('invalid-program-settings');
    const definition = parseResidentProgramDefinition(
      c.definition,
      s.policy,
      s.conditionsPolicy,
      s.actionsPolicy,
    );
    if (!definition || definition.steps.some((step) => !exists(step.principalId)))
      return no('invalid-program-definition');
    return yes({
      type: 'ResidentProgramChanged',
      program: {
        id: c.id,
        ownerId: actor,
        title: c.title,
        purpose: c.purpose,
        runners: [...c.runners],
        ...definition,
        revision: (old?.revision ?? 0) + 1,
        active: true,
        at,
      },
    });
  }
  if (c.type === 'programs.disable') {
    const p = s.programs[c.id];
    if (!p || p.ownerId !== actor) return no('program-not-found');
    if (p.revision !== c.expectedRevision) return no('revision-conflict');
    return yes({
      type: 'ResidentProgramChanged',
      program: { ...p, active: false, revision: p.revision + 1, at },
    });
  }
  if (c.type === 'mandates.grant') {
    const p = s.programs[c.programId];
    if (!p || !canReadProgram(p, actor)) return no('program-not-found');
    if (!p.active || p.revision !== c.programRevision) return no('program-version-inactive');
    if (
      !programPrincipals(p).includes(actor) ||
      !p.runners.includes(c.runnerId) ||
      !exists(c.runnerId)
    )
      return no('invalid-mandate-parties');
    if (s.mandates[c.id]) return no('mandate-id-conflict');
    if (
      !Number.isSafeInteger(c.maxRuns) ||
      c.maxRuns < 1 ||
      c.maxRuns > s.policy.maxRuns ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= at ||
      c.expiresAt > at + s.policy.maxHorizonMs
    )
      return no('invalid-mandate-bounds');
    if (
      Object.values(s.mandates).filter(
        (m) => m.principalId === actor && !m.revoked && m.expiresAt > at && m.usedRuns < m.maxRuns,
      ).length >= s.policy.maxActiveMandates
    )
      return no('mandate-quota');
    return yes({
      type: 'ResidentMandateChanged',
      mandate: {
        id: c.id,
        principalId: actor,
        runnerId: c.runnerId,
        programId: p.id,
        programRevision: p.revision,
        maxRuns: c.maxRuns,
        usedRuns: 0,
        expiresAt: c.expiresAt,
        revoked: false,
        revision: 1,
        at,
      },
    });
  }
  if (c.type === 'mandates.revoke') {
    const m = s.mandates[c.id];
    if (!m || m.principalId !== actor) return no('mandate-not-found');
    if (m.revision !== c.expectedRevision) return no('revision-conflict');
    return yes({
      type: 'ResidentMandateChanged',
      mandate: { ...m, revoked: true, revision: m.revision + 1, at },
    });
  }
  if (c.type === 'programs.schedule') {
    const check = prepareProgramRun(s, actor, c.programId, c.programRevision, at, exists);
    if (!check.accepted) return check;
    if (s.schedules[c.id]) return no('schedule-id-conflict');
    if (
      ![c.startAt, c.intervalMs, c.runs].every(Number.isSafeInteger) ||
      c.startAt <= at ||
      c.intervalMs < s.policy.minIntervalMs ||
      c.runs < 1 ||
      c.runs > s.policy.maxRuns ||
      !Number.isSafeInteger(c.startAt + (c.runs - 1) * c.intervalMs) ||
      c.startAt + (c.runs - 1) * c.intervalMs > at + s.policy.maxHorizonMs
    )
      return no('invalid-schedule-bounds');
    if (
      Object.values(s.schedules).filter((v) => v.runnerId === actor && v.status === 'active')
        .length >= s.policy.maxActiveSchedules
    )
      return no('schedule-quota');
    // An overfull single instant cannot be repaired by splitting AdvanceSimulationTime.
    // Reject that schedule at admission so every accepted world still has a progress path.
    for (let i = 0; i < c.runs; i++) {
      const at = c.startAt + i * c.intervalMs;
      const simultaneous = Object.values(s.schedules).filter((v) => {
        if (v.status !== 'active' || at < v.nextAt) return false;
        const delta = at - v.nextAt;
        return delta % v.intervalMs === 0 && delta / v.intervalMs < v.remainingRuns;
      }).length;
      if (simultaneous >= s.policy.maxDuePerAdvance) return no('schedule-concurrency-quota');
    }
    return yes({
      type: 'ProgramScheduleChanged',
      schedule: {
        id: c.id,
        runnerId: actor,
        programId: c.programId,
        programRevision: c.programRevision,
        nextAt: c.startAt,
        intervalMs: c.intervalMs,
        remainingRuns: c.runs,
        completedRuns: 0,
        status: 'active',
        revision: 1,
        at,
      },
    });
  }
  const schedule = s.schedules[c.id];
  if (!schedule || schedule.runnerId !== actor) return no('schedule-not-found');
  if (schedule.revision !== c.expectedRevision) return no('revision-conflict');
  if (schedule.status !== 'active') return no('schedule-not-active');
  return yes({
    type: 'ProgramScheduleChanged',
    schedule: { ...schedule, status: 'cancelled', revision: schedule.revision + 1, at },
  });
}
/** Caller supplies only a fully verified success, or a failure with no domain effects. */
export function recordProgramRun(
  s: CoordinationState,
  run: ProgramRun,
): readonly CoordinationEvent[] {
  if (s.runs[run.id]) throw new Error('program-run-already-recorded');
  assertProgramExecutionAuthority(s, run);
  const events: CoordinationEvent[] = [];
  if (run.status === 'succeeded') {
    const p = s.programs[run.programId];
    if (!p?.active || p.revision !== run.programRevision || !p.runners.includes(run.runnerId))
      throw new Error('program-version-inactive');
    const principals = programPrincipals(p);
    const actual = run.mandateIds.map((id) => s.mandates[id]?.principalId);
    if (
      new Set(run.mandateIds).size !== run.mandateIds.length ||
      actual.length !== principals.length ||
      new Set(actual).size !== principals.length ||
      principals.some((id) => !actual.includes(id))
    )
      throw new Error('program-mandates-incomplete');
  }
  if (run.status === 'succeeded')
    for (const id of run.mandateIds) {
      const m = s.mandates[id];
      if (
        !m ||
        m.revoked ||
        m.usedRuns >= m.maxRuns ||
        m.expiresAt <= run.at ||
        m.programId !== run.programId ||
        m.programRevision !== run.programRevision ||
        m.runnerId !== run.runnerId
      )
        throw new Error('program-mandate-changed');
      events.push({
        type: 'ResidentMandateChanged',
        mandate: { ...m, usedRuns: m.usedRuns + 1, revision: m.revision + 1, at: run.at },
      });
    }
  events.push({ type: 'ProgramRunRecorded', run });
  if (run.scheduleId) {
    const schedule = s.schedules[run.scheduleId];
    if (
      !schedule ||
      schedule.status !== 'active' ||
      schedule.nextAt !== run.at ||
      schedule.runnerId !== run.runnerId ||
      schedule.programId !== run.programId ||
      schedule.programRevision !== run.programRevision
    )
      throw new Error('program-schedule-mismatch');
    events.push({
      type: 'ProgramScheduleChanged',
      schedule: {
        ...schedule,
        completedRuns: schedule.completedRuns + 1,
        remainingRuns: schedule.remainingRuns - 1,
        nextAt: schedule.nextAt + schedule.intervalMs,
        status:
          run.status === 'failed'
            ? 'failed'
            : schedule.remainingRuns === 1
              ? 'completed'
              : 'active',
        revision: schedule.revision + 1,
        at: run.at,
      },
    });
  }
  return events;
}
export function nextProgramBoundary(s: CoordinationState | undefined): number | undefined {
  const times = Object.values(s?.schedules ?? {})
    .filter((v) => v.status === 'active')
    .map((v) => v.nextAt);
  return times.length ? Math.min(...times) : undefined;
}
export function programAdvanceWithinBudget(
  s: CoordinationState | undefined,
  target: number,
): boolean {
  if (!s) return true;
  return (
    Object.values(s.schedules)
      .filter((v) => v.status === 'active' && v.nextAt <= target)
      .reduce(
        (n, v) => n + Math.min(v.remainingRuns, 1 + Math.floor((target - v.nextAt) / v.intervalMs)),
        0,
      ) <= s.policy.maxDuePerAdvance
  );
}
export function applyCoordinationEvent(
  s: CoordinationState | undefined,
  e: CoordinationEvent,
): CoordinationState {
  if (e.type === 'CoordinationEnabled') {
    if (s) throw new Error('coordination-already-enabled');
    return emptyCoordinationState(e.policy);
  }
  if (!s) throw new Error('coordination-not-enabled');
  if (e.type === 'ProgramActionsEnabled') {
    if (s.actionsPolicy) throw Error('program-actions-already-enabled');
    assertProgramActionsPolicy(e.policy);
    return { ...s, actionsPolicy: e.policy };
  }
  if (e.type === 'ProgramActionsUpgraded') {
    assertProgramActionsPolicy(e.policy);
    if (
      s.actionsPolicy?.version !== PROGRAM_ACTIONS_POLICY.version ||
      e.fromVersion !== s.actionsPolicy.version ||
      e.policy.version !== ENTERPRISE_PROGRAM_ACTIONS_POLICY.version
    )
      throw Error('invalid-program-actions-upgrade');
    return { ...s, actionsPolicy: e.policy };
  }
  if (e.type === 'ProgramConditionsEnabled') {
    if (s.conditionsPolicy) throw new Error('program-conditions-already-enabled');
    assertProgramConditionsPolicy(e.policy);
    return { ...s, conditionsPolicy: e.policy };
  }
  if (e.type === 'ResidentProgramChanged') {
    const p = e.program;
    if (
      (p.actionPolicyVersion || p.steps.some((step) => step.capability === 'resource.control')) &&
      !parseResidentProgramDefinition(
        {
          steps: p.steps,
          ...(p.actionPolicyVersion ? { actionPolicyVersion: p.actionPolicyVersion } : {}),
          ...(p.conditions ? { conditions: p.conditions } : {}),
        },
        s.policy,
        s.conditionsPolicy,
        s.actionsPolicy,
      )
    )
      throw Error('invalid-program-action-version-or-definition');
    if (p.revision !== (s.programs[p.id]?.revision ?? 0) + 1)
      throw new Error('program-revision-gap');
    return {
      ...s,
      programs: { ...s.programs, [p.id]: p },
      history: { ...s.history, [p.id]: [...(s.history[p.id] ?? []), p] },
    };
  }
  if (e.type === 'ResidentMandateChanged') {
    const m = e.mandate;
    if (m.revision !== (s.mandates[m.id]?.revision ?? 0) + 1)
      throw new Error('mandate-revision-gap');
    return { ...s, mandates: { ...s.mandates, [m.id]: m } };
  }
  if (e.type === 'ProgramScheduleChanged') {
    const v = e.schedule;
    if (v.revision !== (s.schedules[v.id]?.revision ?? 0) + 1)
      throw new Error('schedule-revision-gap');
    return { ...s, schedules: { ...s.schedules, [v.id]: v } };
  }
  if (s.runs[e.run.id]) throw new Error('duplicate-program-run');
  return { ...s, runs: { ...s.runs, [e.run.id]: e.run } };
}
