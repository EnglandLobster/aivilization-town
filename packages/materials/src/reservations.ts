import { materialAdministration, type MaterialAdministration } from './administration';
import {
  resourceAdministration,
  sameController,
  validController,
  validResourcePrincipal,
} from '@aivilization/authority';
import { activeMaterialCustody } from './custodyModel';
import { type Inventory } from '@aivilization/economy';
import { fitsStock, containsInventory, moveInventory } from './inventoryFlow';
import {
  materialId,
  no,
  validInventory,
  type MaterialsState,
  type MaterialPorts,
  type MaterialDecision,
  type MaterialEvent,
  type MaterialReceipt,
} from './model';
import type {
  MaterialReservationOffer,
  PrincipalMaterialReservationOffer,
  MaterialConsumerAuthorization,
  MaterialReservation,
} from './reservationModel';
export const sameMaterialConsumer = (
  a: MaterialReservation['consumer'],
  b: MaterialReservation['consumer'],
) => a.domain === b.domain && a.id === b.id;
export const stockHasReservedMaterials = (s: MaterialsState, id: string) =>
  Object.values(s.reservations?.records ?? {}).some(
    (v) => v.stockId === id && v.status !== 'settled',
  ) ||
  Object.values(s.custodies?.records ?? {}).some(
    (v) => activeMaterialCustody(v) && (v.sourceStockId === id || v.destinationStockId === id),
  );
function receiptEvents(
  s: MaterialsState,
  r: MaterialReservation,
  actorId: string,
  receiptId: string,
  operation: string,
  at: number,
  inventory: Inventory,
  transfers: MaterialReceipt['transfers'],
  allocations: NonNullable<MaterialReceipt['allocations']> = [],
  grant?: MaterialAdministration,
): readonly MaterialEvent[] {
  const stock = s.stocks[r.stockId]!;
  return [
    {
      type: 'MaterialStockChanged',
      stock: { ...stock, inventory, revision: stock.revision + 1, at },
    },
    { type: 'MaterialReservationChanged', reservation: r },
    {
      type: 'MaterialReceiptRecorded',
      receipt: {
        id: receiptId,
        actorId,
        at,
        operation,
        stockId: stock.id,
        reservationId: r.id,
        transfers,
        conversions: [],
        efforts: [],
        ...(allocations.length ? { allocations } : {}),
        ...(grant?.decisionId ? { decisionId: grant.decisionId } : {}),
        ...(grant?.principalAuthorization
          ? { principalAuthorization: grant.principalAuthorization }
          : {}),
      },
    },
  ];
}
export function offerMaterialReservation(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  c: MaterialReservationOffer,
  ports: MaterialPorts,
): MaterialDecision {
  return offerReservation(s, actorId, at, receiptId, c, ports, false);
}
export function offerPrincipalMaterialReservation(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  c: PrincipalMaterialReservationOffer,
  ports: MaterialPorts,
): MaterialDecision {
  return offerReservation(s, actorId, at, receiptId, c, ports, true);
}
function offerReservation(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  c: PrincipalMaterialReservationOffer,
  ports: MaterialPorts,
  principal: boolean,
): MaterialDecision {
  const state = s.reservations,
    stock = s.stocks[c.stockId];
  if (!state) return no('material-reservations-not-enabled');
  if (!stock || stock.status !== 'open') return no('material-stock-unavailable');
  if (
    principal &&
    (!s.resourcePrincipals || stock.control.policyVersion !== 'resource-principals-v2')
  )
    return no('material-principal-reservation-not-enabled');
  if (principal && c.consumer.domain !== 'premises')
    return no('principal-material-consumer-not-connected');
  const grant = principal
    ? materialAdministration(stock, actorId, { type: 'reserve-materials', offer: c }, ports)
    : resourceAdministration(stock, actorId, ports.authorize);
  if (!grant) return no('resource-controller-authority-required');
  if (
    !ports.exists(actorId) ||
    !Number.isSafeInteger(at) ||
    at < stock.at ||
    !materialId(receiptId) ||
    s.receipts[receiptId]
  )
    return no('invalid-material-actor-time-or-receipt');
  if (stock.revision !== c.expectedStockRevision || stock.revision >= Number.MAX_SAFE_INTEGER)
    return no('material-stock-revision-conflict');
  if (
    !materialId(c.id) ||
    state.records[c.id] ||
    !validInventory(c.items, s.policy.maxKinds, s.policy.maxQuantity) ||
    !(principal
      ? validResourcePrincipal(c.beneficiary) && ports.principalAvailable?.(c.beneficiary)
      : (c.beneficiary.kind === 'resident' || c.beneficiary.kind === 'collective') &&
        validController({ kind: c.beneficiary.kind, id: c.beneficiary.id }) &&
        ports.controlAvailable({ kind: c.beneficiary.kind, id: c.beneficiary.id })) ||
    !['premises', 'services', 'logistics'].includes(c.consumer.domain) ||
    !materialId(c.consumer.id) ||
    !c.terms.trim() ||
    c.terms.length > state.policy.maxTermsChars ||
    !Number.isSafeInteger(c.expiresAt) ||
    c.expiresAt <= at ||
    c.expiresAt > at + state.policy.maxHorizonMs
  )
    return no('invalid-material-reservation');
  if (
    Object.keys(state.records).length >= state.policy.maxTotal ||
    Object.values(state.records).filter((r) => r.stockId === stock.id).length >=
      state.policy.maxPerStock
  )
    return no('material-reservation-limit');
  if (!containsInventory(stock.inventory, c.items)) return no('insufficient-stock-materials');
  const r: MaterialReservation = {
    ...(principal ? { principalVersion: 'resource-principals-v2' as const } : {}),
    id: c.id,
    stockId: stock.id,
    beneficiary: { ...c.beneficiary },
    consumer: { ...c.consumer },
    original: { ...c.items },
    held: { ...c.items },
    allocated: {},
    returned: {},
    createdBy: actorId,
    ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
    terms: c.terms,
    expiresAt: c.expiresAt,
    revision: 1,
    at,
    status: 'offered',
  };
  const inventory = moveInventory(stock.inventory, c.items, 'remove');
  return {
    accepted: true,
    events: receiptEvents(
      s,
      r,
      actorId,
      receiptId,
      'reserve-materials',
      at,
      inventory,
      [
        {
          from: { kind: 'stock', id: stock.id },
          to: { kind: 'reservation', id: r.id },
          items: c.items,
        },
      ],
      [],
      grant,
    ),
  };
}
/** Reserve owner may withdraw only before the target domain independently binds this offer. */
export function returnUnboundMaterialReservation(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  id: string,
  revision: number,
  ports: MaterialPorts,
  expired = false,
): MaterialDecision {
  const r = s.reservations?.records[id],
    stock = r && s.stocks[r.stockId];
  if (!r || !stock || r.status !== 'offered') return no('material-reservation-not-offered');
  if (
    r.revision !== revision ||
    r.revision >= Number.MAX_SAFE_INTEGER ||
    stock.revision >= Number.MAX_SAFE_INTEGER
  )
    return no('material-reservation-revision-conflict');
  if (!Number.isSafeInteger(at) || at < r.at || !materialId(receiptId) || s.receipts[receiptId])
    return no('invalid-material-time-or-receipt');
  const grant = expired
    ? undefined
    : materialAdministration(
        stock,
        actorId,
        { type: 'reservation-withdrawn', id, expectedRevision: revision },
        ports,
      );
  if (expired ? at < r.expiresAt : !grant) return no('material-reservation-return-not-authorized');
  const inventory = moveInventory(stock.inventory, r.held, 'add'),
    next = {
      ...r,
      held: {},
      returned: moveInventory(r.returned, r.held, 'add'),
      status: 'settled' as const,
      revision: r.revision + 1,
      at,
    };
  if (
    !fitsStock(
      {
        ...s,
        reservations: { ...s.reservations, records: { ...s.reservations.records, [r.id]: next } },
      },
      stock.id,
      inventory,
      ports.locationStorageCapacity?.(stock.locationId),
    )
  )
    return no('material-stock-capacity');
  return {
    accepted: true,
    events: receiptEvents(
      s,
      next,
      actorId,
      receiptId,
      expired ? 'reservation-expired' : 'reservation-withdrawn',
      at,
      inventory,
      [
        {
          from: { kind: 'reservation', id: r.id },
          to: { kind: 'stock', id: stock.id },
          items: r.held,
        },
      ],
      [],
      grant,
    ),
  };
}
/** Only the owning domain's validated transition supplies this evidence. Its world adapter must commit and verify the consumer events in the same transaction. */
export function settleConsumerMaterials(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  id: string,
  revision: number,
  proof: MaterialConsumerAuthorization,
): MaterialDecision {
  const r = s.reservations?.records[id],
    stock = r && s.stocks[r.stockId];
  if (!r || !stock || r.status === 'settled' || stock.status === 'closed')
    return no('material-reservation-unavailable');
  if (
    r.revision !== revision ||
    r.revision >= Number.MAX_SAFE_INTEGER ||
    stock.revision >= Number.MAX_SAFE_INTEGER
  )
    return no('material-reservation-revision-conflict');
  if (
    !Number.isSafeInteger(at) ||
    at < r.at ||
    !materialId(receiptId) ||
    s.receipts[receiptId] ||
    !materialId(proof.evidenceId)
  )
    return no('invalid-material-time-or-evidence');
  if (
    !sameMaterialConsumer(r.consumer, proof.consumer) ||
    !sameController(r.beneficiary, proof.beneficiary)
  )
    return no('material-consumer-mismatch');
  if (r.status === 'offered' && at >= r.expiresAt) return no('material-reservation-expired');
  const allocation = proof.allocation ?? {};
  if (
    !validInventory(allocation, s.policy.maxKinds, s.policy.maxQuantity, true) ||
    !containsInventory(r.held, allocation)
  )
    return no('invalid-material-allocation');
  const remaining = moveInventory(r.held, allocation, 'remove'),
    returned = proof.finish ? remaining : {};
  const next: MaterialReservation = {
    ...r,
    status: proof.finish ? 'settled' : 'bound',
    held: proof.finish ? {} : remaining,
    allocated: moveInventory(r.allocated, allocation, 'add'),
    returned: moveInventory(r.returned, returned, 'add'),
    revision: r.revision + 1,
    at,
    ...(r.status === 'offered' ? { boundBy: actorId } : {}),
  };
  const inventory = moveInventory(stock.inventory, returned, 'add');
  return {
    accepted: true,
    events: receiptEvents(
      s,
      next,
      actorId,
      receiptId,
      'consumer-materials',
      at,
      inventory,
      Object.keys(returned).length
        ? [
            {
              from: { kind: 'reservation', id: r.id },
              to: { kind: 'stock', id: stock.id },
              items: returned,
            },
          ]
        : [],
      Object.keys(allocation).length
        ? [
            {
              reservationId: r.id,
              consumer: r.consumer,
              items: allocation,
              evidenceId: proof.evidenceId,
            },
          ]
        : [],
    ),
  };
}
