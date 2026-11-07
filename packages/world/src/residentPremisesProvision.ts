import {
  applyPremisesProvisionEvent,
  premisesAvailabilityEvidence,
  settlePremisesProvision,
  type PremisesProvisionEvent,
  PREMISES_PROVISION_POLICY,
} from '@aivilization/premises';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export type PremisesProvisionSettlement = Extract<
  PremisesProvisionEvent,
  { type: 'PremisesProvisionSettled' }
>;
export type ResidentPremisesProvisionPayload = {
  readonly policyVersion: 'premises-provision-v1';
  readonly events: readonly PremisesProvisionSettlement[];
};
/** Only real pre-mutation building versions may establish availability. Starting a paid record is reserved for atomic trade acceptance. */
export function applyPremisesProvisionSettlements(
  w: WorldProjection,
  events: readonly PremisesProvisionSettlement[],
  at: number,
): WorldProjection {
  if (!w.premisesRights || at !== w.clock.now) throw Error('invalid-provision-world-context');
  let state = w.premisesRights;
  for (const e of events) {
    const p = state.permits[e.permitId],
      b = p && w.premises?.buildings[p.buildingId];
    if (!b || e.type !== 'PremisesProvisionSettled' || e.at !== at)
      throw Error('invalid-provision-settlement-world-event');
    const actual = premisesAvailabilityEvidence(b);
    if (
      Object.keys(actual).some(
        (key) => actual[key as keyof typeof actual] !== e.evidence[key as keyof typeof actual],
      )
    )
      throw Error('provision-building-evidence-mismatch');
    state = applyPremisesProvisionEvent(state, e);
  }
  return { ...w, premisesRights: state };
}
export function settleResidentPremisesProvisions(input: {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
  buildingIds?: readonly string[];
  permitIds?: readonly string[];
}): readonly WorldEvent[] {
  const w = input.projection,
    s = w.premisesRights;
  if (!s) return [];
  const events: PremisesProvisionSettlement[] = [];
  for (const q of Object.values(s.provisions ?? {}).sort((a, b) =>
    a.permitId < b.permitId ? -1 : a.permitId > b.permitId ? 1 : 0,
  )) {
    const p = s.permits[q.permitId];
    if (!p) throw Error('provision-permit-missing');
    if (input.buildingIds && !input.buildingIds.includes(p.buildingId)) continue;
    if (input.permitIds && !input.permitIds.includes(p.id)) continue;
    const d = settlePremisesProvision(s, p.id, w.clock.now, w.premises?.buildings[p.buildingId]);
    if (!d.accepted) throw Error(`provision-settlement-failed:${p.id}:${d.reason}`);
    for (const e of d.events) {
      if (e.type !== 'PremisesProvisionSettled') throw Error('unexpected-provision-start');
      events.push(e);
    }
  }
  if (!events.length) return [];
  applyPremisesProvisionSettlements(w, events, w.clock.now);
  return [
    createEventEnvelope({
      id: `${input.requestId}:provision`,
      simulationId: input.simulationId,
      sequence: input.nextSequence,
      occurredAt: w.clock.now,
      type: 'ResidentPremisesProvisionCommitted',
      payload: { policyVersion: PREMISES_PROVISION_POLICY.version, events },
    }),
  ];
}
export function applyPremisesProvisionProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPremisesProvisionCommitted') return undefined;
  if (e.payload.policyVersion !== PREMISES_PROVISION_POLICY.version || !e.payload.events.length)
    throw Error('invalid-provision-commit');
  return applyPremisesProvisionSettlements(w, e.payload.events, e.occurredAt);
}
