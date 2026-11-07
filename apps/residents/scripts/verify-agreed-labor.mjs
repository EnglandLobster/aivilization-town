// Directed real transport verification, not evidence of an autonomously founded enterprise.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
  OpenSocietyRuntime,
  createOpenSocietyManifest,
  serializableWorldPolicy,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'productive-employment-cli-'));
const manifest = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  elapsedLabor: false,
  initialization: 'newcomers',
});
const initialWorld = {
  ...manifest.initialWorld,
  // Explicit test scenario capital for later recapitalization; not a resident money-creation operation.
  moneySupply: manifest.initialWorld.moneySupply + 900,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
      id,
      {
        ...a,
        balance: a.balance + (id === manifest.residents[0].id ? 900 : 0),
        inventory: { ...a.inventory, Wood: 10 },
        locationId: 'workshop',
        job: null,
        physiology: { energy: 100, satiety: 100, health: 100 },
      },
    ]),
  ),
};
const runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
assert.equal(runtime.enableAgreedLabor().ok, true);
const [owner, worker, other] = manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [owner, worker, other]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let n = 0,
  closed = false;
const results = [];
async function call(actor, argv, expected = 0) {
  runtime.beginTurn(actor);
  const r = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `labor-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed actual enterprise labor CLI verification' });
  assert.equal(r.code, expected, `${argv.join(' ')}: ${r.out} ${r.err}`);
  const value = JSON.parse(r.out);
  results.push({
    route: argv.slice(0, 2).join(' '),
    ok: value.ok,
    exitCode: r.code,
    ...(value.error ? { error: value.error } : {}),
  });
  return value;
}
try {
  await call(owner, [
    'business',
    'found',
    '--enterprise-id',
    'firm',
    '--name',
    'Resident choice',
    '--occupation-name',
    'Maker',
    '--initial-capital',
    '100',
    '--max-employees',
    '3',
  ]);
  await call(owner, [
    'business',
    'post-job',
    '--enterprise-id',
    'firm',
    '--wage-offer',
    '7',
    '--open-slots',
    '3',
  ]);
  await call(worker, ['business', 'join', '--enterprise-id', 'firm']);
  const offer = [
    'business',
    'change-labor-terms',
    '--enterprise-id',
    'firm',
    '--operation',
    'offer',
    '--id',
    'hourly',
    '--employee-id',
    worker,
    '--wage-micros',
    '60000000',
    '--reference-ms',
    '3600000',
    '--valid-until',
    '86400000',
  ];
  await call(other, offer, 1);
  await call(owner, offer);
  await call(other, ['business', 'labor-terms', '--enterprise-id', 'firm', '--id', 'hourly'], 1);
  const accept = [
    'business',
    'change-labor-terms',
    '--enterprise-id',
    'firm',
    '--operation',
    'accept',
    '--id',
    'hourly',
    '--expected-revision',
    '1',
  ];
  await call(owner, accept, 1);
  await call(worker, accept);
  const read = await call(worker, [
    'business',
    'labor-terms',
    '--enterprise-id',
    'firm',
    '--id',
    'hourly',
  ]);
  assert.equal(read.data.ownCurrent.wageMicros, 60000000);
  const money = runtime.state.world.moneySupply;
  await call(worker, ['business', 'work', '--occupation-name', 'Maker', '--labor-seconds', '600']);
  const id = runtime.state.world.residentLabor.process.activeByActor[worker];
  assert.equal(runtime.state.world.enterprises.firm.earnedPayroll.claims[id].earnedMicros, 0);
  assert.equal(runtime.advanceTime(300000, 'actual-half-work').ok, true);
  const revision = runtime.state.world.residentLabor.process.sessions[id].revision;
  await call(worker, ['life', 'stop-work', '--id', id, '--expected-revision', String(revision)]);
  assert.equal(runtime.state.world.enterprises.firm.earnedPayroll.claims[id].earnedMicros, 5000000);
  assert.equal(runtime.state.world.moneySupply, money);
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  } finally {
    reopened.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        results,
        earnedMicros: 5000000,
        replayEqual: true,
        moneySupplyConserved: true,
      },
      null,
      2,
    ),
  );
} finally {
  if (!closed) {
    await server.close();
    runtime.close();
  }
  rmSync(root, { recursive: true, force: true });
}
