import { expect, test } from 'vitest';
import {
  createMaterialsPolicy,
  emptyMaterialsState,
  applyMaterialCommit,
  offerMaterialReservation,
  returnUnboundMaterialReservation,
  settleConsumerMaterials,
  decideMaterialStock,
  MATERIAL_RESERVATIONS_POLICY,
  type MaterialAllocation,
  type MaterialPorts,
  type MaterialDecision,
  type MaterialEvent,
} from './index';
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
function setup() {
  let s = emptyMaterialsState(policy),
    time = 0,
    n = 0;
  const commits: { events: readonly MaterialEvent[]; proof: readonly MaterialAllocation[] }[] = [];
  const ports: MaterialPorts = {
    exists: (a) => ['a', 'b'].includes(a),
    present: () => true,
    idle: () => true,
    mayStoreAt: () => true,
    inventory: () => ({ Wood: 10 }),
    body: () => ({ energy: 100, satiety: 100, residentialTier: 1, capable: true }),
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: () => false,
  };
  const commit = (d: MaterialDecision, proof: readonly MaterialAllocation[] = []) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (d.accepted) {
      s = applyMaterialCommit(s, d.events, proof).state;
      commits.push({ events: d.events, proof });
    }
    return d;
  };
  commit({
    accepted: true,
    events: [{ type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY }],
  });
  commit(
    decideMaterialStock(
      s,
      'a',
      0,
      's-create',
      { type: 'create-stock', id: 's', locationId: 'site', title: '投入来源' },
      ports,
    ),
  );
  commit(
    decideMaterialStock(
      s,
      'a',
      0,
      's-deposit',
      { type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 5 } },
      ports,
    ),
  );
  const offer = () =>
    offerMaterialReservation(
      s,
      'a',
      time,
      `r${++n}`,
      {
        id: 'r',
        stockId: 's',
        expectedStockRevision: s.stocks.s!.revision,
        items: { Wood: 4 },
        beneficiary: { kind: 'resident', id: 'b' },
        consumer: { domain: 'premises', id: 'project' },
        terms: '只给这一项工程使用',
        expiresAt: 10000,
      },
      ports,
    );
  const bound = () =>
    settleConsumerMaterials(s, 'b', time, `r${++n}`, 'r', s.reservations!.records.r!.revision, {
      consumer: { domain: 'premises', id: 'project' },
      beneficiary: { kind: 'resident', id: 'b' },
      evidenceId: 'project-created',
    });
  return {
    get state() {
      return s;
    },
    commit,
    offer,
    bound,
    ports,
    setTime: (v: number) => {
      time = v;
    },
    replay: () => {
      let replay = emptyMaterialsState(policy);
      for (const c of commits) replay = applyMaterialCommit(replay, c.events, c.proof).state;
      expect(replay).toEqual(s);
    },
  };
}
test('reservation preserves real custody and creator authority; beneficiary and consumer cannot be substituted', () => {
  const t = setup();
  t.commit(t.offer());
  expect(t.state.stocks.s!.inventory).toEqual({ Wood: 1 });
  expect(t.state.reservations!.records.r!.held).toEqual({ Wood: 4 });
  const before = t.state;
  expect(
    settleConsumerMaterials(before, 'a', 0, 'wrong', 'r', 1, {
      consumer: { domain: 'premises', id: 'other-project' },
      beneficiary: { kind: 'resident', id: 'b' },
      evidenceId: 'wrong',
    }).accepted,
  ).toBe(false);
  expect(
    settleConsumerMaterials(before, 'a', 0, 'wrong', 'r', 1, {
      consumer: { domain: 'premises', id: 'project' },
      beneficiary: { kind: 'resident', id: 'a' },
      evidenceId: 'wrong',
    }).accepted,
  ).toBe(false);
  t.commit(t.bound());
  expect(t.state.reservations!.records.r!.status).toBe('bound');
  expect(
    returnUnboundMaterialReservation(t.state, 'a', 1, 'pull-back', 'r', 2, t.ports).accepted,
  ).toBe(false);
  t.replay();
});
test('actual allocation requires independent owning-domain evidence in the same commit; unconsumed material returns exactly once', () => {
  const t = setup();
  t.commit(t.offer());
  t.commit(t.bound());
  const allocation: MaterialAllocation = {
    reservationId: 'r',
    consumer: { domain: 'premises', id: 'project' },
    items: { Wood: 2 },
    evidenceId: 'project-progress',
  };
  const decision = settleConsumerMaterials(t.state, 'b', 1, 'allocate', 'r', 2, {
    consumer: allocation.consumer,
    beneficiary: { kind: 'resident', id: 'b' },
    evidenceId: allocation.evidenceId,
    allocation: allocation.items,
  });
  expect(decision.accepted).toBe(true);
  if (decision.accepted)
    expect(() => applyMaterialCommit(t.state, decision.events)).toThrow(
      'material-allocation-evidence-required',
    );
  t.commit(decision, [allocation]);
  expect(t.state.reservations!.records.r!).toMatchObject({
    held: { Wood: 2 },
    allocated: { Wood: 2 },
    status: 'bound',
  });
  t.commit(
    settleConsumerMaterials(t.state, 'b', 2, 'finish', 'r', 3, {
      consumer: allocation.consumer,
      beneficiary: { kind: 'resident', id: 'b' },
      evidenceId: 'project-cancelled',
      finish: true,
    }),
  );
  expect(t.state.stocks.s!.inventory).toEqual({ Wood: 3 });
  expect(t.state.reservations!.records.r!).toMatchObject({
    held: {},
    allocated: { Wood: 2 },
    returned: { Wood: 2 },
    status: 'settled',
  });
  expect(
    settleConsumerMaterials(t.state, 'b', 3, 'again', 'r', 4, {
      consumer: allocation.consumer,
      beneficiary: { kind: 'resident', id: 'b' },
      evidenceId: 'again',
      finish: true,
    }).accepted,
  ).toBe(false);
  t.replay();
});
test('unbound offers can be withdrawn by source authority or expire, without manufacturing acceptance', () => {
  const t = setup();
  t.commit(t.offer());
  expect(returnUnboundMaterialReservation(t.state, 'b', 1, 'steal', 'r', 1, t.ports).accepted).toBe(
    false,
  );
  expect(
    returnUnboundMaterialReservation(t.state, 'system', 9999, 'early', 'r', 1, t.ports, true)
      .accepted,
  ).toBe(false);
  t.setTime(10000);
  expect(t.bound().accepted).toBe(false);
  t.commit(
    returnUnboundMaterialReservation(t.state, 'system', 10000, 'expired', 'r', 1, t.ports, true),
  );
  expect(t.state.stocks.s!.inventory).toEqual({ Wood: 5 });
  expect(t.state.reservations!.records.r!.boundBy).toBeUndefined();
  t.replay();
});
test('held obligations and reserved return headroom prevent closing or overfilling the source stock', () => {
  const t = setup();
  t.commit(t.offer());
  const s = t.state;
  expect(
    decideMaterialStock(
      s,
      'a',
      0,
      'close',
      { type: 'close-stock', id: 's', expectedRevision: s.stocks.s!.revision },
      t.ports,
    ).accepted,
  ).toBe(false);
  const tight = { ...s, policy: { ...s.policy, maxQuantity: 5 } };
  expect(
    decideMaterialStock(
      tight,
      'a',
      0,
      'fill',
      { type: 'deposit', id: 's', expectedRevision: s.stocks.s!.revision, items: { Wood: 1 } },
      t.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'material-stock-capacity' });
  t.replay();
});
test('old materials state stays unchanged until explicit enable; forged reservations fail stock conservation', () => {
  const old = emptyMaterialsState(policy);
  expect(old.reservations).toBeUndefined();
  const t = setup();
  t.commit(t.offer());
  const r = t.state.reservations!.records.r!;
  expect(() =>
    applyMaterialCommit(t.state, [
      {
        type: 'MaterialReservationChanged',
        reservation: { ...r, revision: r.revision + 1, held: { Wood: 9 } },
      },
    ]),
  ).toThrow('material-reservation-flow-mismatch');
  expect(() =>
    applyMaterialCommit(t.state, [
      { type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY },
    ]),
  ).toThrow('material-reservations-already-enabled');
  t.replay();
});
