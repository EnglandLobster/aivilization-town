import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { createEconomicCompositionPayload } from '../marketMetrics';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = false) {
  const root = mkdtempSync(join(tmpdir(), 'capital-contract-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({ count: 4, continuity: true, capitalAgreements: enabled });
  const r = new OpenSocietyRuntime(root, m);
  cleanup.push(() => r.close());
  const [a, b, c, d] = m.residents.map((x) => x.id) as [string, string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `capital-test-${++n}` });
    r.finishTurn(actor, { summary: 'Directed independent capital consent test' });
    const c = createEconomicCompositionPayload({
      projection: r.state.world,
      recordedAt: r.state.world.clock.now,
    }).composition;
    expect(
      c.agents + c.enterprises + c.treasury + c.bank + (c.collectives ?? 0) + (c.publicServices ?? 0),
    ).toBeCloseTo(r.state.world.moneySupply, 7);
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}: ${d.error}`).toBe(true);
    return d;
  };
  const decision = (capability: string, args: Record<string, unknown>, resourceId = 'firm') => {
    const id = `decision-${++n}`;
    ok(b, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: 1,
      terms: 'Exact chosen capital operation',
      action: { kind: 'resource', capability, resourceId, arguments: args },
      closesAt: r.state.world.clock.now + 10000,
      executeBefore: r.state.world.clock.now + 20000,
    });
    for (const actor of [b, c])
      ok(actor, 'collectives.vote', {
        id,
        expectedRevision: r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    ok(b, 'collectives.decide', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
    return id;
  };
  const execute = (id: string) =>
    call(b, 'collectives.execute', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
  const setup = () => {
    ok(a, 'world.found_enterprise', {
      enterpriseId: 'firm',
      name: 'Their capital and obligations',
      occupationName: 'Their role',
      initialCapital: 100,
      maxEmployees: 3,
    });
    ok(b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: 'Their investment procedure',
        terms: 'Two independent votes',
        members: [b, c],
        voters: [b, c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: 100000,
    });
    ok(c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
    ok(b, 'funds.open', { id: 'pool', collectiveId: 'club', title: 'Actual shared account' });
    ok(b, 'funds.contribute', {
      id: 'pool',
      expectedRevision: r.state.world.commonAccounts!.accounts.pool!.revision,
      amount: 50,
      note: 'Chosen contribution',
    });
    ok(a, 'capital.initialize', { enterpriseId: 'firm' });
  };
  const rev = (id = 'round') => r.state.world.enterprises.firm!.capital!.agreements[id]!.revision;
  const proposal = (id = 'round', amount = 30) =>
    ok(a, 'capital.propose', {
      enterpriseId: 'firm',
      id,
      expectedEquityVersion: 1,
      expiresAt: 50000,
      terms: 'Mixed capital, not manager ownership',
      allocation: {
        positions: [
          { account: { sector: 'agent', id: a }, weight: 60 },
          { account: { sector: 'collective', id: 'pool' }, weight: 40 },
        ],
        contributions: [{ account: { sector: 'collective', id: 'pool' }, amount }],
        disbursements: [{ account: { sector: 'enterprise' }, amount }],
      },
    });
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    return next;
  };
  return { r, root, a, b, c, d, call, ok, decision, execute, setup, rev, proposal, replay };
}
test('explicit capability upgrade preserves legacy manifest and does not automatically convert firms or funding into equity', () => {
  const t = fixture(),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.call(t.a, 'capital.list').error).toBe('capital-agreements-not-enabled');
  const enabled = t.r.enableCapitalAgreements();
  expect(enabled.ok).toBe(true);
  expect(t.r.enableCapitalAgreements()).toEqual(enabled);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.ok(t.a, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: 'Origin',
    occupationName: 'Role',
    initialCapital: 100,
    maxEmployees: 3,
  });
  expect(t.r.state.world.enterprises.firm!.capital).toBeUndefined();
  t.ok(t.a, 'capital.initialize', { enterpriseId: 'firm' });
  const before = t.r.state.world.enterprises.firm!;
  t.ok(t.b, 'world.fund_enterprise', { enterpriseId: 'firm', amount: 10 });
  expect(t.r.state.world.enterprises.firm!.capital).toEqual(before.capital);
  expect(t.r.context(t.a).capabilities).toContain('capital');
  t.replay();
});
test('ordinary group membership cannot pledge shared funds, exact independent decisions can, and actual controller/capital/recipient stay separate', () => {
  const t = fixture(true);
  t.setup();
  t.proposal();
  expect(t.call(t.d, 'capital.read', { enterpriseId: 'firm', id: 'round' }).ok).toBe(false);
  expect(t.ok(t.b, 'capital.rights', { enterpriseId: 'firm' }).data).not.toHaveProperty(
    'companyBalance',
  );
  const accept = {
    id: 'round',
    expectedRevision: t.rev(),
    accountSector: 'collective',
    accountId: 'pool',
  };
  expect(t.call(t.b, 'capital.accept', { enterpriseId: 'firm', ...accept }).ok).toBe(false);
  const decision = t.decision('capital.accept', accept);
  expect(t.execute(decision).ok).toBe(true);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(20);
  expect(t.r.state.world.enterprises.firm!.balance).toBe(100);
  t.ok(t.a, 'capital.accept', {
    enterpriseId: 'firm',
    id: 'round',
    expectedRevision: t.rev(),
    accountSector: 'agent',
    accountId: t.a,
  });
  expect(
    t.call(t.a, 'capital.execute', { enterpriseId: 'firm', id: 'round', expectedRevision: t.rev() })
      .ok,
  ).toBe(false);
  t.ok(t.a, 'capital.authorize', {
    enterpriseId: 'firm',
    id: 'round',
    expectedRevision: t.rev(),
    expectedControlVersion: 1,
  });
  t.ok(t.a, 'capital.execute', { enterpriseId: 'firm', id: 'round', expectedRevision: t.rev() });
  expect(t.r.state.world.enterprises.firm!).toMatchObject({
    balance: 130,
    ownerAgentId: t.a,
    capital: { equityVersion: 2 },
  });
  expect(t.r.state.world.enterprises.firm!.capital!.positions).toContainEqual({
    account: { sector: 'collective', id: 'pool' },
    weight: 40,
  });
  const begin = t.decision('funds.beginSettlement', { controlVersion: 1 }, 'pool');
  expect(t.execute(begin).ok).toBe(true);
  const close = t.decision(
    'funds.close',
    {
      controlVersion: t.r.state.world.commonAccounts!.accounts.pool!.controlVersion,
    },
    'pool',
  );
  expect(t.execute(close).ok).toBe(false);
  expect(t.r.state.collectives!.decisions[close]!.status).toBe('passed');
  expect(t.call(t.a, 'world.close_enterprise', { enterpriseId: 'firm' }).ok).toBe(false);
  const ownerBefore = t.r.state.world.agents[t.a]!.balance;
  const delegateBefore = t.r.state.world.agents[t.b]!.balance;
  const poolBefore = t.r.state.world.commonAccounts!.accounts.pool!.balance;
  expect(
    t.call(t.b, 'capital.close', {
      enterpriseId: 'firm',
      expectedEquityVersion: 2,
      expectedControlVersion: 1,
    }).ok,
  ).toBe(false);
  t.ok(t.a, 'capital.close', {
    enterpriseId: 'firm',
    expectedEquityVersion: 2,
    expectedControlVersion: 1,
  });
  expect(t.r.state.world.enterprises.firm!).toMatchObject({ status: 'closed', balance: 0 });
  expect(t.r.state.world.agents[t.a]!.balance).toBeCloseTo(ownerBefore + 78);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBeCloseTo(poolBefore + 52);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(delegateBefore);
  expect(
    t.call(t.a, 'capital.close', {
      enterpriseId: 'firm',
      expectedEquityVersion: 2,
      expectedControlVersion: 1,
    }).ok,
  ).toBe(false);
  t.replay();
});
test('insufficient shared funding leaves the approved collective decision reusable, expiry refunds precisely, and malformed allocations are rejected', () => {
  const t = fixture(true);
  t.setup();
  t.proposal('round', 70);
  const decision = t.decision('capital.accept', {
    id: 'round',
    expectedRevision: t.rev(),
    accountSector: 'collective',
    accountId: 'pool',
  });
  const before = t.r.state.world;
  expect(t.execute(decision).ok).toBe(false);
  expect(t.r.state.collectives!.decisions[decision]!.status).toBe('passed');
  expect(t.r.state.world.commonAccounts).toEqual(before.commonAccounts);
  t.ok(t.c, 'funds.contribute', {
    id: 'pool',
    expectedRevision: t.r.state.world.commonAccounts!.accounts.pool!.revision,
    amount: 20,
    note: 'Actual additional funds',
  });
  expect(t.execute(decision).ok).toBe(true);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  expect(t.r.advanceTime(60000, 'expire').ok).toBe(true);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(70);
  expect(t.r.state.world.enterprises.firm!.capital!.agreements.round).toMatchObject({
    status: 'cancelled',
    endedAt: 50000,
  });
  expect(
    t.call(t.a, 'capital.propose', {
      enterpriseId: 'firm',
      id: 'bad',
      terms: 'bad',
      expiresAt: 100000,
      expectedEquityVersion: 1,
      allocation: {
        positions: [{ account: { sector: 'agent', id: t.a }, weight: 1 }],
        contributions: [],
        disbursements: [],
        authority: 'self',
      },
    }).ok,
  ).toBe(false);
  t.replay();
});

test('capital transfer and independent management handover remove stale founder resource access while preserving exact historic agreements', () => {
  const t = fixture(true);
  t.setup();
  t.ok(t.a, 'capital.propose', {
    enterpriseId: 'firm',
    id: 'round',
    expectedEquityVersion: 1,
    expiresAt: 50000,
    terms: 'All rights to the independently consenting common account',
    allocation: {
      positions: [{ account: { sector: 'collective', id: 'pool' }, weight: 1 }],
      contributions: [],
      disbursements: [],
    },
  });
  const choice = t.decision('capital.accept', {
    id: 'round',
    expectedRevision: t.rev(),
    accountSector: 'collective',
    accountId: 'pool',
  });
  expect(t.execute(choice).ok).toBe(true);
  t.ok(t.a, 'capital.accept', {
    enterpriseId: 'firm',
    id: 'round',
    expectedRevision: t.rev(),
    accountSector: 'agent',
    accountId: t.a,
  });
  t.ok(t.a, 'capital.execute', { enterpriseId: 'firm', id: 'round', expectedRevision: t.rev() });
  const capital = structuredClone(t.r.state.world.enterprises.firm!.capital);
  const read = t.ok(t.b, 'resources.read', { kind: 'enterprise', id: 'firm' }).data;
  expect(read).not.toHaveProperty('capitalShares');
  expect(read).toMatchObject({
    capitalPositions: [{ account: { sector: 'collective', id: 'pool' }, weight: 1 }],
    equityVersion: 2,
  });
  t.ok(t.a, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'resident', id: t.d },
    expiresAt: 50000,
    terms: 'Management only, no rewriting rights or consent',
  });
  t.ok(t.d, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  expect(t.call(t.a, 'resources.read', { kind: 'enterprise', id: 'firm' }).ok).toBe(false);
  t.ok(t.b, 'resources.read', { kind: 'enterprise', id: 'firm' });
  t.ok(t.d, 'resources.read', { kind: 'enterprise', id: 'firm' });
  // Original parties retain their exact prior agreement, not the new manager's cash.
  const historical = t.ok(t.a, 'capital.read', { enterpriseId: 'firm', id: 'round' });
  expect(historical.ok).toBe(true);
  expect(t.ok(t.a, 'capital.rights', { enterpriseId: 'firm' }).data).not.toHaveProperty(
    'companyBalance',
  );
  expect(t.r.state.world.enterprises.firm!.capital).toEqual(capital);
  const original = t.r.state.world.agents[t.a]!.balance;
  const manager = t.r.state.world.agents[t.d]!.balance;
  t.ok(t.d, 'capital.close', {
    enterpriseId: 'firm',
    expectedEquityVersion: 2,
    expectedControlVersion: 3,
  });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(150);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(original);
  expect(t.r.state.world.agents[t.d]!.balance).toBe(manager);
  t.replay();
});

test('a former collective manager can withdraw its own pending proposal only through a new exact collective decision', () => {
  const t = fixture(true);
  t.setup();
  t.ok(t.a, 'resources.offer', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 1,
    expectedControlVersion: 1,
    target: { kind: 'collective', id: 'club' },
    expiresAt: 50000,
    terms: 'Only management',
  });
  expect(
    t.execute(
      t.decision('resources.accept', {
        kind: 'enterprise',
        expectedRevision: 2,
        expectedControlVersion: 2,
      }),
    ).ok,
  ).toBe(true);
  expect(
    t.execute(
      t.decision('capital.propose', {
        id: 'round',
        expectedEquityVersion: 1,
        expiresAt: 50000,
        terms: 'Pending group proposal',
        allocation: {
          positions: [{ account: { sector: 'agent', id: t.a }, weight: 1 }],
          contributions: [],
          disbursements: [],
        },
      }),
    ).ok,
  ).toBe(true);
  expect(
    t.execute(
      t.decision('resources.offer', {
        kind: 'enterprise',
        expectedRevision: 3,
        expectedControlVersion: 3,
        target: { kind: 'resident', id: t.d },
        expiresAt: 50000,
        terms: 'New manager preserves outstanding proposals',
      }),
    ).ok,
  ).toBe(true);
  t.ok(t.d, 'resources.accept', {
    kind: 'enterprise',
    id: 'firm',
    expectedRevision: 4,
    expectedControlVersion: 4,
  });
  t.ok(t.c, 'capital.read', { enterpriseId: 'firm', id: 'round' });
  expect(
    t.call(t.b, 'capital.cancel', { enterpriseId: 'firm', id: 'round', expectedRevision: t.rev() })
      .ok,
  ).toBe(false);
  expect(
    t.execute(t.decision('capital.cancel', { id: 'round', expectedRevision: t.rev() })).ok,
  ).toBe(true);
  expect(t.r.state.world.enterprises.firm!.capital!.agreements.round!.status).toBe('cancelled');
  t.replay();
});
