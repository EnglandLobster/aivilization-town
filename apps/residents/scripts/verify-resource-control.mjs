// Explicit engineering acceptance: collectively controlled information resources, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-resource-control-cli-'));
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
      [executable, ...argv, '--request-id', `resource-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit resource control CLI acceptance' });
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
  await call(a, ['rules', 'capability', '--name', 'resources.offer']);
  await call(b, [
    'collectives',
    'create',
    '--id',
    'club',
    '--configuration',
    JSON.stringify({
      title: '自己的管理制度',
      terms: '共同决定具体管理动作',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    }),
    '--expires-at',
    String(now + 100000),
  ]);
  await call(c, [
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
    'registers',
    'create',
    '--id',
    'r',
    '--title',
    '自己维护的原始记录',
    '--visibility',
    'private',
    '--readers',
    b,
    '--fields',
    '{"score":"number"}',
  ]);
  await call(a, [
    'records',
    'put',
    '--register-id',
    'r',
    '--key',
    'one',
    '--expected-revision',
    '0',
    '--values',
    '{"score":4}',
  ]);
  await call(a, [
    'resources',
    'offer',
    '--kind',
    'register',
    '--id',
    'r',
    '--expected-revision',
    '1',
    '--expected-control-version',
    '1',
    '--target',
    JSON.stringify({ kind: 'collective', id: 'club' }),
    '--expires-at',
    String(now + 50000),
    '--terms',
    '交接管理不更改作者',
  ]);
  await call(b, ['resources', 'read', '--kind', 'register', '--id', 'r']);
  await call(
    b,
    [
      'resources',
      'accept',
      '--kind',
      'register',
      '--id',
      'r',
      '--expected-revision',
      '2',
      '--expected-control-version',
      '2',
    ],
    1,
  );
  let decisionOrdinal = 0;
  async function collective(capability, args) {
    const id = `d-${++decisionOrdinal}`;
    await call(b, [
      'collectives',
      'propose',
      '--id',
      id,
      '--collective-id',
      'club',
      '--expected-version',
      '1',
      '--terms',
      '独立同意此精确动作',
      '--action',
      JSON.stringify({ kind: 'resource', capability, resourceId: 'r', arguments: args }),
      '--closes-at',
      String(now + 10000),
      '--execute-before',
      String(now + 20000),
    ]);
    for (const actor of [b, c])
      await call(actor, [
        'collectives',
        'vote',
        '--id',
        id,
        '--expected-revision',
        String(runtime.state.collectives.decisions[id].revision),
        '--vote',
        'yes',
      ]);
    await call(b, [
      'collectives',
      'decide',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
    ]);
    await call(b, [
      'collectives',
      'execute',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
    ]);
    assert.equal(runtime.state.collectives.decisions[id].status, 'executed');
  }
  await collective('resources.accept', {
    kind: 'register',
    expectedRevision: 2,
    expectedControlVersion: 2,
  });
  assert.deepEqual(runtime.state.sharedRecords.registers.r.control.controller, {
    kind: 'collective',
    id: 'club',
  });
  await call(
    a,
    ['registers', 'configure', '--id', 'r', '--expected-revision', '3', '--visibility', 'public'],
    1,
  );
  await call(d, ['records', 'read', '--register-id', 'r', '--key', 'one'], 1);
  await collective('resources.manage', {
    kind: 'register',
    expectedRevision: 3,
    expectedControlVersion: 3,
    operation: { type: 'configure', visibility: 'private', readers: [b, d], editors: [d] },
  });
  await call(d, [
    'records',
    'put',
    '--register-id',
    'r',
    '--key',
    'one',
    '--expected-revision',
    '1',
    '--values',
    '{"score":8}',
  ]);
  const original = runtime.state.sharedRecords.records['r/one'];
  assert.equal(original.createdBy, a);
  assert.equal(original.editedBy, d);
  assert.equal(original.authorityId, d);
  assert.equal(runtime.state.collectives.charters.club.members.includes(d), false);
  await collective('resources.offer', {
    kind: 'register',
    expectedRevision: 4,
    expectedControlVersion: 4,
    target: { kind: 'resident', id: d },
    expiresAt: now + 50000,
    terms: '让接收者自行接受',
  });
  await call(d, ['resources', 'read', '--kind', 'register', '--id', 'r']);
  await call(d, [
    'resources',
    'accept',
    '--kind',
    'register',
    '--id',
    'r',
    '--expected-revision',
    '5',
    '--expected-control-version',
    '5',
  ]);
  assert.deepEqual(runtime.state.sharedRecords.registers.r.control.controller, {
    kind: 'resident',
    id: d,
  });
  await call(
    b,
    [
      'resources',
      'manage',
      '--kind',
      'register',
      '--id',
      'r',
      '--expected-revision',
      '6',
      '--expected-control-version',
      '6',
      '--operation',
      JSON.stringify({ type: 'configure', visibility: 'public', readers: [], editors: [] }),
    ],
    1,
  );
  await call(d, ['resources', 'list', '--limit', '5']);
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
    capability: 'M06-M09-information-resource-control-slice',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    independentTwoSidedAcceptance: true,
    collectiveMemberHasNoPersonalAdminBypass: true,
    oldOwnerPrivilegeRemoved: true,
    explicitUsagePermissionOnly: true,
    originalAndNewAuthorshipPreserved: true,
    successorPersonallyAccepted: true,
    atomicDecisionConsumption: true,
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
