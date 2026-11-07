import { principalOperationKey, sameController } from '@aivilization/authority';
import type { MaterialsState, MaterialReceipt, MaterialEvent } from './model';

/** Bind the approved reservation parameters to the actual held/returned material, not just to a stock ID. */
export function assertPrincipalReservationReceipt(
  before: MaterialsState | undefined,
  after: MaterialsState,
  r: MaterialReceipt,
) {
  const id = r.reservationId,
    old = id && before?.reservations?.records[id],
    next = id && after.reservations?.records[id],
    c = r.principalAuthorization?.request.operation.arguments;
  if (!next || next.stockId !== r.stockId || next.at !== r.at)
    throw Error('principal-reservation-receipt-mismatch');
  if (r.conversions.length || r.efforts.length || r.allocations?.length)
    throw Error('principal-reservation-unexpected-effect');
  if (r.operation === 'reserve-materials') {
    const offer = c?.offer;
    if (
      !offer ||
      typeof offer !== 'object' ||
      Array.isArray(offer) ||
      old ||
      next.principalVersion !== 'resource-principals-v2' ||
      principalOperationKey(offer) !==
        principalOperationKey({
          id: next.id,
          stockId: next.stockId,
          expectedStockRevision: before?.stocks[next.stockId]?.revision ?? -1,
          items: next.original,
          beneficiary: next.beneficiary,
          consumer: next.consumer,
          terms: next.terms,
          expiresAt: next.expiresAt,
        }) ||
      next.createdBy !== r.actorId ||
      next.status !== 'offered' ||
      next.boundBy !== undefined ||
      next.revision !== 1 ||
      next.consumer.domain !== 'premises' ||
      next.expiresAt <= r.at ||
      !after.reservations ||
      next.expiresAt > r.at + after.reservations.policy.maxHorizonMs ||
      principalOperationKey(r.transfers) !==
        principalOperationKey([
          {
            from: { kind: 'stock', id: next.stockId },
            to: { kind: 'reservation', id: next.id },
            items: next.original,
          },
        ])
    )
      throw Error('principal-reservation-offer-mismatch');
    return;
  }
  if (
    !old ||
    old.status !== 'offered' ||
    next.status !== 'settled' ||
    next.revision !== old.revision + 1 ||
    next.boundBy !== undefined ||
    (r.operation === 'reservation-expired'
      ? r.at < old.expiresAt
      : c?.id !== old.id || c.expectedRevision !== old.revision) ||
    principalOperationKey(r.transfers) !==
      principalOperationKey([
        {
          from: { kind: 'reservation', id: old.id },
          to: { kind: 'stock', id: old.stockId },
          items: old.held,
        },
      ])
  )
    throw Error('principal-reservation-return-mismatch');
}

/** Every v2 reservation transition needs a unique receipt; source administration and consumer acceptance are distinct. */
export function assertPrincipalReservationTransitions(
  before: MaterialsState | undefined,
  after: MaterialsState,
  events: readonly MaterialEvent[],
) {
  for (const event of events) {
    if (event.type !== 'MaterialReservationChanged' || !event.reservation.principalVersion)
      continue;
    const next = event.reservation,
      old = before?.reservations?.records[next.id],
      receipts = events.flatMap((e) =>
        e.type === 'MaterialReceiptRecorded' && e.receipt.reservationId === next.id
          ? [e.receipt]
          : [],
      );
    if (receipts.length !== 1) throw Error('principal-reservation-receipt-required');
    const r = receipts[0]!;
    if (r.operation === 'consumer-materials') {
      if (
        !old ||
        !['offered', 'bound'].includes(old.status) ||
        (old.status === 'offered' && r.at >= old.expiresAt) ||
        !['bound', 'settled'].includes(next.status) ||
        next.boundBy !== (old.boundBy ?? r.actorId) ||
        next.stockId !== r.stockId ||
        next.at !== r.at ||
        !sameController(old.beneficiary, next.beneficiary)
      )
        throw Error('principal-reservation-consumer-mismatch');
    } else if (
      ['reserve-materials', 'reservation-withdrawn', 'reservation-expired'].includes(r.operation)
    ) {
      assertPrincipalReservationReceipt(before, after, r);
    } else throw Error('principal-reservation-transition-not-supported');
  }
}
