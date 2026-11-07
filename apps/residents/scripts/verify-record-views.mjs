// Explicit engineering acceptance: original resident computations, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-record-views-cli-'));
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
      [executable, ...argv, '--request-id', `view-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit record view CLI acceptance' });
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
  const boundary = await call(a, ['rules', 'capability', '--name', 'views.query']);
  assert.equal(boundary.data.availability.adapterEnabled, true);
  await call(a, [
    'registers',
    'create',
    '--id',
    'notes',
    '--title',
    '居民记录',
    '--visibility',
    'private',
    '--readers',
    b,
    '--fields',
    '{"title":"string","rating":"number","cost":"number"}',
  ]);
  for (const [key, rating, cost] of [
    ['one', 4, 2],
    ['two', 5, 3],
  ])
    await call(a, [
      'records',
      'put',
      '--register-id',
      'notes',
      '--key',
      key,
      '--expected-revision',
      '0',
      '--values',
      JSON.stringify({ title: key, rating, cost }),
    ]);
  const worldBefore = structuredClone(runtime.state.world);
  const definition = {
    sourceRegisterId: 'notes',
    select: ['title', 'weighted'],
    derive: {
      weighted: {
        op: 'subtract',
        left: { op: 'multiply', left: { field: 'rating' }, right: { constant: 2 } },
        right: { field: 'cost' },
      },
    },
    orderBy: [{ field: 'weighted', direction: 'desc' }],
    aggregate: { op: 'sum', field: 'weighted' },
  };
  await call(b, [
    'views',
    'publish',
    '--id',
    'comparison',
    '--title',
    '作者自己的指标',
    '--visibility',
    'public',
    '--definition',
    JSON.stringify(definition),
  ]);
  await call(c, ['views', 'query', '--id', 'comparison', '--expected-revision', '1'], 1);
  const query = await call(b, [
    'views',
    'query',
    '--id',
    'comparison',
    '--expected-revision',
    '1',
    '--limit',
    '1',
  ]);
  assert.equal(query.data.provenance, 'resident-computation');
  assert.equal(query.data.inputProvenance, 'resident-claim');
  assert.equal(query.data.authorId, b);
  assert.equal(query.data.total, 2);
  assert.equal(query.data.items[0].key, 'two');
  assert.equal(query.data.aggregate.value, 13);
  await call(a, [
    'registers',
    'configure',
    '--id',
    'notes',
    '--expected-revision',
    '1',
    '--visibility',
    'private',
    '--readers',
    b,
    '--readers',
    c,
  ]);
  const shared = await call(c, [
    'views',
    'query',
    '--id',
    'comparison',
    '--expected-revision',
    '1',
  ]);
  assert.equal(shared.data.items.length, 2);
  await call(c, [
    'views',
    'publish',
    '--id',
    'directory',
    '--title',
    '普通目录另一种用途',
    '--visibility',
    'public',
    '--definition',
    '{"sourceRegisterId":"notes","select":["title"]}',
  ]);
  const directory = await call(b, [
    'views',
    'query',
    '--id',
    'directory',
    '--expected-revision',
    '1',
  ]);
  assert.deepEqual(
    directory.data.items.map((r) => r.values),
    [{ title: 'one' }, { title: 'two' }],
  );
  await call(b, [
    'views',
    'revise',
    '--id',
    'comparison',
    '--expected-revision',
    '1',
    '--title',
    '修改指标',
    '--visibility',
    'public',
    '--definition',
    JSON.stringify({ ...definition, orderBy: [{ field: 'weighted', direction: 'asc' }] }),
  ]);
  await call(c, ['views', 'query', '--id', 'comparison', '--expected-revision', '1'], 1);
  const history = await call(b, ['views', 'history', '--id', 'comparison']);
  assert.equal(history.data.total, 2);
  await call(b, ['views', 'disable', '--id', 'comparison', '--expected-revision', '2']);
  await call(c, ['views', 'query', '--id', 'comparison', '--expected-revision', '3'], 1);
  await call(a, [
    'registers',
    'configure',
    '--id',
    'notes',
    '--expected-revision',
    '2',
    '--visibility',
    'private',
  ]);
  await call(c, ['views', 'read', '--id', 'directory'], 1);
  assert.deepEqual(runtime.state.world, worldBefore);
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
    capability: 'M02-resident-record-views',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    cliCalls: results.length,
    results,
    independentAuthors: true,
    twoResidentDefinedUses: true,
    sourceAclRechecked: true,
    wholeInputAggregate: 13,
    worldUnchanged: true,
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
