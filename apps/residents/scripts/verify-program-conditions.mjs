// Explicit engineering acceptance: versioned conditional resident procedures, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-program-conditions-cli-'));
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
      [executable, ...argv, '--request-id', `condition-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit conditional procedure CLI acceptance' });
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
  await call(a, ['rules', 'capability', '--name', 'programs.check']);
  await call(b, [
    'registers',
    'create',
    '--id',
    'claims',
    '--title',
    '我的原始判断',
    '--visibility',
    'private',
    '--readers',
    a,
    '--fields',
    '{"approved":"boolean"}',
  ]);
  await call(b, [
    'records',
    'put',
    '--register-id',
    'claims',
    '--key',
    'result',
    '--expected-revision',
    '0',
    '--values',
    '{"approved":false}',
  ]);
  const signed = {
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
  };
  const first = {
    steps: [
      {
        principalId: a,
        capability: 'payments.transfer',
        arguments: { targetId: c, amount: 3, note: '依据指定人的原文声明' },
      },
    ],
    conditions: [signed],
  };
  await call(a, [
    'programs',
    'publish',
    '--id',
    'payment',
    '--title',
    '自定条件付款',
    '--purpose',
    '自己选择依据，不认定客观合格',
    '--runners',
    a,
    '--definition',
    JSON.stringify(first),
  ]);
  await call(a, [
    'mandates',
    'grant',
    '--id',
    'payment-m',
    '--program-id',
    'payment',
    '--program-revision',
    '1',
    '--runner-id',
    a,
    '--max-runs',
    '2',
    '--expires-at',
    String(now + 10000),
  ]);
  const before = runtime.state.world.agents[a].balance;
  const check = await call(a, ['programs', 'check', '--id', 'payment', '--expected-revision', '1']);
  assert.equal(check.data.conditionsMatched, false);
  const failure = await call(
    a,
    ['programs', 'run', '--id', 'payment', '--expected-revision', '1'],
    1,
  );
  assert.equal(failure.error, 'program-conditions-not-met');
  assert.equal(runtime.state.world.agents[a].balance, before);
  assert.equal(runtime.state.coordination.mandates['payment-m'].usedRuns, 0);
  await call(b, [
    'records',
    'put',
    '--register-id',
    'claims',
    '--key',
    'result',
    '--expected-revision',
    '1',
    '--values',
    '{"approved":true}',
  ]);
  const paid = await call(a, ['programs', 'run', '--id', 'payment', '--expected-revision', '1']);
  assert.equal(runtime.state.world.agents[a].balance, before - 3);
  assert.equal(paid.data.conditionEvidence[0].sourceClass, 'signed-claim');
  assert.equal(paid.data.conditionEvidence[0].sourceVersions.recordRevision, 2);
  await call(a, [
    'views',
    'publish',
    '--id',
    'count-approved',
    '--title',
    '本人定义的统计',
    '--visibility',
    'public',
    '--definition',
    '{"sourceRegisterId":"claims","select":[],"where":[{"field":"approved","op":"eq","value":true}],"aggregate":{"op":"count"}}',
  ]);
  const second = {
    steps: [
      {
        principalId: a,
        capability: 'messages.send',
        arguments: { recipientId: b, content: '我自己的条件统计满足，发出这段原话。' },
      },
    ],
    conditions: [
      { source: { kind: 'view', viewId: 'count-approved', viewRevision: 1 }, op: 'gte', value: 1 },
    ],
  };
  await call(a, [
    'programs',
    'publish',
    '--id',
    'notice',
    '--title',
    '自定统计通知',
    '--purpose',
    '另一种用途',
    '--runners',
    a,
    '--definition',
    JSON.stringify(second),
  ]);
  await call(a, [
    'mandates',
    'grant',
    '--id',
    'notice-m',
    '--program-id',
    'notice',
    '--program-revision',
    '1',
    '--runner-id',
    a,
    '--max-runs',
    '2',
    '--expires-at',
    String(now + 10000),
  ]);
  const sent = await call(a, ['programs', 'run', '--id', 'notice', '--expected-revision', '1']);
  assert.equal(sent.data.conditionEvidence[0].sourceClass, 'resident-computation');
  assert.equal(
    Object.values(runtime.state.information.messages).filter(
      (m) => m.content === '我自己的条件统计满足，发出这段原话。',
    ).length,
    1,
  );
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
  const blocked = await call(
    a,
    ['programs', 'check', '--id', 'notice', '--expected-revision', '1'],
    1,
  );
  assert.equal(blocked.error, 'condition-source-unavailable');
  await call(a, ['programs', 'run', '--id', 'notice', '--expected-revision', '1'], 1);
  assert.equal(runtime.state.coordination.mandates['notice-m'].usedRuns, 1);
  const runs = await call(a, ['programs', 'runs', '--program-id', 'payment', '--limit', '1']);
  assert.equal(runs.data.total, 2);
  assert.equal(runs.data.items.length, 1);
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
    capability: 'M07-program-conditions',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    distinctResidentPurposes: true,
    falseConditionHasNoPayment: true,
    failedConditionPreservesMandate: true,
    actualSignedVersion: true,
    residentComputationNotWorldScore: true,
    sourceRevocationStopsExecution: true,
    noRepeatedUnapprovedEffects: true,
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
