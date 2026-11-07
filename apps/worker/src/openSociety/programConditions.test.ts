import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { PROGRAM_CONDITIONS_POLICY, type ProgramCondition } from '@aivilization/collaboration';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function setup(enabled = true, maxWork = PROGRAM_CONDITIONS_POLICY.maxWork as number) {
  const root = mkdtempSync(join(tmpdir(), 'resident-conditions-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({ count: 3, programConditions: enabled }),
    r = new OpenSocietyRuntime(root, {
      ...manifest,
      ...(enabled ? { programConditionsPolicy: { ...PROGRAM_CONDITIONS_POLICY, maxWork } } : {}),
    });
  clean.push(() => r.close());
  const [a, b, c] = r.manifest.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `cond-${++n}` });
    r.finishTurn(actor, { summary: 'Conditional procedure acceptance' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const result = call(actor, name, args);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result;
  };
  const pay = {
    principalId: a,
    capability: 'payments.transfer',
    arguments: { targetId: c, amount: 3, note: '仅按指定依据付款' },
  };
  const publish = (
    conditions: readonly ProgramCondition[],
    runner = a,
    steps: readonly unknown[] = [pay],
  ) => {
    ok(a, 'programs.publish', {
      id: 'p',
      title: '自己的条件',
      purpose: '由居民决定依据',
      runners: [runner],
      definition: { steps, conditions },
    });
    ok(a, 'mandates.grant', {
      id: 'm',
      programId: 'p',
      programRevision: 1,
      runnerId: runner,
      maxRuns: 3,
      expiresAt: r.state.world.clock.now + 500000,
    });
  };
  const register = (readers: string[] | undefined = undefined) =>
    ok(b, 'registers.create', {
      id: 'claims',
      title: '我的署名判断',
      visibility: readers ? 'private' : 'public',
      readers: readers ?? [],
      editors: [],
      fields: { approved: 'boolean' },
    });
  const record = (approved: boolean) =>
    ok(b, 'records.put', {
      registerId: 'claims',
      key: 'result',
      expectedRevision: r.state.sharedRecords!.records['claims/result']?.revision ?? 0,
      values: { approved },
    });
  const statement = (revision: number | 'latest' = 'latest'): ProgramCondition => ({
    source: {
      kind: 'statement',
      registerId: 'claims',
      key: 'result',
      revision,
      field: 'approved',
      signerId: b,
    },
    op: 'eq',
    value: true,
  });
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, a, b, c, call, ok, pay, publish, register, record, statement, replay };
}
test('a false signed claim does not spend or consume authority; a later actual signature permits the exact procedure', () => {
  const t = setup();
  t.register();
  t.record(false);
  t.publish([t.statement()]);
  const before = t.r.state.world.agents[t.a]!.balance;
  expect(t.ok(t.a, 'programs.check', { id: 'p', expectedRevision: 1 })).toMatchObject({
    data: { conditionsMatched: false },
  });
  const failed = t.call(t.a, 'programs.run', { id: 'p', expectedRevision: 1 });
  expect(failed).toMatchObject({
    ok: false,
    error: 'program-conditions-not-met',
    data: {
      conditionEvidence: [
        { sourceClass: 'signed-claim', matched: false, sourceVersions: { recordRevision: 1 } },
      ],
    },
  });
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before);
  expect(t.r.state.coordination!.mandates.m!.usedRuns).toBe(0);
  t.record(true);
  t.ok(t.a, 'programs.run', { id: 'p', expectedRevision: 1 });
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before - 3);
  expect(t.r.state.coordination!.mandates.m!.usedRuns).toBe(1);
  const last = Object.values(t.r.state.coordination!.runs).at(-1)!;
  expect(last.conditionEvidence).toMatchObject([
    { sourceClass: 'signed-claim', matched: true, sourceVersions: { recordRevision: 2 } },
  ]);
  expect(last.conditionEvidence![0]).not.toHaveProperty('value');
  t.replay();
});
test('private sources require permission for every program audience; missing access cannot leak partial condition results', () => {
  const t = setup();
  t.register([t.a]);
  t.record(true);
  t.publish([{ source: { kind: 'clock' }, op: 'gte', value: 0 }, t.statement()], t.c);
  const result = t.call(t.c, 'programs.run', { id: 'p', expectedRevision: 1 });
  expect(result.error).toBe('condition-source-unavailable');
  expect(result.data).not.toHaveProperty('conditionEvidence');
  expect(t.r.state.coordination!.mandates.m!.usedRuns).toBe(0);
  t.ok(t.b, 'registers.configure', {
    id: 'claims',
    expectedRevision: 1,
    visibility: 'private',
    readers: [t.a, t.c],
    editors: [],
  });
  t.ok(t.c, 'programs.run', { id: 'p', expectedRevision: 1 });
  t.ok(t.b, 'registers.configure', {
    id: 'claims',
    expectedRevision: 2,
    visibility: 'private',
    readers: [t.a],
    editors: [],
  });
  expect(t.call(t.c, 'programs.check', { id: 'p', expectedRevision: 1 }).error).toBe(
    'condition-source-unavailable',
  );
  t.replay();
});
test('check is read-only and source changes are rechecked at run, including exact revision and signature identity', () => {
  const t = setup();
  t.register();
  t.record(true);
  t.publish([t.statement(1)]);
  const before = structuredClone(t.r.state.coordination);
  expect(t.ok(t.a, 'programs.check', { id: 'p', expectedRevision: 1 })).toMatchObject({
    data: { conditionsMatched: true },
  });
  expect(t.r.state.coordination).toEqual(before);
  t.record(true);
  expect(t.call(t.a, 'programs.run', { id: 'p', expectedRevision: 1 }).error).toBe(
    'condition-source-unavailable',
  );
  expect(t.r.state.coordination!.mandates.m!.usedRuns).toBe(0);
  t.ok(t.a, 'programs.revise', {
    id: 'p',
    expectedRevision: 1,
    title: '另一个声明者',
    purpose: '签署者不等于名义内容',
    runners: [t.a],
    definition: {
      steps: [t.pay],
      conditions: [{ ...t.statement(), source: { ...t.statement().source, signerId: t.a } }],
    },
  });
  t.ok(t.a, 'mandates.grant', {
    id: 'm2',
    programId: 'p',
    programRevision: 2,
    runnerId: t.a,
    maxRuns: 1,
    expiresAt: t.r.state.world.clock.now + 10000,
  });
  expect(t.call(t.a, 'programs.run', { id: 'p', expectedRevision: 2 }).error).toBe(
    'condition-source-unavailable',
  );
  t.replay();
});
test('condition success does not bypass a later domain rejection or partially execute earlier payment steps', () => {
  const t = setup();
  t.register();
  t.record(true);
  t.publish([t.statement()], t.a, [
    t.pay,
    {
      principalId: t.a,
      capability: 'records.put',
      arguments: { registerId: 'missing', key: 'x', expectedRevision: 0, values: { note: 'x' } },
    },
  ]);
  const before = structuredClone(t.r.state.world);
  const result = t.call(t.a, 'programs.run', { id: 'p', expectedRevision: 1 });
  expect(result.ok).toBe(false);
  expect(result.data).toMatchObject({ conditionEvidence: [{ matched: true }], status: 'failed' });
  expect(t.r.state.world).toEqual(before);
  expect(t.r.state.coordination!.mandates.m!.usedRuns).toBe(0);
  t.replay();
});
test('personal fact conditions do not proxy private balances to another runner, even with a payment mandate', () => {
  const t = setup();
  t.publish(
    [{ source: { kind: 'personal-fact', actorId: t.a, field: 'balance' }, op: 'gt', value: 0 }],
    t.b,
  );
  expect(t.call(t.b, 'programs.check', { id: 'p', expectedRevision: 1 }).error).toBe(
    'condition-source-unavailable',
  );
  expect(t.call(t.b, 'programs.run', { id: 'p', expectedRevision: 1 }).error).toBe(
    'condition-source-unavailable',
  );
  expect(t.r.state.coordination!.mandates.m!.usedRuns).toBe(0);
  t.replay();
});
test('world, common account and procedural decision facts keep exact source versions without granting extra power', () => {
  const t = setup(),
    now = t.r.state.world.clock.now;
  t.ok(t.a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '本人共同事务',
      terms: '自定程序',
      members: [t.a],
      voters: [t.a],
      threshold: 1,
      quorum: 1,
      timing: 'early',
      revote: true,
    },
    expiresAt: now + 10000,
  });
  t.ok(t.a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '账户' });
  t.ok(t.a, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 5, note: '本人出资' });
  t.ok(t.a, 'collectives.propose', {
    id: 'agreement',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '一段原话',
    action: { kind: 'statement' },
    closesAt: now + 1000,
    executeBefore: now + 2000,
  });
  t.ok(t.a, 'collectives.vote', { id: 'agreement', expectedRevision: 1, vote: 'yes' });
  t.ok(t.a, 'collectives.decide', { id: 'agreement', expectedRevision: 2 });
  t.publish([
    {
      source: { kind: 'personal-fact', actorId: t.a, field: 'availableAt' },
      op: 'lte',
      value: now,
    },
    {
      source: { kind: 'common-balance', accountId: 'pool', controlVersion: 1 },
      op: 'eq',
      value: 5,
    },
    {
      source: { kind: 'decision', decisionId: 'agreement', charterVersion: 1 },
      op: 'eq',
      value: 'passed',
    },
  ]);
  expect(t.ok(t.a, 'programs.run', { id: 'p', expectedRevision: 1 })).toMatchObject({
    data: {
      conditionEvidence: [
        { sourceClass: 'world-fact' },
        { sourceClass: 'world-fact', sourceVersions: { accountRevision: 2 } },
        { sourceClass: 'procedural-fact', sourceVersions: { decisionRevision: 3 } },
      ],
    },
  });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(5);
  expect(t.r.state.collectives!.decisions.agreement!.status).toBe('passed');
  t.replay();
});
test('legacy manifests require explicit enabling and old unconditioned programs retain their exact definition', () => {
  const t = setup(false),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(
    t.call(t.a, 'programs.publish', {
      id: 'bad',
      title: '条件',
      purpose: 'x',
      runners: [t.a],
      definition: { steps: [t.pay], conditions: [] },
    }).error,
  ).toBe('invalid-program-definition');
  t.ok(t.a, 'programs.publish', {
    id: 'old',
    title: '旧流程',
    purpose: 'x',
    runners: [t.a],
    definition: { steps: [t.pay] },
  });
  const old = structuredClone(t.r.state.coordination!.programs.old);
  const result = t.r.enableProgramConditions();
  expect(result.ok).toBe(true);
  expect(t.r.enableProgramConditions()).toEqual(result);
  t.publish([{ source: { kind: 'clock' }, op: 'gte', value: 0 }]);
  t.ok(t.a, 'programs.run', { id: 'p', expectedRevision: 1 });
  expect(t.r.state.coordination!.programs.old).toEqual(old);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.replay();
});
test('delegated record writing is not misrepresented as the principal personally signing a judgment', () => {
  const t = setup();
  t.register();
  t.record(false);
  t.ok(t.b, 'programs.publish', {
    id: 'writer',
    title: '授权代写',
    purpose: '固定内容记录',
    runners: [t.a],
    definition: {
      steps: [
        {
          principalId: t.b,
          capability: 'records.put',
          arguments: {
            registerId: 'claims',
            key: 'result',
            expectedRevision: 1,
            values: { approved: true },
          },
        },
      ],
    },
  });
  t.ok(t.b, 'mandates.grant', {
    id: 'writer-m',
    programId: 'writer',
    programRevision: 1,
    runnerId: t.a,
    maxRuns: 1,
    expiresAt: t.r.state.world.clock.now + 10000,
  });
  t.ok(t.a, 'programs.run', { id: 'writer', expectedRevision: 1 });
  expect(t.r.state.sharedRecords!.records['claims/result']).toMatchObject({
    editedBy: t.a,
    authorityId: t.b,
    values: { approved: true },
  });
  t.publish([t.statement()]);
  expect(t.call(t.a, 'programs.run', { id: 'p', expectedRevision: 1 }).error).toBe(
    'condition-source-unavailable',
  );
  t.record(true);
  t.ok(t.a, 'programs.run', { id: 'p', expectedRevision: 1 });
  t.replay();
});
test('conditional scheduled runs evaluate at each exact simulation boundary and replay equally across large or split advances', () => {
  const one = setup(),
    many = setup();
  for (const t of [one, many]) {
    const start = t.r.state.world.clock.now + 60000;
    t.publish([{ source: { kind: 'clock' }, op: 'gte', value: start }]);
    t.ok(t.a, 'programs.schedule', {
      id: 'timer',
      programId: 'p',
      programRevision: 1,
      startAt: start,
      intervalMs: 60000,
      runs: 2,
    });
  }
  expect(one.r.advanceTime(120000, 'whole').ok).toBe(true);
  expect(many.r.advanceTime(60000, 'first').ok).toBe(true);
  expect(many.r.advanceTime(60000, 'second').ok).toBe(true);
  expect(one.r.state.coordination).toEqual(many.r.state.coordination);
  expect(one.r.state.coordination!.mandates.m!.usedRuns).toBe(2);
  expect(
    Object.values(one.r.state.coordination!.runs).map(
      (r) => r.conditionEvidence?.[0]?.sourceVersions.simulationTime,
    ),
  ).toEqual([60000, 120000]);
  one.replay();
  many.replay();
});
