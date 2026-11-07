import { validControllerId } from '@aivilization/authority';
import { serviceFactsEqual } from './engagementFacts';
import {
  cumulativeServiceCharge,
  cumulativeProviderPay,
  serviceMoneyMicros,
} from './engagementMoney';
import {
  emptyServiceEngagementsState,
  SERVICE_PUBLIC_FUNDING_POLICY,
  type ServiceEngagement,
  type ServiceEngagementEvent,
  type ServiceEngagementsState,
} from './engagementModel';
const immutable = (e: ServiceEngagement) =>
  JSON.stringify([
    e.id,
    e.controller,
    e.title,
    e.terms,
    e.locationId,
    e.providerId,
    e.recipientId,
    e.payer,
    e.revenue,
    e.providerShareBps,
    e.pricePerHour,
    e.modelId,
    e.maxDurationMs,
    e.startAt,
    e.endAt,
    e.materials,
    e.createdBy,
    e.createdAt,
    e.decisionId,
    e.maximumCharge,
  ]);
export function applyServiceEngagementEvent(
  s: ServiceEngagementsState | undefined,
  event: ServiceEngagementEvent,
): ServiceEngagementsState {
  if (event.type === 'ServiceEngagementsEnabled') {
    if (s) throw new Error('service-engagements-already-enabled');
    return emptyServiceEngagementsState(event.policy);
  }
  if (!s) throw new Error('service-engagements-not-enabled');
  if (event.type === 'ServicePublicFundingEnabled') {
    if (s.publicFunding || !serviceFactsEqual(event.policy, SERVICE_PUBLIC_FUNDING_POLICY))
      throw Error('invalid-service-public-funding-activation');
    return { ...s, publicFunding: { ...event.policy } };
  }
  if (event.type === 'ServiceEngagementSettled') {
    const f = event.settlement,
      e = s.engagements[f.engagementId];
    if (
      !e ||
      e.status !== 'funded' ||
      !e.providerPresence ||
      !e.recipientPresence ||
      !validControllerId(f.id) ||
      s.settlements[f.id] ||
      f.previousProgressMs !== e.progressMs ||
      !Number.isSafeInteger(f.progressMs) ||
      f.progressMs <= f.previousProgressMs ||
      f.progressMs > e.maxDurationMs ||
      f.until - f.from !== f.progressMs - f.previousProgressMs ||
      f.from < e.settledAt ||
      f.from < Math.max(e.providerPresence.startedAt, e.recipientPresence.startedAt) ||
      f.until > Math.min(f.at, e.endAt, e.providerPresence.until, e.recipientPresence.until) ||
      serviceMoneyMicros(f.charge) !==
        serviceMoneyMicros(f.providerPay) + serviceMoneyMicros(f.revenuePay)
    )
      throw new Error('invalid-service-settlement-event');
    return { ...s, settlements: { ...s.settlements, [f.id]: f } };
  }
  const e = event.engagement,
    old = s.engagements[e.id];
  if (
    (e.payer.sector === 'treasury' &&
      (!s.publicFunding || e.payer.id !== s.publicFunding.treasuryId)) ||
    !validControllerId(e.id) ||
    !Number.isSafeInteger(e.revision) ||
    e.revision !== (old?.revision ?? 0) + 1 ||
    !Number.isSafeInteger(e.at) ||
    e.at < (old?.at ?? 0) ||
    !Number.isSafeInteger(e.progressMs) ||
    e.progressMs < (old?.progressMs ?? 0) ||
    e.progressMs > e.maxDurationMs ||
    (old && (immutable(old) !== immutable(e) || old.status === 'ended')) ||
    (!old &&
      (e.status !== 'offered' ||
        e.progressMs !== 0 ||
        e.escrow !== 0 ||
        e.fundedBy !== undefined ||
        e.acceptedAt !== undefined)) ||
    (e.status === 'ended' &&
      (!e.endReason || e.providerPresence || e.recipientPresence || e.escrow !== 0)) ||
    e.maximumCharge !== cumulativeServiceCharge(e.pricePerHour, e.maxDurationMs) ||
    e.charged !== cumulativeServiceCharge(e.pricePerHour, e.progressMs) ||
    e.providerPaid !== cumulativeProviderPay(e.charged, e.providerShareBps) ||
    serviceMoneyMicros(e.providerPaid) + serviceMoneyMicros(e.revenuePaid) !==
      serviceMoneyMicros(e.charged) ||
    serviceMoneyMicros(e.escrow) +
      serviceMoneyMicros(e.charged) +
      serviceMoneyMicros(e.refunded) !==
      (e.fundedBy ? serviceMoneyMicros(e.maximumCharge) : 0)
  )
    throw new Error('invalid-service-engagement-event');
  if (old) {
    const allowed: Record<ServiceEngagement['status'], readonly ServiceEngagement['status'][]> = {
      offered: ['offered', 'accepted', 'ended'],
      accepted: ['accepted', 'funded', 'ended'],
      funded: ['funded', 'ended'],
      ended: [],
    };
    if (
      !allowed[old.status].includes(e.status) ||
      (old.acceptedAt !== undefined && e.acceptedAt !== old.acceptedAt) ||
      (old.fundedBy !== undefined && e.fundedBy !== old.fundedBy) ||
      (old.fundingDecisionId !== undefined && e.fundingDecisionId !== old.fundingDecisionId) ||
      (old.educationCeiling !== undefined && old.educationCeiling !== e.educationCeiling)
    )
      throw new Error('invalid-service-state-transition');
    if (
      e.progressMs > old.progressMs &&
      !Object.values(s.settlements).some(
        (f) =>
          f.engagementId === e.id &&
          f.previousProgressMs === old.progressMs &&
          f.progressMs === e.progressMs &&
          f.at === e.at,
      )
    )
      throw new Error('service-progress-without-settlement');
  }
  return { ...s, engagements: { ...s.engagements, [e.id]: e } };
}
