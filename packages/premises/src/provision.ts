import { validControllerId } from '@aivilization/authority';
import type { PremisesBuilding } from './model';
import type { PremisesPermit, PremisesRightsState } from './rightsModel';
import {
  PREMISES_PROVISION_POLICY,
  type PremisesAvailabilityEvidence,
  type PremisesProvisionEvent,
  type PremisesProvisionDecision,
} from './provisionModel';
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const no = (reason: string): PremisesProvisionDecision => ({ accepted: false, reason });
const yes = (...events: PremisesProvisionEvent[]): PremisesProvisionDecision => ({
  accepted: true,
  events,
});
export function premisesAvailabilityEvidence(b: PremisesBuilding): PremisesAvailabilityEvidence {
  return {
    buildingId: b.id,
    buildingRevision: b.revision,
    buildingAt: b.at,
    condition: b.condition,
    status: b.status,
  };
}
export const premisesProvisionEnd = (p: PremisesPermit) =>
  Math.min(p.endAt, p.closed?.at ?? p.endAt);
export function premisesProvisionDuration(p: PremisesPermit, through: number) {
  return p.accepted
    ? Math.max(0, Math.min(through, premisesProvisionEnd(p)) - Math.max(p.startAt, p.accepted.at))
    : 0;
}
export function startPremisesProvision(
  s: PremisesRightsState,
  permitId: string,
  orderId: string,
  actorId: string,
  at: number,
): PremisesProvisionDecision {
  const p = s.permits[permitId];
  if (
    !p?.accepted ||
    p.status !== 'accepted' ||
    p.accepted.actorId !== actorId ||
    p.accepted.at !== at ||
    !integer(at)
  )
    return no('provision-requires-same-commit-permit-acceptance');
  if (
    !validControllerId(orderId) ||
    orderId.length > 60 ||
    s.provisions?.[permitId] ||
    Object.values(s.provisions ?? {}).some((q) => q.orderId === orderId)
  )
    return no('provision-order-already-bound-or-invalid');
  return yes({
    type: 'PremisesProvisionStarted',
    actorId,
    at,
    policy: PREMISES_PROVISION_POLICY,
    provision: {
      permitId,
      orderId,
      policyVersion: PREMISES_PROVISION_POLICY.version,
      startedAt: at,
      settledAt: at,
      availableMs: 0,
      unavailableMs: 0,
      revision: 1,
    },
  });
}
export function settlePremisesProvision(
  s: PremisesRightsState,
  permitId: string,
  at: number,
  building: PremisesBuilding | undefined,
): PremisesProvisionDecision {
  const q = s.provisions?.[permitId],
    p = s.permits[permitId];
  if (!q) return yes();
  if (!p?.accepted || !integer(at) || at < q.settledAt)
    return no('invalid-provision-time-or-permit');
  if (!building || building.id !== p.buildingId || building.at > at)
    return no('provision-building-evidence-required');
  const until = Math.min(at, premisesProvisionEnd(p));
  if (until <= q.settledAt) return yes();
  if (building.at > q.settledAt) return no('provision-building-changed-before-settlement');
  if (q.revision >= Number.MAX_SAFE_INTEGER) return no('provision-revision-limit');
  const elapsed = premisesProvisionDuration(p, until) - premisesProvisionDuration(p, q.settledAt),
    availableMs = building.status === 'operational' && building.condition > 0 ? elapsed : 0;
  return yes({
    type: 'PremisesProvisionSettled',
    permitId,
    revision: q.revision + 1,
    at,
    from: q.settledAt,
    until,
    availableMs,
    unavailableMs: elapsed - availableMs,
    evidence: premisesAvailabilityEvidence(building),
  });
}
/** Records final interval facts; authorization and actual building evidence are checked independently by world. */
export function applyPremisesProvisionEvent(
  s: PremisesRightsState,
  e: PremisesProvisionEvent,
): PremisesRightsState {
  if (e.type === 'PremisesProvisionStarted') {
    const q = e.provision,
      p = s.permits[q.permitId];
    if (
      !p?.accepted ||
      p.status !== 'accepted' ||
      e.actorId !== p.accepted.actorId ||
      e.at !== p.accepted.at ||
      !integer(e.at) ||
      e.policy.version !== PREMISES_PROVISION_POLICY.version ||
      e.policy.basis !== PREMISES_PROVISION_POLICY.basis ||
      q.policyVersion !== PREMISES_PROVISION_POLICY.version ||
      q.startedAt !== e.at ||
      q.settledAt !== e.at ||
      q.availableMs !== 0 ||
      q.unavailableMs !== 0 ||
      q.revision !== 1 ||
      !validControllerId(q.orderId) ||
      q.orderId.length > 60 ||
      s.provisions?.[q.permitId] ||
      Object.values(s.provisions ?? {}).some((old) => old.orderId === q.orderId)
    )
      throw Error('invalid-provision-start-event');
    return { ...s, provisions: { ...s.provisions, [q.permitId]: { ...q } } };
  }
  const q = s.provisions?.[e.permitId],
    p = s.permits[e.permitId],
    b = e.evidence;
  if (
    !q ||
    !p?.accepted ||
    q.policyVersion !== PREMISES_PROVISION_POLICY.version ||
    ![
      e.from,
      e.until,
      e.at,
      e.availableMs,
      e.unavailableMs,
      e.revision,
      b.buildingRevision,
      b.buildingAt,
      b.condition,
    ].every(integer) ||
    e.from !== q.settledAt ||
    e.until <= e.from ||
    e.until > e.at ||
    e.until > premisesProvisionEnd(p) ||
    e.revision !== q.revision + 1 ||
    b.buildingId !== p.buildingId ||
    b.buildingRevision < 1 ||
    b.buildingAt > e.from ||
    b.condition > 1000 ||
    !['operational', 'closed', 'demolished'].includes(b.status)
  )
    throw Error('invalid-provision-interval-event');
  const elapsed = premisesProvisionDuration(p, e.until) - premisesProvisionDuration(p, e.from),
    expectedAvailable = b.status === 'operational' && b.condition > 0 ? elapsed : 0;
  if (
    e.availableMs !== expectedAvailable ||
    e.availableMs + e.unavailableMs !== elapsed ||
    !integer(q.availableMs + e.availableMs) ||
    !integer(q.unavailableMs + e.unavailableMs)
  )
    throw Error('invalid-provision-time-conservation');
  return {
    ...s,
    provisions: {
      ...s.provisions,
      [e.permitId]: {
        ...q,
        settledAt: e.until,
        availableMs: q.availableMs + e.availableMs,
        unavailableMs: q.unavailableMs + e.unavailableMs,
        revision: e.revision,
      },
    },
  };
}
export function unsettledPremisesProvisions(
  s: PremisesRightsState | undefined,
  buildingId: string,
  at: number,
) {
  return Object.values(s?.provisions ?? {}).filter((q) => {
    const p = s?.permits[q.permitId];
    return p && p.buildingId === buildingId && q.settledAt < Math.min(at, premisesProvisionEnd(p));
  });
}
