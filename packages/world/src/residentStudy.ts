import type { ResidentDepartureActivitySource } from './residentDepartureActivitySource';
import {
  ELAPSED_STUDY_POLICY,
  startElapsedStudy,
  stopElapsedStudy,
  progressElapsedStudy,
  elapsedStudyEffects,
  validateEducationSystemPolicy,
  deriveEducationLevel,
  evaluateStudyCost,
  applyStudyEfficiency,
  evaluateAutomaticPromotion,
  type ElapsedStudyEvent,
  type StudyTerms,
} from '@aivilization/society';
import { createEventEnvelope, type CommandEnvelope } from '@aivilization/sim-core';
import type { WorldCommandPolicies } from './agentActions';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { assertAgentStudyPayload } from './commands';
import {
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './handlers/shared';
import { assertResidentRestTimeCompatibility } from './residentRestTime';
import { mayEnterWorldPremises, worldPremisesUseUntil, premisesAtLocation } from './premisesAccess';
import {
  RESIDENT_STUDY_SOURCE,
  type ResidentStudyConfiguration,
  type ResidentStudyPayload,
} from './residentStudyModel';
import { studyAccountingTransactions } from './residentStudyAccounting';

export function assertResidentStudyConfiguration(
  w: WorldProjection,
  c: ResidentStudyConfiguration,
) {
  validateEducationSystemPolicy(c.education);
  if (
    !w.residentRest ||
    !c.education.enabled ||
    !c.locationIds.length ||
    new Set(c.locationIds).size !== c.locationIds.length ||
    c.locationIds.some(
      (id) => w.locations[id]?.kind !== 'education' || premisesAtLocation(w, id),
    ) ||
    Object.keys(c.source).length !== Object.keys(RESIDENT_STUDY_SOURCE).length ||
    Object.entries(RESIDENT_STUDY_SOURCE).some(
      ([k, v]) => c.source[k as keyof typeof RESIDENT_STUDY_SOURCE] !== v,
    )
  )
    throw Error('invalid-elapsed-study-configuration');
}
export function enableResidentStudyEvent(input: {
  projection: WorldProjection;
  policies: WorldCommandPolicies;
  requestId: string;
  simulationId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    education = input.policies.educationSystem;
  assertResidentRestTimeCompatibility(input.policies);
  if (
    w.residentStudy ||
    !education?.enabled ||
    Object.values(w.activityTimeByAgent).some(
      (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
    )
  )
    throw Error('study-activation-requires-education-system-and-no-prepaid-activity');
  const configuration: ResidentStudyConfiguration = {
    policy: ELAPSED_STUDY_POLICY,
    source: RESIDENT_STUDY_SOURCE,
    education: structuredClone(education),
    locationIds: Object.values(w.locations)
      .filter((l) => l.kind === 'education' && !premisesAtLocation(w, String(l.locationId)))
      .map((l) => String(l.locationId))
      .sort(),
  };
  assertResidentStudyConfiguration(w, configuration);
  return createEventEnvelope({
    id: `${input.requestId}:study-enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentStudyEnabled',
    payload: configuration,
  });
}

/** Quote the explicitly retained initial educational institution. Never accepts a resident-supplied rate. */
export function quoteResidentStudy(
  w: WorldProjection,
  actorId: string,
  durationSeconds: number,
): { accepted: true; terms: StudyTerms } | { accepted: false; reason: string } {
  const state = w.residentStudy,
    a = w.agents[actorId];
  if (!state || !a) return { accepted: false, reason: 'resident-study-not-enabled' };
  const policy = state.configuration.education,
    level = a.educationLevel ?? deriveEducationLevel(a.educationScore, policy),
    cost = evaluateStudyCost({
      level,
      durationSeconds,
      balance: a.balance,
      inventory: a.inventory,
      treasuryBalance: w.treasury ?? null,
      policy,
    });
  if (cost.status === 'rejected') return { accepted: false, reason: cost.detail };
  const rate = applyStudyEfficiency({
    educationRatePerSecond: state.configuration.source.educationRatePerSecond,
    employed: a.job !== null,
    policy,
  });
  const fixed = (n: number, scale: number) => Math.round(n * scale);
  if (
    fixed(cost.selfPayCost, 1e6) / 1e6 > a.balance ||
    fixed(cost.treasuryCoveredCost, 1e6) / 1e6 > (w.treasury ?? 0)
  )
    return { accepted: false, reason: 'study-fixed-unit-funding-unavailable' };
  return {
    accepted: true,
    terms: {
      modelVersion: policy.policyVersion,
      sourceKind: cost.treasuryCoveredCost > 0 ? 'scenario-public-course' : 'external-course',
      sourceId: state.configuration.source.sourceId,
      fundingAuthorityId:
        cost.treasuryCoveredCost > 0
          ? `initial-study-grant:${policy.policyVersion}`
          : `personal-study:${actorId}`,
      allocation: {
        residentMicros: fixed(cost.selfPayCost, 1e6),
        treasuryMicros: fixed(cost.treasuryCoveredCost, 1e6),
        inventoryNanoUnits: {},
        educationNanoPoints: fixed(rate * durationSeconds, 1e9),
      },
    },
  };
}
type Context = {
  departure?: ResidentDepartureActivitySource;
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
  actorId: string;
};
export function residentStudyCommit(input: Context, event: ElapsedStudyEvent): WorldEvent {
  const w = input.projection,
    state = w.residentStudy;
  if (!state) throw Error('resident-study-not-enabled');
  const a = w.agents[event.session.actorId];
  if (!a) throw Error('study-actor-missing');
  const effects = elapsedStudyEffects(state.process, event),
    educationAfter = a.educationScore + effects.applied.educationNanoPoints / 1e9;
  if (!Number.isFinite(educationAfter)) throw Error('study-education-overflow');
  const payload: ResidentStudyPayload = {
    ...(input.departure ? { departure: input.departure } : {}),
    policyVersion: ELAPSED_STUDY_POLICY.version,
    actorId: input.actorId,
    event,
    transactions: studyAccountingTransactions(state.process, event, input.requestId),
    educationBefore: a.educationScore,
    educationAfter,
  };
  return createEventEnvelope({
    id: `${input.requestId}:study`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentStudyCommitted',
    payload,
  });
}
type CommandContext = {
  command: CommandEnvelope<'AgentStudy' | 'AgentStopStudy', unknown>;
  projection: WorldProjection;
  nextSequence: number;
};
export function handleElapsedStudy(input: CommandContext): WorldEvent[] {
  const w = input.projection,
    state = w.residentStudy,
    a = resolveCommandAgent(w, input.command);
  const reject = (reason: string) => rejectCommand(input, input.command.type, reason);
  if (!state) return reject('resident-study-not-enabled');
  let decision: ReturnType<typeof startElapsedStudy>;
  if (input.command.type === 'AgentStudy') {
    const parsed = parsePayload(() => assertAgentStudyPayload(input.command.payload));
    if (parsed.status === 'invalid') return reject(parsed.reason);
    const duration = parsed.payload.durationSeconds;
    if (
      !a.locationId ||
      !state.configuration.locationIds.includes(a.locationId) ||
      w.transitByAgent?.[a.agentId] ||
      !mayEnterWorldPremises(w, a.agentId, a.locationId)
    )
      return reject('actual-scenario-course-location-required');
    if (a.physiology.health <= 0) return reject('study-physical-unavailable');
    if (worldPremisesUseUntil(w, a.agentId, a.locationId, 'entry') < w.clock.now + duration * 1000)
      return reject('study-entry-window-exceeded');
    const quote = quoteResidentStudy(w, a.agentId, duration);
    if (!quote.accepted) return reject(quote.reason);
    decision = startElapsedStudy({
      state: state.process,
      actorId: a.agentId,
      id: `${input.command.id}:study`,
      locationId: a.locationId,
      at: w.clock.now,
      durationMs: duration * 1000,
      terms: quote.terms,
    });
  } else {
    const p = input.command.payload;
    if (
      !p ||
      typeof p !== 'object' ||
      Array.isArray(p) ||
      Object.keys(p).sort().join(',') !== 'expectedRevision,id' ||
      !('id' in p) ||
      typeof p.id !== 'string' ||
      !('expectedRevision' in p) ||
      typeof p.expectedRevision !== 'number'
    )
      return reject('invalid-study-interruption-payload');
    decision = stopElapsedStudy({
      state: state.process,
      id: p.id,
      expectedRevision: p.expectedRevision,
      at: w.clock.now,
      actorId: a.agentId,
    });
  }
  if (!decision.accepted) return reject(decision.reason);
  const event = decision.events[0]!;
  return [
    residentStudyCommit(
      {
        ...input,
        actorId: a.agentId,
        simulationId: input.command.simulationId,
        requestId: input.command.id,
      },
      event,
    ),
    makeMemoryEvent(input, 1, {
      summary:
        event.session.status === 'active'
          ? `Started actual study until ${event.session.until}; course source is scenario/external, not a resident teacher. Knowledge and tuition accrue only with elapsed time.`
          : `Personally stopped studying after ${event.session.elapsedMs / 1000} seconds; unused tuition returns to its original payer.`,
      status: 'succeeded',
      tags: ['actual-study'],
    }),
  ];
}
export function progressResidentStudyEvents(input: Context & { settledAt: number }): WorldEvent[] {
  const state = input.projection.residentStudy;
  if (!state) return [];
  // One actor per call keeps the application caller's evolving money/education snapshot explicit.
  const id = state.process.activeByActor[input.actorId];
  if (!id) return [];
  const decision = progressElapsedStudy(state.process, id, input.settledAt);
  if (!decision.accepted) throw Error(decision.reason);
  const events = decision.events.map((event, index) =>
    residentStudyCommit(
      {
        ...input,
        actorId: 'system',
        requestId: `${input.requestId}-${index}`,
        nextSequence: input.nextSequence + index,
      },
      event,
    ),
  );
  const after = events.reduce(applyWorldEvent, input.projection);
  const current = after.residentStudy!.process.sessions[id]!;
  const body = after.agents[current.actorId]!;
  const reason =
    body.physiology.health <= 0
      ? ('physical-unavailable' as const)
      : !mayEnterWorldPremises(after, current.actorId, current.locationId)
        ? ('permission-ended' as const)
        : undefined;
  if (current.status === 'active' && reason) {
    const stopped = stopElapsedStudy({
      state: after.residentStudy!.process,
      id,
      actorId: 'system',
      expectedRevision: current.revision,
      at: current.settledAt,
      reason,
    });
    if (!stopped.accepted) throw Error(stopped.reason);
    events.push(
      residentStudyCommit(
        {
          ...input,
          projection: after,
          actorId: 'system',
          requestId: `${input.requestId}-end`,
          nextSequence: input.nextSequence + events.length,
        },
        stopped.events[0]!,
      ),
    );
  }
  return events;
}

/** The retained initial school grants formal levels only at its declared cadence, after earned learning. */
export function residentStudyPromotionEvents(input: Context & { settledAt: number }): WorldEvent[] {
  const state = input.projection.residentStudy;
  if (!state || input.settledAt % state.configuration.source.formalPromotionCadenceMs !== 0)
    return [];
  const agent = input.projection.agents[input.actorId];
  if (!agent) return [];
  const policy = state.configuration.education;
  const level = agent.educationLevel ?? deriveEducationLevel(agent.educationScore, policy);
  const nextLevel = evaluateAutomaticPromotion({ level, score: agent.educationScore, policy });
  if (nextLevel === null) return [];
  return [
    createEventEnvelope({
      id: `${input.requestId}:formal-level`,
      simulationId: input.simulationId,
      sequence: input.nextSequence,
      occurredAt: input.settledAt,
      type: 'EducationLevelChanged',
      payload: {
        agentId: agent.agentId,
        previousLevel: level,
        nextLevel,
        reason: 'compulsory-automatic-promotion',
      },
    }),
  ];
}
