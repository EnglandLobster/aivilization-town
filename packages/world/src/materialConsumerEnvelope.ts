import type { MaterialEvent, MaterialsState } from '@aivilization/materials';

/** Consumer settlement cannot smuggle a stock administrator's approval into another aggregate's envelope. */
export function assertMaterialConsumerEnvelope(
  before: MaterialsState | undefined,
  events: readonly MaterialEvent[],
  domain: 'premises' | 'services' | 'logistics',
) {
  for (const e of events) {
    if (e.type === 'MaterialResourcePrincipalsEnabled' || e.type === 'MaterialPrincipalControlChanged' ||
      (e.type === 'MaterialReceiptRecorded' && e.receipt.principalAuthorization))
      throw Error('principal-administration-needs-authority-envelope');
    if (e.type === 'MaterialReservationChanged' && e.reservation.principalVersion) {
      const r = e.reservation;
      if (!before?.reservations?.records[r.id] || r.consumer.domain !== domain ||
        !events.some(v => v.type === 'MaterialReceiptRecorded' &&
          v.receipt.reservationId === r.id && v.receipt.operation === 'consumer-materials'))
        throw Error('principal-reservation-needs-owning-consumer');
    }
  }
}
