// Explicit integration acceptance, using the real compiled CLI and identity-bound HTTP adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-mobility-cli-'));
const runtime = new OpenSocietyRuntime(
  root,
  createOpenSocietyManifest({ count: 4, continuity: true, initialization: 'newcomers' }),
);
const [a, b, c, d] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c, d]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let ordinal = 0,
  serverClosed = false;
const call = async (actor, argv, expected = 0) => {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `life-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit CLI acceptance' });
  assert.equal(result.code, expected, `${argv.join(' ')}\n${result.out}\n${result.err}`);
  return JSON.parse(result.out);
};
try {
  const initial = {
    supply: runtime.state.world.moneySupply,
    a: runtime.state.world.agents[a].balance,
    b: runtime.state.world.agents[b].balance,
  };
  await call(c, ['drivers', 'register', '--vehicle-id', 'seed-car-1'], 1);
  await call(a, ['drivers', 'register', '--vehicle-id', 'seed-car-1']);
  await call(a, ['drivers', 'online']);
  await call(b, [
    'rides',
    'request',
    '--id',
    'trip',
    '--destination-id',
    'school',
    '--expires-at',
    '3600000',
  ]);
  await call(a, ['rides', 'list', '--scope', 'open']);
  await call(a, [
    'rides',
    'quote',
    '--id',
    'quote',
    '--ride-id',
    'trip',
    '--fare',
    '10',
    '--expires-at',
    '3500000',
  ]);
  const quotes = await call(b, ['rides', 'quotes', '--id', 'trip']);
  assert.equal(quotes.data.items[0].fare, 10);
  await call(b, [
    'rides',
    'book',
    '--id',
    'trip',
    '--quote-id',
    'quote',
    '--expected-revision',
    '1',
  ]);
  assert.equal(runtime.state.world.agents[b].balance, initial.b - 10);
  await call(b, ['deposits', 'settle', '--id', 'ride-deposit-trip', '--expected-revision', '1'], 1);
  await call(a, ['rides', 'pickup', '--id', 'trip', '--expected-revision', '2']);
  await call(b, ['rides', 'board', '--id', 'trip', '--expected-revision', '3']);
  const driver = runtime.state.world.transitByAgent[a],
    rider = runtime.state.world.transitByAgent[b];
  assert.equal(driver.arrivesAt, rider.arrivesAt);
  assert.deepEqual(driver.routeLocationIds, rider.routeLocationIds);
  assert.equal(
    runtime.advanceTime(driver.arrivesAt - runtime.state.world.clock.now, 'arrival').ok,
    true,
  );
  const completed = await call(b, ['rides', 'read', '--id', 'trip']);
  assert.equal(completed.data.status, 'completed');
  assert.equal(runtime.state.world.agents[a].locationId, 'school');
  assert.equal(runtime.state.world.agents[b].locationId, 'school');
  assert.equal(runtime.state.world.agents[a].balance, initial.a + 10);
  assert.equal(runtime.state.world.agents[b].balance, initial.b - 10);
  assert.equal(runtime.state.world.residentCommerce.deposits['ride-deposit-trip'].held, 0);
  const deadline = String(runtime.state.world.clock.now + 3600000);
  await call(b, [
    'rides',
    'request',
    '--id',
    'return',
    '--destination-id',
    'town-square',
    '--expires-at',
    deadline,
  ]);
  await call(a, [
    'rides',
    'quote',
    '--id',
    'return-quote',
    '--ride-id',
    'return',
    '--fare',
    '12',
    '--expires-at',
    deadline,
  ]);
  await call(b, [
    'rides',
    'book',
    '--id',
    'return',
    '--quote-id',
    'return-quote',
    '--expected-revision',
    '1',
  ]);
  await call(a, ['rides', 'cancel', '--id', 'return', '--expected-revision', '2']);
  assert.equal(runtime.state.world.agents[b].balance, initial.b - 10);
  assert.equal(
    runtime.state.world.residentCommerce.deposits['ride-deposit-return'].status,
    'returned',
  );
  assert.equal(runtime.state.world.moneySupply, initial.supply);
  const before = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'), 'utf8');
  await server.close();
  serverClosed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, before);
    assert.equal(readFileSync(join(root, 'journal.jsonl'), 'utf8'), journal);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      commands: ordinal,
      policy: 'resident-mobility-v1',
      checks: [
        'compiled-cli',
        'identity-bound-authorization',
        'voluntary-quotation',
        'escrow-bypass-rejected',
        'actual-shared-travel',
        'arrival-settlement',
        'predeparture-refund',
        'money-supply-conserved',
        'exact-journal-replay',
      ],
    }),
  );
} finally {
  if (!serverClosed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
