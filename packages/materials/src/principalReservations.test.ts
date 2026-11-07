import { expect, test } from 'vitest';
import { RESOURCE_PRINCIPAL_POLICY, type ResourcePrincipal } from '@aivilization/authority';
import {
  createMaterialsPolicy,
  emptyMaterialsState,
  applyMaterialCommit,
  decideMaterialStock,
  decideMaterialPrincipalControl,
  offerMaterialReservation,
  offerPrincipalMaterialReservation,
  returnUnboundMaterialReservation,
  settleConsumerMaterials,
  MATERIAL_RESERVATIONS_POLICY,
  type MaterialPorts,
  type MaterialDecision,
  type MaterialEvent,
  type MaterialAllocation,
  type PrincipalMaterialReservationOffer,
} from './index';

function fixture() {
  const policy = createMaterialsPolicy([
    {
      id: 'boards',
      version: '1',
      inputs: { Wood: 1 },
      outputs: { Board: 1 },
      workMs: 1000,
      energyCost: 1,
      satietyCost: 1,
      minResidentialTier: 1,
    },
  ]);
  let state = emptyMaterialsState(policy);
  const commits: { events: readonly MaterialEvent[]; evidence: readonly MaterialAllocation[] }[] =
    [];
  const ports: MaterialPorts = {
    exists: (id) => ['a', 'b'].includes(id),
    present: () => true,
    idle: () => true,
    mayStoreAt: () => true,
    inventory: () => ({ Wood: 10 }),
    body: () => ({ energy: 100, satiety: 100, residentialTier: 1, capable: true }),
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: () => false,
    principalAvailable: (p) => p.id !== 'missing',
    authorizePrincipal: (principal, request) => ({
      actorId: 'b',
      principal,
      request,
      source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
    }),
  };
  const commit = (d: MaterialDecision, evidence: readonly MaterialAllocation[] = []) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    state = applyMaterialCommit(state, d.events, evidence).state;
    commits.push({ events: d.events, evidence });
    return d.events;
  };
  commit({
    accepted: true,
    events: [{ type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY }],
  });
  commit(
    decideMaterialStock(
      state,
      'a',
      0,
      'create',
      { type: 'create-stock', id: 's', title: '原材料', locationId: 'site' },
      ports,
    ),
  );
  commit(
    decideMaterialStock(
      state,
      'a',
      0,
      'deposit',
      { type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 8 } },
      ports,
    ),
  );
  const legacy = state;
  commit({
    accepted: true,
    events: [{ type: 'MaterialResourcePrincipalsEnabled', policy: RESOURCE_PRINCIPAL_POLICY }],
  });
  const custody = (
    actorId: string,
    command: Parameters<typeof decideMaterialPrincipalControl>[0]['request']['command'],
  ) =>
    decideMaterialPrincipalControl({
      state,
      actorId,
      at: 0,
      available: () => true,
      request: {
        resourceKind: 'stock',
        resourceId: 's',
        resourceRevision: state.stocks.s!.revision,
        controlVersion: state.stocks.s!.control.version,
        command,
      },
      authorize: (principal, request) => ({
        actorId,
        principal,
        request,
        source:
          principal.kind === 'resident'
            ? { kind: 'personal' }
            : { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
      }),
    });
  commit(
    custody('a', {
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      terms: '独立接受',
      expiresAt: 1000,
    }),
  );
  commit(custody('b', { type: 'accept' }));
  const offer = (
    beneficiary: ResourcePrincipal = { kind: 'enterprise', id: 'builder' },
  ): PrincipalMaterialReservationOffer => ({
    id: 'r',
    stockId: 's',
    expectedStockRevision: state.stocks.s!.revision,
    items: { Wood: 6 },
    beneficiary,
    consumer: { domain: 'premises', id: 'p' },
    terms: '只供该项目，未使用的退回原库存',
    expiresAt: 1000,
  });
  return {
    get state() {
      return state;
    },
    ports,
    legacy,
    commit,
    offer,
    custody,
    reserve: (value = offer()) =>
      offerPrincipalMaterialReservation(state, 'b', 0, 'reserve', value, ports),
    replay: () => {
      let s = emptyMaterialsState(policy);
      for (const c of commits) s = applyMaterialCommit(s, c.events, c.evidence).state;
      expect(s).toEqual(state);
    },
  };
}

test('principal reservation preserves independent consumer acceptance and all held obligations across custody transfer', () => {
  const t = fixture();
  t.commit(t.reserve());
  expect(t.state.stocks.s!.inventory.Wood).toBe(2);
  expect(t.state.reservations!.records.r).toMatchObject({
    principalVersion: 'resource-principals-v2',
    status: 'offered',
    beneficiary: { kind: 'enterprise', id: 'builder' },
    held: { Wood: 6 },
  });
  expect(t.state.reservations!.records.r!.boundBy).toBeUndefined();
  t.commit(
    t.custody('b', {
      type: 'offer',
      target: { kind: 'enterprise', id: 'other' },
      terms: '连同已有承诺',
      expiresAt: 900,
    }),
  );
  t.commit(t.custody('b', { type: 'accept' }));
  t.commit(
    settleConsumerMaterials(t.state, 'a', 1, 'bind', 'r', 1, {
      consumer: { domain: 'premises', id: 'p' },
      beneficiary: { kind: 'enterprise', id: 'builder' },
      evidenceId: 'p-created',
    }),
  );
  expect(returnUnboundMaterialReservation(t.state, 'b', 1, 'undo', 'r', 2, t.ports)).toMatchObject({
    accepted: false,
  });
  const evidence = {
    reservationId: 'r',
    consumer: { domain: 'premises' as const, id: 'p' },
    items: { Wood: 4 },
    evidenceId: 'p-done',
  };
  const done = settleConsumerMaterials(t.state, 'a', 2, 'finish', 'r', 2, {
    consumer: evidence.consumer,
    beneficiary: { kind: 'enterprise', id: 'builder' },
    evidenceId: evidence.evidenceId,
    allocation: evidence.items,
    finish: true,
  });
  if (!done.accepted) throw Error(done.reason);
  expect(() => applyMaterialCommit(t.state, done.events)).toThrow(
    'material-allocation-evidence-required',
  );
  t.commit(done, [evidence]);
  expect(t.state.stocks.s!.inventory.Wood).toBe(4);
  expect(t.state.stocks.s!.control.controller).toEqual({ kind: 'enterprise', id: 'other' });
  expect(t.state.reservations!.records.r).toMatchObject({
    allocated: { Wood: 4 },
    returned: { Wood: 2 },
    held: {},
    status: 'settled',
  });
  t.replay();
});

test('v2 authority binds beneficiary, quantity, consumer, version and receipt; legacy entry cannot grant organizational rights', () => {
  const t = fixture();
  expect(
    offerPrincipalMaterialReservation(t.legacy, 'b', 0, 'early', t.offer(), t.ports),
  ).toMatchObject({ accepted: false });
  expect(
    offerMaterialReservation(
      t.state,
      'a',
      0,
      'legacy',
      { ...t.offer(), beneficiary: { kind: 'resident', id: 'a' } },
      t.ports,
    ),
  ).toMatchObject({ accepted: false });
  expect(t.reserve(t.offer({ kind: 'enterprise', id: 'missing' }))).toMatchObject({
    accepted: false,
  });
  expect(t.reserve({ ...t.offer(), consumer: { domain: 'services', id: 'p' } })).toMatchObject({
    accepted: false,
    reason: 'principal-material-consumer-not-connected',
  });
  expect(t.reserve({ ...t.offer(), expectedStockRevision: 1 })).toMatchObject({
    accepted: false,
    reason: 'material-stock-revision-conflict',
  });
  expect(
    offerPrincipalMaterialReservation(t.state, 'a', 0, 'steal', t.offer(), t.ports),
  ).toMatchObject({ accepted: false });
  const d = t.reserve();
  if (!d.accepted) throw Error(d.reason);
  for (const events of [
    d.events.filter((e) => e.type !== 'MaterialReceiptRecorded'),
    d.events.map((e) =>
      e.type === 'MaterialReservationChanged'
        ? { ...e, reservation: { ...e.reservation, terms: '另一份条款' } }
        : e,
    ),
    d.events.map((e) =>
      e.type === 'MaterialReservationChanged'
        ? {
            ...e,
            reservation: { ...e.reservation, beneficiary: { kind: 'public' as const, id: 'town' } },
          }
        : e,
    ),
  ])
    expect(() => applyMaterialCommit(t.state, events)).toThrow();
  t.commit(d);
  t.replay();
});

test('unbound principal offer can expire or be withdrawn once without giving materials to the executor', () => {
  for (const expiry of [false, true]) {
    const t = fixture();
    t.commit(t.reserve());
    expect(
      returnUnboundMaterialReservation(t.state, 'b', 999, 'early', 'r', 1, t.ports, true),
    ).toMatchObject({ accepted: false });
    const d = returnUnboundMaterialReservation(
      t.state,
      'b',
      expiry ? 1000 : 10,
      'return',
      'r',
      1,
      t.ports,
      expiry,
    );
    t.commit(d);
    expect(t.state.stocks.s!.inventory.Wood).toBe(8);
    expect(t.state.reservations!.records.r).toMatchObject({
      status: 'settled',
      returned: { Wood: 6 },
    });
    expect(t.state.reservations!.records.r!.boundBy).toBeUndefined();
    expect(
      returnUnboundMaterialReservation(t.state, 'b', 1001, 'twice', 'r', 2, t.ports, expiry),
    ).toMatchObject({ accepted: false });
    t.replay();
  }
});
