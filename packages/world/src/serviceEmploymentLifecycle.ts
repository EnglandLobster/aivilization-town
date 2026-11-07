import { asAgentId } from '@aivilization/sim-core';
import { serviceEmploymentTerms } from '@aivilization/enterprise';
import { applyWorldEvent, type WorldProjection } from './projection';
import { serviceEmployer } from './serviceCompensation';
import { stopResidentEmployedServiceEvent } from './residentServiceEngagements';
import type { WorldEvent } from './events';
export function stopUnavailableServiceWork(input: {
  readonly onlyActorId?: string;
  projection: WorldProjection;
  at: number;
  simulationId: string;
  nextSequence: number;
}): WorldEvent[] {
  if (!input.projection.serviceEmployment) return [];
  let w = input.projection;
  const events: WorldEvent[] = [];
  for (const id of Object.keys(w.serviceEngagements?.engagements ?? {}).sort()) {
    const e = w.serviceEngagements!.engagements[id]!,
      employer = serviceEmployer(w, id);
    if (
      (input.onlyActorId !== undefined && e.providerId !== input.onlyActorId) ||
      !e.providerPresence ||
      !employer ||
      serviceEmploymentTerms(employer, id, asAgentId(e.providerId), w.clock.now, true)
    )
      continue;
    const d = stopResidentEmployedServiceEvent({
      projection: { ...w, clock: { ...w.clock, now: input.at } },
      actorId: 'system',
      id,
      requestId: `employment-ended-${input.at}-${input.nextSequence + events.length}`,
      simulationId: input.simulationId,
      nextSequence: input.nextSequence + events.length,
      authorization: { authorize: () => undefined, controllerAvailable: () => false },
    });
    if (!d.accepted) throw Error(`service-employment-stop-failed:${d.reason}`);
    for (const event of d.events) {
      w = applyWorldEvent(w, event);
      events.push(event);
    }
  }
  return events;
}
