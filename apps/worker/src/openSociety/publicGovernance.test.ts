import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = false) {
  const root = mkdtempSync(join(tmpdir(), 'public-governance-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({ count: 3, continuity: true, publicGovernance: enabled });
  const [a, b, c] = m.residents.map((v) => v.id) as [string, string, string];
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: {
      ...m.initialWorld,
      agents: {
        ...m.initialWorld.agents,
        [a]: {
          ...m.initialWorld.agents[a]!,
          job: 'Cleaner',
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      },
    },
  });
  cleanup.push(() => r.close());
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `public-test-${++n}` });
    r.finishTurn(actor, { summary: 'Explicit public procedure test' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const d = call(actor, name, args);
    expect(d.ok, `${name}: ${d.error}`).toBe(true);
    return d.data as Record<string, unknown>;
  };
  const rev = (id = 'p') => r.state.world.publicGovernance!.authority.proposals[id]!.revision;
  const propose = (id = 'p') =>
    ok(a, 'governance.propose', {
      id,
      text: '自主选择的政策，不是官方共识。',
      action: {
        kind: 'set-tax',
        expectedRevision: r.state.world.governance?.revision ?? 0,
        terms: {
          neutralRate: 0.1,
          tradeTaxRate: 0.2,
          incomeTaxBrackets: [{ upToAmount: null, rate: 0.2 }],
        },
      },
      closesAt: r.state.world.clock.now + 60000,
      expectedProcedureRevision: r.state.world.publicGovernance!.authority.procedureRevision,
    });
  const vote = (actor: string, id = 'p', choice = 'yes') =>
    ok(actor, 'governance.vote', { id, expectedRevision: rev(id), choice });
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
  return { r, root, a, b, c, call, ok, rev, propose, vote, replay };
}
test('independent exact ballots change authoritative taxes, actual pay and conserved treasury; old revision cannot execute twice', () => {
  const t = fixture(true);
  t.propose();
  expect(t.r.context(t.b).publicGovernance?.pending).toMatchObject([{ id: 'p', status: 'voting' }]);
  const read = t.ok(t.b, 'governance.read', { id: 'p' });
  expect(read.text).toContain('不是官方共识');
  expect(t.ok(t.b, 'memory.search', { sourceId: 'p' }).total).toBe(1);
  t.vote(t.a);
  expect(t.call(t.b, 'governance.execute', { id: 'p', expectedRevision: t.rev() }).ok).toBe(false);
  t.vote(t.b);
  expect(t.r.advanceTime(60000, 'close-time').ok).toBe(true);
  t.ok(t.c, 'governance.close', { id: 'p', expectedRevision: t.rev() });
  const revision = t.rev();
  t.ok(t.b, 'governance.execute', { id: 'p', expectedRevision: revision });
  expect(t.call(t.b, 'governance.execute', { id: 'p', expectedRevision: revision }).ok).toBe(false);
  expect(t.ok(t.a, 'governance.status', {})).toMatchObject({
    currentPolicyRevision: 1,
    enacted: { tax: { tradeTaxRate: 0.2 } },
  });
  const before = t.r.state.world;
  t.ok(t.a, 'world.work', { occupationName: 'Cleaner', laborSeconds: 60 });
  const es = t.r.journal.commits.flatMap((c) => c.worldEvents ?? []);
  const wage = es.filter((e) => e.type === 'WagePaid').at(-1)!;
  const tax = es.filter((e) => e.type === 'IncomeTaxCharged').at(-1)!;
  expect(wage).toBeDefined();
  expect(tax).toBeDefined();
  if (wage.type !== 'WagePaid' || tax.type !== 'IncomeTaxCharged') throw Error('fixture');
  expect(tax.payload.amount).toBeCloseTo(wage.payload.amount * 0.2);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.r.state.world.agents[t.a]!.balance - before.agents[t.a]!.balance).toBeCloseTo(
    before.treasury! - t.r.state.world.treasury!,
  );
  t.replay();
});
test('public previews stay bounded and omit original political text; nested authority forgery and grant expansion are refused', () => {
  const t = fixture(true);
  for (let i = 0; i < 5; i++) t.propose(`p${i}`);
  const context = t.r.context(t.b).publicGovernance!;
  expect(context.pending).toHaveLength(3);
  expect(context.total).toBe(5);
  expect(JSON.stringify(context)).not.toContain('不是官方共识');
  expect(
    t.call(t.a, 'governance.propose', {
      id: 'forged',
      text: '伪造授权',
      action: {
        kind: 'set-tax',
        expectedRevision: 0,
        terms: {
          neutralRate: 0.1,
          tradeTaxRate: 0.2,
          incomeTaxBrackets: [{ upToAmount: null, rate: 0.2 }],
          authority: { kind: 'operator' },
        },
      },
      closesAt: 60000,
      expectedProcedureRevision: 1,
    }).error,
  ).toBe('public-action-outside-grant-or-invalid');
  expect(t.r.state.world.publicGovernance!.authority.proposals.forged).toBeUndefined();
  t.ok(t.b, 'governance.object', {
    id: 'objection',
    proposalId: 'p0',
    text: '我反对，但这不代表世界已经撤销。',
  });
  expect(t.r.state.world.publicGovernance!.authority.proposals.p0!.status).toBe('voting');
  expect(t.ok(t.c, 'governance.objections', { id: 'p0' })).toMatchObject({
    total: 1,
    items: [{ actorId: t.b, text: '我反对，但这不代表世界已经撤销。' }],
  });
  t.replay();
});
