import { resourcePrincipalSnapshot } from '@aivilization/authority';
import type {
  SuccessionBinding,
  SuccessionPorts,
  SuccessionResourceFact,
  SuccessionEvent,
} from '@aivilization/society';
import {
  triggerSuccessionArrangement,
  expireSuccessionArrangement,
  applySuccessionEvent,
} from '@aivilization/society';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import type { ResidentPopulationDeparture } from './residentExitCapture';
/** Exact owning world facts. Open-journal information/service resources require their own adapter; absent means unknown, not a guessed right. */
export function residentSuccessionResourceFact(
  w: WorldProjection,
  b: SuccessionBinding,
): SuccessionResourceFact | undefined {
  const resource =
    b.kind === 'stock'
      ? w.materials?.stocks[b.id]
      : b.kind === 'premises'
        ? w.premises?.buildings[b.id]
        : undefined;
  if (!resource) return undefined;
  if ('status' in resource && (resource.status === 'closed' || resource.status === 'demolished'))
    return undefined;
  const control = resourcePrincipalSnapshot(resource);
  if (control.controller.kind !== 'resident') return undefined;
  return {
    kind: b.kind,
    id: b.id,
    sourceRevision: resource.revision,
    entitlementVersion: control.version,
    ownerId: control.controller.id,
    available: true,
  };
}
export const residentSuccessionPorts = (
  w: WorldProjection,
  departing?: string,
): SuccessionPorts => ({
  residentAvailable: (id) => id !== departing && Object.hasOwn(w.agents, id),
  resource: (b) => residentSuccessionResourceFact(w, b),
});
const populationFact = (e: ResidentPopulationDeparture) => ({
  eventId: e.id,
  residentId: e.payload.agentId,
  kind: e.type === 'AgentDied' ? ('death' as const) : ('emigration' as const),
  at: e.type === 'AgentDied' ? e.payload.diedAt : e.payload.emigratedAt,
  policyVersion: e.payload.policyVersion,
});
function relevant(w: WorldProjection, e: ResidentPopulationDeparture) {
  const fact = populationFact(e);
  return Object.values(w.residentExits?.arrangements.arrangements ?? {})
    .filter(
      (a) =>
        a.ownerId === fact.residentId &&
        (a.status === 'ready' ||
          (a.status === 'offered' && fact.at >= a.acceptBy) ||
          (a.status === 'declined' && fact.at >= a.expiresAt)),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function prepareResidentSuccessionDeparture(
  w: WorldProjection,
  e: ResidentPopulationDeparture,
): readonly SuccessionEvent[] {
  if (!w.successionControlExecutions) return [];
  const state = w.residentExits?.arrangements;
  if (!state) throw Error('succession-real-exit-state-required');
  const fact = populationFact(e),
    ports = residentSuccessionPorts(w, e.payload.agentId);
  const events: SuccessionEvent[] = [];
  let current = state;
  for (const a of relevant(w, e)) {
    const d =
      a.status === 'ready' && fact.at < a.expiresAt
        ? triggerSuccessionArrangement(current, a.id, fact, ports)
        : expireSuccessionArrangement(current, a.id, fact.at);
    if (!d.accepted) throw Error(d.reason);
    events.push(...d.events);
    current = d.events.reduce(applySuccessionEvent, current);
  }
  return events;
}
/** Corroborates actual sources then uses owning reducers. Does not choose a successor or rerun a trigger decision. */
export function applyResidentSuccessionDeparture(
  w: WorldProjection,
  e: ResidentPopulationDeparture,
  events: readonly SuccessionEvent[] | undefined,
) {
  const state = w.residentExits?.arrangements;
  if (!state) throw Error('succession-real-exit-state-required');
  if (!w.successionControlExecutions) {
    if (events) throw Error('succession-control-executions-not-enabled');
    return state;
  }
  const expected = relevant(w, e),
    fact = populationFact(e),
    ports = residentSuccessionPorts(w, e.payload.agentId);
  if (!events || events.length !== expected.length)
    throw Error('succession-population-trigger-coverage-mismatch');
  let current = state;
  for (const [i, event] of events.entries()) {
    const a = expected[i]!;
    if (
      event.type !== 'SuccessionArrangementTriggered' &&
      event.type !== 'SuccessionArrangementExpired'
    )
      throw Error('succession-population-event-kind-mismatch');
    if (event.id !== a.id || event.previousRevision !== a.revision || event.at !== fact.at)
      throw Error('succession-population-reference-mismatch');
    if (event.type === 'SuccessionArrangementTriggered') {
      const t = event.trigger;
      if (
        !equal(t.fact, fact) ||
        t.executorAvailable !== ports.residentAvailable(a.executorId) ||
        t.beneficiaryAvailable !== ports.residentAvailable(a.beneficiaryId) ||
        t.resources.length !== a.bindings.length ||
        t.resources.some((r, j) => !equal(r.fact, ports.resource(a.bindings[j]!) ?? null))
      )
        throw Error('succession-population-owning-resource-mismatch');
    } else if (a.status === 'ready' && fact.at < a.expiresAt)
      throw Error('succession-ready-arrangement-needs-actual-trigger');
    current = applySuccessionEvent(current, event);
  }
  return current;
}
