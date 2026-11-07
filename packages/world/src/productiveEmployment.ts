import { createEventEnvelope } from '@aivilization/sim-core';
import {
  PRODUCTIVE_EMPLOYMENT_VERSION,
  PRODUCTIVE_CLEARING_ORDER,
} from './productiveEmploymentModel';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { applyProductiveWagePaid } from './productiveWages';

export function assertProductiveEmploymentActivation(w: WorldProjection): void {
  if (
    w.productiveEmployment ||
    !w.residentLabor ||
    !w.residentRest ||
    !w.materials ||
    Object.values(w.materials.productions).some((j) => j.session) ||
    Object.values(w.activityTimeByAgent).some(
      (a) => a.availableAt > w.clock.now && a.settlementTiming === 'effects-at-commit',
    )
  )
    throw Error(
      'productive-employment-needs-labor-materials-and-no-active-material-or-prepaid-work',
    );
}
export function enableProductiveEmploymentEvent(input: {
  readonly projection: WorldProjection;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
}): WorldEvent {
  assertProductiveEmploymentActivation(input.projection);
  return createEventEnvelope({
    id: `${input.requestId}:productive-enabled`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentProductiveEmploymentEnabled',
    payload: {
      policyVersion: PRODUCTIVE_EMPLOYMENT_VERSION,
      clearingOrder: PRODUCTIVE_CLEARING_ORDER,
      claims: {},
    } as const,
  });
}
export function applyProductiveEmploymentProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  const paid = applyProductiveWagePaid(w, e);
  if (paid) return paid;
  if (e.type !== 'ResidentProductiveEmploymentEnabled') return undefined;
  assertProductiveEmploymentActivation(w);
  if (
    e.occurredAt !== w.clock.now ||
    e.payload.policyVersion !== PRODUCTIVE_EMPLOYMENT_VERSION ||
    e.payload.clearingOrder !== PRODUCTIVE_CLEARING_ORDER
  )
    throw Error('invalid-productive-employment-activation');
  if (Object.keys(e.payload.claims).length)
    throw Error('productive-activation-cannot-invent-claims');
  return {
    ...w,
    productiveEmployment: {
      policyVersion: PRODUCTIVE_EMPLOYMENT_VERSION,
      clearingOrder: PRODUCTIVE_CLEARING_ORDER,
      claims: {},
    },
  };
}
