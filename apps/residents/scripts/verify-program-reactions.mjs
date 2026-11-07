// Explicit engineering acceptance: bounded durable event reactions, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-program-reactions-cli-'));
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 3 }));
const [a, b, c] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c]);
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
      [executable, ...argv, '--request-id', `reaction-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit durable reaction CLI acceptance' });
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
  await call(a, ['rules', 'capability', '--name', 'reactions.watch']);
  await call(b, [
    'registers',
    'create',
    '--id',
    'claims',
    '--title',
    '自己的判断',
    '--visibility',
    'private',
    '--readers',
    a,
    '--fields',
    '{"approved":"boolean"}',
  ]);
  async function put(value, revision) {
    return call(b, [
      'records',
      'put',
      '--register-id',
      'claims',
      '--key',
      'result',
      '--expected-revision',
      String(revision),
      '--values',
      JSON.stringify({ approved: value }),
    ]);
  }
  await put(false, 0);
  const definition = {
    conditions: [
      {
        source: {
          kind: 'statement',
          registerId: 'claims',
          key: 'result',
          revision: 'latest',
          field: 'approved',
          signerId: b,
        },
        op: 'eq',
        value: true,
      },
    ],
    steps: [
      {
        principalId: a,
        capability: 'payments.transfer',
        arguments: { targetId: c, amount: 3, note: '自定的有限响应' },
      },
    ],
  };
  await call(a, [
    'programs',
    'publish',
    '--id',
    'p',
    '--title',
    '有限事件响应',
    '--purpose',
    '依据独立居民的原文',
    '--runners',
    a,
    '--definition',
    JSON.stringify(definition),
  ]);
  await call(a, [
    'mandates',
    'grant',
    '--id',
    'm',
    '--program-id',
    'p',
    '--program-revision',
    '1',
    '--runner-id',
    a,
    '--max-runs',
    '5',
    '--expires-at',
    String(now + 200000),
  ]);
  const watch = await call(a, [
    'reactions',
    'watch',
    '--id',
    'w',
    '--program-id',
    'p',
    '--program-revision',
    '1',
    '--max-reactions',
    '4',
    '--expires-at',
    String(now + 100000),
  ]);
  assert.equal(Object.hasOwn(watch.data, 'sourceToken'), false);
  assert.equal(Object.keys(runtime.state.coordination.runs).length, 0);
  const before = runtime.state.world.agents[a].balance,
    supply = runtime.state.world.moneySupply;
  await put(false, 1);
  assert.equal(runtime.state.coordination.reactions.reactions['w:1'].status, 'skipped');
  assert.equal(runtime.state.coordination.mandates.m.usedRuns, 0);
  await put(true, 2);
  assert.equal(runtime.state.world.agents[a].balance, before - 3);
  assert.equal(runtime.state.coordination.mandates.m.usedRuns, 1);
  await call(c, ['reactions', 'read', '--id', 'w'], 1);
  const history = await call(a, ['reactions', 'history', '--id', 'w', '--limit', '1']);
  assert.equal(history.data.total, 2);
  assert.equal(history.data.items.length, 1);
  assert.equal(Object.hasOwn(history.data.items[0], 'sourceToken'), false);
  await call(b, [
    'registers',
    'configure',
    '--id',
    'claims',
    '--expected-revision',
    '1',
    '--visibility',
    'private',
  ]);
  const stopped = await call(a, ['reactions', 'read', '--id', 'w']);
  assert.equal(stopped.data.status, 'failed');
  assert.equal(stopped.data.reason, 'condition-source-unavailable');
  await put(true, 3);
  assert.equal(runtime.state.world.agents[a].balance, before - 3);
  await call(b, [
    'registers',
    'configure',
    '--id',
    'claims',
    '--expected-revision',
    '2',
    '--visibility',
    'private',
    '--readers',
    a,
  ]);
  await call(a, [
    'reactions',
    'watch',
    '--id',
    'cancel-me',
    '--program-id',
    'p',
    '--program-revision',
    '1',
    '--max-reactions',
    '1',
    '--expires-at',
    String(now + 100000),
  ]);
  await call(a, ['reactions', 'cancel', '--id', 'cancel-me', '--expected-revision', '1']);
  await put(true, 4);
  assert.equal(runtime.state.world.agents[a].balance, before - 3);
  await call(a, ['reactions', 'list', '--limit', '2']);
  await call(a, ['programs', 'runs', '--program-id', 'p', '--limit', '1']);
  assert.equal(runtime.state.world.moneySupply, supply);
  const expected = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, expected);
    assert.deepEqual(reopened.resumeReactions(), { processed: 0, pending: 0 });
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  const evidence = {
    capability: 'M08-program-reactions',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    registrationDoesNotExecute: true,
    falseChangesSkipWithoutMandateUse: true,
    signedChangeTransfersRealFunds: true,
    currentPermissionStopsQueuedProcedure: true,
    privateWatchHidden: true,
    finiteHistoryPagination: true,
    cancellationPreservesUnusedMandates: true,
    moneySupplyConserved: true,
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
