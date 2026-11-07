// Explicit transport acceptance, separate from free Agent evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-public-cli-'));
const manifest = createOpenSocietyManifest({ count: 3, continuity: true });
const first = manifest.residents[0].id;
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld: {
    ...manifest.initialWorld,
    agents: {
      ...manifest.initialWorld.agents,
      [first]: { ...manifest.initialWorld.agents[first], job: 'Cleaner' },
    },
  },
});
const [a, b, c] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let ordinal = 0,
  refused = 0,
  serverClosed = false;
async function call(actor, argv, expected = 0) {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `public-cli-${++ordinal}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit public-governance CLI acceptance' });
  assert.equal(result.code, expected, `${argv.join(' ')}\n${result.out}\n${result.err}`);
  if (expected) refused++;
  return JSON.parse(result.out);
}
const rev = (id) => runtime.state.world.publicGovernance.authority.proposals[id].revision;
let timeId = 0;
async function propose(id, action) {
  await call(a, [
    'governance',
    'propose',
    '--id',
    id,
    '--text',
    '测试用原文，不是自由实验剧情',
    '--action',
    JSON.stringify(action),
    '--closes-at',
    String(runtime.state.world.clock.now + 60000),
    '--expected-procedure-revision',
    String(runtime.state.world.publicGovernance.authority.procedureRevision),
  ]);
}
async function decide(id, voters = [a, b]) {
  for (const actor of voters)
    await call(actor, [
      'governance',
      'vote',
      '--id',
      id,
      '--expected-revision',
      String(rev(id)),
      '--choice',
      'yes',
    ]);
  assert.equal(runtime.advanceTime(60000, `ballot-${++timeId}`).ok, true);
  await call(c, ['governance', 'close', '--id', id, '--expected-revision', String(rev(id))]);
}
async function execute(id, actor = a, expected = 0) {
  return call(
    actor,
    ['governance', 'execute', '--id', id, '--expected-revision', String(rev(id))],
    expected,
  );
}
try {
  await call(a, ['governance', 'status'], 1);
  assert.equal(runtime.enablePublicGovernance().ok, true);
  const initial = (await call(a, ['governance', 'status'])).data;
  const supply = runtime.state.world.moneySupply;
  const tax = (rate) => ({
    kind: 'set-tax',
    expectedRevision: runtime.state.world.governance?.revision ?? 0,
    terms: {
      neutralRate: 0.1,
      tradeTaxRate: rate,
      incomeTaxBrackets: [{ upToAmount: null, rate }],
    },
  });
  await propose('tax', tax(0.2));
  assert.ok(runtime.context(b).publicGovernance.pending.some((p) => p.id === 'tax'));
  await call(b, ['governance', 'read', '--id', 'tax']);
  await execute('tax', a, 1);
  await decide('tax');
  await execute('tax', b);
  await execute('tax', b, 1);
  assert.equal((await call(a, ['governance', 'status'])).data.enacted.tax.tradeTaxRate, 0.2);
  await call(a, ['business', 'work', '--occupation-name', 'Cleaner', '--labor-seconds', '60']);
  const events = () => runtime.journal.commits.flatMap((c) => c.worldEvents ?? []);
  const wage = events()
      .filter((e) => e.type === 'WagePaid')
      .at(-1),
    charged = events()
      .filter((e) => e.type === 'IncomeTaxCharged')
      .at(-1);
  assert.ok(wage && charged);
  assert.ok(Math.abs(charged.payload.amount - wage.payload.amount * 0.2) < 1e-9);
  assert.equal(runtime.state.world.moneySupply, supply);
  const service = initial.institutionLimits.allowedBudgetServices[0];
  await propose('budget', {
    kind: 'set-budget',
    expectedRevision: 1,
    terms: {
      cadenceMs: 60000,
      minimumTreasuryReserve: 0,
      allocations: [{ service, amountPerCadence: 1 }],
    },
  });
  await decide('budget');
  await execute('budget');
  assert.equal(runtime.advanceTime(60000, 'fiscal-boundary').ok, true);
  assert.ok(
    events().some(
      (e) =>
        e.type === 'PublicBudgetSpent' &&
        e.payload.policyVersion === 'resident-public-budget-v1' &&
        e.payload.amount === 1 &&
        e.payload.service === service,
    ),
  );
  await propose('subsidy', {
    kind: 'set-subsidy',
    expectedRevision: 2,
    terms: { minimumBalance: 1000, maxSubsidy: 1 },
  });
  await decide('subsidy');
  await execute('subsidy');
  assert.equal(runtime.advanceTime(60000, 'subsidy-boundary').ok, true);
  assert.ok(
    events().some(
      (e) =>
        e.type === 'SubsidyPaid' &&
        e.payload.amount === 1 &&
        e.payload.fundingSource === 'treasury',
    ),
  );
  await propose('unused', tax(0.3));
  await decide('unused');
  await call(b, [
    'governance',
    'object',
    '--id',
    'concern',
    '--proposal-id',
    'unused',
    '--text',
    '要求复核，单独异议不自动撤销。',
  ]);
  await call(c, ['governance', 'objections', '--id', 'unused']);
  assert.equal(runtime.state.world.publicGovernance.authority.proposals.unused.status, 'approved');
  await propose('remedy', {
    kind: 'invalidate-decision',
    proposalId: 'unused',
    expectedRevision: rev('unused'),
    reason: '共同决定不执行此项',
  });
  await decide('remedy');
  await execute('remedy');
  await execute('unused', a, 1);
  const procedure = structuredClone(runtime.state.world.publicGovernance.authority.procedure);
  await propose('procedure', {
    kind: 'set-procedure',
    expectedRevision: 1,
    terms: { ...procedure, minimumTurnout: 1, minimumYes: 1, executors: [b] },
  });
  await decide('procedure');
  await execute('procedure');
  assert.equal(runtime.state.world.publicGovernance.authority.procedureRevision, 2);
  await propose('new-procedure', tax(0.25));
  await decide('new-procedure', [a]);
  assert.equal((await execute('new-procedure', c, 1)).error, 'public-executor-not-authorized');
  await execute('new-procedure', b);
  await call(c, ['governance', 'votes', '--id', 'new-procedure']);
  assert.equal(runtime.state.world.governance.tax.tradeTaxRate, 0.25);
  assert.equal(runtime.state.world.moneySupply, supply);
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  serverClosed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      commands: ordinal,
      expectedRefusals: refused,
      checks: [
        'compiled-identity-bound-cli',
        'explicit-public-grant',
        'independent-exact-ballots',
        'actual-income-tax',
        'actual-public-budget',
        'actual-treasury-subsidy',
        'conserved-money-supply',
        'original-objection-not-verdict',
        'approved-remedy',
        'procedure-amended-under-old-rules',
        'new-designated-executor',
        'full-state-replay',
        'journal-bytes-unchanged',
      ],
    }),
  );
} finally {
  if (!serverClosed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
