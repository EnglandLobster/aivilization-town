import { residentPhysicalRestEffect } from './physicalHousingRest';
import {
  advanceElapsedPhysiology,
  advanceElapsedLaborPhysiology,
  ELAPSED_PHYSIOLOGY_VERSION,
  progressResidentRest,
  type PassivePhysiologicalDecayPolicy,
  type SleepDeprivationHealthDecayPolicy,
} from '@aivilization/society';
import type { WorldProjection, WorldAgentState } from './projection';

/** Explicit migration preflight; unsupported cadence/lifecycle paths must not silently change semantics. */
export function assertResidentRestTimeCompatibility(input: {
  readonly lifecycle?: unknown;
  readonly migration?: unknown;
  readonly timeSettlementAmortization?: unknown;
  readonly starvation?: { readonly policyVersion: string };
  readonly stochasticIllness?: {
    readonly policyVersion?: string;
    readonly settlementCadenceMs?: number;
  };
}) {
  if (
    input.lifecycle ||
    input.migration ||
    input.timeSettlementAmortization ||
    input.starvation?.policyVersion === 'starvation-health-decay-v1' ||
    (input.stochasticIllness &&
      (!input.stochasticIllness.policyVersion || !input.stochasticIllness.settlementCadenceMs))
  )
    throw Error('resident-rest-needs-versioned-unamortized-living-resident-cadences');
}
type Interval = { readonly previousSimulationTime: number; readonly currentSimulationTime: number };
export function splitRestIntervals(intervals: readonly Interval[], until?: number): Interval[] {
  return intervals.flatMap((interval) =>
    until !== undefined &&
    until > interval.previousSimulationTime &&
    until < interval.currentSimulationTime
      ? [
          { previousSimulationTime: interval.previousSimulationTime, currentSimulationTime: until },
          { previousSimulationTime: until, currentSimulationTime: interval.currentSimulationTime },
        ]
      : [interval],
  );
}

/** Application adapter calls the owning physical rule once for simultaneous rates. */
export function settleElapsedBodyInterval(input: {
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly previous: WorldAgentState['physiology'];
  readonly interval: Interval;
  readonly decay: PassivePhysiologicalDecayPolicy;
  readonly deprivation?: SleepDeprivationHealthDecayPolicy;
}) {
  const state = input.projection.residentRest;
  if (!state) throw Error('resident-rest-not-enabled');
  const id = state.activeByActor[input.actorId],
    session = id ? state.sessions[id] : undefined;
  const from = input.interval.previousSimulationTime,
    until = input.interval.currentSimulationTime;
  if (
    session &&
    (session.settledAt !== from || session.until < until || session.status !== 'active')
  )
    throw Error('rest-progress-interval-mismatch');
  const laborId = input.projection.residentLabor?.process.activeByActor[input.actorId];
  const labor = laborId ? input.projection.residentLabor?.process.sessions[laborId] : undefined;
  if (
    labor &&
    (session || labor.settledAt !== from || labor.until < until || labor.status !== 'active')
  )
    throw Error('labor-progress-interval-mismatch');
  const physicalHousing =
    session && input.projection.physicalHousingRest
      ? residentPhysicalRestEffect(input.projection, input.actorId, from, session.energyPerSecond)
      : undefined;
  const physical = labor
    ? advanceElapsedLaborPhysiology({
        previous: input.previous,
        elapsedMs: until - from,
        decay: input.decay,
        ...(input.deprivation ? { deprivation: input.deprivation } : {}),
        labor,
      })
    : advanceElapsedPhysiology({
        previous: input.previous,
        elapsedMs: until - from,
        decay: input.decay,
        ...(input.deprivation ? { deprivation: input.deprivation } : {}),
        ...(session
          ? {
              sleep: {
                energyPerSecond: physicalHousing?.energyPerSecond ?? session.energyPerSecond,
                maximum: session.maximum,
              },
            }
          : {}),
      });
  const decision = session ? progressResidentRest(state, session.id, until) : undefined;
  if (decision && !decision.accepted) throw Error(decision.reason);
  return {
    next: physical.next,
    events: decision?.accepted ? decision.events : [],
    evidence: {
      policyVersion: ELAPSED_PHYSIOLOGY_VERSION,
      from,
      until,
      lowEnergyMs: physical.lowEnergyMs,
      ...(physicalHousing ? { physicalHousing } : {}),
      ...(session ? { restSessionId: session.id } : {}),
      ...(labor ? { laborSessionId: labor.id } : {}),
    } as const,
  };
}
