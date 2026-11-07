// Directed CLI acceptance only. Temporary world; never call this a free social outcome.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { startResidentServer, loadResidentCredentials } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'independent-periodic-cli-'));
const manifest = createOpenSocietyManifest({
  count: 2,
  societyKernel: true,
  publicGovernance: false,
});
let runtime = new OpenSocietyRuntime(root, manifest);
const before = structuredClone(runtime.state.world);
const originalManifest = readFileSync(join(root, 'manifest.json'));
runtime.close();
let server;
const results = [];
try {
  const activate = () =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
        'enable-periodic-access',
        '--root',
        root,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
  const activation = activate();
  assert.equal(activation.status, 0, activation.stdout + activation.stderr);
  const activatedBytes = readFileSync(join(root, 'journal.jsonl'));
  assert.equal(activate().status, 0);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), activatedBytes);
  runtime = new OpenSocietyRuntime(root);
  const { periodicAccess, periodicObligations, ...rest } = runtime.state.world;
  assert.deepEqual(rest, before);
  assert.equal(periodicAccess.version, 'independent-periodic-access-v1');
  assert.deepEqual(periodicObligations.contracts, {});
  const [a, b] = manifest.residents.map((r) => r.id);
  const credentials = loadResidentCredentials(root, [a, b]);
  server = await startResidentServer(runtime, credentials);
  const call = async (actor, route, args = {}, expected = 0) => {
    runtime.beginTurn(actor);
    const argv = [
      ...route.split('.'),
      ...Object.entries(args).flatMap(([key, value]) => [
        '--' + key,
        typeof value === 'object' ? JSON.stringify(value) : String(value),
      ]),
      '--request-id',
      `periodic-cli-${results.length}`,
    ];
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../dist/town.js', import.meta.url)), ...argv],
        {
          env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: credentials.residents[actor] },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let stdout = '',
        stderr = '';
      child.stdout.on('data', (b) => {
        stdout += b;
      });
      child.stderr.on('data', (b) => {
        stderr += b;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    runtime.finishTurn(actor, { summary: 'Directed independent periodic CLI acceptance' });
    assert.equal(outcome.code, expected, outcome.stdout + outcome.stderr);
    const value = JSON.parse(outcome.stdout);
    results.push({ route, ok: value.ok, error: value.error ?? null });
    return value.data;
  };
  const terms = {
    type: 'offer',
    id: 'promise',
    title: '有限付款',
    terms: '测试双方独立同意',
    payer: { sector: 'agent', id: a },
    revenue: { sector: 'agent', id: b },
    amount: 1,
    firstDueAt: 60000,
    periodMs: 60000,
    periods: 2,
    acceptBy: 1000,
  };
  const prepared = await call(a, 'obligations.prepare', { command: terms });
  await call(a, 'principals.operate', { request: prepared.request });
  const read = await call(b, 'obligations.read', { id: 'promise' });
  await call(a, 'principals.operate', { request: read.operations.accept }, 1);
  await call(b, 'principals.operate', { request: read.operations.accept });
  await call(
    a,
    'obligations.prepare',
    {
      command: {
        ...terms,
        id: 'public-forgery',
        revenue: { sector: 'treasury', id: 'public-treasury' },
      },
    },
    1,
  );
  const balances = Object.fromEntries(
    Object.entries(runtime.state.world.agents).map(([id, r]) => [id, r.balance]),
  );
  assert.equal(runtime.advanceTime(60000, 'engineering-due-boundary').ok, true);
  assert.ok(Math.abs(runtime.state.world.agents[a].balance - (balances[a] - 1)) < 1e-9);
  assert.ok(Math.abs(runtime.state.world.agents[b].balance - (balances[b] + 1)) < 1e-9);
  const final = await call(b, 'obligations.read', { id: 'promise' });
  assert.equal(final.installments.items[0].status, 'paid');
  assert.equal(runtime.state.world.publicGovernance, undefined);
  assert.equal(runtime.state.world.moneySupply, before.moneySupply);
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  server = undefined;
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), originalManifest);
  console.log(
    JSON.stringify(
      {
        ok: true,
        version: 'independent-periodic-cli-v1',
        results,
        publicAuthorityAbsent: true,
        actualPayment: 1,
        replayMatched: true,
        manifestUnchanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (server) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
