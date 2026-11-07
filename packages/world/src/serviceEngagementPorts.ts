import { residentFinancialAccount } from './residentFinancialAccounts';
import type {
  ServiceEngagementPorts,
  ServiceEngagement,
  ServicePresence,
} from '@aivilization/services';
import { residentServiceEffect } from '@aivilization/society';
import { premisesServiceFacilityCapacity } from '@aivilization/premises';
import type { WorldProjection } from './projection';
import {
  mayEnterWorldPremises,
  mayOperateWorldPremises,
  premisesAtLocation,
  worldPremisesUseUntil,
} from './premisesAccess';
export type ServiceEngagementAuthorization = Pick<
  ServiceEngagementPorts,
  'authorize' | 'controllerAvailable'
> & {
  readonly authorizePublicFunding?: NonNullable<
    ServiceEngagementPorts['publicFunding']
  >['authorize'];
};
export function servicePremisesWindowFailure(
  w: WorldProjection,
  e: ServiceEngagement,
  actorId: string,
  until: number,
) {
  if (!w.premisesRights) return undefined;
  if (worldPremisesUseUntil(w, e.providerId, e.locationId, 'operate') < until)
    return 'service-permit-window-exceeded';
  if (worldPremisesUseUntil(w, actorId, e.locationId, 'entry') < until)
    return 'service-entry-window-exceeded';
  return undefined;
}
export function servicePresenceReserved(w: WorldProjection, presence: ServicePresence) {
  const r = w.activityTimeByAgent[presence.actorId];
  return (
    !!r &&
    r.commandType === 'ResidentServiceWork' &&
    r.startedAt === presence.startedAt &&
    r.availableAt === presence.until
  );
}
export function serviceParticipantCondition(w: WorldProjection, actorId: string) {
  const a = w.agents[actorId];
  return a ? { ...a.physiology, educationScore: a.educationScore } : undefined;
}
export function residentServiceFacilityAvailable(
  w: WorldProjection,
  e: ServiceEngagement,
  at: number,
) {
  const model = residentServiceEffect(e.modelId);
  if (!model) return false;
  if (model.facility === 'none') return true;
  const capacity = w.premises
    ? premisesServiceFacilityCapacity(w.premises, e.locationId, model.facility)
    : 0;
  if (capacity <= 0) return false;
  // An admitted presence owns a station until its recorded end, including the last settlement at that end.
  if (e.providerPresence || e.recipientPresence) return true;
  const inUse = Object.values(w.serviceEngagements?.engagements ?? {}).filter(
    (other) =>
      other.id !== e.id &&
      other.status === 'funded' &&
      other.locationId === e.locationId &&
      residentServiceEffect(other.modelId)?.facility === model.facility &&
      [other.providerPresence, other.recipientPresence].some((p) => p && p.until > at),
  ).length;
  return inUse < capacity;
}
export function residentServiceEngagementPorts(
  w: WorldProjection,
  auth: ServiceEngagementAuthorization,
): ServiceEngagementPorts {
  return {
    ...auth,
    ...(w.serviceEmployment
      ? { enterpriseAccountingVersion: w.serviceEmployment.policyVersion }
      : {}),
    exists: (id) => !!w.agents[id],
    account: (account) => residentFinancialAccount(w, account),
    ...(w.serviceEngagements?.publicFunding
      ? {
          publicFunding: {
            balance: Math.max(
              0,
              (w.treasury ?? 0) - (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0),
            ),
            authorize: auth.authorizePublicFunding ?? (() => undefined),
          },
        }
      : {}),
    condition: (id) => serviceParticipantCondition(w, id),
    present: (id, location) => w.agents[id]?.locationId === location && !w.transitByAgent?.[id],
    presentAndIdle: (id, location) =>
      w.agents[id]?.locationId === location &&
      !w.transitByAgent?.[id] &&
      (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now &&
      mayEnterWorldPremises(w, id, location),
    mayOperate: (id, location) => mayOperateWorldPremises(w, id, location),
    ...(w.premisesRights
      ? {
          mayOperateDuring: (e: ServiceEngagement, from: number, until: number) =>
            until <= from ||
            worldPremisesUseUntil(w, e.providerId, e.locationId, 'operate', from) >= until,
        }
      : {}),
    locationAvailable: (id) => {
      const l = w.locations[id],
        b = premisesAtLocation(w, id);
      return (
        !!l &&
        (l.capacity === null || l.capacity >= 2) &&
        (!b || (b.status === 'operational' && b.condition > 0))
      );
    },
    facilityAvailable: (e, at) => residentServiceFacilityAvailable(w, e, at),
    sessionReserved: (_id, presence) => servicePresenceReserved(w, presence),
    material: (id) => {
      const r = w.materials?.reservations?.records[id],
        stock = r && w.materials?.stocks[r.stockId];
      return r && stock && (r.beneficiary.kind === 'resident' || r.beneficiary.kind === 'collective')
        ? {
            revision: r.revision,
            status: r.status,
            expiresAt: r.expiresAt,
            beneficiary: { kind: r.beneficiary.kind, id: r.beneficiary.id },
            consumerDomain: r.consumer.domain,
            consumerId: r.consumer.id,
            locationId: stock.locationId,
            held: r.held,
          }
        : undefined;
    },
  };
}
