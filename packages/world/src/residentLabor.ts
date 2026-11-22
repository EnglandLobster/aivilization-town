import { quoteWorldLaborCompensation } from './laborCompensationSource';
import {
  RESIDENT_LABOR_POLICY,
  assertResidentLaborPolicy,
  startResidentLabor,
  progressResidentLabor,
  stopResidentLabor,
  advanceElapsedLaborPhysiology,
  calculateLaborPay,
  type ResidentLaborEvent,
} from '@aivilization/society';
import { decideEnableEarnedPayroll, isEnterpriseOperational } from '@aivilization/enterprise';
import { createEventEnvelope, type CommandEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { WorldCommandPolicies } from './agentActions';
import { assertAgentWorkPayload } from './commands';
import { assertResidentRestTimeCompatibility } from './residentRestTime';
import { mayEnterWorldPremises, worldPremisesUseUntil, premisesAtLocation } from './premisesAccess';
import {
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
  makeMemoryEvent,
} from './handlers/shared';
import { decideEarnedCompensation, applyEarnedCompensationProof } from './earnedCompensation';
import { prepareEarnedWageEstatePayment } from './earnedWageEstate';
import { claimProductiveWageEvent } from './productiveWages';
import { stopUnavailableProductiveWork } from './productiveEmploymentLifecycle';
import type { ResidentLaborConfiguration, ResidentLaborTerms } from './residentLaborModel';

type Context = {
  readonly projection: WorldProjection;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
  readonly actorId: string;
};
export function assertResidentLaborConfiguration(
  w: WorldProjection,
  c: ResidentLaborConfiguration,
) {
  assertResidentLaborPolicy(c.policy);
  calculateLaborPay(1, 1, c.pay);
  if (
    !w.residentRest ||
    ![...Object.values(c.effort), ...Object.values(c.critical)].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    !c.locationIds.length ||
    new Set(c.locationIds).size !== c.locationIds.length ||
    c.locationIds.some(
      (id) => !w.locations[id]?.activityAffinities.includes('work') || premisesAtLocation(w, id),
    )
  )
    throw Error('invalid-resident-labor-configuration');
}
export function enableResidentLaborEvent(
  input: Omit<Context, 'actorId'> & {
    readonly policies: WorldCommandPolicies;
  },
): WorldEvent {
  const w = input.projection,
    p = input.policies;
  assertResidentRestTimeCompatibility(p);
  if (
    w.residentLabor ||
    !p.laborPay ||
    Object.values(w.activityTimeByAgent).some(
      (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
    )
  )
    throw Error('labor-activation-requires-period-pay-and-no-prepaid-activity');
  const configuration: ResidentLaborConfiguration = {
    policy: RESIDENT_LABOR_POLICY,
    pay: { ...p.laborPay },
    effort: { ...p.laborCost },
    critical: { ...p.criticalThresholds },
    locationIds: Object.values(w.locations)
      .filter((l) => l.activityAffinities.includes('work') && !premisesAtLocation(w, l.locationId))
      .map((l) => String(l.locationId))
      .sort(),
  };
  assertResidentLaborConfiguration(w, configuration);
  const enterprises = Object.values(w.enterprises)
    .filter((e) => e.status !== 'closed')
    .sort((a, b) =>
      a.enterpriseId < b.enterpriseId ? -1 : a.enterpriseId > b.enterpriseId ? 1 : 0,
    )
    .map((e) => {
      const d = decideEnableEarnedPayroll(e);
      if (!d.accepted) throw Error(d.reason);
      return { enterpriseId: e.enterpriseId, event: d.event };
    });
  return createEventEnvelope({
    id: `${input.requestId}:labor-enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentLaborEnabled',
    payload: { configuration, enterprises },
  });
}

/** One atomic world fact contains the body process, enterprise obligation and balanced payment. */
export function residentLaborCommit(
  input: Context & {
    readonly sessionId: string;
    readonly labor?: ResidentLaborEvent;
    readonly terms?: ResidentLaborTerms;
    readonly pay: boolean;
  },
): WorldEvent {
  const w = input.projection,
    state = w.residentLabor;
  if (!state) throw Error('resident-labor-not-enabled');
  const session = input.labor?.session ?? state.process.sessions[input.sessionId];
  if (!session) throw Error('resident-labor-not-found');
  const enterprise = w.enterprises[session.enterpriseId];
  if (!enterprise) throw Error('labor-enterprise-missing');
  const terms = input.terms ?? state.termsBySession[session.id];
  if (!terms) throw Error('labor-compensation-missing');
  const id = `${input.requestId}:labor`;
  const compensation = decideEarnedCompensation({
    enterprise,
    claimId: session.id,
    terms,
    previouslyWithheldMicros: state.withheldMicrosBySession[session.id] ?? 0,
    pay: input.pay,
    transactionId: `${id}:pay`,
    ...(input.labor
      ? {
          work: {
            actorId: session.actorId,
            startedAt: session.startedAt,
            plannedMs: session.until - session.startedAt,
            settledAt: session.settledAt,
            elapsedMs: session.elapsedMs,
            ended: session.status !== 'active',
          },
        }
      : {}),
  });
  const departed = !w.agents[session.actorId];
  const verified = departed
    ? applyEarnedCompensationProof({
        enterprise,
        claimId: session.id,
        actorId: session.actorId,
        terms,
        previousWithheldMicros: state.withheldMicrosBySession[session.id] ?? 0,
        payload: compensation,
        transactionId: `${id}:pay`,
        ...(input.labor
          ? {
              work: {
                actorId: session.actorId,
                startedAt: session.startedAt,
                plannedMs: session.until - session.startedAt,
                settledAt: session.settledAt,
                elapsedMs: session.elapsedMs,
                ended: session.status !== 'active',
              },
            }
          : {}),
      })
    : undefined;
  const estatePayment = verified
    ? prepareEarnedWageEstatePayment(w, {
        actorId: session.actorId,
        enterpriseId: session.enterpriseId,
        claimId: session.id,
        claimRevision: verified.enterprise.earnedPayroll!.claims[session.id]!.revision,
        transactionId: `${id}:pay`,
        paidMicros: verified.paidMicros,
        tax: verified.tax,
      })
    : undefined;
  return createEventEnvelope({
    id,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: !departed && input.labor ? session.settledAt : w.clock.now,
    type: 'ResidentLaborCommitted',
    payload: {
      policyVersion: state.configuration.policy.version,
      actorId: input.actorId,
      enterpriseId: session.enterpriseId,
      sessionId: session.id,
      ...(input.labor ? { labor: input.labor } : {}),
      ...(input.terms ? { terms: input.terms } : {}),
      ...compensation,
      ...(estatePayment ? { estatePayment } : {}),
    },
  });
}

/** True for private employment in the explicit mode; omitted employer cannot bypass into public wages. */
export function usesResidentLabor(w: WorldProjection, actorId: string, payload: unknown): boolean {
  return (
    !!w.residentLabor &&
    (!!(payload && typeof payload === 'object' && 'enterpriseId' in payload) ||
      Object.values(w.enterprises).some((e) => e.employeeAgentIds.some((id) => id === actorId)))
  );
}
export function handleResidentLabor(input: {
  readonly projection: WorldProjection;
  readonly command: CommandEnvelope<'AgentWork' | 'AgentStopWork' | 'AgentClaimWage', unknown>;
  readonly policies: WorldCommandPolicies;
  readonly nextSequence: number;
}): WorldEvent[] {
  const w = input.projection,
    state = w.residentLabor;
  const reject = (reason: string) => rejectCommand(input, input.command.type, reason);
  if (!state) return reject('resident-labor-not-enabled');
  const actor = resolveCommandAgent(w, input.command);
  const context: Context = {
    projection: w,
    actorId: actor.agentId,
    simulationId: input.command.simulationId,
    requestId: input.command.id,
    nextSequence: input.nextSequence,
  };
  const decision = parsePayload(() => {
    if (input.command.type === 'AgentWork') {
      const p = assertAgentWorkPayload(input.command.payload);
      const memberships = Object.values(w.enterprises).filter((e) =>
        e.employeeAgentIds.includes(actor.agentId),
      );
      const enterprise = p.enterpriseId
        ? w.enterprises[p.enterpriseId]
        : memberships.length === 1
          ? memberships[0]
          : undefined;
      if (
        !enterprise ||
        !isEnterpriseOperational(enterprise) ||
        !enterprise.employeeAgentIds.includes(actor.agentId) ||
        enterprise.occupationName !== p.occupationName ||
        actor.job !== p.occupationName
      )
        throw Error('current-operational-employment-required');
      if (
        !actor.locationId ||
        !state.configuration.locationIds.includes(actor.locationId) ||
        w.transitByAgent?.[actor.agentId] ||
        !mayEnterWorldPremises(w, actor.agentId, actor.locationId)
      )
        throw Error('actual-initial-workplace-required');
      if (
        worldPremisesUseUntil(w, actor.agentId, actor.locationId, 'entry') <
        w.clock.now + p.laborSeconds * 1000
      )
        throw Error('labor-entry-window-exceeded');
      const physical = advanceElapsedLaborPhysiology({
        previous: actor.physiology,
        elapsedMs: p.laborSeconds * 1000,
        decay: input.policies.calendar?.physiologicalDecay ?? {
          energyPerHour: 0,
          satietyPerHour: 0,
        },
        labor: state.configuration.effort,
        ...(input.policies.sleepDeprivation
          ? { deprivation: input.policies.sleepDeprivation }
          : {}),
      });
      const critical = state.configuration.critical;
      if (
        actor.physiology.energy <= critical.energy ||
        actor.physiology.health <= critical.health ||
        physical.next.energy <= critical.energy ||
        physical.next.health <= critical.health
      )
        throw Error('insufficient-labor-effort-budget');
      const offer = enterprise.employeeWageOffers?.[actor.agentId];
      const terms = quoteWorldLaborCompensation({
        configuration: state.configuration,
        durationMs: p.laborSeconds * 1000,
        quotedWage: offer ?? input.policies.wageCalculator(p.occupationName),
        wageSource: offer === undefined ? 'initial-wage-regime' : 'recorded-employment-offer',
        ...(input.policies.tax ? { tax: input.policies.tax } : {}),
      });
      if (terms.taxMicros && w.treasury === undefined) throw Error('labor-tax-treasury-required');
      const started = startResidentLabor({
        state: state.process,
        id: `${input.command.id}:labor`,
        actorId: actor.agentId,
        enterpriseId: enterprise.enterpriseId,
        locationId: actor.locationId,
        occupation: p.occupationName,
        at: w.clock.now,
        durationMs: p.laborSeconds * 1000,
        ...state.configuration.effort,
      });
      if (!started.accepted) throw Error(started.reason);
      const labor = started.events[0]!;
      return residentLaborCommit({
        ...context,
        sessionId: labor.session.id,
        labor,
        terms,
        pay: false,
      });
    }
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
      throw Error('invalid-labor-operation-payload');
    if (input.command.type === 'AgentClaimWage' && w.productiveEmployment?.claims[p.id])
      return claimProductiveWageEvent({
        ...context,
        id: p.id,
        expectedRevision: p.expectedRevision,
      });
    const session = state.process.sessions[p.id];
    if (!session || session.actorId !== actor.agentId) throw Error('own-labor-required');
    if (input.command.type === 'AgentClaimWage') {
      const claim = w.enterprises[session.enterpriseId]?.earnedPayroll?.claims[session.id];
      if (!claim || claim.revision !== p.expectedRevision)
        throw Error('earned-wage-revision-conflict');
      return residentLaborCommit({ ...context, sessionId: p.id, pay: true });
    }
    const stopped = stopResidentLabor({
      state: state.process,
      actorId: actor.agentId,
      id: p.id,
      expectedRevision: p.expectedRevision,
      at: w.clock.now,
    });
    if (!stopped.accepted) throw Error(stopped.reason);
    return residentLaborCommit({
      ...context,
      sessionId: p.id,
      labor: stopped.events[0]!,
      pay: true,
    });
  });
  if (decision.status === 'invalid') return reject(decision.reason);
  return [
    decision.payload,
    makeMemoryEvent(input, 1, {
      summary:
        input.command.type === 'AgentWork'
          ? 'Started actual enterprise labor. No future wage or output was granted; earned wages, payment and unpaid claims can be queried.'
          : input.command.type === 'AgentStopWork'
            ? 'Personally stopped future enterprise labor; earned obligations remain.'
            : 'Received an actual payment against my own earned wage claim.',
      status: 'succeeded',
      tags: ['actual-enterprise-labor'],
    }),
  ];
}

/** Reconcile discrete employment/body facts at their boundary without deleting earned credit. */
export function stopUnavailableResidentLabor(
  input: Omit<Context, 'actorId'> & { readonly onlyActorId?: string },
): WorldEvent[] {
  let w = input.projection;
  const events: WorldEvent[] = [];
  for (const actorId of Object.keys(w.residentLabor?.process.activeByActor ?? {}).sort()) {
    if (input.onlyActorId !== undefined && actorId !== input.onlyActorId) continue;
    const state = w.residentLabor!;
    const s = state.process.sessions[state.process.activeByActor[actorId]!]!;
    const actor = w.agents[actorId],
      enterprise = w.enterprises[s.enterpriseId];
    const reason =
      !actor ||
      !enterprise ||
      !isEnterpriseOperational(enterprise) ||
      !enterprise.employeeAgentIds.some((id) => id === actorId) ||
      actor.job !== s.occupation
        ? ('employment-ended' as const)
        : actor.physiology.energy <= state.configuration.critical.energy ||
            actor.physiology.health <= state.configuration.critical.health
          ? ('physical-unavailable' as const)
          : undefined;
    if (!reason) continue;
    const stopped = stopResidentLabor({
      state: state.process,
      actorId: 'system',
      id: s.id,
      expectedRevision: s.revision,
      at: s.settledAt,
      reason,
    });
    if (!stopped.accepted) throw Error(stopped.reason);
    const event = residentLaborCommit({
      ...input,
      projection: w,
      actorId: 'system',
      requestId: `${input.requestId}:stop:${actorId}`,
      nextSequence: input.nextSequence + events.length,
      sessionId: s.id,
      labor: stopped.events[0]!,
      pay: true,
    });
    events.push(event);
    w = applyWorldEvent(w, event);
  }
  return events;
}

export function withEndedEmploymentLabor(
  input: {
    readonly command: CommandEnvelope;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  events: WorldEvent[],
): WorldEvent[] {
  if (
    !input.projection.residentLabor ||
    !events.some(
      (e) => e.type === 'EnterpriseEmployeeLeft' || e.type === 'EnterpriseEmployeeLaidOff',
    )
  )
    return events;
  const projection = events.reduce(applyWorldEvent, input.projection);
  const stopped = [
    ...events,
    ...stopUnavailableResidentLabor({
      projection,
      simulationId: input.command.simulationId,
      requestId: input.command.id,
      nextSequence: input.nextSequence + events.length,
    }),
  ];
  return [
    ...stopped,
    ...stopUnavailableProductiveWork({
      projection: stopped.reduce(applyWorldEvent, input.projection),
      at: projection.clock.now,
      simulationId: input.command.simulationId,
      nextSequence: input.nextSequence + stopped.length,
    }),
  ];
}

export function progressResidentLaborEvents(
  input: Context & { readonly settledAt: number },
): WorldEvent[] {
  const state = input.projection.residentLabor;
  const id = state?.process.activeByActor[input.actorId];
  if (!state || !id) return [];
  const d = progressResidentLabor(state.process, id, input.settledAt);
  if (!d.accepted) throw Error(d.reason);
  return d.events.map((labor, i) =>
    residentLaborCommit({
      ...input,
      actorId: 'system',
      requestId: `${input.requestId}-${i}`,
      nextSequence: input.nextSequence + i,
      sessionId: id,
      labor,
      pay:
        labor.session.status !== 'active' ||
        input.settledAt % state.configuration.policy.cadenceMs === 0,
    }),
  );
}
