// Prompted mechanism acceptance. Real compiled CLI + identity-bound HTTP; no model or emergence claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'society-kernel-cli-'));
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 4 }));
const [a, b, c, outsider] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c, outsider]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let ordinal = 0,
  closed = false;
const results = [];
async function call(actor, argv, expected = 0, requestId) {
  runtime.beginTurn(actor);
  const id = requestId ?? `kernel-cli-${++ordinal}`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [executable, ...argv, '--request-id', id], {
      env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (v) => (out += v));
    child.stderr.on('data', (v) => (err += v));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
  runtime.finishTurn(actor, { summary: 'Explicit society kernel CLI acceptance' });
  assert.equal(result.code, expected, `${argv.slice(0, 2).join(' ')}: ${result.out} ${result.err}`);
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
  await call(a, ['rules', 'list']);
  const boundaries = await call(a, ['rules', 'capabilities', '--category', 'records']);
  assert.equal(boundaries.data.total, 6);
  const recordBoundary = await call(a, ['rules', 'capability', '--name', 'records.put']);
  assert.deepEqual(recordBoundary.data.records, ['attributed-claim']);
  assert.equal(recordBoundary.data.cli, 'town records put');
  assert.equal(recordBoundary.data.delegation, 'exact-version-limited-mandate');
  const bodyBoundary = await call(a, ['rules', 'capability', '--name', 'world.study']);
  assert.equal(bodyBoundary.data.participation, 'personal-physical-action');
  assert.equal(bodyBoundary.data.delegation, 'not-enabled');
  const rule = await call(a, ['rules', 'read', '--id', 'resident-programs']);
  assert.equal(rule.data.enabled, true);
  await call(b, [
    'registers',
    'create',
    '--id',
    'journal',
    '--title',
    '居民自己的约定',
    '--visibility',
    'private',
    '--editors',
    c,
    '--fields',
    '{"note":"string","amount":"number"}',
  ]);
  await call(outsider, ['registers', 'read', '--id', 'journal'], 1);
  await call(b, [
    'records',
    'put',
    '--register-id',
    'journal',
    '--key',
    'entry',
    '--expected-revision',
    '0',
    '--values',
    '{"note":"原始陈述","amount":999}',
  ]);
  await call(c, [
    'records',
    'put',
    '--register-id',
    'journal',
    '--key',
    'entry',
    '--expected-revision',
    '1',
    '--values',
    '{"note":"独立修订","amount":0}',
  ]);
  const history = await call(b, [
    'records',
    'history',
    '--register-id',
    'journal',
    '--key',
    'entry',
  ]);
  assert.equal(history.data.items[0].values.amount, 999);
  assert.equal(history.data.items[1].editedBy, c);
  const definition = {
    steps: [
      {
        principalId: b,
        capability: 'payments.transfer',
        arguments: { targetId: c, amount: 5, note: '自愿协作' },
      },
      {
        principalId: b,
        capability: 'records.append',
        arguments: { registerId: 'journal', values: { note: '我的陈述不是系统认证', amount: 5 } },
      },
      {
        principalId: b,
        capability: 'messages.send',
        arguments: { recipientId: c, content: '本人授权的原话 $ 不执行' },
      },
    ],
  };
  await call(a, [
    'programs',
    'publish',
    '--id',
    'cooperate',
    '--title',
    '自主流程',
    '--purpose',
    '原文目的',
    '--runners',
    a,
    '--definition',
    JSON.stringify(definition),
  ]);
  await call(outsider, ['programs', 'read', '--id', 'cooperate'], 1);
  await call(a, ['programs', 'run', '--id', 'cooperate', '--expected-revision', '1'], 1);
  await call(b, ['programs', 'read', '--id', 'cooperate']);
  await call(b, [
    'mandates',
    'grant',
    '--id',
    'consent',
    '--program-id',
    'cooperate',
    '--program-revision',
    '1',
    '--runner-id',
    a,
    '--max-runs',
    '3',
    '--expires-at',
    '300000',
  ]);
  const initial = {
    b: runtime.state.world.agents[b].balance,
    c: runtime.state.world.agents[c].balance,
    supply: runtime.state.world.moneySupply,
  };
  const one = await call(
    a,
    ['programs', 'run', '--id', 'cooperate', '--expected-revision', '1'],
    0,
    'retry-run',
  );
  const again = await call(
    a,
    ['programs', 'run', '--id', 'cooperate', '--expected-revision', '1'],
    0,
    'retry-run',
  );
  assert.deepEqual(again, one);
  assert.equal(runtime.state.world.agents[b].balance, initial.b - 5);
  assert.equal(runtime.state.world.agents[c].balance, initial.c + 5);
  const message = Object.values(runtime.state.information.messages).at(-1);
  assert.equal(message.content, '本人授权的原话 $ 不执行');
  assert.equal(message.executedBy, a);
  assert.equal(message.senderId, b);
  await call(a, [
    'programs',
    'schedule',
    '--id',
    'repeat',
    '--program-id',
    'cooperate',
    '--program-revision',
    '1',
    '--start-at',
    '60000',
    '--interval-ms',
    '60000',
    '--runs',
    '2',
  ]);
  assert.equal(runtime.advanceTime(120000, 'advance').ok, true);
  await call(a, ['programs', 'schedules']);
  const runs = await call(b, ['programs', 'runs']);
  assert.equal(runs.data.items.filter((r) => r.status === 'succeeded').length, 3);
  assert.equal(runtime.state.coordination.mandates.consent.usedRuns, 3);
  assert.equal(runtime.state.world.moneySupply, initial.supply);
  await call(a, ['programs', 'run', '--id', 'cooperate', '--expected-revision', '1'], 1);
  await call(b, ['mandates', 'revoke', '--id', 'consent', '--expected-revision', '4']);
  const before = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  closed = true;
  runtime.close();
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, before);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  const evidence = {
    spec: 'agent-driven-society-v1',
    mode: 'real-compiled-cli-mechanism-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    successfulProgramRuns: 3,
    moneySupplyPreserved: true,
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
