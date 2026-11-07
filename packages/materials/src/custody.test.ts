import { expect, test } from 'vitest';
import {
  createMaterialsPolicy,
  emptyMaterialsState,
  applyMaterialCommit,
  decideMaterialStock,
  offerMaterialReservation,
  settleMaterialCustody,
  materialLocationStorageUsage,
  MATERIAL_RESERVATIONS_POLICY,
  MATERIAL_CUSTODY_POLICY,
  type MaterialPorts,
  type MaterialEvent,
  type MaterialDecision,
  type MaterialCustodyProof,
} from './index';

function fixture(capacity = 10) {
  const policy = createMaterialsPolicy([
    {
      id: 'book',
      version: 'v1',
      inputs: { Wood: 1 },
      outputs: { Book: 1 },
      workMs: 1000,
      energyCost: 1,
      satietyCost: 1,
      minResidentialTier: 1,
    },
  ]);
  let state = emptyMaterialsState(policy),
    counter = 0;
  const history: { events: readonly MaterialEvent[]; proofs: readonly MaterialCustodyProof[] }[] =
    [];
  const ports: MaterialPorts = {
    exists: () => true,
    present: () => true,
    idle: () => true,
    mayStoreAt: () => true,
    inventory: () => ({ Wood: 10 }),
    body: () => ({ energy: 100, satiety: 100, residentialTier: 1, capable: true }),
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: () => false,
    locationStorageCapacity: () => capacity,
  };
  const commit = (d: MaterialDecision, proofs: readonly MaterialCustodyProof[] = []) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    state = applyMaterialCommit(state, d.events, [], proofs).state;
    history.push({ events: d.events, proofs });
  };
  commit({
    accepted: true,
    events: [
      { type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY },
      { type: 'MaterialCustodyEnabled', policy: MATERIAL_CUSTODY_POLICY },
    ],
  });
  for (const id of ['source', 'destination'])
    commit(
      decideMaterialStock(
        state,
        id,
        0,
        `${id}-created`,
        { type: 'create-stock', id, locationId: id, title: id },
        ports,
      ),
    );
  commit(
    decideMaterialStock(
      state,
      'source',
      0,
      'deposit',
      { type: 'deposit', id: 'source', expectedRevision: 1, items: { Wood: 5 } },
      ports,
    ),
  );
  commit(
    offerMaterialReservation(
      state,
      'source',
      0,
      'offered',
      {
        id: 'reserved',
        stockId: 'source',
        expectedStockRevision: 2,
        items: { Wood: 4 },
        consumer: { domain: 'logistics', id: 'freight' },
        beneficiary: { kind: 'resident', id: 'source' },
        terms: '运送四件',
        expiresAt: 10000,
      },
      ports,
    ),
  );
  const proof = (operation: MaterialCustodyProof['operation']): MaterialCustodyProof => ({
    id: 'cargo',
    consumerId: 'freight',
    sourceReservationId: 'reserved',
    sourceStockId: 'source',
    destinationStockId: 'destination',
    items: { Wood: 4 },
    beneficiary: { kind: 'resident', id: 'source' },
    operation,
    evidenceId: `freight-${operation}`,
  });
  const decision = (p: MaterialCustodyProof) =>
    settleMaterialCustody(
      state,
      'carrier',
      ++counter,
      `receipt-${counter}`,
      p,
      ports.locationStorageCapacity,
    );
  const perform = (operation: MaterialCustodyProof['operation']) => {
    const p = proof(operation);
    commit(decision(p), [p]);
  };
  const total = () =>
    [
      ...Object.values(state.stocks).map((v) => v.inventory),
      ...Object.values(state.reservations!.records).map((v) => v.held),
      ...Object.values(state.custodies!.records).map((v) => v.held),
    ].reduce((n, v) => n + (v.Wood ?? 0), 0);
  return {
    get state() {
      return state;
    },
    policy,
    ports,
    commit,
    proof,
    decision,
    perform,
    total,
    replay: () => {
      let replay = emptyMaterialsState(policy);
      const reorder = (v: unknown): unknown =>
        Array.isArray(v)
          ? v.map(reorder)
          : v && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, x]) => [k, reorder(x)]),
              )
            : v;
      const persisted = JSON.parse(JSON.stringify(reorder(history))) as typeof history;
      for (const h of persisted) replay = applyMaterialCommit(replay, h.events, [], h.proofs).state;
      expect(replay).toEqual(state);
    },
  };
}
test('freight holds one copy of real goods, reserves both ends, and delivers once with exact external evidence', () => {
  const t = fixture();
  t.perform('reserve');
  expect(t.state.custodies!.records.cargo!.held).toEqual({});
  expect(materialLocationStorageUsage(t.state, 'source')).toMatchObject({
    stored: 5,
    incoming: 0,
    returnHeadroom: 0,
    total: 5,
  });
  expect(materialLocationStorageUsage(t.state, 'destination')).toMatchObject({
    stored: 0,
    incoming: 4,
    total: 4,
  });
  t.perform('load');
  expect(t.state.reservations!.records.reserved).toMatchObject({
    held: {},
    allocated: { Wood: 4 },
    status: 'settled',
  });
  expect(t.state.custodies!.records.cargo!.held).toEqual({ Wood: 4 });
  expect(materialLocationStorageUsage(t.state, 'source')).toMatchObject({
    stored: 1,
    returnHeadroom: 4,
    total: 5,
  });
  expect(t.total()).toBe(5);
  t.perform('deliver');
  expect(t.state.stocks.destination!.inventory).toEqual({ Wood: 4 });
  expect(t.state.custodies!.records.cargo).toMatchObject({ held: {}, status: 'delivered' });
  expect(materialLocationStorageUsage(t.state, 'source').total).toBe(1);
  expect(t.decision(t.proof('deliver'))).toMatchObject({
    accepted: false,
    reason: 'material-custody-ended',
  });
  expect(t.total()).toBe(5);
  t.replay();
});
test('preload cancellation returns held source goods; loaded custody requires an actual return proof', () => {
  const t = fixture();
  t.perform('reserve');
  t.perform('cancel');
  expect(t.state.stocks.source!.inventory).toEqual({ Wood: 5 });
  expect(materialLocationStorageUsage(t.state, 'destination').total).toBe(0);
  t.replay();
  const loaded = fixture();
  loaded.perform('reserve');
  loaded.perform('load');
  const before = loaded.state;
  expect(loaded.decision(loaded.proof('cancel'))).toMatchObject({
    accepted: false,
    reason: 'material-custody-cannot-cancel-after-loading',
  });
  expect(loaded.state).toBe(before);
  loaded.perform('return');
  expect(loaded.state.stocks.source!.inventory).toEqual({ Wood: 5 });
  expect(loaded.state.custodies!.records.cargo!.status).toBe('returned');
  expect(loaded.total()).toBe(5);
  loaded.replay();
});
test('destination and source return reservations block overfilling and closing including same-location other stocks', () => {
  const t = fixture(5);
  t.perform('reserve');
  t.perform('load');
  for (const id of ['source', 'destination']) {
    const stock = t.state.stocks[id]!;
    expect(
      decideMaterialStock(
        t.state,
        id,
        5,
        `close-${id}`,
        { type: 'close-stock', id, expectedRevision: stock.revision },
        t.ports,
      ),
    ).toMatchObject({ accepted: false, reason: 'material-stock-unsettled' });
    expect(
      decideMaterialStock(
        t.state,
        id,
        5,
        `fill-${id}`,
        { type: 'deposit', id, expectedRevision: stock.revision, items: { Wood: 2 } },
        t.ports,
      ),
    ).toMatchObject({ accepted: false, reason: 'material-stock-capacity' });
  }
  t.commit(
    decideMaterialStock(
      t.state,
      'destination',
      5,
      'extra-created',
      { type: 'create-stock', id: 'extra', locationId: 'destination', title: 'another stock' },
      t.ports,
    ),
  );
  expect(
    decideMaterialStock(
      t.state,
      'destination',
      5,
      'extra-fill',
      { type: 'deposit', id: 'extra', expectedRevision: 1, items: { Wood: 2 } },
      t.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'material-stock-capacity' });
  t.perform('deliver');
  t.replay();
});
test('unauthorized flow, forged final values, duplicate evidence and unused evidence fail replay atomically', () => {
  const t = fixture(),
    p = t.proof('reserve'),
    d = t.decision(p);
  if (!d.accepted) throw Error(d.reason);
  expect(() => applyMaterialCommit(t.state, d.events)).toThrow(
    'material-custody-evidence-required',
  );
  expect(() => applyMaterialCommit(t.state, d.events, [], [p, p])).toThrow(
    'unused-material-custody-evidence',
  );
  expect(() => applyMaterialCommit(t.state, [], [], [p])).toThrow(
    'unused-material-custody-evidence',
  );
  const forged = d.events.map((e) =>
    e.type === 'MaterialCustodyChanged'
      ? { ...e, custody: { ...e.custody, destinationStockId: 'source' } }
      : e,
  );
  expect(() => applyMaterialCommit(t.state, forged, [], [p])).toThrow(
    'material-custody-flow-mismatch',
  );
  t.commit(d, [p]);
  t.perform('load');
  const delivered = t.decision(t.proof('deliver'));
  if (!delivered.accepted) throw Error(delivered.reason);
  const missingStock = delivered.events.filter((e) => e.type !== 'MaterialStockChanged');
  expect(() => applyMaterialCommit(t.state, missingStock, [], [t.proof('deliver')])).toThrow(
    'invalid-material-custody-packet',
  );
  expect(t.total()).toBe(5);
});
test('receipt evidence cannot substitute a different consumer, item quantity, or beneficiary', () => {
  const t = fixture(),
    p = t.proof('reserve');
  for (const forged of [
    { ...p, consumerId: 'other' },
    { ...p, items: { Wood: 3 } },
    { ...p, beneficiary: { kind: 'resident' as const, id: 'thief' } },
  ])
    expect(t.decision(forged)).toMatchObject({
      accepted: false,
      reason: 'material-custody-reference-mismatch',
    });
  expect(t.state.reservations!.records.reserved!.status).toBe('offered');
});
test('explicit opt-in preserves old snapshots and rejects insufficient destination space without binding source', () => {
  const t = fixture(5),
    old = emptyMaterialsState(t.policy);
  expect(old.custodies).toBeUndefined();
  expect(materialLocationStorageUsage(old, 'source')).toEqual({
    stored: 0,
    futureOutputs: 0,
    total: 0,
  });
  t.commit(
    decideMaterialStock(
      t.state,
      'destination',
      0,
      'fill',
      { type: 'deposit', id: 'destination', expectedRevision: 1, items: { Wood: 2 } },
      t.ports,
    ),
  );
  expect(t.decision(t.proof('reserve'))).toMatchObject({
    accepted: false,
    reason: 'material-stock-capacity',
  });
  expect(t.state.reservations!.records.reserved!.status).toBe('offered');
  expect(t.state.custodies!.records).toEqual({});
});
