import { applyPeriodicEvent, PERIODIC_OBLIGATIONS_POLICY } from '@aivilization/commerce';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';

export const PERIODIC_ACCESS_POLICY = { version: 'independent-periodic-access-v1' } as const;
export type PeriodicAccessPolicy = typeof PERIODIC_ACCESS_POLICY;

export function assertPeriodicAccessState(w: WorldProjection) {
  if (
    w.periodicAccess &&
    (w.periodicAccess.version !== PERIODIC_ACCESS_POLICY.version ||
      Object.keys(w.periodicAccess).length !== 1 ||
      !w.periodicObligations)
  )
    throw Error('inconsistent-periodic-access-state');
}

/** Integration permission, not a public grant or a change to the financial agreement policy. */
export function applyPeriodicAccessProjection(w: WorldProjection, e: WorldEvent) {
  if (e.type !== 'ResidentPeriodicAccessEnabled') return undefined;
  if (
    w.periodicAccess ||
    e.occurredAt !== w.clock.now ||
    e.payload.version !== PERIODIC_ACCESS_POLICY.version ||
    Object.keys(e.payload).length !== 1
  )
    throw Error('invalid-periodic-access-activation');
  const next: WorldProjection = {
    ...w,
    periodicAccess: structuredClone(e.payload),
    periodicObligations:
      w.periodicObligations ??
      applyPeriodicEvent(undefined, {
        type: 'PeriodicObligationsEnabled',
        policy: PERIODIC_OBLIGATIONS_POLICY,
      }),
  };
  assertPeriodicAccessState(next);
  return next;
}

export function enablePeriodicAccessEvent(input: {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const event: WorldEvent = createEventEnvelope({
    id: `${input.requestId}:periodic-access`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentPeriodicAccessEnabled',
    payload: PERIODIC_ACCESS_POLICY,
  });
  applyPeriodicAccessProjection(input.projection, event);
  return event;
}
