import type { WorldProjection } from './projection';
export type ResidentDepartureActivitySource = {
  readonly version: 'resident-departure-activity-v1';
  readonly executor: 'system';
  readonly actorId: string;
  readonly populationEventId: string;
  readonly populationType: 'AgentDied' | 'AgentEmigrated';
  readonly populationPolicyVersion: string;
  readonly at: number;
};
/** Population decision provenance; the outer application must commit the terminal fact in the same batch. */
export function assertResidentDepartureActivitySource(
  w: WorldProjection,
  source: ResidentDepartureActivitySource,
  actorId: string,
  at: number,
) {
  if (
    source.version !== 'resident-departure-activity-v1' ||
    source.executor !== 'system' ||
    source.actorId !== actorId ||
    source.at !== at ||
    at !== w.clock.now ||
    !w.agents[actorId] ||
    !w.residentExits ||
    w.residentExits.records[actorId] ||
    !['AgentDied', 'AgentEmigrated'].includes(source.populationType) ||
    !source.populationEventId ||
    !source.populationPolicyVersion
  )
    throw Error('invalid-departure-activity-source');
}
