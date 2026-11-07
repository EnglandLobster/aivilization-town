// Explicit engineering acceptance: collectively controlled information resources, not spontaneous emergence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-material-production-cli-'));
const manifest = createOpenSocietyManifest({ count: 4, continuity: true });
const locationId = Object.values(manifest.initialWorld.locations).find(
  (l) => l.kind === 'production',
).locationId;
// Explicit engineering seed; no claim that these initial materials were manufactured.
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld: {
    ...manifest.initialWorld,
    agents: Object.fromEntries(
      Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId,
          inventory: { ...a.inventory, Wood: 2 },
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  },
});
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
      [executable, ...argv, '--request-id', `material-cli-${++ordinal}`],
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
  await call(a, ['rules', 'read', '--id', 'material-production']);
  await call(a, ['production', 'recipes', '--limit', '5']);
  await call(a, [
    'stocks',
    'create',
    '--id',
    's',
    '--title',
    '实物保管记录',
    '--location-id',
    locationId,
  ]);
  await call(a, [
    'stocks',
    'deposit',
    '--id',
    's',
    '--expected-revision',
    '1',
    '--items',
    '{"Wood":2}',
  ]);
  await call(d, ['stocks', 'read', '--id', 's'], 1);
  await call(b, [
    'collectives',
    'create',
    '--id',
    'club',
    '--configuration',
    JSON.stringify({
      title: '自己选择用途',
      terms: '具体动作共同决定',
      members: [b, c],
      voters: [b, c],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    }),
    '--expires-at',
    String(now + 10000000),
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
  const stock = () => runtime.state.world.materials.stocks.s,
    job = () => runtime.state.world.materials.productions.j;
  await call(a, [
    'stocks',
    'offer',
    '--id',
    's',
    '--expected-revision',
    String(stock().revision),
    '--expected-control-version',
    String(stock().control.version),
    '--target-kind',
    'collective',
    '--target-id',
    'club',
    '--expires-at',
    String(now + 10000000),
    '--terms',
    '接收真实物品及义务',
  ]);
  let dn = 0;
  async function decision(capability, resourceId, args, executor = b, preflightActor) {
    const id = `d${++dn}`,
      time = runtime.state.world.clock.now;
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
      '精确批准',
      '--action',
      JSON.stringify({ kind: 'resource', capability, resourceId, arguments: args }),
      '--closes-at',
      String(time + 10000),
      '--execute-before',
      String(time + 1000000),
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
    const argv = [
      'collectives',
      'execute',
      '--id',
      id,
      '--expected-revision',
      String(runtime.state.collectives.decisions[id].revision),
    ];
    if (preflightActor) {
      await call(preflightActor, argv, 1);
      assert.equal(runtime.state.collectives.decisions[id].status, 'passed');
    }
    await call(executor, argv);
    assert.equal(runtime.state.collectives.decisions[id].status, 'executed');
  }
  await decision('stocks.accept', 's', {
    expectedRevision: stock().revision,
    expectedControlVersion: stock().control.version,
  });
  await call(
    a,
    [
      'stocks',
      'withdraw',
      '--id',
      's',
      '--expected-revision',
      String(stock().revision),
      '--recipient-id',
      a,
      '--items',
      '{"Wood":1}',
    ],
    1,
  );
  await decision('production.create', 'j', {
    stockId: 's',
    expectedRevision: stock().revision,
    recipeId: 'book',
    quantity: 1,
    productName: '居民自选作品名',
    description: '原话不是品质认证',
    workers: [a, b],
  });
  assert.equal(stock().inventory.Wood, 1);
  assert.equal(job().held.Wood, 1);
  assert.equal(stock().inventory.Book, undefined);
  const half = job().recipe.workMs / 2;
  await call(a, [
    'production',
    'start',
    '--id',
    'j',
    '--expected-revision',
    String(job().revision),
    '--until',
    String(runtime.state.world.clock.now + half),
  ]);
  assert.equal(runtime.advanceTime(half, 'material-cli-half').ok, true);
  await call(a, ['production', 'read', '--id', 'j']);
  assert.equal(job().completed, 0);
  assert.equal(job().progressMs, half);
  assert.equal(job().lastStop.reason, 'shift-ended');
  await call(b, [
    'production',
    'start',
    '--id',
    'j',
    '--expected-revision',
    String(job().revision),
    '--until',
    String(runtime.state.world.clock.now + half),
  ]);
  assert.equal(runtime.advanceTime(half, 'material-cli-finish').ok, true);
  await call(b, ['stocks', 'read', '--id', 's']);
  assert.equal(job().status, 'completed');
  assert.deepEqual(job().held, {});
  assert.equal(stock().inventory.Book, 1);
  await decision(
    'stocks.withdraw',
    's',
    { expectedRevision: stock().revision, recipientId: c, items: { Book: 1 } },
    c,
    b,
  );
  assert.equal(
    runtime.state.world.agents[c].inventory.Book,
    (manifest.initialWorld.agents[c].inventory.Book ?? 0) + 1,
  );
  await call(b, ['stocks', 'ledger', '--id', 's', '--limit', '10']);
  await decision('stocks.offer', 's', {
    expectedRevision: stock().revision,
    expectedControlVersion: stock().control.version,
    targetKind: 'resident',
    targetId: a,
    expiresAt: runtime.state.world.clock.now + 100000,
    terms: '接管余料',
  });
  await call(a, [
    'stocks',
    'accept',
    '--id',
    's',
    '--expected-revision',
    String(stock().revision),
    '--expected-control-version',
    String(stock().control.version),
  ]);
  await call(a, ['stocks', 'settle', '--id', 's', '--expected-revision', String(stock().revision)]);
  await call(
    a,
    ['stocks', 'close', '--id', 's', '--expected-revision', String(stock().revision)],
    1,
  );
  await call(a, [
    'stocks',
    'withdraw',
    '--id',
    's',
    '--expected-revision',
    String(stock().revision),
    '--recipient-id',
    a,
    '--items',
    '{"Wood":1}',
  ]);
  await call(a, ['stocks', 'close', '--id', 's', '--expected-revision', String(stock().revision)]);
  assert.deepEqual(stock().inventory, {});
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
    capability: 'W01-M06-M09-material-production-foundation',
    mode: 'real-compiled-cli-engineering-acceptance',
    modelInvoked: false,
    explicitTestSeed: {
      residents: 4,
      woodPerResident: 2,
      colocatedAtExistingProductionLocation: true,
    },
    cliCalls: results.length,
    results,
    realMaterialReservation: true,
    noOutputBeforeWork: true,
    independentWorkerSuccession: true,
    actualEffortAndRegisteredConversion: true,
    collectiveRecipientBound: true,
    failedExecutionKeepsDecision: true,
    independentHandoverAndSettlement: true,
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
