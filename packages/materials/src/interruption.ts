import {
  materialId,
  type MaterialsState,
  type MaterialEvent,
  type MaterialDecision,
} from './model';
export const MATERIAL_INTERRUPTION_VERSION = 'production-interrupted-v1' as const;
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = Object.entries(a),
    y = Object.entries(b);
  return (
    x.length === y.length && x.every(([k, v]) => Object.hasOwn(b, k) && equal(v, Reflect.get(b, k)))
  );
}
/** System interruption after the application has established unavailability.
 * No new labor is inferred: callers must first settle exactly to this boundary. */
export function interruptMaterialProduction(
  s: MaterialsState,
  id: string,
  at: number,
  receiptId: string,
): MaterialDecision {
  const job = s.productions[id],
    session = job?.session;
  if (!job || job.status !== 'open' || !session)
    return { accepted: false, reason: 'active-material-work-required' };
  if (!Number.isSafeInteger(at) || at !== session.settledAt || at !== job.at)
    return { accepted: false, reason: 'material-interruption-needs-settled-boundary' };
  if (!materialId(receiptId) || s.receipts[receiptId] || job.revision >= Number.MAX_SAFE_INTEGER)
    return { accepted: false, reason: 'invalid-material-interruption-receipt-or-revision' };
  const { session: prior, ...rest } = job;
  return {
    accepted: true,
    release: prior!,
    events: [
      {
        type: 'MaterialProductionChanged',
        production: {
          ...rest,
          revision: job.revision + 1,
          lastStop: { actorId: session.actorId, at, reason: 'worker-unavailable' },
        },
      },
      {
        type: 'MaterialReceiptRecorded',
        receipt: {
          id: receiptId,
          actorId: 'system',
          at,
          operation: MATERIAL_INTERRUPTION_VERSION,
          productionId: id,
          stockId: job.stockId,
          endReason: 'worker-unavailable',
          transfers: [],
          conversions: [],
          efforts: [],
        },
      },
    ],
  };
}
/** Validate recorded facts, without rerunning the decision or inventing elapsed work. */
export function assertMaterialInterruption(
  before: MaterialsState | undefined,
  events: readonly MaterialEvent[],
): void {
  const receipts = events.filter(
    (e) =>
      e.type === 'MaterialReceiptRecorded' && e.receipt.operation === MATERIAL_INTERRUPTION_VERSION,
  );
  if (!receipts.length) return;
  const changed = events[0],
    recorded = events[1];
  if (
    !before ||
    events.length !== 2 ||
    receipts.length !== 1 ||
    changed?.type !== 'MaterialProductionChanged' ||
    recorded?.type !== 'MaterialReceiptRecorded'
  )
    throw Error('invalid-material-interruption-events');
  const r = recorded.receipt,
    old = before.productions[r.productionId ?? ''],
    s = old?.session;
  if (
    !old ||
    !s ||
    old.status !== 'open' ||
    r.at !== s.settledAt ||
    r.at !== old.at ||
    r.actorId !== 'system' ||
    r.stockId !== old.stockId ||
    r.endReason !== 'worker-unavailable' ||
    r.transfers.length ||
    r.conversions.length ||
    r.efforts.length ||
    r.decisionId ||
    r.principalAuthorization ||
    r.reservationId ||
    r.custodyProof
  )
    throw Error('material-interruption-source-mismatch');
  const { session, ...rest } = old;
  if (
    !session ||
    !equal(changed.production, {
      ...rest,
      revision: old.revision + 1,
      lastStop: { actorId: s.actorId, at: r.at, reason: 'worker-unavailable' },
    })
  )
    throw Error('material-interruption-changed-work-or-assets');
}
