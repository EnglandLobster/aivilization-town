// Explicit engineering acceptance: real collectively controlled cash, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-common-accounts-cli-'));
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 4 }));
const [a, b, c, d] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c, d]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const results = [];
let ordinal = 0,
  closed = false;
async function call(actor, argv, expectedCode = 0) {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `funds-cli-${++ordinal}`],
      {
        env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '',
      err = '';
    child.stdout.on('data', (v) => (out += v));
    child.stderr.on('data', (v) => (err += v));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit common account CLI acceptance' });
  assert.equal(
    result.code,
    expectedCode,
    `${argv.slice(0, 2).join(' ')}: ${result.out} ${result.err}`,
  );
  const parsed = JSON.parse(result.out);
  results.push({
    route: argv.slice(0, 2).join(' '),
    exitCode: result.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}
try {
  const now = runtime.state.world.clock.now;
  const config = {
    title: '共同维护',
    terms: '两位成员独立决定共同支出',
    members: [a, b],
    voters: [a, b],
    threshold: 2,
    quorum: 2,
    timing: 'early',
    revote: true,
  };
  const approval = async (id, capability, args) => {
    await call(a, [
      'collectives',
      'propose',
      '--id',
      id,
      '--collective-id',
      'club',
      '--expected-version',
      '1',
      '--terms',
      '这一笔精确资源操作',
      '--action',
      JSON.stringify({ kind: 'resource', capability, resourceId: 'pool', arguments: args }),
      '--closes-at',
      String(now + 10000),
      '--execute-before',
      String(now + 20000),
    ]);
    await call(a, ['collectives', 'vote', '--id', id, '--expected-revision', '1', '--vote', 'yes']);
    await call(b, ['collectives', 'vote', '--id', id, '--expected-revision', '2', '--vote', 'yes']);
    await call(a, ['collectives', 'decide', '--id', id, '--expected-revision', '3']);
  };
  const execute = (id, code = 0) =>
    call(a, ['collectives', 'execute', '--id', id, '--expected-revision', '4'], code);
  await call(a, ['rules', 'capability', '--name', 'funds.contribute']);
  await call(a, [
    'collectives',
    'create',
    '--id',
    'club',
    '--configuration',
    JSON.stringify(config),
    '--expires-at',
    String(now + 100000),
  ]);
  await call(b, [
    'collectives',
    'respond',
    '--id',
    'club',
    '--expected-revision',
    '1',
    '--accept',
    'true',
  ]);
  await call(a, [
    'funds',
    'open',
    '--id',
    'pool',
    '--collective-id',
    'club',
    '--title',
    '实际共同账户',
  ]);
  await approval('pay', 'funds.transfer', {
    controlVersion: 1,
    recipient: { sector: 'agent', id: d },
    amount: 20,
    note: '按独立决定付款',
  });
  const failed = await execute('pay', 1);
  assert.equal(failed.error, 'insufficient-common-account-balance');
  assert.equal(runtime.state.collectives.decisions.pay.status, 'passed');
  const donorBefore = runtime.state.world.agents[c].balance,
    targetBefore = runtime.state.world.agents[d].balance,
    supplyBefore = runtime.state.world.moneySupply;
  await call(c, [
    'funds',
    'contribute',
    '--id',
    'pool',
    '--expected-revision',
    '1',
    '--amount',
    '35',
    '--note',
    '本人自愿出资，不是自动会费',
  ]);
  const publicView = await call(c, ['funds', 'read', '--id', 'pool']);
  assert.equal(publicView.data.balanceVisible, false);
  assert.equal(Object.hasOwn(publicView.data, 'balance'), false);
  await call(c, ['funds', 'ledger', '--id', 'pool'], 1);
  await execute('pay');
  assert.equal(runtime.state.world.agents[d].balance, targetBefore + 20);
  assert.equal(runtime.state.world.agents[c].balance, donorBefore - 35);
  await execute('pay', 1);
  const balance = await call(b, ['funds', 'read', '--id', 'pool']);
  assert.equal(balance.data.balance, 15);
  const treasuryBefore = runtime.state.world.treasury;
  await approval('public-contribution', 'funds.transfer', {
    controlVersion: 1,
    recipient: { sector: 'treasury', id: 'public-treasury' },
    amount: 5,
    note: '自主公共出资',
  });
  await execute('public-contribution');
  assert.equal(runtime.state.world.treasury, treasuryBefore + 5);
  await approval('settle', 'funds.beginSettlement', { controlVersion: 1 });
  await execute('settle');
  await call(
    c,
    [
      'funds',
      'contribute',
      '--id',
      'pool',
      '--expected-revision',
      String(runtime.state.world.commonAccounts.accounts.pool.revision),
      '--amount',
      '1',
      '--note',
      '已清算账户不能新入资',
    ],
    1,
  );
  await approval('close', 'funds.close', { controlVersion: 2 });
  await execute('close', 1);
  await approval('remaining', 'funds.transfer', {
    controlVersion: 2,
    recipient: { sector: 'agent', id: c },
    amount: 10,
    note: '按共同决定分配余款',
  });
  await execute('remaining');
  await execute('close');
  const closedAccount = await call(a, ['funds', 'read', '--id', 'pool']);
  assert.equal(closedAccount.data.status, 'closed');
  assert.equal(closedAccount.data.balance, 0);
  const ledger = await call(b, ['funds', 'ledger', '--id', 'pool']);
  assert.equal(ledger.data.total, 7);
  assert.deepEqual(
    ledger.data.items.map((r) => r.accountRevisions.pool),
    [1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(runtime.state.world.moneySupply, supplyBefore);
  const w = runtime.state.world,
    total =
      Object.values(w.agents).reduce((sum, a) => sum + a.balance, 0) +
      Object.values(w.enterprises).reduce((sum, e) => sum + e.balance, 0) +
      (w.bank?.balance ?? 0) +
      (w.treasury ?? 0) +
      Object.values(w.commonAccounts.accounts).reduce((sum, a) => sum + a.balance, 0);
  assert.ok(Math.abs(total - w.moneySupply) < 1e-8);
  const spendingCommits = runtime.journal.commits.filter(
    (c) => c.capability === 'collectives.execute' && c.result.ok,
  );
  assert.equal(spendingCommits.length, 5);
  assert.ok(
    spendingCommits.every((c) => c.worldEvents?.length === 1 && c.collectiveEvents?.length === 1),
  );
  const expected = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, expected);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  const evidence = {
    capability: 'M06-common-account-slice',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    atomicProofAndCash: true,
    failedDecisionPreserved: true,
    independentContribution: true,
    noOutsiderLedger: true,
    noRepeatedPayment: true,
    treasuryTransfer: true,
    settlementBeforeClosure: true,
    moneySupplyConserved: true,
    orderedActualLedger: true,
    replayEqual: true,
    journalBytesUnchanged: true,
  };
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  if (!closed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
