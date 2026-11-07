import type { FreightCustodyCollectivePort } from '../freightCustodyAuthority';
import { applyResidentFreightCustody } from '../residentFreightCustody';
import { logisticsEstateCashSource } from '../logisticsEstateAccounting';
import { assertMaterialConsumerEnvelope } from '../materialConsumerEnvelope';
import { premisesStorageControllerAllowed } from '../premisesAccess';
import {
  applyLogisticsCommit,
  freightCustodian,
  freightEscrowBalance,
  LOGISTICS_ESCROW,
  freightFactsEqual as equal,
} from '@aivilization/logistics';
import { applyMaterialCommit } from '@aivilization/materials';
import { tradeSourceStartFailure } from '@aivilization/commerce';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
import { applyEscrowAccounting } from '../residentEscrowAccounting';

export function applyLogisticsProjection(
  w: WorldProjection,
  event: WorldEvent,
  custodyAuthority?: FreightCustodyCollectivePort,
): WorldProjection | undefined {
  if (event.type !== 'ResidentLogisticsCommitted') return undefined;
  const p = event.payload;
  if (p.policyVersion !== 'resident-logistics-v1' || event.occurredAt !== w.clock.now)
    throw Error('invalid-logistics-commit-version-or-time');
  if (p.custody) return applyResidentFreightCustody(w, event, custodyAuthority);
  for (const e of p.events)
    if (e.type === 'FreightChanged') {
      const f = e.freight,
        old = w.logistics?.freight[f.id];
      if (
        ((old?.status === 'offered' && f.status === 'accepted') ||
          (old?.status !== 'delivered' && f.status === 'delivered')) &&
        !premisesStorageControllerAllowed(w, f.recipient, f.destinationLocationId)
      )
        throw Error('freight-destination-storage-permit-required');
    }
  assertMaterialConsumerEnvelope(w.materials, p.materialEvents, 'logistics');
  const logistics = applyLogisticsCommit(w.logistics, p.events, p.transactions, p.materialProofs),
    material = applyMaterialCommit(w.materials, p.materialEvents, [], p.materialProofs);
  if (Object.keys(material.residentDeltas).length || material.efforts.length)
    throw Error('unrelated-logistics-material-effects');
  const enabling = p.events.some((e) => e.type === 'LogisticsEnabled');
  if (enabling) {
    if (
      w.logistics ||
      p.actorId !== 'system' ||
      !w.premises?.facilityUsePolicy ||
      Object.keys(w.transitByAgent ?? {}).length ||
      Object.values(w.residentMobility?.vehicles ?? {}).some((v) => v.journey) ||
      p.materialEvents.length !== 1 ||
      p.materialEvents[0]?.type !== 'MaterialCustodyEnabled'
    )
      throw Error('invalid-logistics-enablement');
  } else {
    // Every material event belongs to one exact custody packet. No unrelated stock, recipe or enable effects.
    const packetSizes = p.materialProofs.reduce(
      (n, proof) => n + (proof.operation === 'reserve' || proof.operation === 'cancel' ? 4 : 3),
      0,
    );
    if (
      packetSizes !== p.materialEvents.length ||
      p.materialEvents.some(
        (e) =>
          ![
            'MaterialStockChanged',
            'MaterialReservationChanged',
            'MaterialCustodyChanged',
            'MaterialReceiptRecorded',
          ].includes(e.type),
      )
    )
      throw Error('unrelated-logistics-material-event');
  }
  for (const e of p.events)
    if (e.type === 'FreightReceiptRecorded') {
      const receipt = e.receipt,
        f = logistics.freight[receipt.freightId]!;
      if (
        receipt.operation === 'load' &&
        tradeSourceStartFailure(w.residentTrade, { kind: 'freight', id: f.id })
      )
        throw Error('trade-unfunded-freight-cannot-start');
      if (receipt.actorId !== p.actorId || receipt.at !== w.clock.now)
        throw Error('freight-actor-or-time-mismatch');
      const c =
        receipt.operation === 'offer'
          ? f.controller
          : receipt.operation === 'accept'
            ? f.recipient
            : receipt.operation === 'fund'
              ? f.payer.sector === 'agent'
                ? { kind: 'resident', id: f.payer.id }
                : { kind: 'collective', id: w.commonAccounts?.accounts[f.payer.id]?.collectiveId }
              : undefined;
      if (c && (c.kind === 'resident' ? c.id !== p.actorId : !receipt.decisionId))
        throw Error('freight-resource-consent-mismatch');
      if (
        receipt.operation === 'load' ||
        receipt.operation === 'deliver' ||
        receipt.operation === 'return'
      ) {
        const holder = freightCustodian(w.logistics?.custody, f);
        if (p.actorId !== holder.carrierId) throw Error('freight-personal-carrier-required');
        // Verify recorded physical facts, not current pricing, authority, ACL or load policies.
        const place =
          receipt.operation === 'deliver' ? f.destinationLocationId : f.sourceLocationId;
        const actor = w.agents[holder.carrierId],
          vehicle = holder.vehicleId ? w.residentMobility?.vehicles[holder.vehicleId] : undefined;
        if (
          !actor ||
          actor.locationId !== place ||
          w.transitByAgent?.[holder.carrierId] ||
          (w.activityTimeByAgent[holder.carrierId]?.availableAt ?? 0) > w.clock.now ||
          (holder.vehicleId && (!vehicle || vehicle.locationId !== place || vehicle.journey))
        )
          throw Error('freight-actual-custody-required');
      }
    }
  // Custody proofs include final facts; body, unrelated inventories and stock control are not transportation outputs.
  for (const e of p.materialEvents)
    if (e.type === 'MaterialStockChanged') {
      const old = w.materials?.stocks[e.stock.id];
      if (
        !old ||
        !equal({ ...e.stock, inventory: old.inventory, revision: old.revision, at: old.at }, old)
      )
        throw Error('unrelated-freight-stock-control-change');
    }
  const estateSource = logisticsEstateCashSource(w, p.events, p.transactions);
  if (!!estateSource !== !!p.estateCashBatch)
    throw Error('logistics-estate-receipt-coverage-mismatch');
  const { agents, common, residentExits } = applyEscrowAccounting({
    ...(estateSource && p.estateCashBatch
      ? {
          estateCashBatch: {
            source: estateSource,
            originalTransactions: p.transactions,
            batch: p.estateCashBatch,
          },
        }
      : {}),
    settlementAt: event.occurredAt,
    world: w,
    context: 'logistics',
    actorId: p.actorId,
    referenceIds: p.events.filter((e) => e.type === 'FreightChanged').map((e) => e.freight.id),
    transactions: p.estateCashBatch
      ? p.estateCashBatch.effects.flatMap((e) => e.resolution.transactions)
      : p.transactions,
    commonEvents: p.commonAccountEvents,
    escrowAccount: LOGISTICS_ESCROW,
    beforeEscrow: freightEscrowBalance(w.logistics),
    afterEscrow: freightEscrowBalance(logistics),
  });
  return {
    ...w,
    logistics,
    ...(residentExits ? { residentExits } : {}),
    materials: material.state,
    agents,
    ...(common ? { commonAccounts: common } : {}),
  };
}
