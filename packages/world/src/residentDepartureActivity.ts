import {
  assertResidentDepartureActivitySource,
  type ResidentDepartureActivitySource,
} from './residentDepartureActivitySource';
import { interruptResidentConstructionForDeparture } from './residentPremises';
import { interruptResidentRest, stopElapsedStudy } from '@aivilization/society';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldEvent } from './events';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { ResidentPopulationDeparture } from './residentExitCapture';
import { residentStudyCommit } from './residentStudy';
/** Ends supported participation at its actual boundary without inventing recovery, work or arrival. */
export function prepareResidentDepartureActivities(input: {
  projection: WorldProjection;
  departure: ResidentPopulationDeparture;
  nextSequence: number;
}): readonly WorldEvent[] {
  const d = input.departure,
    actorId = d.payload.agentId;
  const source: ResidentDepartureActivitySource = {
    version: 'resident-departure-activity-v1',
    executor: 'system',
    actorId,
    populationEventId: d.id,
    populationType: d.type,
    populationPolicyVersion: d.payload.policyVersion,
    at: d.type === 'AgentDied' ? d.payload.diedAt : d.payload.emigratedAt,
  };
  let w = input.projection;
  assertResidentDepartureActivitySource(w, source, actorId, d.occurredAt);
  const events: WorldEvent[] = [];
  const restId = w.residentRest?.activeByActor[actorId];
  if (restId) {
    const s = w.residentRest!.sessions[restId]!;
    const stopped = interruptResidentRest({
      state: w.residentRest!,
      actorId: 'system',
      id: restId,
      expectedRevision: s.revision,
      at: w.clock.now,
      systemReason: 'population-departure',
    });
    if (!stopped.accepted) throw Error(stopped.reason);
    const event = createEventEnvelope({
      id: `${d.id}:rest-ended`,
      simulationId: d.simulationId,
      sequence: input.nextSequence,
      occurredAt: w.clock.now,
      type: 'ResidentRestSessionChanged',
      payload: {
        previousRevision: stopped.events[0]!.previousRevision,
        session: stopped.events[0]!.session,
        departure: source,
      },
    });
    w = applyWorldEvent(w, event);
    events.push(event);
  }
  const studyId = w.residentStudy?.process.activeByActor[actorId];
  if (studyId) {
    const s = w.residentStudy!.process.sessions[studyId]!;
    const stopped = stopElapsedStudy({
      state: w.residentStudy!.process,
      actorId: 'system',
      id: studyId,
      expectedRevision: s.revision,
      at: w.clock.now,
      reason: 'population-departure',
    });
    if (!stopped.accepted) throw Error(stopped.reason);
    const event = residentStudyCommit(
      {
        projection: w,
        actorId: 'system',
        requestId: `${d.id}:study-ended`,
        simulationId: d.simulationId,
        nextSequence: input.nextSequence + events.length,
        departure: source,
      },
      stopped.events[0]!,
    );
    w = applyWorldEvent(w, event);
    events.push(event);
  }
  for (const project of Object.values(w.premises?.projects ?? {})
    .filter((p) => p.session?.actorId === actorId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const d = interruptResidentConstructionForDeparture({
      projection: w,
      projectId: project.id,
      departure: source,
      requestId: `${input.departure.id}:construction:${events.length}`,
      simulationId: input.departure.simulationId,
      nextSequence: input.nextSequence + events.length,
      authorization: {
        authorize: () => undefined,
        controlAvailable: () => false,
        additionalObligations: () => true,
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
