import {
  authorizeController,
  sameController,
  validController,
  validControllerId,
} from '@aivilization/authority';
import { residentServiceEffect } from '@aivilization/society';
import {
  engagementMaterialsAvailable,
  engagementMaterialInstructions,
} from './engagementMaterials';
import {
  cumulativeServiceCharge,
  engagementMoneyTransfer,
  serviceMoneyMicros,
} from './engagementMoney';
import { endServiceEngagement, settleServiceEngagement } from './engagementWork';
import {
  assertServiceEngagementPolicy,
  engagementAccepted as yes,
  engagementRejected as no,
  type ServiceEngagement,
  type EngagementMaterialRef,
  type ServiceEngagementsState,
  type ServiceEngagementCommand,
  type ServiceEngagementPorts,
  type ServiceEngagementDecision,
  type ServiceAccount,
} from './engagementModel';
const integer = (n: number, minimum = 0) => Number.isSafeInteger(n) && n >= minimum;
const accountValid = (a: ServiceAccount) =>
  ['agent', 'collective', 'enterprise'].includes(a.sector) && validControllerId(a.id);
export function decideServiceEngagement(
  s: ServiceEngagementsState,
  actorId: string,
  at: number,
  c: ServiceEngagementCommand,
  p: ServiceEngagementPorts,
): ServiceEngagementDecision {
  assertServiceEngagementPolicy(s.policy);
  if (!p.exists(actorId) || !integer(at) || !validControllerId(c.id) || c.id.length > 60)
    return no('invalid-service-actor-time-or-id');
  if (c.type === 'offer') {
    const { type: _type, ...terms } = c;
    void _type;
    const model = residentServiceEffect(c.modelId);
    if (
      !model ||
      s.engagements[c.id] ||
      !validController(c.controller) ||
      !p.controllerAvailable(c.controller) ||
      !p.exists(c.providerId) ||
      !p.exists(c.recipientId) ||
      c.providerId === c.recipientId ||
      !c.title.trim() ||
      c.title.length > 120 ||
      !c.terms.trim() ||
      c.terms.length > s.policy.maxTermsChars ||
      !integer(c.startAt) ||
      c.startAt < at ||
      !integer(c.endAt, c.startAt + 1) ||
      c.endAt > at + s.policy.maxWindowMs ||
      !integer(c.maxDurationMs, 1) ||
      c.maxDurationMs > s.policy.maxDurationMs ||
      c.maxDurationMs > c.endAt - c.startAt ||
      !integer(c.providerShareBps) ||
      c.providerShareBps > 10000 ||
      !Number.isFinite(c.pricePerHour) ||
      c.pricePerHour < 0 ||
      c.pricePerHour > s.policy.maxPricePerHour ||
      !(c.payer.sector === 'treasury'
        ? s.publicFunding && c.payer.id === s.publicFunding.treasuryId
        : accountValid(c.payer)) ||
      !accountValid(c.revenue) ||
      ((c.payer.sector === 'enterprise' || c.revenue.sector === 'enterprise') &&
        !p.enterpriseAccountingVersion) ||
      !Array.isArray(c.materials) ||
      c.materials.length > s.policy.maxMaterialRefs ||
      c.materials.some(
        (r: EngagementMaterialRef) => !r || !validControllerId(r.id) || !integer(r.revision, 1),
      )
    )
      return no('invalid-service-engagement-terms');
    try {
      serviceMoneyMicros(c.pricePerHour);
    } catch {
      return no('invalid-service-price-precision');
    }
    const auth = authorizeController(c.controller, actorId, p.authorize);
    if (!auth) return no('resource-controller-authority-required');
    const revenue = p.account(c.revenue),
      payer =
        c.payer.sector === 'treasury' ? p.publicFunding && { status: 'open' } : p.account(c.payer);
    if (
      !revenue ||
      revenue.status !== 'open' ||
      (c.revenue.sector !== 'enterprise' && !sameController(revenue.controller, c.controller)) ||
      !payer ||
      payer.status !== 'open'
    )
      return no('service-account-unavailable');
    if (!p.locationAvailable(c.locationId) || !p.mayOperate(actorId, c.locationId))
      return no('service-location-not-authorized');
    if (
      Object.keys(s.engagements).length >= s.policy.maxTotal ||
      Object.values(s.engagements).filter((e) => sameController(e.controller, c.controller))
        .length >= s.policy.maxPerController
    )
      return no('service-engagement-limit');
    if (!engagementMaterialsAvailable(c, p, at))
      return no('service-material-reservations-required');
    const engagement: ServiceEngagement = {
      ...terms,
      createdBy: actorId,
      createdAt: at,
      ...(auth.decisionId ? { decisionId: auth.decisionId } : {}),
      revision: 1,
      at,
      status: 'offered',
      maximumCharge: cumulativeServiceCharge(c.pricePerHour, c.maxDurationMs),
      escrow: 0,
      charged: 0,
      providerPaid: 0,
      revenuePaid: 0,
      refunded: 0,
      progressMs: 0,
      settledAt: at,
    };
    return yes([{ type: 'ServiceEngagementChanged', engagement }]);
  }
  const e = s.engagements[c.id];
  if (!e) return no('service-engagement-not-found');
  if (e.revision !== c.expectedRevision || e.revision >= Number.MAX_SAFE_INTEGER)
    return no('service-engagement-revision-conflict');
  if (at < e.at || e.status === 'ended') return no('service-engagement-ended-or-invalid-time');
  if (c.type === 'cancel') {
    if (
      ![e.providerId, e.recipientId].includes(actorId) &&
      !authorizeController(e.controller, actorId, p.authorize)
    )
      return no('service-cancel-not-authorized');
    return endServiceEngagement(s, e, at, 'cancelled', p);
  }
  if (at >= e.endAt) return no('service-engagement-expired');
  const changed = (patch: Partial<ServiceEngagement>) => ({
    ...e,
    ...patch,
    revision: e.revision + 1,
    at,
  });
  if (c.type === 'accept') {
    if (actorId !== e.recipientId) return no('service-recipient-consent-required');
    if (e.status !== 'offered') return no('service-engagement-not-offered');
    if (!engagementMaterialsAvailable(e, p, at))
      return no('service-material-reservations-required');
    const next = changed({ status: 'accepted', acceptedAt: at });
    return yes([{ type: 'ServiceEngagementChanged', engagement: next }], {
      materialInstructions: engagementMaterialInstructions(
        e,
        p,
        `engagement-${e.id}-${next.revision}`,
        {},
        false,
      ),
    });
  }
  if (c.type === 'fund') {
    if (e.status !== 'accepted') return no('service-engagement-not-accepted');
    const payer = e.payer.sector === 'treasury' ? undefined : p.account(e.payer),
      revenue = p.account(e.revenue);
    if (
      (e.payer.sector === 'treasury'
        ? !s.publicFunding || !p.publicFunding
        : !payer || payer.status !== 'open') ||
      !revenue ||
      revenue.status !== 'open'
    )
      return no('service-account-unavailable');
    const auth =
      e.payer.sector === 'treasury'
        ? p.publicFunding?.authorize(e, actorId)
        : payer && authorizeController(payer.controller, actorId, p.authorize);
    if (!auth) return no('service-payer-authority-required');
    const balance = e.payer.sector === 'treasury' ? p.publicFunding!.balance : payer!.balance;
    if (!Number.isFinite(balance) || balance < e.maximumCharge)
      return no('insufficient-service-funding');
    return yes(
      [
        {
          type: 'ServiceEngagementChanged',
          engagement: changed({
            status: 'funded',
            fundedBy: actorId,
            ...(auth.decisionId ? { fundingDecisionId: auth.decisionId } : {}),
            escrow: e.maximumCharge,
          }),
        },
      ],
      {
        transactions:
          e.maximumCharge > 0
            ? [engagementMoneyTransfer(`engagement-${e.id}-fund`, e.payer, e.maximumCharge, true)]
            : [],
      },
    );
  }
  if (e.status !== 'funded') return no('service-engagement-not-funded');
  if (![e.providerId, e.recipientId].includes(actorId))
    return no('personal-service-participation-required');
  if (c.type === 'leave') {
    if ((actorId === e.providerId ? e.providerPresence : e.recipientPresence)?.actorId !== actorId)
      return no('service-participation-not-started');
    return endServiceEngagement(s, e, at, 'participant-left', p);
  }
  if (c.type !== 'start') return no('unsupported-service-engagement-command');
  if (
    at < e.startAt ||
    !integer(c.until, at + 1) ||
    c.until > e.endAt ||
    c.until - at > s.policy.maxDurationMs
  )
    return no('invalid-service-participation-window');
  if (actorId === e.providerId ? e.providerPresence : e.recipientPresence)
    return no('service-participation-already-started');
  if (!p.presentAndIdle(actorId, e.locationId))
    return no('service-participant-not-present-and-idle');
  const condition = p.condition(actorId);
  if (!condition || condition.health <= 0) return no('service-participant-unavailable');
  if (
    !p.locationAvailable(e.locationId) ||
    !p.mayOperate(e.providerId, e.locationId) ||
    !p.facilityAvailable(e, at)
  )
    return no('service-facility-unavailable');
  const provider = p.condition(e.providerId),
    recipient = p.condition(e.recipientId);
  if (
    e.modelId === 'guided-study-v1' &&
    (!provider || !recipient || provider.educationScore <= recipient.educationScore)
  )
    return no('service-provider-knowledge-required');
  const presence = { actorId, startedAt: at, until: c.until };
  return yes(
    [
      {
        type: 'ServiceEngagementChanged',
        engagement: changed({
          ...(actorId === e.providerId
            ? { providerPresence: presence }
            : { recipientPresence: presence }),
          educationCeiling: e.educationCeiling ?? provider?.educationScore ?? 0,
          settledAt: at,
        }),
      },
    ],
    { reserve: presence },
  );
}
export function advanceServiceEngagement(
  s: ServiceEngagementsState,
  id: string,
  at: number,
  ports: ServiceEngagementPorts,
): ServiceEngagementDecision {
  const e = s.engagements[id];
  if (!e || e.status === 'ended') return yes([]);
  if (!integer(at) || at < e.at) return no('invalid-service-settlement-time');
  return settleServiceEngagement(s, e, at, ports);
}
export function nextServiceEngagementBoundary(
  s: ServiceEngagementsState,
  at: number,
): number | undefined {
  const times: number[] = [];
  for (const e of Object.values(s.engagements)) {
    if (e.status === 'ended') continue;
    times.push(e.endAt);
    for (const presence of [e.providerPresence, e.recipientPresence])
      if (presence) times.push(presence.until);
    if (e.providerPresence && e.recipientPresence)
      times.push(
        Math.min(e.settledAt + s.policy.cadenceMs, e.settledAt + e.maxDurationMs - e.progressMs),
      );
  }
  const future = times.filter((t) => t > at);
  return future.length ? Math.min(...future) : undefined;
}
