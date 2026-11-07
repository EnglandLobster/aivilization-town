import { expect, test } from 'vitest';
import {
  emptyFreightCustodyState,
  FREIGHT_CUSTODY_COLLECTIVE_VERSION,
  type FreightCustodyState,
  decideFreightCustody,
  applyFreightCustodyEvent,
  freightCustodian,
  type Freight,
  type FreightCustodyPorts,
  type FreightCustodyCommand,
  type FreightCustodyEvent,
} from './index';
const freight: Freight = {
  id: 'parcel',
  controller: { kind: 'resident', id: 'source' },
  recipient: { kind: 'resident', id: 'recipient' },
  sourceStockId: 'stock-a',
  destinationStockId: 'stock-b',
  sourceLocationId: 'a',
  destinationLocationId: 'b',
  materialRef: { id: 'material', revision: 1 },
  items: { Wood: 4 },
  carrierId: 'original',
  payer: { sector: 'agent', id: 'payer' },
  deliveryFee: 8,
  returnFee: 3,
  deadline: 10000,
  title: 'Original',
  terms: 'Original terms',
  status: 'loaded',
  createdBy: 'source',
  createdAt: 0,
  at: 0,
  revision: 4,
  funded: 8,
  escrow: 8,
  paid: 0,
  refunded: 0,
};
function fixture(departed = false) {
  let s = emptyFreightCustodyState(),
    failure: string | undefined = 'not-at-actual-cargo';
  const history: FreightCustodyEvent[] = [];
  const p: FreightCustodyPorts = {
    authorize: () => undefined,
    exists: (id) => !departed || id !== 'original',
    payerController: () => ({ kind: 'resident', id: 'payer' }),
    departure: () =>
      departed ? { actorId: 'original', populationEventId: 'actual-death', at: 0 } : undefined,
    takingFailure: () => failure,
  };
  const decide = (actorId: string, command: FreightCustodyCommand, at = 1, f = freight) =>
    decideFreightCustody({ state: s, freight: f, actorId, command, at, ports: p });
  const commit = (d: ReturnType<typeof decide>) => {
    if (!d.accepted) throw Error(d.reason);
    s = applyFreightCustodyEvent(s, freight, d.event);
    history.push(d.event);
    return d.event;
  };
  const propose = () =>
    commit(
      decide('source', { type: 'propose', id: 'handoff', nextCarrierId: 'next', expiresAt: 1000 }),
    );
  const consent = (actor: string, role: 'source' | 'recipient' | 'payer' | 'previous-carrier') =>
    commit(
      decide(actor, {
        type: 'consent',
        id: 'handoff',
        role,
        expectedRevision: s.proposals.handoff!.revision,
      }),
    );
  const accept = (actor = 'next') =>
    decide(actor, {
      type: 'accept',
      id: 'handoff',
      expectedRevision: s.proposals.handoff!.revision,
    });
  return {
    get s() {
      return s;
    },
    p,
    decide,
    commit,
    propose,
    consent,
    accept,
    history,
    present: () => {
      failure = undefined;
    },
  };
}
for (const departed of [false, true])
  test(`custody changes only after exact independent consent and actual taking; departed ${departed}`, () => {
    const t = fixture(departed),
      original = structuredClone(freight);
    t.propose();
    expect(t.accept()).toMatchObject({
      accepted: false,
      reason: 'custody-independent-consents-required',
    });
    expect(
      t.decide('next', { type: 'consent', id: 'handoff', expectedRevision: 1, role: 'payer' })
        .accepted,
    ).toBe(false);
    t.consent('source', 'source');
    t.consent('recipient', 'recipient');
    t.consent('payer', 'payer');
    if (!departed) t.consent('original', 'previous-carrier');
    expect(t.accept('source')).toMatchObject({
      accepted: false,
      reason: 'custody-successor-personal-acceptance-required',
    });
    expect(t.accept()).toMatchObject({ accepted: false, reason: 'not-at-actual-cargo' });
    expect(freightCustodian(t.s, freight).carrierId).toBe('original');
    t.present();
    const before = t.s,
      event = t.commit(t.accept());
    expect(freightCustodian(t.s, freight).carrierId).toBe('next');
    expect(freight).toEqual(original);
    expect(
      t.history.reduce(
        (s, e) => applyFreightCustodyEvent(s, freight, e),
        emptyFreightCustodyState(),
      ),
    ).toEqual(t.s);
    expect(() => applyFreightCustodyEvent(t.s, freight, event)).toThrow();
    expect(() =>
      applyFreightCustodyEvent(before, freight, {
        ...event,
        value: { ...event.value, consents: {} },
      }),
    ).toThrow();
  });
test('changed contract, expired proposal, missing death source and rewritten terms cannot reuse consent', () => {
  const t = fixture(true);
  t.propose();
  const command = {
    type: 'consent' as const,
    id: 'handoff',
    expectedRevision: 1,
    role: 'source' as const,
  };
  expect(t.decide('source', command, 1000).accepted).toBe(false);
  expect(t.decide('source', command, 1, { ...freight, revision: 5 }).accepted).toBe(false);
  expect(
    decideFreightCustody({
      state: emptyFreightCustodyState(),
      freight,
      actorId: 'source',
      at: 1,
      command: { type: 'propose', id: 'other', nextCarrierId: 'next', expiresAt: 100 },
      ports: { ...t.p, departure: () => undefined },
    }).accepted,
  ).toBe(false);
  const d = t.decide('source', command);
  if (!d.accepted) throw Error(d.reason);
  expect(() =>
    applyFreightCustodyEvent(t.s, freight, {
      ...d.event,
      value: { ...d.event.value, nextCarrierId: 'intruder' },
    }),
  ).toThrow('custody-proposal-terms-changed');
});

test('unexecuted consent can be withdrawn and cannot authorize a later acceptance', () => {
  const t = fixture();
  t.propose();
  t.consent('payer', 'payer');
  const event = t.commit(
    t.decide('payer', { type: 'withdraw', id: 'handoff', expectedRevision: 2 }),
  );
  expect(event.value).toMatchObject({ status: 'withdrawn', lastActorId: 'payer' });
  expect(t.accept()).toMatchObject({ accepted: false, reason: 'custody-proposal-stale' });
  expect(freightCustodian(t.s, freight).carrierId).toBe('original');
});
test('a collective authorization must still be valid when the successor takes custody', () => {
  let s = emptyFreightCustodyState(),
    revoked = false;
  const p: FreightCustodyPorts = {
    exists: () => true,
    authorize: () => (revoked ? undefined : { actorId: 'payer', decisionId: 'decision-1' }),
    payerController: () => ({ kind: 'collective', id: 'group' }),
    departure: () => undefined,
    takingFailure: () => undefined,
  };
  const run = (actorId: string, command: FreightCustodyCommand) => {
    const d = decideFreightCustody({ state: s, freight, actorId, command, at: 1, ports: p });
    if (!d.accepted) throw Error(d.reason);
    s = applyFreightCustodyEvent(s, freight, d.event);
  };
  run('source', { type: 'propose', id: 'h', nextCarrierId: 'next', expiresAt: 100 });
  for (const [actor, role] of [
    ['source', 'source'],
    ['recipient', 'recipient'],
    ['payer', 'payer'],
    ['original', 'previous-carrier'],
  ] as const)
    run(actor, { type: 'consent', id: 'h', role, expectedRevision: s.proposals.h!.revision });
  revoked = true;
  expect(
    decideFreightCustody({
      state: s,
      freight,
      actorId: 'next',
      at: 1,
      ports: p,
      command: { type: 'accept', id: 'h', expectedRevision: s.proposals.h!.revision },
    }),
  ).toMatchObject({ accepted: false, reason: 'custody-consent-authority-no-longer-valid' });
});

test('versioned collective grants bind each role; a historical representative has no personal withdrawal right and need not stay alive', () => {
  const f: Freight = { ...freight, controller: { kind: 'collective', id: 'club' } };
  let s: FreightCustodyState = {
    ...emptyFreightCustodyState(),
    collectiveGrantsVersion: FREIGHT_CUSTODY_COLLECTIVE_VERSION,
  };
  let actor = 'representative',
    decisionId: string | undefined = 'propose',
    departed = false;
  const p: FreightCustodyPorts = {
    exists: (id) => !departed || id !== 'representative',
    authorize: () => (decisionId ? { actorId: actor, decisionId } : undefined),
    payerController: () => ({ kind: 'collective', id: 'club' }),
    departure: () => undefined,
    takingFailure: () => undefined,
    collectiveConsentValid: (v, role) => v.consents[role]?.decisionId === `consent-${role}`,
  };
  const run = (who: string, command: FreightCustodyCommand) => {
    actor = who;
    const d = decideFreightCustody({
      state: s,
      freight: f,
      actorId: actor,
      at: 1,
      command,
      ports: p,
    });
    if (!d.accepted) throw Error(d.reason);
    s = applyFreightCustodyEvent(s, f, d.event);
  };
  run(actor, { type: 'propose', id: 'h', nextCarrierId: 'next', expiresAt: 100 });
  expect(s.proposals.h!.createdByCollectiveId).toBe('club');
  for (const [who, role] of [
    ['representative', 'source'],
    ['recipient', 'recipient'],
    ['representative', 'payer'],
    ['original', 'previous-carrier'],
  ] as const) {
    decisionId = `consent-${role}`;
    run(who, { type: 'consent', id: 'h', role, expectedRevision: s.proposals.h!.revision });
  }
  decisionId = undefined;
  expect(
    decideFreightCustody({
      state: s,
      freight: f,
      actorId: 'representative',
      at: 1,
      command: { type: 'withdraw', id: 'h', expectedRevision: 5 },
      ports: p,
    }),
  ).toMatchObject({ accepted: false, reason: 'custody-withdrawal-party-required' });
  const before = s;
  decisionId = 'new-withdraw-decision';
  run('new-representative', { type: 'withdraw', id: 'h', expectedRevision: 5 });
  expect(s.proposals.h!.withdrawalAuthority).toEqual({ collectiveId: 'club', decisionId });
  s = before;
  decisionId = undefined;
  departed = true;
  run('next', { type: 'accept', id: 'h', expectedRevision: 5 });
  expect(s.holders[f.id]!.carrierId).toBe('next');
});
