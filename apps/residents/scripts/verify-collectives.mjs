// Explicit engineering acceptance: resident-designed collective procedures, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-collectives-cli-'));
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
      [executable, ...argv, '--request-id', `collective-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit collective CLI acceptance' });
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
  const originalWorld = structuredClone(runtime.state.world);
  const charter = {
    title: '自定作品交流安排',
    terms: '两人一致决定修改',
    members: [a, b],
    voters: [a, b],
    threshold: 2,
    quorum: 2,
    timing: 'early',
    revote: true,
  };
  await call(a, ['rules', 'capability', '--name', 'collectives.execute']);
  await call(a, [
    'collectives',
    'create',
    '--id',
    'exchange',
    '--configuration',
    JSON.stringify(charter),
    '--expires-at',
    String(now + 10000),
  ]);
  await call(b, ['collectives', 'read', '--id', 'exchange']);
  await call(b, [
    'collectives',
    'respond',
    '--id',
    'exchange',
    '--expected-revision',
    '1',
    '--accept',
    'true',
  ]);
  const replacement = {
    ...charter,
    title: '成员自己的新安排',
    members: [a, b, c],
    voters: [c],
    threshold: 1,
    quorum: 1,
  };
  await call(a, [
    'collectives',
    'propose',
    '--id',
    'change',
    '--collective-id',
    'exchange',
    '--expected-version',
    '1',
    '--terms',
    '按原程序修改并邀请第三人',
    '--action',
    JSON.stringify({ kind: 'amend', configuration: replacement }),
    '--closes-at',
    String(now + 1000),
    '--execute-before',
    String(now + 2000),
  ]);
  await call(d, ['collectives', 'decision', '--id', 'change'], 1);
  await call(
    c,
    ['collectives', 'vote', '--id', 'change', '--expected-revision', '1', '--vote', 'yes'],
    1,
  );
  await call(a, [
    'collectives',
    'vote',
    '--id',
    'change',
    '--expected-revision',
    '1',
    '--vote',
    'yes',
  ]);
  await call(b, [
    'collectives',
    'vote',
    '--id',
    'change',
    '--expected-revision',
    '2',
    '--vote',
    'yes',
  ]);
  await call(a, ['collectives', 'decide', '--id', 'change', '--expected-revision', '3']);
  await call(a, ['collectives', 'execute', '--id', 'change', '--expected-revision', '4'], 1);
  await call(c, ['collectives', 'decision', '--id', 'change']);
  await call(c, [
    'collectives',
    'join',
    '--id',
    'change',
    '--expected-revision',
    '4',
    '--accept',
    'true',
  ]);
  await call(b, ['collectives', 'execute', '--id', 'change', '--expected-revision', '5']);
  const changed = await call(c, ['collectives', 'read', '--id', 'exchange']);
  assert.equal(changed.data.version, 2);
  assert.deepEqual(changed.data.voters, [c]);
  assert.equal(changed.data.consents[a].version, 1);
  const history = await call(c, ['collectives', 'history', '--id', 'exchange']);
  assert.equal(history.data.total, 1);
  await call(b, ['collectives', 'execute', '--id', 'change', '--expected-revision', '6'], 1);
  const mutual = {
    title: '自定共同维修安排',
    terms: '三人中至少两人赞成，到期结算',
    members: [a, b, c],
    voters: [a, b, c],
    threshold: 2,
    quorum: 2,
    timing: 'deadline',
    revote: false,
  };
  await call(b, [
    'collectives',
    'create',
    '--id',
    'repair',
    '--configuration',
    JSON.stringify(mutual),
    '--expires-at',
    String(now + 10000),
  ]);
  await call(a, [
    'collectives',
    'respond',
    '--id',
    'repair',
    '--expected-revision',
    '1',
    '--accept',
    'true',
  ]);
  await call(c, [
    'collectives',
    'respond',
    '--id',
    'repair',
    '--expected-revision',
    '2',
    '--accept',
    'true',
  ]);
  await call(b, [
    'collectives',
    'propose',
    '--id',
    'discussion',
    '--collective-id',
    'repair',
    '--expected-version',
    '1',
    '--terms',
    '共同讨论维修；这段话不会完成施工',
    '--action',
    '{"kind":"statement"}',
    '--closes-at',
    String(now + 1000),
    '--execute-before',
    String(now + 2000),
  ]);
  await call(b, [
    'collectives',
    'vote',
    '--id',
    'discussion',
    '--expected-revision',
    '1',
    '--vote',
    'yes',
  ]);
  await call(c, [
    'collectives',
    'vote',
    '--id',
    'discussion',
    '--expected-revision',
    '2',
    '--vote',
    'yes',
  ]);
  await call(b, ['collectives', 'decide', '--id', 'discussion', '--expected-revision', '3'], 1);
  assert.deepEqual(runtime.state.world, originalWorld);
  assert.equal(runtime.advanceTime(1000, 'deadline-advance').ok, true);
  const decision = await call(a, ['collectives', 'decision', '--id', 'discussion']);
  assert.equal(decision.data.status, 'passed');
  await call(a, ['collectives', 'execute', '--id', 'discussion', '--expected-revision', '4'], 1);
  await call(c, ['collectives', 'leave', '--id', 'exchange', '--expected-revision', '3']);
  const suspended = await call(a, ['collectives', 'read', '--id', 'exchange']);
  assert.equal(suspended.data.operable, false);
  assert.equal(suspended.data.threshold, 1);
  assert.deepEqual(suspended.data.voters, []);
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
    capability: 'M05-resident-collectives',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    twoResidentDefinedPurposes: true,
    distinctDecisionProcedures: true,
    independentJoiningConsent: true,
    oldAuthorityUsedForAmendment: true,
    noForgedResigning: true,
    statementHasNoResourceEffect: true,
    noImplicitSuccession: true,
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
