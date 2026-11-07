import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyWorldEvent,
  worldPeriodicRequest,
  normalizeLegacyWorldProjectionSnapshot,
  dispatchWorldCommand,
} from '@aivilization/world';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { commonAccountsBalance } from '@aivilization/economy';
import {
  periodicAccountObligations,
  periodicUnpaidMicros,
  type PeriodicAccount,
  type PeriodicCommand,
} from '@aivilization/commerce';
import {
  assertPrincipalOperationRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import { createOpenSocietyManifest, openWorldPolicies } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup.length = 0;
});
function fixture(enabled = true, maxQueryItems = 30) {
  const root = mkdtempSync(join(tmpdir(), 'finite-obligations-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 4,
    continuity: true,
    elapsedRest: true,
    publicGovernance: true,
  });
  const r = new OpenSocietyRuntime(root, { ...m, policy: { ...m.policy, maxQueryItems } });
  cleanup.push(() => r.close());
  const [a, b, c, d] = m.residents.map((x) => x.id) as [string, string, string, string];
  let n = 0;
  const call = (
    actorId: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `query-${++n}`,
  ) => {
    r.beginTurn(actorId);
    const v = r.invoke(actorId, { name, arguments: args, requestId });
    r.finishTurn(actorId, { summary: 'Finite financial agreement verification' });
    return v;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const v = call(actor, name, args);
    expect(v.ok, `${name}:${v.error}`).toBe(true);
    return v;
  };
  if (enabled) expect(r.enablePeriodicObligations().ok).toBe(true);
  const state = () => r.state.world.periodicObligations!;
  const rev = (id = 'promise') => state().contracts[id]!.revision;
  const request = (c: PeriodicCommand) => worldPeriodicRequest(r.state.world, c);
  const time = (ms: number) => {
    const v = r.advanceTime(ms, `time-${++n}`);
    expect(v.ok, v.error).toBe(true);
  };
  const offer = (
    extra: Partial<Extract<PeriodicCommand, { type: 'offer' }>> = {},
  ): Extract<PeriodicCommand, { type: 'offer' }> => ({
    type: 'offer',
    id: 'promise',
    title: '居民自定有限原文',
    terms: '这不创造房屋、会籍或服务',
    payer: { sector: 'agent', id: a },
    revenue: { sector: 'agent', id: c },
    amount: 25,
    periods: 3,
    firstDueAt: r.state.world.clock.now + 500000,
    periodMs: 60000,
    acceptBy: r.state.world.clock.now + 400000,
    ...extra,
  });
  const operate = (actor: string, c: PeriodicCommand) =>
    ok(actor, 'principals.operate', { request: request(c) });
  const ready = (extra: Partial<Extract<PeriodicCommand, { type: 'offer' }>> = {}) => {
    operate(a, offer(extra));
    operate(c, { type: 'accept', id: extra.id ?? 'promise', expectedRevision: 1 });
  };
  const common = () => {
    ok(a, 'collectives.create', {
      id: 'club',
      configuration: {
        title: '共同原文',
        terms: '两个人的真实共同决定',
        members: [a, b],
        voters: [a, b],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: r.state.world.clock.now + 1000000,
    });
    ok(b, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
    ok(a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '共同现金' });
    ok(d, 'funds.contribute', {
      id: 'pool',
      expectedRevision: 1,
      amount: 100,
      note: '独立实款，不造股权',
    });
  };
  const collective = (q: PrincipalOperationRequest, id = `decision-${++n}`) => {
    ok(a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: r.state.collectives!.charters.club!.version,
      terms: '批准全部固定期数总额',
      action: {
        kind: 'resource',
        capability: 'principals.operate',
        resourceId: q.resourceId,
        arguments: { request: q },
      },
      closesAt: r.state.world.clock.now + 10000,
      executeBefore: r.state.world.clock.now + 200000,
    });
    for (const actor of [a, b])
      ok(actor, 'collectives.vote', {
        id,
        expectedRevision: r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    ok(a, 'collectives.decide', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
    return ok(a, 'collectives.execute', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
  };
  const publicExecute = (q: PrincipalOperationRequest, id = `public-${++n}`) => {
    ok(a, 'governance.propose', {
      id,
      text: '整份有限财政承诺，不造借款',
      action: { kind: 'manage-resource', expectedRevision: q.resourceRevision, request: q },
      closesAt: r.state.world.clock.now + 60000,
      expectedProcedureRevision: r.state.world.publicGovernance!.authority.procedureRevision,
    });
    for (const actor of [a, b, c])
      ok(actor, 'governance.vote', {
        id,
        choice: 'yes',
        expectedRevision: r.state.world.publicGovernance!.authority.proposals[id]!.revision,
      });
    time(60000);
    ok(d, 'governance.close', {
      id,
      expectedRevision: r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    });
    return ok(d, 'governance.execute', {
      id,
      expectedRevision: r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    });
  };
  const replay = () => {
    const expected = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    try {
      expect(reopened.state).toEqual(expected);
      expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    } finally {
      reopened.close();
    }
  };
  const sum = () =>
    Object.values(r.state.world.agents).reduce((n, a) => n + a.balance, 0) +
    Object.values(r.state.world.enterprises).reduce((n, e) => n + e.balance, 0) +
    (r.state.world.treasury ?? 0) +
    commonAccountsBalance(r.state.world.commonAccounts) +
    (r.state.world.bank?.balance ?? 0) +
    Object.values(r.state.world.publicBudget?.serviceBalances ?? {}).reduce(
      (n, balance) => n + balance,
      0,
    );
  const dueEvents = () =>
    r.journal.commits
      .flatMap((x) => x.worldEvents ?? [])
      .filter(
        (e) =>
          e.type === 'ResidentPeriodicObligationsCommitted' &&
          e.payload.event.type === 'PeriodicInstallmentRecorded',
      );
  return {
    r,
    root,
    a,
    b,
    c,
    d,
    call,
    ok,
    state,
    rev,
    request,
    time,
    offer,
    operate,
    ready,
    common,
    collective,
    publicExecute,
    replay,
    sum,
    dueEvents,
  };
}
test('independent access upgrade retains an accepted legacy promise and the exact original public scope', () => {
  const t = fixture(true);
  t.ready();
  const before = structuredClone(t.r.state.world);
  expect(before.periodicObligations?.contracts.promise?.status).toBe('active');
  expect(t.r.enablePeriodicAccess().ok).toBe(true);
  expect(t.r.state.world).toEqual({
    ...before,
    periodicAccess: { version: 'independent-periodic-access-v1' },
  });
  t.replay();
});

test('explicit old-state activation creates no balances or contracts, leaves the original manifest bytes and supports an asset-free principal path', () => {
  const t = fixture(false),
    before = structuredClone(t.r.state.world),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.a, 'obligations.list', {}).ok).toBe(false);
  expect(t.r.enablePeriodicObligations().ok).toBe(true);
  expect(t.r.enablePeriodicObligations().ok).toBe(true);
  expect(t.state().contracts).toEqual({});
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(t.r.state.world.enterprises).toEqual(before.enterprises);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.r.state.world.treasury).toBe(before.treasury);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  expect(t.r.state.world.materials?.resourcePrincipals).toBeUndefined();
  t.ready();
  expect(t.state().contracts.promise).toMatchObject({ status: 'active', cursor: 0 });
  t.replay();
});
test.each(['agent', 'enterprise', 'collective', 'treasury'] as const)(
  'actual %s payer uses independent whole authorization and actual once-only own cash, not manager or executor wallets',
  (sector) => {
    const t = fixture();
    let payer: PeriodicAccount = { sector: 'agent', id: t.a };
    if (sector === 'enterprise') {
      t.ok(t.a, 'world.found_enterprise', {
        enterpriseId: 'firm',
        name: '真实企业',
        occupationName: '有限经营',
        initialCapital: 100,
        maxEmployees: 2,
      });
      payer = { sector, id: 'firm' };
    }
    if (sector === 'collective') {
      t.common();
      payer = { sector, id: 'pool' };
    }
    if (sector === 'treasury') payer = { sector, id: 'public-treasury' };
    const c = t.offer({ payer }),
      q = t.request(c),
      before = t.sum(),
      sources = structuredClone(t.r.state.world.agents);
    if (sector === 'collective') {
      expect(t.call(t.a, 'principals.operate', { request: q }).ok).toBe(false);
      t.collective(q);
    } else if (sector === 'treasury') {
      expect(t.call(t.d, 'principals.operate', { request: q }).ok).toBe(false);
      t.publicExecute(q);
    } else t.operate(t.a, c);
    expect(t.state().contracts.promise).toMatchObject({ status: 'offered', cursor: 0 });
    const atAccept = structuredClone(t.r.state.world);
    t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
    expect(t.r.state.world.agents).toEqual(atAccept.agents);
    expect(t.r.state.world.treasury).toBe(atAccept.treasury);
    expect(t.state().contracts.promise!.offeredAuthorization.principal.kind).toBe(
      sector === 'agent' ? 'resident' : sector === 'treasury' ? 'public' : sector,
    );
    t.time(c.firstDueAt - t.r.state.world.clock.now + 120000);
    expect(t.state().contracts.promise).toMatchObject({ status: 'ended', cursor: 3 });
    expect(Object.values(t.state().contracts.promise!.installments).map((i) => i.status)).toEqual([
      'paid',
      'paid',
      'paid',
    ]);
    const due = t.dueEvents();
    expect(due).toHaveLength(3);
    for (const event of due) {
      if (event.type !== 'ResidentPeriodicObligationsCommitted') throw Error('fixture');
      expect(event.payload.actorId).toBe('system');
      expect(event.payload.transactions).toHaveLength(2);
      for (const tx of event.payload.transactions)
        expect(tx.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
    }
    expect(t.sum()).toBeCloseTo(before, 6);
    expect(t.r.state.world.moneySupply).toBeCloseTo(t.sum(), 6);
    if (sector === 'enterprise') {
      expect(t.r.state.world.enterprises.firm!.balance).toBe(25);
      expect(t.r.state.world.enterprises.firm!.cumulativePurchases).toBe(75);
    }
    if (sector === 'collective') {
      expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(25);
      expect(
        Object.values(t.r.state.collectives!.decisions).filter((d) => d.status === 'executed'),
      ).toHaveLength(1);
    }
    expect(t.r.state.world.agents[t.a]!.inventory).toEqual(sources[t.a]!.inventory);
    const count = t.dueEvents().length;
    t.time(60000);
    expect(t.dueEvents()).toHaveLength(count);
    t.replay();
  },
);
test('account shortage records one old claim; termination retains it, exact creditor waiver transfers no money, and no later tick retries it', () => {
  const t = fixture();
  t.common();
  const c = t.offer({ payer: { sector: 'collective', id: 'pool' }, amount: 100, periods: 3 });
  t.collective(t.request(c));
  t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
  t.time(c.firstDueAt - t.r.state.world.clock.now + 60000);
  expect(t.state().contracts.promise!.installments['1']!.status).toBe('paid');
  expect(t.state().contracts.promise!.installments['2']).toMatchObject({
    status: 'unpaid',
    unpaidReason: 'periodic-insufficient-funds',
  });
  t.operate(t.c, { type: 'terminate', id: 'promise', expectedRevision: t.rev() });
  expect(periodicUnpaidMicros(t.state().contracts.promise!)).toBe(100000000);
  expect(periodicAccountObligations(t.state(), { sector: 'collective', id: 'pool' })).toEqual([
    'promise',
  ]);
  const at = t.r.state.world.clock.now,
    balances = structuredClone(t.r.state.world.agents),
    cash = t.sum();
  t.operate(t.c, { type: 'waive', id: 'promise', expectedRevision: t.rev(), period: 2 });
  expect(t.r.state.world.agents).toEqual(balances);
  expect(t.sum()).toBe(cash);
  expect(periodicAccountObligations(t.state(), { sector: 'collective', id: 'pool' })).toEqual([]);
  t.time(180000);
  expect(t.state().contracts.promise!.cursor).toBe(2);
  expect(t.state().contracts.promise!.futureStoppedAt).toBe(at);
  expect(t.dueEvents()).toHaveLength(2);
  t.replay();
});
test('raw caller balance/actor/terms mutations and forged actual account receipt reject without effects; snapshot retains the original finite history', () => {
  const t = fixture();
  const c = t.offer();
  t.operate(t.a, c);
  const exact = t.request({ type: 'accept', id: 'promise', expectedRevision: 1 }),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'principals.operate', { request: exact }).ok).toBe(false);
  expect(
    t.call(t.c, 'principals.operate', {
      request: {
        ...exact,
        operation: {
          ...exact.operation,
          arguments: { ...exact.operation.arguments, maximumTotalMicros: 1 },
        },
      },
    }).ok,
  ).toBe(false);
  expect(t.r.state.world).toEqual(before);
  t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
  t.time(c.firstDueAt - t.r.state.world.clock.now);
  const event = t.dueEvents()[0]!;
  if (
    event.type !== 'ResidentPeriodicObligationsCommitted' ||
    event.payload.event.type !== 'PeriodicInstallmentRecorded'
  )
    throw Error('fixture');
  const all = t.r.journal.commits.flatMap((x) => x.worldEvents ?? []),
    index = all.findIndex((e) => e.id === event.id);
  expect(index).toBeGreaterThanOrEqual(0);
  const preState = all.slice(0, index).reduce(applyWorldEvent, t.r.manifest.initialWorld);
  const malformed = {
    ...t.r.state.world,
    periodicObligations: {
      ...t.state(),
      contracts: { promise: { ...t.state().contracts.promise!, acceptedAt: c.firstDueAt } },
    },
  };
  expect(() => normalizeLegacyWorldProjectionSnapshot(malformed)).toThrow(
    'periodic-acceptance-time-mismatch',
  );
  const receipt = {
    ...event,
    payload: {
      ...event.payload,
      event: {
        ...event.payload.event,
        sourceRead: {
          ...event.payload.event.sourceRead,
          payer: { ...event.payload.event.sourceRead.payer!, balance: 99999 },
        },
      },
    },
  };
  // Same exact revision and valid source shape: the world still rejects a fabricated actual balance.
  expect(() => applyWorldEvent(preState, receipt)).toThrow(
    'periodic-owning-account-source-mismatch',
  );
  t.replay();
});
test('small and multi-boundary time advances use identical financial order; a naked world cannot skip an unsettled due boundary', () => {
  const big = fixture(),
    small = fixture();
  for (const t of [big, small]) {
    t.ready({ id: 'z', amount: 25 });
    t.ready({ id: 'a', amount: 25 });
  }
  const due = big.state().contracts.a!.firstDueAt;
  const w = big.r.state.world;
  expect(() =>
    dispatchWorldCommand({
      projection: w,
      policies: openWorldPolicies(big.r.manifest.seed, w, big.r.manifest.rhythm),
      nextSequence: big.r.state.worldSequence + 1,
      command: createCommandEnvelope({
        id: 'skip-due',
        simulationId: big.r.manifest.simulationId,
        issuedAt: w.clock.now,
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: due - w.clock.now + 120000 },
        source: 'system',
      }),
    }),
  ).toThrow('periodic-unsettled-boundary-must-be-processed');
  big.time(due - big.r.state.world.clock.now + 120000);
  small.time(due - small.r.state.world.clock.now);
  small.time(60000);
  small.time(60000);
  expect(big.state()).toEqual(small.state());
  const order = (t: ReturnType<typeof fixture>) =>
    t
      .dueEvents()
      .map((e) =>
        e.type === 'ResidentPeriodicObligationsCommitted' &&
        e.payload.event.type === 'PeriodicInstallmentRecorded'
          ? [e.occurredAt, e.payload.event.id, e.payload.event.installment.period]
          : null,
      );
  expect(order(big)).toEqual(order(small));
  expect(order(big).map((x) => x?.[1])).toEqual(['a', 'z', 'a', 'z', 'a', 'z']);
  expect(big.r.state.world.agents).toEqual(small.r.state.world.agents);
  expect(big.r.state.world.treasury).toBe(small.r.state.world.treasury);
  big.replay();
  small.replay();
});
test('private primitive templates reveal no actual balances and lower manifest query caps apply to both agreement and period pages', () => {
  const t = fixture(true, 1);
  t.ready({ id: 'one' });
  t.ready({ id: 'two' });
  const prepared = t.ok(t.a, 'obligations.prepare', { command: t.offer({ id: 'next' }) }).data;
  expect(prepared && typeof prepared === 'object' && !Array.isArray(prepared)).toBe(true);
  const q = (prepared as { request: PrincipalOperationRequest }).request;
  assertPrincipalOperationRequest(q);
  expect(JSON.stringify(q)).not.toContain('balance');
  const list = t.ok(t.a, 'obligations.list', {}).data as {
    items: unknown[];
    total: number;
    nextOffset: number;
  };
  expect(list.items).toHaveLength(1);
  expect(list.total).toBe(2);
  expect(list.nextOffset).toBe(1);
  expect(t.call(t.d, 'obligations.read', { id: 'one' }).ok).toBe(false);
  t.time(t.state().contracts.one!.firstDueAt - t.r.state.world.clock.now + 120000);
  const read = t.ok(t.c, 'obligations.read', { id: 'one' }).data as {
    installments: { items: unknown[]; total: number };
  };
  expect(read.installments.items).toHaveLength(1);
  expect(read.installments.total).toBe(3);
  t.replay();
});

test.each(['agent', 'enterprise', 'collective', 'treasury'] as const)(
  'actual %s revenue subject separately accepts, owns receipts and keeps the executor wallet distinct',
  (sector) => {
    const t = fixture();
    let revenue: PeriodicAccount = { sector: 'agent', id: t.c };
    if (sector === 'enterprise') {
      t.ok(t.c, 'world.found_enterprise', {
        enterpriseId: 'firm',
        name: '独立收款企业',
        occupationName: '经营',
        initialCapital: 100,
        maxEmployees: 2,
      });
      revenue = { sector, id: 'firm' };
    }
    if (sector === 'collective') {
      t.common();
      revenue = { sector, id: 'pool' };
    }
    if (sector === 'treasury') revenue = { sector, id: 'public-treasury' };
    const c = t.offer({ revenue, periods: 1 });
    t.operate(t.a, c);
    const q = t.request({ type: 'accept', id: 'promise', expectedRevision: 1 });
    if (sector === 'collective') t.collective(q);
    else if (sector === 'treasury') t.publicExecute(q);
    else t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
    expect(t.state().contracts.promise!.acceptedAuthorization!.principal.kind).toBe(
      sector === 'agent' ? 'resident' : sector === 'treasury' ? 'public' : sector,
    );
    const before = t.sum();
    t.time(c.firstDueAt - t.r.state.world.clock.now);
    expect(t.state().contracts.promise!.installments['1']!.status).toBe('paid');
    expect(t.sum()).toBeCloseTo(before, 6);
    if (sector === 'enterprise') {
      expect(t.r.state.world.enterprises.firm!.balance).toBe(125);
      expect(t.r.state.world.enterprises.firm!.cumulativeSales).toBe(25);
    }
    if (sector === 'collective')
      expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(125);
    const event = t.dueEvents()[0]!;
    if (event.type !== 'ResidentPeriodicObligationsCommitted') throw Error('fixture');
    expect(event.payload.transactions[1]!.entries).toContainEqual({
      account: { sector, accountId: `${sector}:${revenue.id}` },
      amount: 25,
    });
    t.replay();
  },
);
test('common settlement can pay pre-existing installments but cannot offer a new commitment, and nonzero future responsibility blocks closing after cash is exhausted', () => {
  const t = fixture();
  t.common();
  const c = t.offer({ payer: { sector: 'collective', id: 'pool' }, amount: 100, periods: 2 });
  t.collective(t.request(c));
  t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
  const approve = (capability: string, id: string) => {
    t.ok(t.a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: t.r.state.collectives!.charters.club!.version,
      terms: '精确清算步骤',
      action: {
        kind: 'resource',
        capability,
        resourceId: 'pool',
        arguments: {
          controlVersion: t.r.state.world.commonAccounts!.accounts.pool!.controlVersion,
        },
      },
      closesAt: t.r.state.world.clock.now + 10000,
      executeBefore: t.r.state.world.clock.now + 200000,
    });
    for (const actor of [t.a, t.b])
      t.ok(actor, 'collectives.vote', {
        id,
        expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    t.ok(t.a, 'collectives.decide', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    });
    return { id, expectedRevision: t.r.state.collectives!.decisions[id]!.revision };
  };
  t.ok(t.a, 'collectives.execute', approve('funds.beginSettlement', 'begin'));
  expect(t.r.state.world.commonAccounts!.accounts.pool!.status).toBe('settling');
  expect(
    t.call(t.a, 'obligations.prepare', {
      command: t.offer({ id: 'new', payer: { sector: 'collective', id: 'pool' } }),
    }).ok,
  ).toBe(false);
  t.time(c.firstDueAt - t.r.state.world.clock.now);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  expect(t.state().contracts.promise!.installments['1']!.status).toBe('paid');
  const close = approve('funds.close', 'close'),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'collectives.execute', close).ok).toBe(false);
  expect(t.r.state.world).toEqual(before);
  expect(t.r.state.collectives!.decisions.close!.status).toBe('passed');
  t.operate(t.c, { type: 'terminate', id: 'promise', expectedRevision: t.rev() });
  t.ok(t.a, 'collectives.execute', close);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.status).toBe('closed');
  t.replay();
});
test('new management gets current access and can stop future obligations, while original manager approval remains historical and confers no private backdoor', () => {
  const t = fixture();
  t.ok(t.a, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '有限责任交接',
    occupationName: '经营',
    initialCapital: 100,
    maxEmployees: 2,
  });
  const c = t.offer({ payer: { sector: 'enterprise', id: 'firm' } });
  t.operate(t.a, c);
  t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
  t.ok(t.a, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'resident', id: t.b },
    expiresAt: t.r.state.world.clock.now + 200000,
    terms: '交管理，不抹债或转股权',
  });
  t.ok(t.b, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  expect(t.call(t.a, 'obligations.read', { id: 'promise' }).ok).toBe(false);
  t.ok(t.b, 'obligations.read', { id: 'promise' });
  t.time(c.firstDueAt - t.r.state.world.clock.now);
  expect(t.state().contracts.promise!.installments['1']!.status).toBe('paid');
  expect(t.state().contracts.promise!.offeredAuthorization.actorId).toBe(t.a);
  expect(
    t.r.state.world.enterprises.firm!.periodicAccounting!.positions.promise!.authorization.actorId,
  ).toBe(t.a);
  expect(
    t.call(t.a, 'principals.operate', {
      request: t.request({ type: 'terminate', id: 'promise', expectedRevision: t.rev() }),
    }).ok,
  ).toBe(false);
  t.operate(t.b, { type: 'terminate', id: 'promise', expectedRevision: t.rev() });
  const snapshot = structuredClone(t.r.state.world),
    firm = snapshot.enterprises.firm!;
  expect(() =>
    normalizeLegacyWorldProjectionSnapshot({
      ...snapshot,
      enterprises: {
        ...snapshot.enterprises,
        firm: { ...firm, periodicAccounting: { ...firm.periodicAccounting!, positions: {} } },
      },
    }),
  ).toThrow('periodic-enterprise-snapshot-source-mismatch');
  expect(() =>
    normalizeLegacyWorldProjectionSnapshot({
      ...t.r.state.world,
      enterprises: {},
    }),
  ).toThrow('periodic-enterprise-snapshot-source-mismatch');

  t.replay();
});
test('a collective precisely pays an old unpaid period once after independent actual funding, without creating a second approval or suppressing a prior failure', () => {
  const t = fixture();
  t.common();
  const c = t.offer({ payer: { sector: 'collective', id: 'pool' }, amount: 100, periods: 2 });
  t.collective(t.request(c));
  t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
  t.time(c.firstDueAt - t.r.state.world.clock.now + 60000);
  expect(t.state().contracts.promise!.status).toBe('ended');
  expect(t.state().contracts.promise!.installments['2']!.status).toBe('unpaid');
  t.ok(t.d, 'funds.contribute', {
    id: 'pool',
    expectedRevision: t.r.state.world.commonAccounts!.accounts.pool!.revision,
    amount: 100,
    note: '新的真实资金',
  });
  t.time(60000);
  expect(t.state().contracts.promise!.installments['2']!.status).toBe('unpaid');
  const q = t.request({ type: 'settle', id: 'promise', expectedRevision: t.rev(), period: 2 }),
    before = t.sum();
  expect(t.call(t.a, 'principals.operate', { request: q }).ok).toBe(false);
  t.collective(q);
  expect(t.state().contracts.promise!.installments['2']).toMatchObject({
    status: 'paid',
    unpaidReason: 'periodic-insufficient-funds',
  });
  expect(t.sum()).toBeCloseTo(before, 6);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  expect(t.call(t.a, 'principals.operate', { request: q }).ok).toBe(false);
  expect(t.dueEvents()).toHaveLength(2);
  expect(
    Object.values(t.r.state.collectives!.decisions).filter((d) => d.status === 'executed'),
  ).toHaveLength(2);
  t.replay();
});

test('independently approved public reserve protects actual cash at due time and an unpaid finite claim is not fiscal injection', () => {
  const t = fixture();
  const initialTreasury = t.r.state.world.treasury!;
  const id = 'reserve';
  t.ok(t.a, 'governance.propose', {
    id,
    text: '明确保护国库真实准备金',
    action: {
      kind: 'set-budget',
      expectedRevision: t.r.state.world.governance?.revision ?? 0,
      terms: {
        cadenceMs: 86400000,
        minimumTreasuryReserve: initialTreasury - 20,
        allocations: [],
      },
    },
    closesAt: t.r.state.world.clock.now + 60000,
    expectedProcedureRevision: t.r.state.world.publicGovernance!.authority.procedureRevision,
  });
  const rev = () => t.r.state.world.publicGovernance!.authority.proposals[id]!.revision;
  for (const actor of [t.a, t.b, t.c])
    t.ok(actor, 'governance.vote', { id, choice: 'yes', expectedRevision: rev() });
  t.time(60000);
  t.ok(t.d, 'governance.close', { id, expectedRevision: rev() });
  t.ok(t.d, 'governance.execute', { id, expectedRevision: rev() });
  const command = t.offer({ payer: { sector: 'treasury', id: 'public-treasury' }, periods: 1 });
  t.publicExecute(t.request(command), 'whole-protected');
  t.operate(t.c, { type: 'accept', id: 'promise', expectedRevision: 1 });
  const before = structuredClone(t.r.state.world);
  t.time(command.firstDueAt - t.r.state.world.clock.now);
  expect(t.state().contracts.promise!.installments['1']).toMatchObject({
    status: 'unpaid',
    unpaidReason: 'periodic-insufficient-funds',
    amountMicros: 25000000,
  });
  expect(t.r.state.world.treasury).toBe(before.treasury);
  expect(t.r.state.world.agents[t.c]!.balance).toBe(before.agents[t.c]!.balance);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  const event = t.dueEvents()[0]!;
  if (event.type !== 'ResidentPeriodicObligationsCommitted') throw Error('actual periodic due');
  expect(event.payload.transactions).toEqual([]);
  t.replay();
});
