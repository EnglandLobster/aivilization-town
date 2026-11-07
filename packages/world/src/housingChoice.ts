import { createEventEnvelope } from '@aivilization/sim-core';
import {
  HOUSING_CHOICE_POLICY,
  assertHousingChoiceState,
  decideHousingStandardChoice,
  applyHousingStandardChoice,
  recordHousingStandardChange,
} from '@aivilization/society';
import type { WorldCommandPolicies } from './agentActions';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
type Context = {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
};
export function enableHousingChoiceEvent(
  input: Context & { policies: WorldCommandPolicies },
): WorldEvent {
  if (input.projection.housingChoice) throw Error('housing-choice-already-enabled');
  if (input.policies.timeSettlementAmortization)
    throw Error('housing-choice-requires-exact-time-settlement');
  const upkeep = input.policies.residentialUpkeep?.costs.map((c) => c.residentialTier) ?? [];
  const caps = input.policies.residentialPhysiologyCaps?.caps.map((c) => c.residentialTier);
  const availableTiers = [...new Set(upkeep.filter((t) => !caps || caps.includes(t)))].sort(
    (a, b) => a - b,
  );
  const state = { policy: HOUSING_CHOICE_POLICY, availableTiers, revisions: {} };
  assertHousingChoiceState(state);
  return createEventEnvelope({
    id: input.requestId,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentHousingChoiceEnabled',
    payload: state,
  });
}
export function chooseResidentHousingStandard(
  input: Context & { actorId: string; targetTier: number; expectedRevision: number },
) {
  const w = input.projection,
    state = w.housingChoice,
    actor = w.agents[input.actorId];
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!state || !actor) return no('housing-choice-or-actor-unavailable');
  // Active work/recovery has frozen inputs. Residents may stop it through its own lifecycle first.
  if (
    (w.activityTimeByAgent[input.actorId]?.availableAt ?? 0) > w.clock.now ||
    w.transitByAgent?.[input.actorId]
  )
    return no('housing-choice-requires-no-active-physical-commitment');
  const d = decideHousingStandardChoice({
    state,
    actorId: input.actorId,
    at: w.clock.now,
    currentTier: actor.residentialTier,
    targetTier: input.targetTier,
    expectedRevision: input.expectedRevision,
  });
  if (!d.accepted) return d;
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: input.requestId,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        type: 'ResidentHousingStandardChosen' as const,
        payload: d.event,
      }),
    ],
  };
}
export function applyHousingChoiceProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type === 'ResidentHousingChoiceEnabled') {
    assertHousingChoiceState(e.payload);
    if (w.housingChoice || Object.keys(e.payload.revisions).length || e.occurredAt !== w.clock.now)
      throw Error('invalid-housing-choice-activation');
    return { ...w, housingChoice: structuredClone(e.payload) };
  }
  if (e.type !== 'ResidentHousingStandardChosen') return undefined;
  const p = e.payload,
    actor = w.agents[p.actorId];
  if (
    !w.housingChoice ||
    !actor ||
    p.at !== w.clock.now ||
    e.occurredAt !== p.at ||
    (w.activityTimeByAgent[p.actorId]?.availableAt ?? 0) > p.at ||
    w.transitByAgent?.[p.actorId]
  )
    throw Error('invalid-housing-choice-world-source');
  const applied = applyHousingStandardChoice(w.housingChoice, actor.residentialTier, p);
  // No cash, inventory, debt, body, job, lease, building, location or household changes.
  return {
    ...w,
    housingChoice: applied.state,
    agents: { ...w.agents, [p.actorId]: { ...actor, residentialTier: applied.tier } },
  };
}
/** Old upgrade/forced-downgrade events keep their semantics while invalidating new stale previews. */
export function advanceHousingChoiceRevision(w: WorldProjection, actor: string): WorldProjection {
  return w.housingChoice
    ? { ...w, housingChoice: recordHousingStandardChange(w.housingChoice, actor) }
    : w;
}
