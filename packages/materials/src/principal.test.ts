import { expect, test } from 'vitest';
import {
  RESOURCE_PRINCIPAL_POLICY,
  type PrincipalAuthorizationPort,
  type PrincipalControlCommand,
} from '@aivilization/authority';
import {
  applyMaterialCommit,
  createMaterialsPolicy,
  emptyMaterialsState,
  decideMaterialStock,
  decideMaterialProduction,
  decideMaterialPrincipalControl,
  type MaterialPorts,
  type MaterialDecision,
  type MaterialEvent,
} from './index';

function setup() {
  const policy = createMaterialsPolicy([
    {
      id: 'boards',
      version: 'v1',
      inputs: { Wood: 2 },
      outputs: { Board: 1 },
      workMs: 1000,
      energyCost: 2,
      satietyCost: 1,
      minResidentialTier: 1,
    },
  ]);
  let state = emptyMaterialsState(policy),
    counter = 0;
  const commits: (readonly MaterialEvent[])[] = [];
  const ports: MaterialPorts = {
    exists: (id) => ['a', 'b'].includes(id),
    present: () => true,
    idle: () => true,
    mayStoreAt: () => true,
    inventory: () => ({ Wood: 8 }),
    body: () => ({ energy: 100, satiety: 100, residentialTier: 1, capable: true }),
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: () => true,
  };
  const apply = (d: MaterialDecision) => {
    if (d.accepted) {
      state = applyMaterialCommit(state, d.events).state;
      commits.push(d.events);
    }
    return d;
  };
  const ok = (d: MaterialDecision) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    return apply(d);
  };
  ok(
    decideMaterialStock(
      state,
      'a',
      0,
      `r${++counter}`,
      { type: 'create-stock', id: 'stock', title: '原料', locationId: 'site' },
      ports,
    ),
  );
  ok(
    decideMaterialStock(
      state,
      'a',
      0,
      `r${++counter}`,
      { type: 'deposit', id: 'stock', expectedRevision: 1, items: { Wood: 8 } },
      ports,
    ),
  );
  const legacy = state;
  const authorize: PrincipalAuthorizationPort = (principal, request) => ({
    actorId: principal.kind === 'resident' ? principal.id : 'b',
    principal,
    request,
    source:
      principal.kind === 'resident'
        ? { kind: 'personal' }
        : principal.kind === 'enterprise'
          ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
          : { kind: 'public', proposalId: 'p1', procedureRevision: 1 },
  });
  const decide = (actorId: string, command: PrincipalControlCommand, auth = authorize) =>
    decideMaterialPrincipalControl({
      state,
      actorId,
      at: 10,
      request: {
        resourceKind: 'stock',
        resourceId: 'stock',
        resourceRevision: state.stocks.stock!.revision,
        controlVersion: state.stocks.stock!.control.version,
        command,
      },
      authorize: auth,
      available: () => true,
    });
  return {
    get state() {
      return state;
    },
    legacy,
    ports,
    apply,
    ok,
    decide,
    enable: () =>
      ok({
        accepted: true,
        events: [{ type: 'MaterialResourcePrincipalsEnabled', policy: RESOURCE_PRINCIPAL_POLICY }],
      }),
    replay: () => {
      let replay = emptyMaterialsState(policy);
      for (const events of commits) replay = applyMaterialCommit(replay, events).state;
      expect(replay).toEqual(state);
    },
  };
}
const offer = (kind: 'enterprise' | 'public'): PrincipalControlCommand => ({
  type: 'offer',
  target: { kind, id: kind },
  expiresAt: 1000,
  terms: '承担库存及未结义务',
});

test('explicit activation preserves old stocks; independent enterprise and public acceptance preserves physical stock and author', () => {
  const t = setup();
  expect(t.decide('a', offer('enterprise'))).toMatchObject({
    accepted: false,
    reason: 'material-resource-principals-not-enabled',
  });
  t.enable();
  expect(t.state.stocks).toEqual(t.legacy.stocks);
  t.ok(t.decide('a', offer('enterprise')));
  expect(t.decide('a', { type: 'accept' })).toMatchObject({ accepted: false });
  t.ok(t.decide('b', { type: 'accept' }));
  expect(t.state.stocks.stock).toMatchObject({
    ownerId: 'a',
    inventory: { Wood: 8 },
    contributors: ['a'],
    readers: ['a'],
    control: { controller: { kind: 'enterprise', id: 'enterprise' }, version: 3 },
  });
  t.ok(t.decide('b', offer('public')));
  t.ok(t.decide('b', { type: 'accept' }));
  expect(t.state.stocks.stock!.control.controller).toEqual({ kind: 'public', id: 'public' });
  expect(t.state.stocks.stock!.inventory).toEqual({ Wood: 8 });
  t.replay();
});

test('legacy personal and collective authority cannot operate a principal stock or overwrite its proof', () => {
  const t = setup();
  t.enable();
  t.ok(t.decide('a', offer('enterprise')));
  t.ok(t.decide('b', { type: 'accept' }));
  const stock = t.state.stocks.stock!,
    before = structuredClone(t.state);
  for (const actor of ['a', 'b']) {
    expect(
      decideMaterialStock(
        t.state,
        actor,
        10,
        `withdraw-${actor}`,
        {
          type: 'withdraw',
          id: stock.id,
          expectedRevision: stock.revision,
          recipientId: actor,
          items: { Wood: 1 },
        },
        t.ports,
      ),
    ).toMatchObject({ accepted: false });
    expect(
      decideMaterialStock(
        t.state,
        actor,
        10,
        `control-${actor}`,
        {
          type: 'control-stock',
          id: stock.id,
          expectedRevision: stock.revision,
          control: {
            type: 'offer',
            expectedVersion: stock.control.version,
            target: { kind: 'resident', id: actor },
            expiresAt: 100,
            terms: '旧接口',
          },
        },
        t.ports,
      ),
    ).toMatchObject({ accepted: false, reason: 'versioned-principal-control-required' });
  }
  expect(() =>
    applyMaterialCommit(t.state, [
      {
        type: 'MaterialStockChanged',
        stock: { ...stock, revision: stock.revision + 1, control: t.legacy.stocks.stock!.control },
      },
    ]),
  ).toThrow('invalid-material-stock-event');
  expect(t.state).toEqual(before);
  t.replay();
});

test('previously authorized production, held materials and contributor permissions survive transfer', () => {
  const t = setup();
  t.ok(
    decideMaterialProduction(
      t.state,
      'a',
      0,
      'create',
      {
        type: 'create-production',
        id: 'job',
        stockId: 'stock',
        expectedRevision: 2,
        recipeId: 'boards',
        quantity: 2,
        productName: '板',
        description: '真实生产',
        workers: ['a'],
      },
      t.ports,
    ),
  );
  t.enable();
  const jobs = structuredClone(t.state.productions);
  t.ok(t.decide('a', offer('enterprise')));
  t.ok(t.decide('b', { type: 'accept' }));
  expect(t.state.productions).toEqual(jobs);
  expect(t.state.stocks.stock!.inventory).toEqual({ Wood: 4 });
  t.ok(
    decideMaterialStock(
      t.state,
      'a',
      10,
      'contribution',
      {
        type: 'deposit',
        id: 'stock',
        expectedRevision: t.state.stocks.stock!.revision,
        items: { Wood: 1 },
      },
      t.ports,
    ),
  );
  expect(t.state.stocks.stock!.control.controller.kind).toBe('enterprise');
  t.replay();
});

test('legacy pending consent must resolve first, and forged resource versions cannot replay', () => {
  const t = setup();
  t.ok(
    decideMaterialStock(
      t.state,
      'a',
      0,
      'offer',
      {
        type: 'control-stock',
        id: 'stock',
        expectedRevision: 2,
        control: {
          type: 'offer',
          expectedVersion: 1,
          target: { kind: 'resident', id: 'b' },
          expiresAt: 100,
          terms: '原同意',
        },
      },
      t.ports,
    ),
  );
  t.enable();
  expect(t.decide('a', offer('enterprise'))).toMatchObject({
    accepted: false,
    reason: 'legacy-control-offer-unresolved',
  });
  t.ok(
    decideMaterialStock(
      t.state,
      'a',
      10,
      'cancel',
      {
        type: 'control-stock',
        id: 'stock',
        expectedRevision: t.state.stocks.stock!.revision,
        control: { type: 'cancel', expectedVersion: t.state.stocks.stock!.control.version },
      },
      t.ports,
    ),
  );
  const d = t.decide('a', offer('enterprise'));
  if (!d.accepted || d.events[0]?.type !== 'MaterialPrincipalControlChanged')
    throw Error('expected transfer');
  const forged = structuredClone(d.events[0]);
  const changed = {
    ...forged,
    change: { ...forged.change, request: { ...forged.change.request, resourceRevision: 1 } },
  };
  expect(() => applyMaterialCommit(t.state, [changed])).toThrow('invalid-material-principal-event');
  t.ok(d);
  t.replay();
});
