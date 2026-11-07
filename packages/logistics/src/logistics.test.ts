import { expect, test } from 'vitest';
import type { Controller } from '@aivilization/authority';
import { calculateCirculatingMoneyDelta } from '@aivilization/economy';
import {
  emptyLogisticsState,
  decideLogistics,
  applyLogisticsCommit,
  advanceFreight,
  nextLogisticsBoundary,
  freightEscrowBalance,
  freightAccountObligations,
  freightReservedCommonIncoming,
  physicalLoadUnits,
  type FreightTerms,
  type LogisticsPorts,
  type LogisticsDecision,
  type LogisticsCommand,
} from './index';

const terms: FreightTerms = {
  id: 'parcel',
  controller: { kind: 'resident', id: 'source' },
  recipient: { kind: 'resident', id: 'recipient' },
  sourceStockId: 'source-stock',
  destinationStockId: 'destination-stock',
  sourceLocationId: 'west',
  destinationLocationId: 'east',
  materialRef: { id: 'goods', revision: 1 },
  items: { Wood: 4 },
  carrierId: 'carrier',
  payer: { sector: 'agent', id: 'payer' },
  deliveryFee: 8,
  returnFee: 3,
  deadline: 10000,
  title: '送四件木料',
  terms: '居民约定的原文',
};
function fixture(t: FreightTerms = terms) {
  let state = emptyLogisticsState(),
    at = 0,
    location = 'west',
    failure: string | undefined,
    recipient = t.recipient;
  let collectiveProof: { actorId: string; decisionId?: string } | undefined;
  const history: Extract<LogisticsDecision, { accepted: true }>[] = [];
  const balances: Record<string, number> = {
    'agent:payer': 100,
    'agent:carrier': 0,
    'public-service:resident-logistics': 0,
    'collective:fund': 100,
  };
  const ports: LogisticsPorts = {
    exists: () => true,
    controllerAvailable: () => true,
    authorize: () => collectiveProof,
    stock: (id) => ({
      locationId: id === 'source-stock' ? 'west' : 'east',
      controller: id === 'source-stock' ? t.controller : recipient,
      status: 'open',
    }),
    material: () => ({
      stockId: 'source-stock',
      revision: 1,
      status: 'offered',
      expiresAt: 10000,
      beneficiary: t.controller,
      consumer: { domain: 'logistics', id: 'parcel' },
      held: { Wood: 4 },
    }),
    account: (a) => ({
      controller: { kind: a.sector === 'agent' ? 'resident' : 'collective', id: a.id },
      balance: balances[`${a.sector}:${a.id}`] ?? 0,
      status: 'open',
    }),
    presentAndIdle: (id, place) => id === 'carrier' && place === location,
    routeExists: () => true,
    cargoAccess: () => failure,
  };
  const commit = (d: LogisticsDecision) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    state = applyLogisticsCommit(state, d.events, d.transactions, d.materialProofs);
    for (const tx of d.transactions) {
      expect(calculateCirculatingMoneyDelta(tx)).toBe(0);
      for (const e of tx.entries)
        balances[e.account.accountId] = (balances[e.account.accountId] ?? 0) + e.amount;
    }
    history.push(d);
  };
  const decide = (actorId: string, type: Exclude<LogisticsCommand['type'], 'offer'>) =>
    decideLogistics(
      state,
      actorId,
      at,
      { type, id: t.id, expectedRevision: state.freight[t.id]!.revision },
      ports,
    );
  const run = (actorId: string, type: Exclude<LogisticsCommand['type'], 'offer'>) =>
    commit(decide(actorId, type));
  return {
    get state() {
      return state;
    },
    get time() {
      return at;
    },
    balances,
    ports,
    history,
    decide,
    run,
    commit,
    offer: (actorId = 'source') =>
      commit(decideLogistics(state, actorId, at, { type: 'offer', ...t }, ports)),
    setLocation: (v: string) => {
      location = v;
    },
    setFailure: (v: string | undefined) => {
      failure = v;
    },
    setTime: (v: number) => {
      at = v;
    },
    setRecipient: (v: Controller) => {
      recipient = v;
    },
    setProof: (v: typeof collectiveProof) => {
      collectiveProof = v;
    },
    replay: () => {
      let s = emptyLogisticsState();
      for (const d of history)
        s = applyLogisticsCommit(s, d.events, d.transactions, d.materialProofs);
      expect(s).toEqual(state);
    },
  };
}
test('source, receiver, payer and carrier independently authorize; only actual delivery releases agreed fee', () => {
  const t = fixture();
  t.offer();
  expect(t.decide('source', 'accept')).toMatchObject({
    accepted: false,
    reason: 'freight-recipient-authority-required',
  });
  t.run('recipient', 'accept');
  expect(t.history.at(-1)!.materialProofs[0]!.operation).toBe('reserve');
  expect(t.decide('source', 'fund')).toMatchObject({
    accepted: false,
    reason: 'freight-payer-authority-required',
  });
  t.run('payer', 'fund');
  expect(t.balances['agent:payer']).toBe(92);
  expect(freightEscrowBalance(t.state)).toBe(8);
  expect(t.decide('source', 'load')).toMatchObject({
    accepted: false,
    reason: 'freight-personal-carrier-required',
  });
  t.run('carrier', 'load');
  expect(t.balances['agent:carrier']).toBe(0);
  expect(t.decide('carrier', 'deliver')).toMatchObject({
    accepted: false,
    reason: 'freight-carrier-not-present-and-idle',
  });
  t.setLocation('east');
  t.run('carrier', 'deliver');
  expect(t.state.freight.parcel).toMatchObject({
    status: 'delivered',
    escrow: 0,
    paid: 8,
    refunded: 0,
  });
  expect(t.balances['agent:carrier']).toBe(8);
  expect(t.balances['public-service:resident-logistics']).toBe(0);
  expect(t.decide('carrier', 'deliver').accepted).toBe(false);
  t.replay();
});
test('cancellation after loading keeps actual custody and escrow until carrier returns, without timeout teleportation', () => {
  const t = fixture();
  t.offer();
  t.run('recipient', 'accept');
  t.run('payer', 'fund');
  t.run('carrier', 'load');
  t.setLocation('road');
  t.run('source', 'cancel');
  expect(t.state.freight.parcel).toMatchObject({
    status: 'return-required',
    escrow: 8,
    paid: 0,
    refunded: 0,
  });
  expect(t.history.at(-1)!.materialProofs).toEqual([]);
  t.setTime(20000);
  t.commit(advanceFreight(t.state, 'parcel', t.time, t.ports));
  expect(t.state.freight.parcel!.status).toBe('return-required');
  expect(nextLogisticsBoundary(t.state, t.time)).toBeUndefined();
  expect(t.decide('carrier', 'return').accepted).toBe(false);
  t.setLocation('west');
  t.run('carrier', 'return');
  expect(t.balances['agent:payer']).toBe(97);
  expect(t.balances['agent:carrier']).toBe(3);
  expect(t.history.at(-1)!.materialProofs[0]!.operation).toBe('return');
  t.replay();
});
test('preload cancellation refunds maximum deposit and releases bound material, never paying invented travel', () => {
  const t = fixture({ ...terms, deliveryFee: 2, returnFee: 9 });
  t.offer();
  t.run('recipient', 'accept');
  t.run('payer', 'fund');
  expect(t.state.freight.parcel!.escrow).toBe(9);
  t.run('carrier', 'cancel');
  expect(t.state.freight.parcel).toMatchObject({
    status: 'cancelled',
    refunded: 9,
    paid: 0,
    escrow: 0,
  });
  expect(t.history.at(-1)!.materialProofs[0]!.operation).toBe('cancel');
  expect(t.balances['agent:payer']).toBe(100);
  t.replay();
});
test('unaccepted offers release only matching still-unbound material and never lock a merely named common payer', () => {
  const t = fixture({ ...terms, payer: { sector: 'collective', id: 'fund' } });
  t.offer();
  expect(freightAccountObligations(t.state, 'fund')).toBe(false);
  expect(freightReservedCommonIncoming(t.state, 'fund')).toBe(0);
  t.run('source', 'cancel');
  expect(t.history.at(-1)!.materialProofs[0]!.operation).toBe('release');
  t.replay();
  const externallyReleased = fixture();
  externallyReleased.offer();
  externallyReleased.commit(
    advanceFreight(externallyReleased.state, 'parcel', 10000, {
      ...externallyReleased.ports,
      material: () => undefined,
    }),
  );
  expect(externallyReleased.history.at(-1)!.materialProofs).toEqual([]);
  expect(externallyReleased.state.freight.parcel!.status).toBe('cancelled');
});
test('expiry uses preload refund or loaded return obligation; physical and recipient gates remain authoritative', () => {
  const t = fixture();
  t.offer();
  t.run('recipient', 'accept');
  t.run('payer', 'fund');
  t.setFailure('freight-load-capacity');
  expect(t.decide('carrier', 'load')).toMatchObject({
    accepted: false,
    reason: 'freight-load-capacity',
  });
  t.setFailure(undefined);
  t.run('carrier', 'load');
  t.setLocation('east');
  t.setRecipient({ kind: 'resident', id: 'new-recipient' });
  expect(t.decide('carrier', 'deliver')).toMatchObject({
    accepted: false,
    reason: 'freight-reception-no-longer-authorized',
  });
  t.commit(advanceFreight(t.state, 'parcel', 10000, t.ports));
  expect(t.state.freight.parcel!.status).toBe('return-required');
  expect(t.balances['agent:carrier']).toBe(0);
  t.replay();
});
test('exact collective authority can fund resources but cannot take over named personal labor', () => {
  const t = fixture({ ...terms, payer: { sector: 'collective', id: 'fund' } });
  t.offer();
  t.run('recipient', 'accept');
  t.setProof({ actorId: 'member' });
  expect(t.decide('member', 'fund').accepted).toBe(false);
  t.setProof({ actorId: 'member', decisionId: 'fund-vote' });
  t.run('member', 'fund');
  expect(freightAccountObligations(t.state, 'fund')).toBe(true);
  expect(freightReservedCommonIncoming(t.state, 'fund')).toBe(8);
  expect(t.decide('member', 'load')).toMatchObject({
    accepted: false,
    reason: 'freight-personal-carrier-required',
  });
  t.replay();
});
test('replay rejects forged money, missing custody proofs, changed parties and out-of-order transitions', () => {
  const t = fixture();
  t.offer();
  const accepted = t.decide('recipient', 'accept');
  if (!accepted.accepted) throw Error(accepted.reason);
  expect(() => applyLogisticsCommit(t.state, accepted.events)).toThrow(
    'freight-material-facts-mismatch',
  );
  t.commit(accepted);
  const funded = t.decide('payer', 'fund');
  if (!funded.accepted) throw Error(funded.reason);
  expect(() => applyLogisticsCommit(t.state, funded.events, [], funded.materialProofs)).toThrow(
    'freight-accounting-facts-mismatch',
  );
  const changed = funded.events.map((e) =>
    e.type === 'FreightChanged' ? { ...e, freight: { ...e.freight, carrierId: 'thief' } } : e,
  );
  expect(() =>
    applyLogisticsCommit(t.state, changed, funded.transactions, funded.materialProofs),
  ).toThrow('freight-transition-facts-mismatch');
  expect(t.decide('carrier', 'load')).toMatchObject({
    accepted: false,
    reason: 'invalid-freight-transition',
  });
});
test('finite precision, load arithmetic, revision conflicts and explicit old-state enable are guarded', () => {
  const t = fixture();
  expect(
    decideLogistics(
      t.state,
      'source',
      0,
      { type: 'offer', ...terms, deliveryFee: 0.00000001 },
      t.ports,
    ).accepted,
  ).toBe(false);
  expect(
    decideLogistics(
      t.state,
      'source',
      0,
      { type: 'offer', ...terms, items: { Wood: Infinity } },
      t.ports,
    ).accepted,
  ).toBe(false);
  t.offer();
  expect(
    decideLogistics(
      t.state,
      'recipient',
      0,
      { type: 'accept', id: 'parcel', expectedRevision: 0 },
      t.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'freight-revision-conflict' });
  expect(() => applyLogisticsCommit(undefined, t.history[0]!.events)).toThrow(
    'invalid-freight-commit-packet',
  );
  expect(physicalLoadUnits({ Wood: 3, Apple: 1.5 })).toBe(4.5);
  expect(() => physicalLoadUnits({ Wood: NaN })).toThrow('invalid-physical-load');
});
