import { applyOpenSocietyEffects } from './state';
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  principalTradeRequest,
  evidenceTradeEscrowBalance,
  type PrincipalTradeCommand,
} from '@aivilization/commerce';
import {
  principalPermitRequest,
  type PrincipalPremisesRightsCommand,
} from '@aivilization/premises';
import type { ResourcePrincipal, PrincipalOperationRequest } from '@aivilization/authority';
import {
  applyWorldEvent,
  mayOperateWorldPremises,
  principalPermitTradeEvidence,
} from '@aivilization/world';
import { openPermitsFixture } from './testFixtures/openPermits';

function fixture(enabled = true, wear: { wearIntervalMs?: number; wearPerInterval?: number } = {}) {
  const t = openPermitsFixture(true, { principals: true, paidPermits: true, ...wear });
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '原始收费主体',
    occupationName: '角色',
    initialCapital: 100,
    maxEmployees: 3,
  });
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  const control = (command: Record<string, unknown>) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: t.building().revision,
    controlVersion: t.building().control.version,
    command,
  });
  t.ok(t.b, 'principals.control', {
    request: control({
      type: 'offer',
      target: { kind: 'enterprise', id: 'firm' },
      terms: '独立承接建筑',
      expiresAt: t.r.state.world.clock.now + 1000000,
    }),
  });
  t.ok(t.b, 'principals.control', { request: control({ type: 'accept' }) });
  expect(t.r.enablePrincipalPermits().ok).toBe(true);
  if (enabled) expect(t.r.enablePrincipalTrade().ok).toBe(true);
  const request = (c: PrincipalTradeCommand): PrincipalOperationRequest =>
    principalTradeRequest(
      t.r.state.world.residentTrade!,
      c,
      c.type === 'offer' ? principalPermitTradeEvidence(t.r.state.world, c.source.id) : undefined,
    );
  const permitRequest = (c: PrincipalPremisesRightsCommand) =>
    principalPermitRequest(t.r.state.world.premisesRights!, c, { building: () => t.building() });
  const permission = (grantee: ResourcePrincipal = { kind: 'resident', id: t.c }) => {
    t.ok(t.b, 'principals.operate', {
      request: permitRequest({
        type: 'offer',
        buildingRevision: t.building().revision,
        terms: {
          id: 'usage',
          buildingId: 'home',
          grantee,
          users: [t.c],
          scopes: ['operate'],
          mode: 'shared',
          title: '原工坊许可',
          terms: '许可可用时间，非满意评价',
          startAt: t.r.state.world.clock.now,
          endAt: t.r.state.world.clock.now + 3600000,
          acceptBy: t.r.state.world.clock.now + 600000,
        },
      }),
    });
  };
  const offer = (
    payer: Extract<PrincipalTradeCommand, { type: 'offer' }>['payer'] = {
      sector: 'agent',
      id: t.c,
    },
  ) => ({
    type: 'offer' as const,
    id: 'fee',
    title: '工坊费用',
    terms: '按可用时间，未履行退原付款方',
    source: {
      kind: 'permit' as const,
      id: 'usage',
      expectedRevision: t.r.state.world.premisesRights!.permits.usage!.revision,
    },
    payer,
    revenue: { sector: 'enterprise' as const, id: 'firm' },
    amount: 36,
    acceptBy: t.r.state.world.clock.now + 600000,
  });
  const approvePublic = (id: string, r: PrincipalOperationRequest) => {
    t.ok(t.a, 'governance.propose', {
      id,
      text: '明确订单和原国库付款',
      action: {
        kind: 'manage-resource',
        expectedRevision: r.resourceRevision,
        request: r,
      },
      closesAt: t.r.state.world.clock.now + 60000,
      expectedProcedureRevision: t.r.state.world.publicGovernance!.authority.procedureRevision,
    });
    for (const actor of [t.a, t.b, t.c])
      t.ok(actor, 'governance.vote', {
        id,
        choice: 'yes',
        expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
      });
    t.time(60000);
    t.ok(t.d, 'governance.close', {
      id,
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    });
    return {
      id,
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    };
  };
  return { ...t, request, permitRequest, control, permission, offer, approvePublic };
}
test('explicit fee migration preserves original manifest and all legacy accounts; no implicit upgrade', () => {
  const t = fixture(false),
    before = structuredClone(t.r.state.world),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  t.permission();
  expect(t.call(t.b, 'principals.operate', { request: t.request(t.offer()) }).error).toBe(
    'principal-trade-not-enabled',
  );
  expect(t.r.enablePrincipalTrade().ok).toBe(true);
  expect(t.r.enablePrincipalTrade().ok).toBe(true);
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(t.r.state.world.residentTrade!.orders).toEqual(before.residentTrade!.orders);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  t.replay();
});
test('actual enterprise revenue, atomic independent funding/consent, real availability and partial release preserve all cash', () => {
  const t = fixture();
  t.permission();
  const residents = structuredClone(t.r.state.world.agents),
    firmBalance = t.r.state.world.enterprises.firm!.balance,
    managerBalance = residents[t.b]!.balance,
    supply = t.r.state.world.moneySupply;
  expect(t.call(t.a, 'principals.operate', { request: t.request(t.offer()) }).ok).toBe(false);
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
  expect(
    t.call(t.c, 'principals.operate', {
      request: t.permitRequest({ type: 'accept', id: 'usage', revision: 1 }),
    }).error,
  ).toBe('permit-paid-acceptance-required');
  const before = structuredClone(t.r.state.world);
  t.ok(t.c, 'principals.operate', {
    request: t.request({ type: 'accept', id: 'fee', expectedRevision: 1 }),
  });
  expect(t.r.state.world.agents[t.c]!.balance).toBe(residents[t.c]!.balance - 36);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(managerBalance);
  expect(t.r.state.world.enterprises.firm!.balance).toBe(firmBalance);
  expect(evidenceTradeEscrowBalance(t.r.state.world.residentTrade)).toBe(36);
  expect(mayOperateWorldPremises(t.r.state.world, t.c, t.building().locationId)).toBe(true);
  const commit = t.r.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .find((e) => e.type === 'ResidentPrincipalEvidenceTradeCommitted' && e.payload.paidPermit);
  if (commit?.type !== 'ResidentPrincipalEvidenceTradeCommitted')
    throw Error('missing funding commit');
  expect(commit.payload.paidPermit!.acceptance.authorization.request.operation.capability).toBe(
    'trades.accept',
  );
  expect(() =>
    applyWorldEvent(before, { ...commit, payload: { ...commit.payload, transactions: [] } }),
  ).toThrow();
  const { paidPermit: omittedPaidPermit, ...withoutPaidPermit } = commit.payload;
  void omittedPaidPermit;
  expect(() => applyWorldEvent(before, { ...commit, payload: withoutPaidPermit })).toThrow();
  expect(() =>
    applyWorldEvent(before, { ...commit, payload: { ...commit.payload, enterpriseEvents: [] } }),
  ).toThrow('principal-trade-enterprise-source-mismatch');
  expect(
    t.call(t.b, 'principals.operate', {
      request: t.permitRequest({ type: 'release', id: 'usage', revision: 2 }),
    }).ok,
  ).toBe(false);
  t.time(900000);
  const order = t.r.state.world.residentTrade!.principalOrders!.orders.fee!;
  expect(order.paidMicros).toBe(9000000);
  expect(t.r.state.world.enterprises.firm!.balance).toBeCloseTo(firmBalance + 9, 6);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(managerBalance);
  t.ok(t.c, 'principals.operate', {
    request: t.permitRequest({ type: 'release', id: 'usage', revision: 2 }),
  });
  expect(t.r.state.world.residentTrade!.principalOrders!.orders.fee).toMatchObject({
    status: 'settled',
    paidMicros: 9000000,
    refundedMicros: 27000000,
    escrowMicros: 0,
  });
  expect(t.r.state.world.agents[t.c]!.balance).toBe(residents[t.c]!.balance - 9);
  expect(t.r.state.world.moneySupply).toBe(supply);
  expect(t.ok(t.b, 'trades.read', { id: 'fee' }).data).toMatchObject({
    policyVersion: 'resident-principal-evidence-trade-v3',
  });
  t.replay();
});
test('public exact parent approval funds treasury and records consent without inventing an independent free permission vote', () => {
  const t = fixture(),
    id = t.r.state.world.publicGovernance!.authority.grant.id;
  t.permission({ kind: 'public', id });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ sector: 'treasury', id: 'public-treasury' })),
  });
  const request = t.request({ type: 'accept', id: 'fee', expectedRevision: 1 }),
    before = t.r.state.world.treasury!;
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  const approval = t.approvePublic('buy-usage', request);
  t.ok(t.d, 'governance.execute', approval);
  expect(t.r.state.world.treasury).toBe(before - 36);
  const permit = t.r.state.world.premisesRights!.permits.usage!;
  expect(
    'principalAuthorization' in permit && permit.principalAuthorization.accepted?.request,
  ).toEqual(request);
  expect(t.call(t.d, 'governance.execute', approval).ok).toBe(false);
  const release = t.approvePublic(
    'release-usage',
    t.permitRequest({ type: 'release', id: 'usage', revision: 2 }),
  );
  t.ok(t.a, 'governance.execute', release);
  expect(t.r.state.world.residentTrade!.principalOrders!.orders.fee!.status).toBe('settled');
  expect(t.r.state.world.publicGovernance!.authority.proposals['buy-usage']!.status).toBe(
    'executed',
  );
  t.replay();
});

test('enterprise payer reserves its own funds and recognizes actual expense; later custody never redirects the frozen seller account', () => {
  const t = fixture();
  t.ok(t.c, 'world.found_enterprise', {
    enterpriseId: 'buyer-firm',
    name: '实际付款企业',
    occupationName: '角色',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.permission({ kind: 'enterprise', id: 'buyer-firm' });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ sector: 'enterprise', id: 'buyer-firm' })),
  });
  const personal = t.r.state.world.agents[t.c]!.balance;
  t.ok(t.c, 'principals.operate', {
    request: t.request({ type: 'accept', id: 'fee', expectedRevision: 1 }),
  });
  expect(t.r.state.world.enterprises['buyer-firm']).toMatchObject({
    balance: 64,
    cumulativePurchases: 0,
    retainedEarnings: 0,
  });
  expect(t.r.state.world.agents[t.c]!.balance).toBe(personal);
  t.ok(t.b, 'principals.control', {
    request: t.control({
      type: 'offer',
      target: { kind: 'resident', id: t.a },
      terms: '保留原收费和使用约定',
      expiresAt: t.r.state.world.clock.now + 600000,
    }),
  });
  t.ok(t.a, 'principals.control', { request: t.control({ type: 'accept' }) });
  expect(t.call(t.b, 'world.close_enterprise', { enterpriseId: 'firm' }).ok).toBe(false);
  expect(t.call(t.c, 'world.close_enterprise', { enterpriseId: 'buyer-firm' }).ok).toBe(false);
  t.time(3600000);
  expect(t.r.state.world.enterprises['buyer-firm']).toMatchObject({
    balance: 64,
    cumulativePurchases: 36,
    retainedEarnings: -36,
  });
  expect(t.r.state.world.enterprises.firm).toMatchObject({
    balance: 136,
    cumulativeSales: 36,
    retainedEarnings: 36,
  });
  expect(t.r.state.world.residentTrade!.principalOrders!.orders.fee).toMatchObject({
    status: 'settled',
    paidMicros: 36000000,
    refundedMicros: 0,
  });
  expect(t.r.state.world.agents[t.a]!.balance).not.toBe(536);
  t.replay();
});

test('collective funding uses its actual common account and consumes only the exact approved parent decision', () => {
  const t = fixture(),
    at = t.r.state.world.clock.now;
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同使用',
      terms: '精确支出表决',
      members: [t.b, t.c],
      voters: [t.b, t.c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: at + 1000000,
  });
  t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  t.ok(t.b, 'funds.open', { id: 'pool', collectiveId: 'club', title: '真实共同资金' });
  t.ok(t.a, 'funds.contribute', {
    id: 'pool',
    expectedRevision: 1,
    amount: 40,
    note: '自愿提供，不授予股权',
  });
  t.permission({ kind: 'collective', id: 'club' });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ sector: 'collective', id: 'pool' })),
  });
  const request = t.request({ type: 'accept', id: 'fee', expectedRevision: 1 });
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  t.ok(t.b, 'collectives.propose', {
    id: 'pay',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '仅这份许可费用',
    action: {
      kind: 'resource',
      capability: 'principals.operate',
      resourceId: request.resourceId,
      arguments: { request },
    },
    closesAt: at + 100000,
    executeBefore: at + 1000000,
  });
  for (const actor of [t.b, t.c])
    t.ok(actor, 'collectives.vote', {
      id: 'pay',
      expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
      vote: 'yes',
    });
  t.ok(t.b, 'collectives.decide', {
    id: 'pay',
    expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
  });
  const before = structuredClone(t.r.state.world),
    beforeState = structuredClone(t.r.state);
  t.ok(t.c, 'collectives.execute', {
    id: 'pay',
    expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
  });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(4);
  expect(t.r.state.collectives!.decisions.pay!.status).toBe('executed');
  const commit = t.r.journal.commits.find((c) =>
    c.collectiveEvents?.some(
      (e) =>
        e.type === 'CollectiveDecisionChanged' &&
        e.decision.id === 'pay' &&
        e.decision.status === 'executed',
    ),
  )!;
  const funded = commit.worldEvents?.find(
    (e) => e.type === 'ResidentPrincipalEvidenceTradeCommitted' && e.payload.paidPermit,
  );
  if (funded?.type !== 'ResidentPrincipalEvidenceTradeCommitted')
    throw Error('missing common paid effect');
  expect(funded.payload.commonAccountEvents).toHaveLength(2);
  expect(() => applyOpenSocietyEffects(beforeState, { worldEvents: commit.worldEvents! })).toThrow(
    'world-principal-operation-source-mismatch',
  );
  expect(() => applyWorldEvent(before, funded)).toThrow(
    'principal-trade-actual-authority-required',
  );
  expect(
    t.call(t.c, 'collectives.execute', {
      id: 'pay',
      expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
    }).ok,
  ).toBe(false);
  t.time(3600000);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(4);
  expect(evidenceTradeEscrowBalance(t.r.state.world.residentTrade)).toBe(0);
  t.replay();
});

test('world fees follow actual damaged-building intervals; divided and single time advances settle identically', () => {
  const snapshots = [];
  for (const divided of [false, true]) {
    const t = fixture(true, { wearIntervalMs: 60000, wearPerInterval: 1000 });
    t.permission();
    t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
    t.ok(t.c, 'principals.operate', {
      request: t.request({ type: 'accept', id: 'fee', expectedRevision: 1 }),
    });
    if (divided) for (let i = 0; i < 12; i++) t.time(300000);
    else t.time(3600000);
    expect(t.building().condition).toBe(0);
    const q = t.r.state.world.premisesRights!.provisions!.usage!;
    expect(q.availableMs).toBe(60000);
    expect(q.unavailableMs).toBe(3540000);
    const order = t.r.state.world.residentTrade!.principalOrders!.orders.fee!;
    expect(order).toMatchObject({
      status: 'settled',
      paidMicros: 600000,
      refundedMicros: 35400000,
      escrowMicros: 0,
    });
    expect(t.r.state.world.enterprises.firm!.balance).toBeCloseTo(100.6, 6);
    snapshots.push({
      paid: order.paidMicros,
      refunded: order.refundedMicros,
      available: q.availableMs,
      unavailable: q.unavailableMs,
      revenue: t.r.state.world.enterprises.firm!.balance,
      buyer: t.r.state.world.agents[t.c]!.balance,
      supply: t.r.state.world.moneySupply,
    });
    t.replay();
  }
  expect(snapshots[0]).toEqual(snapshots[1]);
});
