import { expect, test } from 'vitest';
import {
  applyEvidenceTradeCommit,
  decideEvidenceTrade,
  emptyEvidenceTradeState,
  EVIDENCE_TRADE_POLICY_V2,
  tradeSourceEarned,
  validTradeEvidence,
  type EvidenceTradeCommand,
  type EvidenceTradeDecision,
  type EvidenceTradePorts,
  type PermitTradeEvidence,
} from './index';
const source = (): PermitTradeEvidence => ({
  sourceVersion: 'premises-provision-v1',
  revision: 1,
  permitRevision: 1,
  at: 0,
  status: 'offered',
  basis: {
    kind: 'permit',
    id: 'permit',
    seller: { kind: 'resident', id: 'owner' },
    buyer: { kind: 'resident', id: 'user' },
    createdAt: 0,
    buildingId: 'hall',
    issuerVersion: 1,
    users: ['user'],
    scopes: ['operate'],
    mode: 'shared',
    title: 'Original permission',
    terms: 'Original scope',
    startAt: 100,
    endAt: 1100,
    acceptBy: 200,
  },
});
const offer: EvidenceTradeCommand = {
  type: 'offer',
  id: 'order',
  title: 'Resident price',
  terms: 'Permission availability only',
  source: { kind: 'permit', id: 'permit', expectedRevision: 1 },
  payer: { sector: 'agent', id: 'user' },
  revenue: { sector: 'agent', id: 'owner' },
  amount: 30,
  acceptBy: 150,
};
function fixture() {
  let s = emptyEvidenceTradeState(EVIDENCE_TRADE_POLICY_V2),
    evidence = source();
  const initial = s,
    journal: Extract<EvidenceTradeDecision, { accepted: true }>[] = [];
  const ports: EvidenceTradePorts = {
    exists: () => true,
    authorize: () => undefined,
    controllerAvailable: () => true,
    account: (a) => ({ controller: { kind: 'resident', id: a.id }, balance: 100, status: 'open' }),
    evidence: () => evidence,
  };
  const decide = (actor: string, c: EvidenceTradeCommand, at = 10) =>
    decideEvidenceTrade(s, actor, at, c, ports);
  const commit = (d: EvidenceTradeDecision) => {
    if (!d.accepted) throw Error(d.reason);
    s = applyEvidenceTradeCommit(s, d.events, d.transactions, d.evidenceReads);
    journal.push(d);
    return d;
  };
  return {
    get s() {
      return s;
    },
    get evidence() {
      return evidence;
    },
    set evidence(e: PermitTradeEvidence) {
      evidence = e;
    },
    initial,
    journal,
    ports,
    decide,
    commit,
  };
}
test('v1 cannot create paid permissions; an explicit v2 upgrade preserves every prior ledger entry', () => {
  const f = fixture(),
    old = emptyEvidenceTradeState();
  expect(decideEvidenceTrade(old, 'owner', 10, offer, f.ports)).toMatchObject({
    accepted: false,
    reason: 'trade-permit-requires-v2',
  });
  const next = applyEvidenceTradeCommit(old, [
    {
      type: 'EvidenceTradePolicyUpgraded',
      fromVersion: 'resident-evidence-trade-v1',
      policy: EVIDENCE_TRADE_POLICY_V2,
    },
  ]);
  expect(next.orders).toBe(old.orders);
  expect(next.receipts).toBe(old.receipts);
  expect(decideEvidenceTrade(next, 'owner', 10, offer, f.ports).accepted).toBe(true);
  expect(() =>
    applyEvidenceTradeCommit(next, [
      {
        type: 'EvidenceTradePolicyUpgraded',
        fromVersion: 'resident-evidence-trade-v1',
        policy: EVIDENCE_TRADE_POLICY_V2,
      },
    ]),
  ).toThrow('invalid-trade-policy-upgrade');
});
test('price follows recorded available duration, refunds unavailable time and awaits independent buyer confirmation', () => {
  const f = fixture();
  f.commit(f.decide('owner', offer));
  expect(f.decide('owner', { type: 'accept', id: 'order', expectedRevision: 1 })).toMatchObject({
    accepted: false,
  });
  f.commit(f.decide('user', { type: 'accept', id: 'order', expectedRevision: 1 }));
  f.evidence = {
    ...f.evidence,
    revision: 7,
    permitRevision: 3,
    at: 1100,
    status: 'expired',
    acceptedAt: 10,
    closedAt: 1100,
    provision: {
      orderId: 'order',
      revision: 4,
      settledAt: 1100,
      availableMs: 700,
      unavailableMs: 300,
    },
  };
  const d = f.commit(f.decide('user', { type: 'observe', id: 'order', expectedRevision: 2 }, 1100));
  expect(f.s.orders.order).toMatchObject({
    earned: 21,
    refunded: 9,
    escrow: 21,
    paid: 0,
    status: 'awaiting-confirmation',
  });
  expect(d.transactions.flatMap((t) => t.entries).reduce((sum, e) => sum + e.amount, 0)).toBe(0);
  f.commit(f.decide('user', { type: 'confirm', id: 'order', expectedRevision: 3 }, 1100));
  expect(f.s.orders.order).toMatchObject({ escrow: 0, paid: 21, refunded: 9, status: 'completed' });
  expect(
    f.journal.reduce(
      (s, d) => applyEvidenceTradeCommit(s, d.events, d.transactions, d.evidenceReads),
      f.initial,
    ),
  ).toEqual(f.s);
});
test('early release and late acceptance only earn available original-window time with micro-unit floor', () => {
  const e: PermitTradeEvidence = {
    ...source(),
    revision: 5,
    permitRevision: 3,
    at: 600,
    status: 'released',
    acceptedAt: 125,
    closedAt: 600,
    provision: {
      orderId: 'order',
      revision: 2,
      settledAt: 600,
      availableMs: 475,
      unavailableMs: 0,
    },
  };
  expect(validTradeEvidence(e, 600)).toBe(true);
  expect(tradeSourceEarned(e, 0.000003)).toBe(0.000001);
  expect(
    tradeSourceEarned(
      { ...e, provision: { ...e.provision!, settledAt: 500, availableMs: 375 } },
      30,
    ),
  ).toBeUndefined();
  expect(validTradeEvidence({ ...e, provision: { ...e.provision!, availableMs: 476 } }, 600)).toBe(
    false,
  );
});
test('an existing free acceptance cannot be charged retroactively and invented or unrelated counters reject', () => {
  const f = fixture();
  f.evidence = {
    ...f.evidence,
    revision: 2,
    permitRevision: 2,
    at: 10,
    status: 'accepted',
    acceptedAt: 10,
  };
  expect(
    f.decide('owner', { ...offer, source: { kind: 'permit', id: 'permit', expectedRevision: 2 } }),
  ).toMatchObject({ accepted: false });
  f.evidence = source();
  f.commit(f.decide('owner', offer));
  f.commit(f.decide('user', { type: 'accept', id: 'order', expectedRevision: 1 }));
  f.evidence = {
    ...source(),
    revision: 5,
    permitRevision: 3,
    at: 1100,
    status: 'expired',
    acceptedAt: 10,
    closedAt: 1100,
    provision: {
      orderId: 'someone-else',
      revision: 2,
      settledAt: 1100,
      availableMs: 1000,
      unavailableMs: 0,
    },
  };
  expect(
    f.decide('user', { type: 'observe', id: 'order', expectedRevision: 2 }, 1100),
  ).toMatchObject({ accepted: false, reason: 'trade-source-facts-mismatch' });
});
test('acceptance deadlines and original permission parties and scopes remain exact', () => {
  const f = fixture();
  expect(f.decide('owner', { ...offer, acceptBy: 201 })).toMatchObject({ accepted: false });
  f.commit(f.decide('owner', offer));
  f.evidence = { ...f.evidence, basis: { ...f.evidence.basis, scopes: ['store'] } };
  expect(f.decide('user', { type: 'accept', id: 'order', expectedRevision: 1 })).toMatchObject({
    accepted: false,
    reason: 'trade-source-facts-mismatch',
  });
  expect(
    validTradeEvidence(
      { ...source(), basis: { ...source().basis, mode: 'exclusive', scopes: ['entry'] } },
      10,
    ),
  ).toBe(false);
});
