import { applyLeaseContinuity, leaseHasDepartedParty } from '../leaseEstateContinuity';
import {
  applyResidentLeaseEvent,
  emptyResidentLeaseState,
  RESIDENT_LEASE_POLICY,
} from '@aivilization/society';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
import { premisesLeaseRightAvailable } from '../premisesAccess';
export function applyResidentLeaseProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (
    e.type === 'ResidentLeaseChanged' &&
    e.payload.policyVersion !== RESIDENT_LEASE_POLICY.version
  )
    throw new Error('unsupported-resident-lease-policy');
  if (e.type === 'ResidentLeaseChanged') {
    const prior = w.residentLeases?.leases[e.payload.lease.id];
    if (prior && leaseHasDepartedParty(w, prior) && !e.payload.continuity)
      throw Error('lease-continuity-proof-required');
  }
  if (e.type === 'ResidentLeaseChanged' && e.payload.continuity) {
    if (e.occurredAt !== e.payload.continuity.source.at)
      throw Error('lease-continuity-time-mismatch');
    w = applyLeaseContinuity(w, e.payload.lease, e.payload.continuity);
  }
  if (e.type === 'ResidentLeaseChanged') {
    const l = e.payload.lease,
      before = w.residentLeases?.leases[l.id];
    if (
      (!before || (before.status === 'offered' && l.status === 'active')) &&
      !premisesLeaseRightAvailable(w, l.tenantId, l.locationId, l.expiresAt)
    )
      throw Error('lease-conflicts-with-premises-use-rights');
  }
  return e.type === 'ResidentLeaseChanged'
    ? {
        ...w,
        residentLeases: applyResidentLeaseEvent(w.residentLeases ?? emptyResidentLeaseState(), {
          type: 'ResidentLeaseChanged',
          lease: e.payload.lease,
        }),
      }
    : undefined;
}
