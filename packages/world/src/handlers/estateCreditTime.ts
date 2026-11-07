import { asCommandId } from '@aivilization/sim-core';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import { assertAdvanceSimulationTimePayload } from '../commands';
import { applyWorldEvent } from '../projection';
import type { WorldEvent } from '../events';
import {
  assertResidentEstateCreditSnapshot,
  nextResidentEstateCreditDueAt,
  residentEstateCreditDueEvent,
} from '../residentEstateCredit';
import type { AdvanceSimulationTimeInput } from './timeAdvance';
/** Versioned orchestration only: owning handlers still decide all bank/body effects. No hidden activation or replay decisions. */
export function advanceEstateCreditTime(
  input: AdvanceSimulationTimeInput,
  interval: (input: AdvanceSimulationTimeInput) => WorldEvent[],
): WorldEvent[] {
  assertResidentEstateCreditSnapshot(input.projection);
  const state = input.projection.estateCredit;
  if (!state || !equal(input.credit, state.creditPolicy))
    throw Error('estate-credit-pinned-runtime-policy-required');
  if (input.timeSettlementAmortization && input.timeSettlementAmortization.buckets !== 1)
    throw Error('estate-credit-body-bucket-migration-required');
  const payload = assertAdvanceSimulationTimePayload(input.command.payload),
    until = input.projection.clock.now + payload.deltaMs,
    cadence = state.creditPolicy.accrualCadenceMs;
  let w = input.projection;
  const events: WorldEvent[] = [];
  const pulse = () => {
    const due = nextResidentEstateCreditDueAt(w);
    if (due !== undefined && due < w.clock.now)
      throw Error('estate-credit-overdue-cursor-recovery-required');
    for (const c of Object.values(w.estateCredit!.customers).sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (c.nextCadenceAt !== w.clock.now) continue;
      const e = residentEstateCreditDueEvent({
        projection: w,
        customerId: c.id,
        requestId: `${input.command.id}:estate-credit:${c.id}:${w.clock.now}`,
        simulationId: input.command.simulationId,
        nextSequence: input.nextSequence + events.length,
      });
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  };
  pulse();
  while (w.clock.now < until) {
    const next = Math.min(
      until,
      (Math.floor(w.clock.now / cadence) + 1) * cadence,
      nextResidentEstateCreditDueAt(w) ?? until,
    );
    const batch = interval({
      ...input,
      projection: w,
      nextSequence: input.nextSequence + events.length,
      command: {
        ...input.command,
        id: asCommandId(`${input.command.id}:estate-interval:${w.clock.now}:${next}`),
        issuedAt: w.clock.now,
        payload: { deltaMs: next - w.clock.now },
      },
    });
    w = batch.reduce(applyWorldEvent, w);
    events.push(...batch);
    if (w.clock.now !== next) throw Error('estate-credit-actual-clock-interval-mismatch');
    pulse();
  }
  return events;
}
