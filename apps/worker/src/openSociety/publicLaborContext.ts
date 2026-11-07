import type { WorldProjection } from '@aivilization/world';
export function publicLaborDetails(w: WorldProjection, id: string) {
  const s = w.publicLabor?.process.sessions[id];
  if (!s) return undefined;
  return {
    session: s,
    source: { kind: s.terms.sourceKind, id: s.terms.sourceId },
    protectedGrossRemaining: (s.terms.grossMicros - s.paidMicros - s.refundedMicros) / 1e6,
    earned: s.earnedMicros / 1e6,
    paidGross: s.paidMicros / 1e6,
    paidNet: (s.paidMicros - s.withheldMicros) / 1e6,
    tax: s.withheldMicros / 1e6,
    returnedToTreasury: s.refundedMicros / 1e6,
    stopWith: `town life stop-work --id ${s.id} --expected-revision ${s.revision}`,
    note: 'Initial public employment, not resident-created procurement. Gross wage is protected in treasury-funded escrow before work. Actual wages pay automatically; no separate claim or product is created.',
  };
}
export function activePublicLaborContext(w: WorldProjection, actorId: string) {
  const state = w.publicLabor,
    id = state?.process.activeByActor[actorId],
    s = id ? state?.process.sessions[id] : undefined;
  if (!s) return undefined;
  return {
    id: s.id,
    revision: s.revision,
    sourceKind: s.terms.sourceKind,
    startedAt: s.startedAt,
    until: s.until,
    settledAt: s.settledAt,
    elapsedMs: s.elapsedMs,
    earned: s.earnedMicros / 1e6,
    paidGross: s.paidMicros / 1e6,
    protectedGrossRemaining: (s.terms.grossMicros - s.paidMicros) / 1e6,
    readWith: `town city observe --view labor --section ${s.id}`,
    stopWith: `town life stop-work --id ${s.id} --expected-revision ${s.revision}`,
  };
}
