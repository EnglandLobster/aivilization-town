import { asAgentId } from '@aivilization/sim-core';
import { productionEmploymentWage } from '@aivilization/enterprise';
import { productionEmployer } from './productiveCompensation';
import { interruptResidentEmployedMaterialEvent } from './residentMaterials';
import { mayStoreWorldPremises } from './premisesAccess';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
/** End future participation at the actual employment boundary; the prior real work still earns wages. */
export function stopUnavailableProductiveWork(input: {
  readonly onlyActorId?: string;
  readonly projection: WorldProjection;
  readonly at: number;
  readonly simulationId: string;
  readonly nextSequence: number;
}): WorldEvent[] {
  if (!input.projection.productiveEmployment) return [];
  let w = input.projection;
  const events: WorldEvent[] = [];
  for (const job of Object.values(w.materials?.productions ?? {}).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    const session = job.session;
    if (!session || (input.onlyActorId !== undefined && session.actorId !== input.onlyActorId))
      continue;
    const employer = productionEmployer(w, job.id);
    if (!employer) continue;
    if (
      productionEmploymentWage(employer, job.id, asAgentId(session.actorId), w.clock.now, true) !==
        undefined &&
      (w.agents[session.actorId]?.physiology.health ?? 0) > 0
    )
      continue;
    if (session.settledAt !== input.at)
      throw Error('productive-employment-stop-needs-settled-body');
    const at = { ...w, clock: { ...w.clock, now: input.at } };
    const d = interruptResidentEmployedMaterialEvent({
      projection: at,
      productionId: job.id,
      simulationId: input.simulationId,
      requestId: `productive-end-${input.nextSequence + events.length}`,
      nextSequence: input.nextSequence + events.length,
      authorization: {
        authorize: () => undefined,
        controlAvailable: () => false,
        hasExternalObligation: () => false,
        mayStoreAt: (a, l) => mayStoreWorldPremises(at, a, l),
      },
    });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  }
  return events;
}
