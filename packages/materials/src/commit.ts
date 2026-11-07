import { assertMaterialInterruption } from './interruption';
import { assertPrincipalReservationTransitions } from './principalReservations';
import { assertMaterialPrincipalReceipt } from './principalReceipts';
import type { MaterialAllocation } from './reservationModel';
import type { MaterialCustodyProof } from './custodyModel';
import { validateMaterialCustodyEvidence } from './custodyCommit';
import type { Inventory } from '@aivilization/economy';
import { applyMaterialEvent } from './events';
import { regrowMaterialSources } from './growth';
import { scaleInventory } from './inventoryFlow';
import { materialEffortCost } from './work';
import {
  validInventory,
  type MaterialsState,
  type MaterialEvent,
  type MaterialEndpoint,
  type MaterialEffort,
} from './model';
const key = (e: MaterialEndpoint) => `${e.kind}:${e.id}`;
/** Key-order independent: persisted journals may store object keys sorted. */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
const equalInventory = (a: Inventory, b: Inventory) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (k) =>
      Number.isFinite(a[k] ?? 0) &&
      Number.isFinite(b[k] ?? 0) &&
      Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-8,
  );
/** Replay validates the recorded physical facts, never recalculates authorization or business choices. */
export function applyMaterialCommit(
  before: MaterialsState | undefined,
  events: readonly MaterialEvent[],
  consumerEvidence: readonly MaterialAllocation[] = [],
  custodyEvidence: readonly MaterialCustodyProof[] = [],
) {
  assertMaterialInterruption(before, events);
  if (
    custodyEvidence.length ||
    events.some(
      (e) =>
        e.type === 'MaterialCustodyChanged' ||
        (e.type === 'MaterialReceiptRecorded' &&
          (e.receipt.custodyProof ||
            e.receipt.transfers.some((t) => t.from.kind === 'custody' || t.to.kind === 'custody'))),
    )
  )
    validateMaterialCustodyEvidence(before, events, custodyEvidence);
  if (
    events.some((e) => e.type === 'MaterialExtractionEnabled') &&
    (events.length !== 1 || consumerEvidence.length || custodyEvidence.length)
  )
    throw Error('material-extraction-activation-must-stand-alone');
  if (
    events.some(
      (e) =>
        e.type === 'MaterialResourcePrincipalsEnabled' ||
        e.type === 'MaterialPrincipalControlChanged',
    ) &&
    events.length !== 1
  )
    throw Error('material-principal-transition-must-stand-alone');
  // Regrowth is the only way a source rises without a returned transfer; it must be exactly the policy result.
  const regrown = events.find((e) => e.type === 'MaterialSourcesRegrown');
  if (
    regrown &&
    (!before ||
      consumerEvidence.length ||
      custodyEvidence.length ||
      canonicalJson(events) !== canonicalJson(regrowMaterialSources(before, regrown.at)))
  )
    throw Error('material-regrowth-must-match-policy');
  let state = before,
    receiptBefore = before;
  for (const e of events) {
    state = applyMaterialEvent(state, e);
    if (e.type === 'MaterialReceiptRecorded') {
      assertMaterialPrincipalReceipt(receiptBefore, state, e.receipt);
      receiptBefore = state;
    }
  }
  if (!state) throw new Error('materials-not-enabled');
  assertPrincipalReservationTransitions(before, state, events);
  const deltas: Record<string, Record<string, number>> = {},
    efforts: MaterialEffort[] = [];
  const allocations: Record<string, Record<string, number>> = {},
    returned: Record<string, Record<string, number>> = {};
  const usedEvidence = new Set<number>();
  const converted: Record<string, number> = {},
    worked: Record<string, number> = {};
  const add = (endpoint: MaterialEndpoint, items: Inventory, sign: number) => {
    if (!validInventory(items, state.policy.maxKinds, state.policy.maxQuantity))
      throw new Error('invalid-material-flow');
    if (
      (endpoint.kind === 'source' && !state.extraction?.sources[endpoint.id]) ||
      (endpoint.kind === 'stock' && !state.stocks[endpoint.id]) ||
      (endpoint.kind === 'production' && !state.productions[endpoint.id]) ||
      (endpoint.kind === 'custody' && !state.custodies?.records[endpoint.id]) ||
      (endpoint.kind === 'reservation' && !state.reservations?.records[endpoint.id])
    )
      throw new Error('material-flow-endpoint-missing');
    const id = key(endpoint),
      inventory = deltas[id] ?? {};
    for (const [item, q] of Object.entries(items)) {
      const n = (inventory[item] ?? 0) + q * sign;
      if (!Number.isFinite(n)) throw new Error('material-flow-overflow');
      inventory[item] = n;
    }
    deltas[id] = inventory;
  };
  for (const e of events)
    if (e.type === 'MaterialReceiptRecorded') {
      const r = e.receipt;
      if (!state.stocks[r.stockId]) throw new Error('material-receipt-stock-missing');
      for (const t of r.transfers) {
        const fromJob = t.from.kind === 'production' ? state.productions[t.from.id] : undefined,
          toJob = t.to.kind === 'production' ? state.productions[t.to.id] : undefined;
        if (
          (fromJob?.sourceId && (t.to.kind !== 'source' || t.to.id !== fromJob.sourceId)) ||
          (toJob?.sourceId && (t.from.kind !== 'source' || t.from.id !== toJob.sourceId))
        )
          throw Error('unearned-source-material-cannot-enter-inventory');
        if (t.from.kind === 'source' || t.to.kind === 'source') {
          const reserving = t.from.kind === 'source',
            endpoint = reserving ? t.to : t.from,
            sourceId = reserving ? t.from.id : t.to.id,
            job = state.productions[endpoint.id],
            source = state.extraction?.sources[sourceId];
          if (
            !source ||
            endpoint.kind !== 'production' ||
            !job ||
            job.sourceId !== sourceId ||
            r.productionId !== job.id ||
            r.stockId !== job.stockId ||
            Object.keys(t.items).length !== 1 ||
            !Number.isSafeInteger(t.items[source.commodity]) ||
            (reserving
              ? before?.productions[job.id] || r.operation !== 'create-extraction'
              : job.status !== 'cancelled' || r.operation !== 'cancel-production')
          )
            throw Error('invalid-material-source-reservation-flow');
        }
        add(t.from, t.items, -1);
        add(t.to, t.items, 1);
        if (t.from.kind === 'reservation') {
          const reservation = state.reservations?.records[t.from.id];
          const toCustody = t.to.kind === 'custody' && r.custodyProof?.operation === 'load';
          if (
            !reservation ||
            (!toCustody && (t.to.kind !== 'stock' || t.to.id !== reservation.stockId))
          )
            throw new Error('invalid-material-reservation-return');
          const ledger = toCustody ? allocations : returned;
          const v = ledger[reservation.id] ?? {};
          for (const [k, n] of Object.entries(t.items)) v[k] = (v[k] ?? 0) + n;
          ledger[reservation.id] = v;
        }
      }
      for (const a of r.allocations ?? []) {
        const reservation = state.reservations?.records[a.reservationId];
        const proofIndex = consumerEvidence.findIndex(
          (v, i) =>
            !usedEvidence.has(i) &&
            v.reservationId === a.reservationId &&
            v.evidenceId === a.evidenceId &&
            v.consumer.domain === a.consumer.domain &&
            v.consumer.id === a.consumer.id &&
            equalInventory(v.items, a.items),
        );
        if (
          !reservation ||
          proofIndex < 0 ||
          reservation.consumer.domain !== a.consumer.domain ||
          reservation.consumer.id !== a.consumer.id ||
          reservation.stockId !== r.stockId
        )
          throw new Error('material-allocation-evidence-required');
        usedEvidence.add(proofIndex);
        add({ kind: 'reservation', id: a.reservationId }, a.items, -1);
        const delta = allocations[a.reservationId] ?? {};
        for (const [k, n] of Object.entries(a.items)) delta[k] = (delta[k] ?? 0) + n;
        allocations[a.reservationId] = delta;
      }
      for (const c of r.conversions) {
        const job = state.productions[c.productionId];
        if (
          !job ||
          job.stockId !== r.stockId ||
          c.productionId !== r.productionId ||
          c.recipeVersion !== job.recipe.version ||
          !Number.isSafeInteger(c.units) ||
          c.units <= 0 ||
          !equalInventory(c.consumed, scaleInventory(job.recipe.inputs, c.units)) ||
          !equalInventory(c.produced, scaleInventory(job.recipe.outputs, c.units))
        )
          throw new Error('invalid-material-conversion');
        converted[job.id] = (converted[job.id] ?? 0) + c.units;
        add({ kind: 'production', id: job.id }, c.consumed, -1);
        add({ kind: 'stock', id: job.stockId }, c.produced, 1);
      }
      for (const effort of r.efforts) {
        const old = before?.productions[effort.productionId],
          job = state.productions[effort.productionId];
        if (
          !old?.session ||
          !job ||
          r.productionId !== job.id ||
          effort.actorId !== old.session.actorId ||
          effort.from !== old.session.settledAt ||
          !Number.isSafeInteger(effort.workMs) ||
          effort.workMs <= 0 ||
          effort.through - effort.from !== effort.workMs ||
          effort.through > old.session.until ||
          effort.through > r.at ||
          !Number.isFinite(effort.energyCost) ||
          !Number.isFinite(effort.satietyCost) ||
          effort.energyCost < 0 ||
          effort.satietyCost < 0 ||
          Math.abs(
            effort.energyCost -
              (materialEffortCost(
                old.progressMs + effort.workMs,
                job.recipe.workMs,
                job.recipe.energyCost,
              ) -
                materialEffortCost(old.progressMs, job.recipe.workMs, job.recipe.energyCost)),
          ) > 1e-8 ||
          Math.abs(
            effort.satietyCost -
              (materialEffortCost(
                old.progressMs + effort.workMs,
                job.recipe.workMs,
                job.recipe.satietyCost,
              ) -
                materialEffortCost(old.progressMs, job.recipe.workMs, job.recipe.satietyCost)),
          ) > 1e-8
        )
          throw new Error('invalid-material-effort');
        worked[job.id] = (worked[job.id] ?? 0) + effort.workMs;
        efforts.push(effort);
      }
    }
  if (usedEvidence.size !== consumerEvidence.length)
    throw new Error('unused-material-allocation-evidence');
  for (const [id, source] of Object.entries(state.extraction?.sources ?? {})) {
    const old = before?.extraction?.sources[id];
    if (!old) {
      if (!events.some((e) => e.type === 'MaterialExtractionEnabled'))
        throw Error('unseeded-material-source');
      continue;
    }
    if (regrown) continue;
    const delta = deltas[`source:${id}`] ?? {};
    if (
      Object.keys(delta).some((k) => k !== source.commodity) ||
      source.remaining !== old.remaining + (delta[source.commodity] ?? 0)
    )
      throw Error('material-source-flow-mismatch');
  }
  for (const [id, c] of Object.entries(state.custodies?.records ?? {})) {
    const expected = { ...before?.custodies?.records[id]?.held };
    for (const [k, n] of Object.entries(deltas[`custody:${id}`] ?? {}))
      expected[k] = (expected[k] ?? 0) + n;
    if (!equalInventory(expected, c.held)) throw Error('material-custody-flow-mismatch');
  }
  for (const [id, v] of Object.entries(state.stocks)) {
    const old = before?.stocks[id]?.inventory ?? {},
      expected = { ...old };
    for (const [k, n] of Object.entries(deltas[`stock:${id}`] ?? {}))
      expected[k] = (expected[k] ?? 0) + n;
    if (!equalInventory(expected, v.inventory)) throw new Error('material-stock-flow-mismatch');
  }
  for (const [id, v] of Object.entries(state.productions)) {
    const old = before?.productions[id],
      expected = { ...old?.held };
    for (const [k, n] of Object.entries(deltas[`production:${id}`] ?? {}))
      expected[k] = (expected[k] ?? 0) + n;
    if (
      !equalInventory(expected, v.held) ||
      v.completed - (old?.completed ?? 0) !== (converted[id] ?? 0) ||
      v.progressMs - (old?.progressMs ?? 0) !== (worked[id] ?? 0)
    )
      throw new Error('material-production-flow-mismatch');
  }
  for (const [id, r] of Object.entries(state.reservations?.records ?? {})) {
    const old = before?.reservations?.records[id],
      expected = { ...old?.held },
      allocated = { ...old?.allocated },
      returnedItems = { ...old?.returned };
    for (const [k, n] of Object.entries(deltas[`reservation:${id}`] ?? {}))
      expected[k] = (expected[k] ?? 0) + n;
    for (const [k, n] of Object.entries(allocations[id] ?? {}))
      allocated[k] = (allocated[k] ?? 0) + n;
    for (const [k, n] of Object.entries(returned[id] ?? {}))
      returnedItems[k] = (returnedItems[k] ?? 0) + n;
    const total = { ...r.held };
    for (const v of [r.allocated, r.returned])
      for (const [k, n] of Object.entries(v)) total[k] = (total[k] ?? 0) + n;
    if (
      !equalInventory(expected, r.held) ||
      !equalInventory(allocated, r.allocated) ||
      !equalInventory(returnedItems, r.returned) ||
      !equalInventory(total, r.original)
    )
      throw new Error('material-reservation-flow-mismatch');
  }
  return {
    state,
    residentDeltas: Object.fromEntries(
      Object.entries(deltas)
        .filter(([id]) => id.startsWith('resident:'))
        .map(([id, v]) => [id.slice('resident:'.length), v]),
    ),
    efforts,
  };
}
