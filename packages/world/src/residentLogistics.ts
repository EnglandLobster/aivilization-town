import type { ResidentFreightCustodyPacket } from './residentFreightCustody';
import { logisticsEstateCashSource } from './logisticsEstateAccounting';
import {
  prepareResidentEstateCashBatch,
  type ResidentEstateCashBatch,
} from './residentEstateCashBatch';
import {
  decideLogistics,
  advanceFreight,
  applyLogisticsCommit,
  LOGISTICS_POLICY,
  type LogisticsPolicy,
  type LogisticsCommand,
  type LogisticsEvent,
  type LogisticsDecision,
} from '@aivilization/logistics';
import { tradeSourceStartFailure } from '@aivilization/commerce';
import {
  applyMaterialCommit,
  settleMaterialCustody,
  MATERIAL_CUSTODY_POLICY,
  type MaterialEvent,
  type MaterialCustodyProof,
} from '@aivilization/materials';
import { premisesStorageCapacity } from '@aivilization/premises';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { residentLogisticsPorts, type LogisticsAuthorization } from './logisticsPorts';
import { premisesStorageControllerAllowed } from './premisesAccess';
import { prepareEscrowCommonTransfers, residentEscrowIncoming } from './residentEscrowAccounting';
export type ResidentLogisticsPayload = {
  readonly policyVersion: 'resident-logistics-v1';
  readonly custody?: ResidentFreightCustodyPacket;
  readonly estateCashBatch?: ResidentEstateCashBatch;
  readonly actorId: string;
  readonly events: readonly LogisticsEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly materialProofs: readonly MaterialCustodyProof[];
  readonly materialEvents: readonly MaterialEvent[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
};
type Context = {
  projection: WorldProjection;
  actorId: string;
  simulationId: string;
  requestId: string;
  nextSequence: number;
  authorization: LogisticsAuthorization;
};
function wrap(input: Context, decision: LogisticsDecision) {
  if (!decision.accepted) return decision;
  if (!decision.events.length) return { accepted: true as const, events: [] };
  const w = input.projection,
    at = w.clock.now,
    d = decision,
    logistics = applyLogisticsCommit(w.logistics, d.events, d.transactions, d.materialProofs),
    materialEvents: MaterialEvent[] = [];
  let materials = w.materials;
  for (const [index, proof] of d.materialProofs.entries()) {
    if (!materials) return { accepted: false as const, reason: 'logistics-materials-required' };
    const result = settleMaterialCustody(
      materials,
      input.actorId,
      at,
      `${input.requestId}-m${index}`,
      proof,
      (id) => (w.premises ? premisesStorageCapacity(w.premises, id) : undefined),
    );
    if (!result.accepted) return result;
    materials = applyMaterialCommit(materials, result.events, [], [proof]).state;
    materialEvents.push(...result.events);
  }
  const changed = d.events.find((e) => e.type === 'FreightChanged');
  const accounting = prepareEscrowCommonTransfers({
    state: w.commonAccounts,
    context: 'logistics',
    referenceId: changed?.freight.id ?? 'enable',
    actorId: input.actorId,
    at,
    requestId: input.requestId,
    transactions: d.transactions,
  });
  if (!accounting.accepted) return accounting;
  for (const account of Object.values(accounting.state?.accounts ?? {}))
    if (
      account.balance + residentEscrowIncoming({ ...w, logistics }, account.id) >
      accounting.state!.policy.maxBalance + 1e-8
    )
      return { accepted: false as const, reason: 'logistics-common-account-refund-capacity' };
  const estateSource = logisticsEstateCashSource(w, d.events, d.transactions);
  const estateCashBatch = estateSource
    ? prepareResidentEstateCashBatch(w, estateSource, d.transactions, at)
    : undefined;
  const payload: ResidentLogisticsPayload = {
    ...(estateCashBatch ? { estateCashBatch } : {}),
    policyVersion: LOGISTICS_POLICY.version,
    actorId: input.actorId,
    events: d.events,
    transactions: d.transactions,
    materialProofs: d.materialProofs,
    materialEvents,
    commonAccountEvents: accounting.events,
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:logistics`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: at,
        type: 'ResidentLogisticsCommitted',
        payload,
      }),
    ],
  };
}
export function residentLogisticsEvent(input: Context & { command: LogisticsCommand }) {
  if (!input.projection.logistics)
    return { accepted: false as const, reason: 'logistics-not-enabled' };
  if (input.command.type === 'accept') {
    const f = input.projection.logistics.freight[input.command.id];
    if (
      f &&
      !premisesStorageControllerAllowed(input.projection, f.recipient, f.destinationLocationId)
    )
      return { accepted: false as const, reason: 'freight-destination-storage-permit-required' };
  }
  if (input.command.type === 'load') {
    const reason = tradeSourceStartFailure(input.projection.residentTrade, {
      kind: 'freight',
      id: input.command.id,
    });
    if (reason) return { accepted: false as const, reason };
  }
  return wrap(
    input,
    decideLogistics(
      input.projection.logistics,
      input.actorId,
      input.projection.clock.now,
      input.command,
      residentLogisticsPorts(input.projection, input.authorization),
    ),
  );
}
export function advanceResidentLogistics(input: Omit<Context, 'actorId' | 'authorization'>) {
  let projection = input.projection;
  const events: WorldEvent[] = [];
  for (const id of Object.keys(projection.logistics?.freight ?? {}).sort()) {
    const authorization = { authorize: () => undefined, controllerAvailable: () => false };
    const result = wrap(
      {
        ...input,
        projection,
        authorization,
        actorId: 'system',
        requestId: `${input.requestId}-${events.length}`,
        nextSequence: input.nextSequence + events.length,
      },
      advanceFreight(
        projection.logistics!,
        id,
        projection.clock.now,
        residentLogisticsPorts(projection, authorization),
      ),
    );
    if (!result.accepted) throw Error(`logistics-settlement-failed:${id}:${result.reason}`);
    for (const event of result.events) {
      projection = applyWorldEvent(projection, event);
      events.push(event);
    }
  }
  return events;
}
export function enableResidentLogisticsEvent(
  input: Omit<Context, 'actorId' | 'authorization'> & { policy: LogisticsPolicy },
) {
  const w = input.projection;
  if (w.logistics) return { accepted: false as const, reason: 'logistics-already-enabled' };
  if (!w.materials?.reservations || !w.premises?.facilityUsePolicy)
    return { accepted: false as const, reason: 'logistics-materials-and-facility-use-required' };
  if (
    Object.keys(w.transitByAgent ?? {}).length ||
    Object.values(w.residentMobility?.vehicles ?? {}).some((v) => v.journey)
  )
    return { accepted: false as const, reason: 'logistics-upgrade-await-existing-travel' };
  const payload: ResidentLogisticsPayload = {
    policyVersion: input.policy.version,
    actorId: 'system',
    events: [{ type: 'LogisticsEnabled', policy: input.policy }],
    transactions: [],
    materialProofs: [],
    materialEvents: [{ type: 'MaterialCustodyEnabled', policy: MATERIAL_CUSTODY_POLICY }],
    commonAccountEvents: [],
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:logistics-enabled`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        type: 'ResidentLogisticsCommitted',
        payload,
      }),
    ],
  };
}
