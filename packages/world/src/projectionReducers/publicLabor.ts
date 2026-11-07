import {
  emptyPublicLaborState,
  applyPublicLaborEvent,
  publicLaborEffects,
  publicLaborBody,
  calculateLaborPay,
} from '@aivilization/society';
import { asAgentId } from '@aivilization/sim-core';
import { assertMoneySupplyDelta } from '@aivilization/economy';
import type { WorldProjection } from '../projection';
import { RESIDENT_ACTIVITY_PROGRESS_VERSION, type WorldEvent } from '../events';
import {
  assertPublicLaborConfiguration,
  hasPrivateEmployment,
  publicLaborAvailability,
} from '../publicLabor';
import { mayEnterWorldPremises, worldPremisesUseUntil } from '../premisesAccess';
import { publicLaborTransactions } from '../publicLaborAccounting';

export function applyPublicLaborProjection(
  w: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  if (event.type === 'PublicLaborEnabled') {
    if (
      w.publicLabor ||
      event.occurredAt !== w.clock.now ||
      Object.values(w.activityTimeByAgent).some(
        (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
      )
    )
      throw Error('invalid-public-labor-activation');
    assertPublicLaborConfiguration(w, event.payload);
    return {
      ...w,
      publicLabor: {
        configuration: structuredClone(event.payload),
        process: emptyPublicLaborState(),
      },
    };
  }
  if (event.type !== 'PublicLaborCommitted') return undefined;
  const p = event.payload,
    state = w.publicLabor,
    first = p.events[0]?.session,
    last = p.events.at(-1)?.session;
  if (
    !state ||
    !first ||
    !last ||
    p.events.length > 2 ||
    p.events.some((e) => e.session.id !== first.id) ||
    p.policyVersion !== state.process.policy.version ||
    event.occurredAt > w.clock.now ||
    w.treasury === undefined
  )
    throw Error('invalid-public-labor-commit');
  const a = w.agents[first.actorId],
    old = state.process.sessions[first.id],
    c = state.configuration,
    reservation = w.activityTimeByAgent[first.actorId];
  const departedRefund =
    !a &&
    !!old &&
    p.actorId === 'system' &&
    !p.body &&
    p.events.length === 1 &&
    last.status === 'interrupted' &&
    last.endReason === 'employment-ended' &&
    last.settledAt === old.settledAt &&
    last.earnedMicros === old.earnedMicros;
  if ((!a && !departedRefund) || (p.actorId !== first.actorId && p.actorId !== 'system'))
    throw Error('public-labor-actor-required');
  if (!old) {
    if (
      !a ||
      p.body ||
      p.events.length !== 1 ||
      p.actorId !== a.agentId ||
      first.startedAt !== w.clock.now ||
      event.occurredAt !== w.clock.now ||
      a.job !== first.terms.occupation ||
      hasPrivateEmployment(w, a.agentId) ||
      !Object.hasOwn(c.occupationWages, first.terms.occupation) ||
      a.locationId !== first.locationId ||
      w.transitByAgent?.[a.agentId] ||
      !c.locationIds.includes(first.locationId) ||
      !mayEnterWorldPremises(w, first.actorId, first.locationId) ||
      worldPremisesUseUntil(w, first.actorId, first.locationId, 'entry') < first.until ||
      (reservation?.availableAt ?? 0) > w.clock.now ||
      a.physiology.energy <= c.body.critical.energy ||
      a.physiology.health <= c.body.critical.health ||
      first.terms.sourceId !== c.sourceId ||
      first.terms.quotedWage !== c.occupationWages[first.terms.occupation] ||
      first.terms.referenceSeconds !== c.pay.referenceSeconds ||
      first.terms.energyCostPerHour !== c.effort.energyCostPerHour ||
      first.terms.satietyCostPerHour !== c.effort.satietyCostPerHour ||
      first.terms.grossMicros !==
        Math.round(
          calculateLaborPay(first.terms.quotedWage, (first.until - first.startedAt) / 1000, c.pay) *
            1e6,
        )
    )
      throw Error('public-labor-start-source-mismatch');
  } else {
    if (
      !departedRefund &&
      (!reservation ||
        reservation.commandType !== 'AgentWork' ||
        reservation.policyVersion !== RESIDENT_ACTIVITY_PROGRESS_VERSION ||
        reservation.startedAt !== old.startedAt ||
        reservation.availableAt !== old.until)
    )
      throw Error('public-labor-time-reservation-mismatch');
    if (p.body) {
      if (
        !a ||
        p.actorId !== 'system' ||
        p.body.until !== event.occurredAt ||
        p.body.from !== old.settledAt ||
        p.body.sessionId !== old.id
      )
        throw Error('public-labor-body-source-mismatch');
      const unavailable = publicLaborAvailability(w, old.id, p.body.until);
      const expected = publicLaborBody({
        session: old,
        policy: c.body,
        previous: a.physiology,
        from: p.body.from,
        until: p.body.until,
        available: !unavailable,
      });
      if (
        p.body.policyVersion !== expected.policyVersion ||
        p.body.workedMs !== expected.workedMs ||
        p.body.physicallyEnded !== expected.physicallyEnded ||
        (['energy', 'satiety', 'health'] as const).some(
          (k) => p.body!.before[k] !== expected.before[k] || p.body!.after[k] !== expected.after[k],
        ) ||
        last.elapsedMs !== old.elapsedMs + expected.workedMs ||
        last.settledAt !== expected.from + expected.workedMs ||
        (last.settledAt === old.until
          ? last.status !== 'completed'
          : unavailable || expected.physicallyEnded
            ? last.status !== 'interrupted' ||
              last.endReason !== (unavailable ?? 'physical-unavailable')
            : last.status !== 'active')
      )
        throw Error('public-labor-body-proof-mismatch');
    } else if (
      p.events.length !== 1 ||
      last.status !== 'interrupted' ||
      last.settledAt !== old.settledAt ||
      event.occurredAt !== old.settledAt ||
      (last.endReason === 'participant-left'
        ? p.actorId !== a?.agentId
        : p.actorId !== 'system' ||
          last.endReason !== publicLaborAvailability(w, old.id, event.occurredAt))
    )
      throw Error('public-labor-stop-source-mismatch');
  }
  const expectedTransactions = publicLaborTransactions(state.process, p.events, event.id);
  if (
    p.transactions.length !== expectedTransactions.length ||
    p.transactions.some((t, i) => {
      const x = expectedTransactions[i]!;
      return (
        t.transactionId !== x.transactionId ||
        t.reason !== x.reason ||
        t.entries.length !== x.entries.length ||
        t.entries.some(
          (entry, j) =>
            entry.amount !== x.entries[j]!.amount ||
            entry.account.sector !== x.entries[j]!.account.sector ||
            entry.account.accountId !== x.entries[j]!.account.accountId,
        )
      );
    })
  )
    throw Error('public-labor-accounting-proof-mismatch');
  for (const t of p.transactions) assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
  let process = state.process,
    balance = a?.balance ?? 0,
    treasury = w.treasury;
  for (const e of p.events) {
    const fx = publicLaborEffects(process, e);
    if (fx.reservedMicros > Math.floor(treasury * 1e6))
      throw Error('public-labor-original-funding-required');
    treasury += (fx.withheldMicros + fx.refundedMicros - fx.reservedMicros) / 1e6;
    balance += (fx.paidMicros - fx.withheldMicros) / 1e6;
    process = applyPublicLaborEvent(process, e);
  }
  if (![treasury, balance].every((n) => Number.isFinite(n) && n >= 0))
    throw Error('invalid-public-labor-money-state');
  const activityTimeByAgent = { ...w.activityTimeByAgent };
  if (!old && a)
    activityTimeByAgent[a.agentId] = {
      agentId: asAgentId(a.agentId),
      activity: 'labor',
      commandType: 'AgentWork',
      policyVersion: RESIDENT_ACTIVITY_PROGRESS_VERSION,
      settlementTiming: 'effects-during-activity',
      startedAt: first.startedAt,
      availableAt: first.until,
      durationSeconds: (first.until - first.startedAt) / 1000,
      committedAt: w.clock.now,
    };
  else if (a && last.status !== 'active')
    activityTimeByAgent[a.agentId] = {
      ...reservation!,
      availableAt: last.settledAt,
      durationSeconds: (last.settledAt - last.startedAt) / 1000,
    };
  return {
    ...w,
    treasury,
    agents: a
      ? {
          ...w.agents,
          [a.agentId]: { ...a, balance, ...(p.body ? { physiology: { ...p.body.after } } : {}) },
        }
      : w.agents,
    activityTimeByAgent,
    publicLabor: { ...state, process },
  };
}
