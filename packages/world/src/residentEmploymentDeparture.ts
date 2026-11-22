import { prepareResidentDepartureActivities } from './residentDepartureActivity';
import { decideLeaveEnterprise } from '@aivilization/enterprise';
import { createEventEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  prepareResidentExitCapture,
  type ResidentPopulationDeparture,
} from './residentExitCapture';
import { stopUnavailableResidentLabor } from './residentLabor';
import { stopUnavailableProductiveWork } from './productiveEmploymentLifecycle';

/** Candidate atomic batch only. The caller owns the actual population decision and must
 * append every event in one journal transaction. This is not natural-population activation. */
export function prepareResidentEmploymentDeparture(input: {
  readonly projection: WorldProjection;
  readonly departure: ResidentPopulationDeparture;
}):
  | { readonly accepted: true; readonly events: readonly WorldEvent[] }
  | { readonly accepted: false; readonly reason: string } {
  try {
    const d = input.departure,
      id = d.payload.agentId;
    let w = input.projection;
    const at = d.type === 'AgentDied' ? d.payload.diedAt : d.payload.emigratedAt;
    if (at !== w.clock.now || d.occurredAt !== at || d.payload.exitPreservation)
      throw Error('employment-departure-current-unprepared-source-required');
    const laborId = w.residentLabor?.process.activeByActor[id];
    if (laborId && w.residentLabor!.process.sessions[laborId]!.settledAt !== at)
      throw Error('employment-departure-needs-settled-labor-boundary');
    const initialCapture = prepareResidentExitCapture(w, d);
    if (!initialCapture.accepted) return initialCapture;
    const events: WorldEvent[] = [];
    const append = (batch: readonly WorldEvent[]) => {
      for (const event of batch) {
        w = applyWorldEvent(w, event);
        events.push(event);
      }
    };
    for (const enterprise of Object.values(w.enterprises)
      .filter((e) => e.employeeAgentIds.includes(id))
      .sort((a, b) =>
        a.enterpriseId < b.enterpriseId ? -1 : a.enterpriseId > b.enterpriseId ? 1 : 0,
      )) {
      const decision = decideLeaveEnterprise({ enterprise, agentId: id });
      if (decision.status === 'rejected') throw Error(decision.reason);
      append([
        createEventEnvelope({
          id: `${d.id}:employment:${events.length}`,
          simulationId: d.simulationId,
          sequence: d.sequence + events.length,
          occurredAt: at,
          type: 'EnterpriseEmployeeLeft',
          payload: {
            enterpriseId: enterprise.enterpriseId,
            agentId: id,
            occupationName: enterprise.occupationName,
            previousJob: w.agents[id]!.job,
          },
        }),
      ]);
    }
    const context = () => ({
      projection: w,
      onlyActorId: String(id),
      at,
      simulationId: d.simulationId,
      requestId: `${d.id}:stop:${events.length}`,
      nextSequence: d.sequence + events.length,
    });
    append(stopUnavailableProductiveWork(context()));
    append(stopUnavailableResidentLabor(context()));
    append(
      prepareResidentDepartureActivities({
        projection: w,
        departure: d,
        nextSequence: d.sequence + events.length,
      }),
    );
    // Unsupported body participation must be integrated explicitly, never erased by capture.
    if (
      w.transitByAgent?.[id] ||
      w.residentRest?.activeByActor[id] ||
      w.residentStudy?.process.activeByActor[id] ||
      w.residentLabor?.process.activeByActor[id] ||
      (w.activityTimeByAgent[id]?.availableAt ?? 0) > at ||
      Object.values(w.materials?.productions ?? {}).some((j) => j.session?.actorId === id) ||
      Object.values(w.premises?.projects ?? {}).some((j) => j.session?.actorId === id)
    )
      throw Error('employment-departure-other-active-participation-unresolved');
    const terminal = { ...d, sequence: d.sequence + events.length };
    const capture = prepareResidentExitCapture(w, terminal);
    if (!capture.accepted) return capture;
    const preserved: ResidentPopulationDeparture =
      terminal.type === 'AgentDied'
        ? { ...terminal, payload: { ...terminal.payload, exitPreservation: capture.capture } }
        : { ...terminal, payload: { ...terminal.payload, exitPreservation: capture.capture } };
    append([preserved]);
    return { accepted: true, events };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-employment-departure',
    };
  }
}
