import { assertResidentDepartureActivitySource } from '../residentDepartureActivitySource';
import {
  applyElapsedStudyEvent,
  emptyElapsedStudyState,
  elapsedStudyEffects,
} from '@aivilization/society';
import { calculateCirculatingMoneyDelta } from '@aivilization/economy';
import { asAgentId } from '@aivilization/sim-core';
import { RESIDENT_ACTIVITY_PROGRESS_VERSION, type WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import { assertResidentStudyConfiguration } from '../residentStudy';
import { studyAccountingTransactions } from '../residentStudyAccounting';

/** All final monetary/education effects are in the event; verify their process proof before applying. */
export function applyResidentStudyProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type === 'ResidentStudyEnabled') {
    if (
      w.residentStudy ||
      e.occurredAt !== w.clock.now ||
      Object.values(w.activityTimeByAgent).some(
        (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
      )
    )
      throw Error('invalid-study-activation');
    assertResidentStudyConfiguration(w, e.payload);
    return {
      ...w,
      residentStudy: {
        configuration: structuredClone(e.payload),
        process: emptyElapsedStudyState(e.payload.policy),
      },
    };
  }
  if (e.type !== 'ResidentStudyCommitted') return undefined;
  const p = e.payload,
    state = w.residentStudy,
    s = p.event.session,
    a = w.agents[s.actorId];
  if (
    !state ||
    !a ||
    p.policyVersion !== state.process.policy.version ||
    s.settledAt > w.clock.now ||
    e.occurredAt > w.clock.now ||
    !e.id.endsWith(':study')
  )
    throw Error('invalid-study-world-event');
  if (s.endReason === 'population-departure' || p.departure) {
    if (
      !p.departure ||
      p.actorId !== 'system' ||
      s.status !== 'interrupted' ||
      s.endReason !== 'population-departure' ||
      s.settledAt !== w.clock.now
    )
      throw Error('departure-study-interruption-required');
    assertResidentDepartureActivitySource(w, p.departure, s.actorId, e.occurredAt);
  }
  const previous = state.process.sessions[s.id],
    fx = elapsedStudyEffects(state.process, p.event),
    process = applyElapsedStudyEvent(state.process, p.event),
    r = w.activityTimeByAgent[s.actorId];
  if (Object.keys(s.terms.allocation.inventoryNanoUnits).length)
    throw Error('material-study-course-not-integrated');
  if (!previous) {
    if (
      p.actorId !== s.actorId ||
      s.startedAt !== w.clock.now ||
      a.locationId !== s.locationId ||
      w.transitByAgent?.[s.actorId] ||
      !state.configuration.locationIds.includes(s.locationId) ||
      a.physiology.health <= 0 ||
      (r?.availableAt ?? 0) > w.clock.now
    )
      throw Error('study-start-world-facts-mismatch');
    // The write decision already fixed the quote. Replay verifies its source and escrow proof,
    // never reprices historical study from a current level, balance, employment or policy callback.
    const publicFunding = s.terms.allocation.treasuryMicros > 0;
    if (
      s.terms.modelVersion !== state.configuration.education.policyVersion ||
      s.terms.sourceId !== state.configuration.source.sourceId ||
      s.terms.sourceKind !== (publicFunding ? 'scenario-public-course' : 'external-course') ||
      s.terms.fundingAuthorityId !==
        (publicFunding
          ? `initial-study-grant:${state.configuration.education.policyVersion}`
          : `personal-study:${s.actorId}`)
    )
      throw Error('study-initial-funding-quote-mismatch');
  } else {
    if (
      !r ||
      r.commandType !== 'AgentStudy' ||
      r.policyVersion !== RESIDENT_ACTIVITY_PROGRESS_VERSION ||
      r.startedAt !== s.startedAt ||
      r.availableAt !== s.until ||
      a.locationId !== s.locationId ||
      w.transitByAgent?.[s.actorId]
    )
      throw Error('study-reservation-or-presence-mismatch');
    if (
      s.status === 'interrupted'
        ? s.endReason === 'participant-left'
          ? p.actorId !== s.actorId
          : p.actorId !== 'system'
        : p.actorId !== 'system'
    )
      throw Error('study-progress-authority-mismatch');
  }
  const expected = studyAccountingTransactions(
    state.process,
    p.event,
    e.id.slice(0, -':study'.length),
  );
  if (
    p.transactions.length !== expected.length ||
    p.transactions.some((t, i) => {
      const x = expected[i]!;
      return (
        t.transactionId !== x.transactionId ||
        t.reason !== x.reason ||
        t.entries.length !== x.entries.length ||
        t.entries.some(
          (entry, j) =>
            entry.amount !== x.entries[j]!.amount ||
            entry.account.accountId !== x.entries[j]!.account.accountId ||
            entry.account.sector !== x.entries[j]!.account.sector,
        )
      );
    })
  )
    throw Error('study-accounting-proof-mismatch');
  if (
    p.educationBefore !== a.educationScore ||
    p.educationAfter !== p.educationBefore + fx.applied.educationNanoPoints / 1e9 ||
    !Number.isFinite(p.educationAfter)
  )
    throw Error('study-education-proof-mismatch');
  const balance = a.balance - fx.reserve.residentMicros / 1e6 + fx.refund.residentMicros / 1e6;
  const treasury =
    (w.treasury ?? 0) - fx.reserve.treasuryMicros / 1e6 + fx.refund.treasuryMicros / 1e6;
  if (
    balance < 0 ||
    !Number.isFinite(balance) ||
    treasury < 0 ||
    !Number.isFinite(treasury) ||
    (w.treasury === undefined && (fx.reserve.treasuryMicros || fx.refund.treasuryMicros))
  )
    throw Error('study-insufficient-original-funding');
  const paidPublic = fx.applied.treasuryMicros / 1e6;
  const activityTimeByAgent = { ...w.activityTimeByAgent };
  if (fx.reserveTime)
    activityTimeByAgent[s.actorId] = {
      agentId: asAgentId(s.actorId),
      activity: 'education',
      commandType: 'AgentStudy',
      policyVersion: RESIDENT_ACTIVITY_PROGRESS_VERSION,
      settlementTiming: 'effects-during-activity',
      startedAt: s.startedAt,
      availableAt: s.until,
      durationSeconds: (s.until - s.startedAt) / 1000,
      committedAt: w.clock.now,
    };
  else if (fx.releaseTime)
    activityTimeByAgent[s.actorId] = {
      ...r!,
      availableAt: s.settledAt,
      durationSeconds: s.elapsedMs / 1000,
    };
  return {
    ...w,
    residentStudy: { ...state, process },
    activityTimeByAgent,
    agents: { ...w.agents, [s.actorId]: { ...a, balance, educationScore: p.educationAfter } },
    ...(w.treasury === undefined ? {} : { treasury }),
    moneySupply:
      w.moneySupply + p.transactions.reduce((sum, t) => sum + calculateCirculatingMoneyDelta(t), 0),
    ...(paidPublic > 0
      ? {
          publicBudget: {
            cumulativeSpendingByService: { ...w.publicBudget?.cumulativeSpendingByService },
            serviceBalances: {
              ...w.publicBudget?.serviceBalances,
              education: (w.publicBudget?.serviceBalances.education ?? 0) + paidPublic,
            },
            lastSettledAt: w.publicBudget?.lastSettledAt ?? s.settledAt,
          },
        }
      : {}),
  };
}
