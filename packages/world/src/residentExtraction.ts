import { createEventEnvelope } from '@aivilization/sim-core';
import {
  MATERIAL_EXTRACTION_POLICY,
  applyMaterialCommit,
  type MaterialSourceSeed,
  type MaterialSourceOrigin,
  type MaterialExtractionEvent,
} from '@aivilization/materials';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { WorldCommandPolicies } from './agentActions';
export function assertResidentExtractionCompatibility(
  w: WorldProjection,
  policies: WorldCommandPolicies,
) {
  if (policies.renewableResources || w.renewableResources)
    throw Error('physical-production-cannot-duplicate-legacy-resource-pool');
}
export function enableResidentExtractionEvent(input: {
  projection: WorldProjection;
  policies: WorldCommandPolicies;
  sources: readonly MaterialSourceSeed[];
  origin?: MaterialSourceOrigin;
  requestId: string;
  simulationId: string;
  nextSequence: number;
}): WorldEvent {
  assertResidentExtractionCompatibility(input.projection, input.policies);
  const event: WorldEvent = createEventEnvelope({
    id: `${input.requestId}:extraction`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentExtractionEnabled',
    payload: {
      type: 'MaterialExtractionEnabled' as const,
      policy: MATERIAL_EXTRACTION_POLICY,
      ...(input.origin ? { origin: input.origin } : {}),
      sources: input.sources.map((s) => ({
        ...s,
        remaining: s.initialQuantity,
        revision: 1,
        at: input.projection.clock.now,
      })),
    },
  });
  applyResidentExtractionActivation(input.projection, event);
  return event;
}
export type ResidentExtractionPayload = Extract<
  MaterialExtractionEvent,
  { type: 'MaterialExtractionEnabled' }
>;
export function applyResidentExtractionActivation(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentExtractionEnabled') return undefined;
  if (
    !w.materials ||
    w.renewableResources ||
    e.occurredAt !== w.clock.now ||
    e.payload.type !== 'MaterialExtractionEnabled' ||
    e.payload.sources.some((s) => s.at !== w.clock.now || !w.locations[s.locationId]) ||
    Object.values(w.activityTimeByAgent).some(
      (a) => a.commandType === 'AgentProduce' && a.availableAt > w.clock.now,
    )
  )
    throw Error('invalid-physical-production-activation-or-active-legacy-production');
  return { ...w, materials: applyMaterialCommit(w.materials, [e.payload]).state };
}
