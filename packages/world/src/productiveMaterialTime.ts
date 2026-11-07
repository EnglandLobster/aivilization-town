import { advanceProductivePhysiology, PRODUCTIVE_PHYSIOLOGY_VERSION } from '@aivilization/society';
import {
  settleResidentMaterialEvent,
  materialWorkstationAvailable,
  materialSessionReserved,
} from './residentMaterials';
import { mayStoreWorldPremises } from './premisesAccess';
import type { WorldProjection } from './projection';
import type { WorldCommandPolicies } from './agentActions';
import type { WorldEvent } from './events';

/** Material/body application composition. The same actual interval drives output and later payroll. */
export function settleProductiveMaterialInterval(input: {
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly from: number;
  readonly until: number;
  readonly policies: Pick<WorldCommandPolicies, 'calendar' | 'sleepDeprivation'>;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
}): WorldEvent[] {
  const w = input.projection,
    s = w.materials;
  if (!w.productiveEmployment || !s) return [];
  const jobs = Object.values(s.productions).filter((j) => j.session?.actorId === input.actorId);
  if (jobs.length > 1) throw Error('multiple-material-body-reservations');
  const job = jobs[0],
    session = job?.session;
  if (!job || !session) return [];
  const actor = w.agents[input.actorId],
    stock = s.stocks[job.stockId];
  if (!actor || !stock || session.settledAt !== input.from || session.until < input.until)
    throw Error('productive-material-time-mismatch');
  const at = { ...w, clock: { ...w.clock, now: input.until } };
  const eligible =
    actor.locationId === stock.locationId &&
    !w.transitByAgent?.[input.actorId] &&
    materialSessionReserved(w, job) &&
    materialWorkstationAvailable(at, job.id, input.actorId, stock.locationId);
  const physicalInput = {
    previous: actor.physiology,
    elapsedMs: input.until - input.from,
    workLimitMs: eligible
      ? Math.min(input.until - input.from, job.quantity * job.recipe.workMs - job.progressMs)
      : 0,
    decay: input.policies.calendar?.physiologicalDecay ?? { energyPerHour: 0, satietyPerHour: 0 },
    effort: {
      energyCostPerHour: (job.recipe.energyCost * 3600000) / job.recipe.workMs,
      satietyCostPerHour: (job.recipe.satietyCost * 3600000) / job.recipe.workMs,
    },
    ...(input.policies.sleepDeprivation ? { deprivation: input.policies.sleepDeprivation } : {}),
  };
  const physical = advanceProductivePhysiology(physicalInput);
  const exhausted =
    physical.workedMs < input.until - input.from ||
    advanceProductivePhysiology({
      ...physicalInput,
      previous: physical.next,
      elapsedMs: 1,
      workLimitMs: 1,
    }).workedMs === 0;
  const d = settleResidentMaterialEvent({
    projection: at,
    actorId: 'system',
    productionId: job.id,
    simulationId: input.simulationId,
    // Receipt IDs have a stricter domain alphabet than command IDs. The durable world
    // sequence is unique within this simulation and cannot be chosen by a resident.
    requestId: `productive-body-${input.nextSequence}`,
    nextSequence: input.nextSequence,
    authorization: {
      authorize: () => undefined,
      controlAvailable: () => false,
      hasExternalObligation: () => false,
      mayStoreAt: (a, l) => mayStoreWorldPremises(at, a, l),
    },
    elapsedBody: {
      policyVersion: PRODUCTIVE_PHYSIOLOGY_VERSION,
      productionId: job.id,
      actorId: input.actorId,
      from: input.from,
      until: input.until,
      workedMs: physical.workedMs,
      ...(exhausted ? { endedAt: input.from + physical.workedMs } : {}),
      lowEnergyMs: physical.lowEnergyMs,
      previous: actor.physiology,
      next: physical.next,
    },
  });
  if (!d.accepted) throw Error(d.reason);
  return [...d.events];
}
