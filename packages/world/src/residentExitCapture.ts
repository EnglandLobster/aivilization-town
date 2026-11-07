import {
  prepareEstateCreditDeparture,
  assertResidentEstateCreditSnapshot,
} from './residentEstateCredit';
import type { EstateCreditEvent } from '@aivilization/credit';
import type { SuccessionEvent } from '@aivilization/society';
import {
  prepareResidentSuccessionDeparture,
  applyResidentSuccessionDeparture,
} from './residentSuccessionResources';
import {
  applyEstateCashEvent,
  captureEstateCash,
  assertMoneySupplyDelta,
  type EstateCashEvent,
  type AccountingTransaction,
} from '@aivilization/economy';
import {
  applyEstateMaterialEvent,
  captureEstateBackpack,
  type EstateMaterialEvent,
  type EstateMaterialFlow,
} from '@aivilization/materials';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  assertResidentExitSnapshot,
  type ResidentExitRecord,
  type ResidentExitState,
  type ResidentExitPreservationPolicy,
} from './residentExitPreservation';
export type ResidentPopulationDeparture = Extract<
  WorldEvent,
  { type: 'AgentDied' | 'AgentEmigrated' }
>;
export type ResidentExitCapture = {
  readonly policyVersion: ResidentExitPreservationPolicy['version'];
  readonly record: ResidentExitRecord;
  readonly cashEvents: readonly EstateCashEvent[];
  readonly materialEvents: readonly EstateMaterialEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly materialFlows: readonly EstateMaterialFlow[];
  readonly creditEvents?: readonly EstateCreditEvent[];
  readonly successionEvents?: readonly SuccessionEvent[];
};
function source(w: WorldProjection, e: ResidentPopulationDeparture) {
  const state = w.residentExits,
    a = w.agents[e.payload.agentId];
  if (!state) throw Error('resident-exit-preservation-not-enabled');
  assertResidentExitSnapshot(w);
  assertResidentEstateCreditSnapshot(w);
  if (!a || state.records[a.agentId]) throw Error('resident-exit-actual-body-unavailable');
  const at = e.type === 'AgentDied' ? e.payload.diedAt : e.payload.emigratedAt;
  if (
    !Number.isSafeInteger(e.sequence) ||
    e.sequence < 1 ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    at > w.clock.now ||
    !e.payload.policyVersion
  )
    throw Error('resident-exit-population-source-mismatch');
  // An application must select the preservation protocol before legacy liquidation.
  // A companion write-off, owner closure or burn cannot be undone by this packet.
  const estate = e.payload.estate;
  if (
    estate.burnedCurrency !== 0 ||
    estate.depositForfeited !== 0 ||
    estate.writtenOffLoanIds.length ||
    Object.values(estate.inventoryByCommodity).some((n) => n !== 0)
  )
    throw Error('resident-exit-cannot-follow-legacy-liquidation');
  return {
    state,
    a,
    at,
    cause: e.type === 'AgentDied' ? ('death' as const) : ('emigration' as const),
  };
}
/** Application preparation only. Must accompany the actual body event in the same atomic journal commit. Not a resident command or an activation API. */
export function prepareResidentExitCapture(
  w: WorldProjection,
  e: ResidentPopulationDeparture,
):
  | { readonly accepted: true; readonly capture: ResidentExitCapture }
  | { readonly accepted: false; readonly reason: string } {
  try {
    const { state, a, at, cause } = source(w, e),
      cashAccountId = `estate-${e.sequence}`,
      backpackCustodyId = `estate-backpack-${e.sequence}`;
    const cash = captureEstateCash(state.cash, cashAccountId, {
      ownerId: a.agentId,
      populationEventId: e.id,
      populationPolicyVersion: e.payload.policyVersion,
      cause,
      at,
      personalBalance: a.balance,
    });
    if (!cash.accepted) return cash;
    const materials = captureEstateBackpack(state.materials, backpackCustodyId, {
      ownerId: a.agentId,
      populationEventId: e.id,
      populationPolicyVersion: e.payload.policyVersion,
      cause,
      at,
      locationId: a.locationId,
      sourceRevision: e.sequence,
      items: a.inventory,
    });
    if (!materials.accepted) return materials;
    return {
      accepted: true,
      capture: {
        policyVersion: state.policy.version,
        record: {
          residentId: a.agentId,
          populationEventId: e.id,
          populationPolicyVersion: e.payload.policyVersion,
          cause,
          at,
          cashAccountId,
          backpackCustodyId,
        },
        cashEvents: cash.events,
        materialEvents: materials.events,
        transactions: cash.transactions,
        materialFlows: materials.flows,
        ...(w.estateCredit ? { creditEvents: prepareEstateCreditDeparture(w, e)! } : {}),
        ...(w.successionControlExecutions
          ? { successionEvents: prepareResidentSuccessionDeparture(w, e) }
          : {}),
      },
    };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-resident-exit-source',
    };
  }
}
/** Replay validates captured facts against the still-present body and owning reducers. It does not run inheritance decisions, terminate other domains or choose a successor. Returned custody and body removal must be published together. */
export function applyResidentExitCapture(
  w: WorldProjection,
  e: ResidentPopulationDeparture,
  p: ResidentExitCapture,
): ResidentExitState {
  const { state, a, at, cause } = source(w, e);
  if (
    !equal(
      Object.keys(p).sort(),
      [
        'policyVersion',
        'record',
        'cashEvents',
        'materialEvents',
        'transactions',
        'materialFlows',
        ...(w.estateCredit ? ['creditEvents'] : []),
        ...(w.successionControlExecutions ? ['successionEvents'] : []),
      ].sort(),
    ) ||
    p.policyVersion !== state.policy.version ||
    !equal(p.record, {
      residentId: a.agentId,
      populationEventId: e.id,
      populationPolicyVersion: e.payload.policyVersion,
      cause,
      at,
      cashAccountId: `estate-${e.sequence}`,
      backpackCustodyId: `estate-backpack-${e.sequence}`,
    })
  )
    throw Error('resident-exit-record-source-mismatch');
  if (p.cashEvents.length !== 1 || p.materialEvents.length !== 1)
    throw Error('resident-exit-single-custody-capture-required');
  const c = p.cashEvents[0]!,
    m = p.materialEvents[0]!;
  if (
    c.type !== 'EstateCashCaptured' ||
    m.type !== 'EstateBackpackCaptured' ||
    c.id !== p.record.cashAccountId ||
    m.custody.id !== p.record.backpackCustodyId ||
    !equal(c.source, {
      ownerId: a.agentId,
      populationEventId: e.id,
      populationPolicyVersion: e.payload.policyVersion,
      cause,
      at,
      personalBalance: a.balance,
    }) ||
    !equal(m.custody.source, {
      ownerId: a.agentId,
      populationEventId: e.id,
      populationPolicyVersion: e.payload.policyVersion,
      cause,
      at,
      locationId: a.locationId,
      sourceRevision: e.sequence,
      items: a.inventory,
    })
  )
    throw Error('resident-exit-custody-actual-source-mismatch');
  if (
    !equal(p.transactions, c.transaction ? [c.transaction] : []) ||
    !equal(p.materialFlows, m.flows)
  )
    throw Error('resident-exit-flow-proof-mismatch');
  for (const t of p.transactions) assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
  return {
    ...state,
    cash: applyEstateCashEvent(state.cash, c),
    materials: applyEstateMaterialEvent(state.materials, m),
    records: { ...state.records, [a.agentId]: structuredClone(p.record) },
    arrangements: applyResidentSuccessionDeparture(w, e, p.successionEvents),
  };
}
