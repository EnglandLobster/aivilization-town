import { sameController } from '@aivilization/authority';
import { moveInventory } from './inventoryFlow';
import {
  materialId,
  validInventory,
  no,
  type MaterialsState,
  type MaterialDecision,
  type MaterialEvent,
  type MaterialReceipt,
} from './model';
import { settleConsumerMaterials } from './reservations';
import {
  activeMaterialCustody,
  type MaterialCustody,
  type MaterialCustodyProof,
} from './custodyModel';

/** Closed v1 physical transformation. Authority to execute comes from the independent logistics commit. */
export function materialCustodyFlow(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  p: MaterialCustodyProof,
): MaterialDecision {
  const records = s.custodies?.records,
    old = records?.[p.id],
    r = s.reservations?.records[p.sourceReservationId],
    source = s.stocks[p.sourceStockId],
    destination = s.stocks[p.destinationStockId];
  if (!records) return no('material-custody-not-enabled');
  if (
    !r ||
    !source ||
    !destination ||
    source.status === 'closed' ||
    (destination.status === 'closed' && p.operation !== 'release')
  )
    return no('material-custody-stock-unavailable');
  if (
    ![p.id, p.consumerId, p.evidenceId, receiptId].every(materialId) ||
    s.receipts[receiptId] ||
    !Number.isSafeInteger(at) ||
    at < Math.max(r.at, old?.at ?? 0, source.at, destination.at) ||
    !validInventory(p.items, s.policy.maxKinds, s.policy.maxQuantity)
  )
    return no('invalid-material-custody-proof');
  if (
    r.stockId !== source.id ||
    source.id === destination.id ||
    r.consumer.domain !== 'logistics' ||
    r.consumer.id !== p.consumerId ||
    !sameController(r.beneficiary, p.beneficiary) ||
    !materialInventoryEqual(r.original, p.items) ||
    (old &&
      (old.consumerId !== p.consumerId ||
        old.sourceReservationId !== r.id ||
        old.sourceStockId !== source.id ||
        old.destinationStockId !== destination.id ||
        !materialInventoryEqual(old.original, p.items)))
  )
    return no('material-custody-reference-mismatch');
  if (old && !activeMaterialCustody(old)) return no('material-custody-ended');
  if (
    (old?.revision ?? 0) >= Number.MAX_SAFE_INTEGER ||
    r.revision >= Number.MAX_SAFE_INTEGER ||
    source.revision >= Number.MAX_SAFE_INTEGER ||
    destination.revision >= Number.MAX_SAFE_INTEGER
  )
    return no('material-custody-revision-limit');
  if (p.operation === 'release') {
    if (old || r.status !== 'offered' || !materialInventoryEqual(r.held, p.items))
      return no('material-custody-source-not-unbound');
    return {
      accepted: true,
      events: [
        {
          type: 'MaterialStockChanged',
          stock: {
            ...source,
            inventory: moveInventory(source.inventory, r.held, 'add'),
            revision: source.revision + 1,
            at,
          },
        },
        {
          type: 'MaterialReservationChanged',
          reservation: {
            ...r,
            held: {},
            returned: moveInventory(r.returned, r.held, 'add'),
            status: 'settled',
            revision: r.revision + 1,
            at,
          },
        },
        {
          type: 'MaterialReceiptRecorded',
          receipt: {
            id: receiptId,
            actorId,
            at,
            stockId: source.id,
            operation: 'custody-release',
            custodyProof: p,
            transfers: [
              {
                from: { kind: 'reservation', id: r.id },
                to: { kind: 'stock', id: source.id },
                items: p.items,
              },
            ],
            conversions: [],
            efforts: [],
          },
        },
      ],
    };
  }
  let next: MaterialCustody,
    events: readonly MaterialEvent[] = [],
    transfers: MaterialReceipt['transfers'] = [];
  if (p.operation === 'reserve') {
    if (
      old ||
      r.status !== 'offered' ||
      at >= r.expiresAt ||
      source.status !== 'open' ||
      destination.status !== 'open'
    )
      return no('material-custody-reservation-unavailable');
    if (
      Object.values(records).some((v) => activeMaterialCustody(v) && v.sourceReservationId === r.id)
    )
      return no('material-reservation-already-in-custody');
    const bound = settleConsumerMaterials(s, actorId, at, receiptId, r.id, r.revision, {
      consumer: r.consumer,
      beneficiary: p.beneficiary,
      evidenceId: p.evidenceId,
    });
    if (!bound.accepted) return bound;
    events = bound.events.filter((e) => e.type !== 'MaterialReceiptRecorded');
    next = {
      id: p.id,
      consumerId: p.consumerId,
      sourceReservationId: r.id,
      sourceStockId: source.id,
      destinationStockId: destination.id,
      original: { ...p.items },
      held: {},
      status: 'reserved',
      revision: 1,
      at,
    };
  } else {
    if (!old) return no('material-custody-not-found');
    if (p.operation === 'load') {
      if (
        old.status !== 'reserved' ||
        r.status !== 'bound' ||
        !materialInventoryEqual(r.held, p.items)
      )
        return no('material-custody-not-reserved');
      events = [
        {
          type: 'MaterialReservationChanged',
          reservation: {
            ...r,
            held: {},
            allocated: moveInventory(r.allocated, p.items, 'add'),
            status: 'settled',
            revision: r.revision + 1,
            at,
          },
        },
      ];
      transfers = [
        {
          from: { kind: 'reservation', id: r.id },
          to: { kind: 'custody', id: old.id },
          items: p.items,
        },
      ];
      next = { ...old, held: { ...p.items }, status: 'loaded', revision: old.revision + 1, at };
    } else if (p.operation === 'cancel') {
      if (old.status !== 'reserved' || r.status !== 'bound')
        return no('material-custody-cannot-cancel-after-loading');
      const released = settleConsumerMaterials(s, actorId, at, receiptId, r.id, r.revision, {
        consumer: r.consumer,
        beneficiary: p.beneficiary,
        evidenceId: p.evidenceId,
        finish: true,
      });
      if (!released.accepted) return released;
      events = released.events.filter((e) => e.type !== 'MaterialReceiptRecorded');
      transfers = [
        {
          from: { kind: 'reservation', id: r.id },
          to: { kind: 'stock', id: source.id },
          items: p.items,
        },
      ];
      next = { ...old, status: 'cancelled', revision: old.revision + 1, at };
    } else if (p.operation === 'deliver' || p.operation === 'return') {
      if (old.status !== 'loaded' || !materialInventoryEqual(old.held, p.items))
        return no('material-custody-not-loaded');
      const target = p.operation === 'deliver' ? destination : source;
      events = [
        {
          type: 'MaterialStockChanged',
          stock: {
            ...target,
            inventory: moveInventory(target.inventory, p.items, 'add'),
            revision: target.revision + 1,
            at,
          },
        },
      ];
      transfers = [
        {
          from: { kind: 'custody', id: old.id },
          to: { kind: 'stock', id: target.id },
          items: p.items,
        },
      ];
      next = {
        ...old,
        held: {},
        status: p.operation === 'deliver' ? 'delivered' : 'returned',
        revision: old.revision + 1,
        at,
      };
    } else return no('invalid-material-custody-operation');
  }
  return {
    accepted: true,
    events: [
      ...events,
      { type: 'MaterialCustodyChanged', custody: next },
      {
        type: 'MaterialReceiptRecorded',
        receipt: {
          id: receiptId,
          actorId,
          at,
          stockId: source.id,
          operation: `custody-${p.operation}`,
          custodyProof: p,
          transfers,
          conversions: [],
          efforts: [],
        },
      },
    ],
  };
}
export const materialInventoryEqual = (
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (k) =>
      Number.isFinite(a[k] ?? 0) &&
      Number.isFinite(b[k] ?? 0) &&
      Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-8,
  );
