import {
  currentServiceEnterprise,
  enterpriseServiceEstateIds,
  type ServicesState,
} from '@aivilization/services';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export const SERVICE_CLOSURE_POLICY = { version: 'independent-service-closure-v1' } as const;
export type ServiceClosurePolicy = typeof SERVICE_CLOSURE_POLICY;
/** Explicit integration completeness requirement; it confers no public jurisdiction. */
export function assertServiceClosurePolicy(w: WorldProjection) {
  if (
    w.serviceClosurePolicy &&
    (w.serviceClosurePolicy.version !== SERVICE_CLOSURE_POLICY.version ||
      Object.keys(w.serviceClosurePolicy).length !== 1)
  )
    throw Error('invalid-service-closure-policy');
}
export function applyServiceClosurePolicy(
  w: WorldProjection,
  e: WorldEvent,
  directory?: ServicesState,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceClosureEnabled') return undefined;
  if (
    w.serviceClosurePolicy ||
    e.occurredAt !== w.clock.now ||
    e.payload.version !== SERVICE_CLOSURE_POLICY.version ||
    Object.keys(e.payload).length !== 1
  )
    throw Error('invalid-service-closure-activation');
  if (!directory?.principalPolicy) throw Error('service-principal-directory-port-required');
  const ids = new Set(
    Object.values(directory.services).flatMap((s) => [
      ...(s.control?.controller.kind === 'enterprise' ? [s.control.controller.id] : []),
      ...(currentServiceEnterprise(s) ? [currentServiceEnterprise(s)!] : []),
    ]),
  );
  for (const id of ids)
    if (
      (!w.enterprises[id] || w.enterprises[id].status === 'closed') &&
      enterpriseServiceEstateIds(directory, id, w.clock.now).length
    )
      throw Error('service-closure-existing-orphan-responsibility');
  return { ...w, serviceClosurePolicy: { ...e.payload } };
}
export function enableServiceClosureEvent(input: {
  projection: WorldProjection;
  directory: ServicesState;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const event = createEventEnvelope({
    id: input.requestId + ':service-closure',
    simulationId: input.simulationId,
    type: 'ResidentServiceClosureEnabled',
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    payload: SERVICE_CLOSURE_POLICY,
  });
  applyServiceClosurePolicy(input.projection, event, input.directory);
  return event;
}
