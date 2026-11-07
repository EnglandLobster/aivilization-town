import { decideServiceAttendanceBody } from './serviceAttendance';
import { decideServiceElapsedBody, serviceElapsedEffect } from './elapsedBody';
import { affordableServiceDuration, applyResidentServiceEffect } from '@aivilization/society';
import type { Inventory } from '@aivilization/economy';
import {
  cumulativeProviderPay,
  cumulativeServiceCharge,
  engagementMoneyTransfer,
  serviceMoneyDifference,
} from './engagementMoney';
import { engagementMaterialInstructions } from './engagementMaterials';
import {
  engagementAccepted as yes,
  type ServiceEngagementsState,
  type ServiceEngagement,
  type ServiceEngagementPorts,
  type ServiceEngagementDecision,
  type ServiceEngagementEvent,
  type EngagementSettlement,
} from './engagementModel';
function settle(
  e: ServiceEngagement,
  at: number,
  p: ServiceEngagementPorts,
  requestedEnd?: ServiceEngagement['endReason'],
): ServiceEngagementDecision {
  const evidenceId = `engagement-${e.id}-${e.revision + 1}`;
  let reason = requestedEnd,
    progressMs = e.progressMs,
    consumed: Inventory = {},
    charged = e.charged,
    providerPaid = e.providerPaid,
    revenuePaid = e.revenuePaid;
  const events: ServiceEngagementEvent[] = [],
    transactions: Extract<ServiceEngagementDecision, { accepted: true }>['transactions'][number][] =
      [];
  const presences = [e.providerPresence, e.recipientPresence].filter((v) => v !== undefined);
  const provider = p.condition(e.providerId),
    recipient = p.condition(e.recipientId);
  const workFrom = Math.max(
      e.settledAt,
      e.providerPresence?.startedAt ?? e.settledAt,
      e.recipientPresence?.startedAt ?? e.settledAt,
    ),
    workUntil = Math.min(
      at,
      e.endAt,
      e.providerPresence?.until ?? at,
      e.recipientPresence?.until ?? at,
    );
  const unavailable =
    presences.some((v) => !p.present(v.actorId, e.locationId) || !p.sessionReserved(e.id, v)) ||
    (!!e.providerPresence && (!provider || provider.health <= 0)) ||
    (!!e.recipientPresence && (!recipient || recipient.health <= 0));
  const facilityUnavailable =
    presences.length > 0 &&
    (!p.locationAvailable(e.locationId) ||
      !(p.mayOperateDuring
        ? p.mayOperateDuring(e, workFrom, workUntil)
        : p.mayOperate(e.providerId, e.locationId)) ||
      !p.facilityAvailable(e, at));
  if (unavailable) reason ??= 'participant-unavailable';
  if (facilityUnavailable) reason ??= 'facility-unavailable';
  const elapsedBody =
    p.elapsedInterval && e.providerPresence && e.recipientPresence && provider && recipient
      ? decideServiceElapsedBody(
          e,
          p.elapsedInterval,
          provider,
          recipient,
          !unavailable && !facilityUnavailable,
        )
      : undefined;
  const elapsedAttendance =
    p.enterpriseAccountingVersion &&
    p.elapsedInterval &&
    e.providerPresence &&
    !e.recipientPresence &&
    provider
      ? decideServiceAttendanceBody(
          e,
          p.elapsedInterval,
          provider,
          !unavailable && !facilityUnavailable,
        )
      : undefined;
  if (elapsedAttendance?.exhausted) reason ??= 'physical-budget-exhausted';
  if (
    e.status === 'funded' &&
    e.providerPresence &&
    e.recipientPresence &&
    provider &&
    recipient &&
    !unavailable &&
    !facilityUnavailable
  ) {
    const from = Math.max(e.settledAt, e.providerPresence.startedAt, e.recipientPresence.startedAt),
      until = Math.min(at, e.endAt, e.providerPresence.until, e.recipientPresence.until),
      elapsedMs = Math.min(Math.max(0, until - from), e.maxDurationMs - e.progressMs),
      duration =
        elapsedBody?.workedMs ??
        affordableServiceDuration({
          modelId: e.modelId,
          progressMs: e.progressMs,
          elapsedMs,
          provider,
          recipient,
          educationCeiling: e.educationCeiling ?? 0,
        });
    progressMs += duration;
    if (duration > 0) {
      const effect = elapsedBody
        ? serviceElapsedEffect(e, elapsedBody)
        : applyResidentServiceEffect({
            modelId: e.modelId,
            previousProgressMs: e.progressMs,
            nextProgressMs: progressMs,
            provider,
            recipient,
            educationCeiling: e.educationCeiling ?? 0,
          });
      consumed = effect.consumed;
      charged = cumulativeServiceCharge(e.pricePerHour, progressMs);
      providerPaid = cumulativeProviderPay(charged, e.providerShareBps);
      revenuePaid = serviceMoneyDifference(charged, providerPaid);
      const charge = serviceMoneyDifference(charged, e.charged),
        providerPay = serviceMoneyDifference(providerPaid, e.providerPaid),
        revenuePay = serviceMoneyDifference(revenuePaid, e.revenuePaid);
      const settlement: EngagementSettlement = {
        id: evidenceId,
        engagementId: e.id,
        at,
        from,
        until: from + duration,
        previousProgressMs: e.progressMs,
        progressMs,
        ...(elapsedBody ? { elapsedBody } : {}),
        providerBefore: provider,
        providerAfter: effect.provider,
        recipientBefore: recipient,
        recipientAfter: effect.recipient,
        consumed,
        charge,
        providerPay,
        revenuePay,
      };
      events.push({ type: 'ServiceEngagementSettled', settlement });
      if (providerPay > 0)
        transactions.push(
          engagementMoneyTransfer(
            `${evidenceId}-provider`,
            { sector: 'agent', id: e.providerId },
            providerPay,
            false,
          ),
        );
      if (revenuePay > 0)
        transactions.push(
          engagementMoneyTransfer(`${evidenceId}-revenue`, e.revenue, revenuePay, false),
        );
    }
    if (duration < elapsedMs || elapsedBody?.exhausted) reason ??= 'physical-budget-exhausted';
    if (progressMs === e.maxDurationMs) reason ??= 'completed';
  }
  if (at >= e.endAt) reason ??= 'expired';
  if (presences.some((v) => at >= v.until)) reason ??= 'participant-time-ended';
  if (progressMs === e.progressMs && !reason && !elapsedAttendance) return yes([]);
  const charge = serviceMoneyDifference(charged, e.charged),
    remaining = serviceMoneyDifference(e.escrow, charge);
  if (remaining < 0) throw new Error('service-escrow-underflow');
  if (reason && remaining > 0)
    transactions.push(engagementMoneyTransfer(`${evidenceId}-refund`, e.payer, remaining, false));
  const { providerPresence: _provider, recipientPresence: _recipient, ...withoutPresence } = e;
  void _provider;
  void _recipient;
  const next: ServiceEngagement = {
    ...(reason ? withoutPresence : e),
    revision: e.revision + 1,
    at,
    progressMs,
    settledAt: at,
    charged,
    providerPaid,
    revenuePaid,
    escrow: reason ? 0 : remaining,
    refunded: reason ? e.refunded + remaining : e.refunded,
    ...(reason ? { status: 'ended', endReason: reason } : {}),
  };
  events.push({ type: 'ServiceEngagementChanged', engagement: next });
  return yes(events, {
    ...(elapsedBody ? { elapsedBody } : {}),
    ...(elapsedAttendance ? { elapsedAttendance } : {}),
    transactions,
    materialInstructions:
      e.status !== 'offered' && (reason || progressMs > e.progressMs)
        ? engagementMaterialInstructions(e, p, evidenceId, consumed, !!reason)
        : [],
    releases: reason ? presences : [],
  });
}
export function settleServiceEngagement(
  _s: ServiceEngagementsState,
  e: ServiceEngagement,
  at: number,
  p: ServiceEngagementPorts,
) {
  return settle(e, at, p);
}
export function endServiceEngagement(
  _s: ServiceEngagementsState,
  e: ServiceEngagement,
  at: number,
  reason: NonNullable<ServiceEngagement['endReason']>,
  p: ServiceEngagementPorts,
) {
  return settle(e, at, p, reason);
}
