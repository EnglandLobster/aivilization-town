import {
  applyResidentLaborEvent,
  emptyResidentLaborState,
  earnedLaborWithholding,
  EARNED_LABOR_WITHHOLDING_VERSION,
} from '@aivilization/society';
import { applyEnterpriseDomainEvent } from '@aivilization/enterprise';
import { asAgentId } from '@aivilization/sim-core';
import type { WorldProjection } from '../projection';
import { RESIDENT_ACTIVITY_PROGRESS_VERSION, type WorldEvent } from '../events';
import { applyEarnedCompensationProof } from '../earnedCompensation';
import { assertResidentLaborConfiguration } from '../residentLabor';
import { applyEarnedWageEstatePayment } from '../earnedWageEstate';

export function applyResidentLaborProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type === 'ResidentLaborEnabled') {
    if (
      w.residentLabor ||
      e.occurredAt !== w.clock.now ||
      Object.values(w.activityTimeByAgent).some(
        (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
      )
    )
      throw Error('invalid-labor-activation');
    assertResidentLaborConfiguration(w, e.payload.configuration);
    const enterprises = { ...w.enterprises };
    const expectedIds = Object.values(enterprises)
      .filter((v) => v.status !== 'closed')
      .map((v) => v.enterpriseId)
      .sort();
    if (
      e.payload.enterprises.length !== expectedIds.length ||
      e.payload.enterprises.some(
        (v, i) =>
          v.enterpriseId !== expectedIds[i] || v.event.type !== 'EnterpriseEarnedPayrollEnabled',
      )
    )
      throw Error('labor-activation-enterprises-mismatch');
    for (const v of e.payload.enterprises)
      enterprises[v.enterpriseId] = applyEnterpriseDomainEvent(
        enterprises[v.enterpriseId],
        v.event,
      );
    return {
      ...w,
      enterprises,
      residentLabor: {
        configuration: structuredClone(e.payload.configuration),
        process: emptyResidentLaborState(e.payload.configuration.policy),
        termsBySession: {},
        withheldMicrosBySession: {},
      },
    };
  }
  if (e.type !== 'ResidentLaborCommitted') return undefined;
  const p = e.payload,
    state = w.residentLabor,
    initialEnterprise = w.enterprises[p.enterpriseId];
  if (
    !state ||
    !initialEnterprise ||
    p.policyVersion !== state.configuration.policy.version ||
    e.occurredAt > w.clock.now ||
    !p.payroll.length ||
    p.payroll.length > 3
  )
    throw Error('invalid-labor-world-event');
  const old = state.process.sessions[p.sessionId];
  const s = p.labor?.session ?? old;
  if (!s || s.id !== p.sessionId || s.enterpriseId !== p.enterpriseId || s.settledAt > w.clock.now)
    throw Error('labor-session-world-mismatch');
  const a = w.agents[s.actorId];
  if (!a) {
    if (
      !p.estatePayment ||
      !w.residentExits?.records[s.actorId] ||
      !old ||
      p.terms ||
      p.actorId !== 'system' ||
      e.occurredAt !== w.clock.now ||
      old.settledAt > w.residentExits.records[s.actorId]!.at ||
      (p.labor
        ? old.status !== 'active' ||
          s.status !== 'interrupted' ||
          s.endReason !== 'employment-ended' ||
          s.elapsedMs !== old.elapsedMs ||
          s.settledAt !== old.settledAt
        : old.status === 'active')
    )
      throw Error('labor-preserved-exit-source-required');
  } else if (p.estatePayment) throw Error('labor-living-estate-proof-forbidden');
  const process = p.labor ? applyResidentLaborEvent(state.process, p.labor) : state.process;
  const terms = p.terms ?? state.termsBySession[s.id];
  if (
    !terms ||
    terms.withholdingVersion !== EARNED_LABOR_WITHHOLDING_VERSION ||
    !terms.taxPolicyVersion ||
    !['recorded-employment-offer', 'initial-wage-regime'].includes(terms.wageSource)
  )
    throw Error('labor-compensation-source-missing');
  earnedLaborWithholding(terms, 0);
  const reservation = w.activityTimeByAgent[s.actorId];
  if (!old) {
    if (
      !p.labor ||
      !a ||
      !p.terms ||
      p.actorId !== s.actorId ||
      s.startedAt !== w.clock.now ||
      a.locationId !== s.locationId ||
      w.transitByAgent?.[s.actorId] ||
      a.job !== s.occupation ||
      !state.configuration.locationIds.includes(s.locationId) ||
      (reservation?.availableAt ?? 0) > w.clock.now ||
      s.energyCostPerHour !== state.configuration.effort.energyCostPerHour ||
      s.satietyCostPerHour !== state.configuration.effort.satietyCostPerHour
    )
      throw Error('labor-start-world-facts-mismatch');
  } else {
    if (p.terms) throw Error('labor-compensation-immutable');
    if (
      a &&
      p.labor &&
      (!reservation ||
        reservation.commandType !== 'AgentWork' ||
        reservation.startedAt !== s.startedAt ||
        reservation.availableAt !== s.until ||
        a.locationId !== s.locationId ||
        w.transitByAgent?.[s.actorId])
    )
      throw Error('labor-body-reservation-mismatch');
    if (
      a &&
      (p.labor
        ? s.status === 'interrupted' && s.endReason === 'participant-left'
          ? p.actorId !== s.actorId
          : p.actorId !== 'system'
        : p.actorId !== s.actorId)
    )
      throw Error('labor-effect-authority-mismatch');
  }
  const { enterprise, paidMicros, withheld, tax } = applyEarnedCompensationProof({
    enterprise: initialEnterprise,
    claimId: s.id,
    actorId: s.actorId,
    terms,
    previousWithheldMicros: state.withheldMicrosBySession[s.id] ?? 0,
    payload: p,
    transactionId: `${e.id}:pay`,
    ...(p.labor
      ? {
          work: {
            actorId: s.actorId,
            startedAt: s.startedAt,
            plannedMs: s.until - s.startedAt,
            settledAt: s.settledAt,
            elapsedMs: s.elapsedMs,
            ended: s.status !== 'active',
          },
        }
      : {}),
  });
  if (tax && w.treasury === undefined) throw Error('labor-tax-treasury-required');
  const residentExits = p.estatePayment
    ? applyEarnedWageEstatePayment(
        w,
        {
          actorId: s.actorId,
          enterpriseId: s.enterpriseId,
          claimId: s.id,
          claimRevision: enterprise.earnedPayroll!.claims[s.id]!.revision,
          transactionId: `${e.id}:pay`,
          paidMicros,
          tax,
        },
        p.estatePayment,
      )
    : undefined;
  const activityTimeByAgent = { ...w.activityTimeByAgent };
  if (!old)
    activityTimeByAgent[s.actorId] = {
      agentId: asAgentId(s.actorId),
      activity: 'labor',
      commandType: 'AgentWork',
      policyVersion: RESIDENT_ACTIVITY_PROGRESS_VERSION,
      settlementTiming: 'effects-during-activity',
      startedAt: s.startedAt,
      availableAt: s.until,
      durationSeconds: (s.until - s.startedAt) / 1000,
      committedAt: w.clock.now,
    };
  else if (a && p.labor && s.status !== 'active')
    activityTimeByAgent[s.actorId] = {
      ...reservation!,
      availableAt: s.settledAt,
      durationSeconds: s.elapsedMs / 1000,
    };
  return {
    ...w,
    enterprises: { ...w.enterprises, [p.enterpriseId]: enterprise },
    agents: a
      ? { ...w.agents, [s.actorId]: { ...a, balance: a.balance + (paidMicros - tax) / 1e6 } }
      : w.agents,
    ...(residentExits ? { residentExits } : {}),
    ...(tax ? { treasury: w.treasury! + tax / 1e6 } : {}),
    activityTimeByAgent,
    residentLabor: {
      ...state,
      process,
      termsBySession: { ...state.termsBySession, [s.id]: structuredClone(terms) },
      withheldMicrosBySession: { ...state.withheldMicrosBySession, [s.id]: withheld },
    },
  };
}
