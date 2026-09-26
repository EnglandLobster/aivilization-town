import {
  applyResidentLeaseEvent,
  emptyResidentLeaseState,
  RESIDENT_LEASE_POLICY,
} from '@aivilization/society';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
export function applyResidentLeaseProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (
    e.type === 'ResidentLeaseChanged' &&
    e.payload.policyVersion !== RESIDENT_LEASE_POLICY.version
  )
    throw new Error('unsupported-resident-lease-policy');
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
