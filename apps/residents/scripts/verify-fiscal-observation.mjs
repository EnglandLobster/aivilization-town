// Explicit low-cash fixture and prompted read-only model acceptance, never a free-society run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  createOpenCodeResidentDriver,
  loadResidentCredentials,
  startResidentServer,
} from '../dist/index.js';

const root = resolve(process.argv[2] ?? '.local/open-residents/fiscal-query-acceptance');
if (existsSync(join(root, 'manifest.json'))) throw new Error('use-a-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const base = createOpenSocietyManifest({ count: 2, continuity: true, publicGovernance: true });
const [a, b] = base.residents.map((r) => r.id);
const originalCash = Object.values(base.initialWorld.agents).reduce((n, r) => n + r.balance, 0);
const manifest = {
  ...base,
  worldPolicies: {
    ...base.worldPolicies,
    safetyNetSubsidy: { minimumBalance: 50, maxSubsidy: 100 },
  },
  initialWorld: {
    ...base.initialWorld,
    treasury: 0,
    governance: {
      revision: 1,
      consumedPetitionIds: [],
      lastChangedAt: 0,
      lastChangedBy: { kind: 'operator', subjectId: 'explicit-fiscal-query-fixture' },
      lastChangeReason: 'Explicit initial test policy, not a resident decision',
      subsidy: {
        policyVersion: 'town-governance-subsidy-v1',
        source: 'explicit-fiscal-query-fixture',
        minimumBalance: 50,
        maxSubsidy: 100,
      },
    },
    moneySupply: base.initialWorld.moneySupply - base.initialWorld.treasury - originalCash + 20,
    agents: Object.fromEntries(
      Object.entries(base.initialWorld.agents).map(([id, agent]) => [
        id,
        { ...agent, balance: 10, locationId: 'market' },
      ]),
    ),
  },
};
const runtime = new OpenSocietyRuntime(root, manifest);
const credentials = loadResidentCredentials(root, [a, b]);
const server = await startResidentServer(runtime, credentials);
const cli = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let ordinal = 0;
const calls = [];
async function call(actor, argv, expected = 0) {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, ...argv, '--request-id', `fiscal-test-${++ordinal}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (v) => {
      out += v;
    });
    child.stderr.on('data', (v) => {
      err += v;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit fiscal observation CLI acceptance' });
  assert.equal(result.code, expected, result.out + result.err);
  const response = JSON.parse(result.out);
  calls.push({ argv, code: result.code, ok: response.ok, error: response.error });
  return response;
}
let failure;
let modelResult;
let query;
const model = process.argv[3] ?? 'opencode-go/deepseek-v4.1-flash';
try {
  await call(a, [
    'market',
    'trade',
    '--commodity-name',
    'Apple',
    '--quantity',
    '1',
    '--side',
    'sell',
  ]);
  assert.equal(
    runtime.advanceTime(
      Math.max(60000, runtime.state.world.activityTimeByAgent[a]?.availableAt ?? 0),
      'settle-fiscal-fixture',
    ).ok,
    true,
  );
  const world = structuredClone(runtime.state.world);
  const sourceEvents = runtime.journal.commits.flatMap((c) => c.worldEvents ?? []);
  const tax = sourceEvents
    .filter((e) => e.type === 'TradeTaxCharged')
    .reduce((n, e) => n + e.payload.amount, 0);
  const paid = sourceEvents
    .filter((e) => e.type === 'SubsidyPaid' && e.payload.fundingSource === 'treasury')
    .reduce((n, e) => n + e.payload.amount, 0);
  assert.ok(tax > 0);
  assert.ok(Math.abs(tax - paid) < 1e-9);
  assert.ok(Math.abs(world.treasury) < 1e-9);
  query = (await call(b, ['city', 'observe', '--view', 'fiscal'])).data;
  assert.equal(query.groups.find((g) => g.category === 'TradeTaxCharged').amount, tax);
  assert.equal(
    query.groups.find((g) => g.category === 'SubsidyPaid' && g.source === 'treasury').amount,
    paid,
  );
  assert.equal(query.scope, 'recorded-tax-and-subsidy-event-types-only');
  assert.equal(JSON.stringify(query).includes(a), false);
  await call(b, ['city', 'observe', '--view', 'fiscal', '--cursor', 'invalid'], 1);
  await call(b, ['city', 'observe', '--view', 'fiscal', '--limit', '1'], 1);
  await call(b, ['city', 'observe', '--view', 'self']);
  assert.deepEqual(runtime.state.world, world);

  const turn = runtime.beginTurn(b, 'prompted-fiscal-query-acceptance');
  const start = runtime.journal.commits.length;
  console.log(JSON.stringify({ stage: 'opencode-query', status: 'running' }));
  const driver = createOpenCodeResidentDriver({
    connection: { endpoint: server.url, token: credentials.residents[b] },
    model,
    directory: join(root, 'opencode', b),
    task: '这是明确提示的查询可用性验收，不是自由社会实验。请通过平台帮助自行找到财政事实查询，核对当前国库余额，以及查询范围内是否有税款流入、补贴支付。只查询，不发布、转账或推进时间。简短说明事实与查询不能支持的结论；不得只凭余额推断历史。',
  });
  modelResult = await driver.run({
    actorId: b,
    turnId: turn.id,
    context: runtime.context(b),
    signal: globalThis.AbortSignal.timeout(300000),
    invoke: (request) => Promise.resolve(runtime.invoke(b, request)),
  });
  runtime.finishTurn(b, modelResult);
  assert.equal(modelResult.status, 'completed');
  assert.ok(
    runtime.journal.commits
      .slice(start)
      .some(
        (c) =>
          c.capability === 'world.observe' &&
          c.result.data?.version === 'resident-fiscal-observation-v1',
      ),
  );
  assert.deepEqual(runtime.state.world, world);
} catch (error) {
  failure = error instanceof Error ? error.message : 'unknown-error';
}
const state = structuredClone(runtime.state);
const bytes = readFileSync(join(root, 'journal.jsonl'));
await server.close();
runtime.close();
const reopened = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(reopened.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
} finally {
  reopened.close();
}
const report = {
  mode: 'explicit-fixture-and-prompted-model-query-not-emergence',
  model,
  passed: !failure,
  calls,
  query,
  modelResult,
  replayEqual: true,
  ...(failure ? { failure } : {}),
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
