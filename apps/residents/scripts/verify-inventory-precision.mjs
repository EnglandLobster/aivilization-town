// Directed regression from actual free-world fractional food failure; not autonomous evidence.
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

const root = mkdtempSync(join(tmpdir(), 'inventory-precision-cli-'));
const manifest = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  initialization: 'newcomers',
});
const [owner, worker, other] = manifest.residents.map((r) => r.id);
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
      id,
      {
        ...a,
        locationId: 'town-square',
        job: null,
        inventory: { ...a.inventory, 'Apple Pie': id === owner ? 1 : 0 },
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
      [executable, ...argv, '--request-id', `inventory-precision-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed inventory precision CLI verification' });
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
  const give = (to, quantity) =>
    call(owner, [
      'market',
      'give',
      '--target-agent-id',
      to,
      '--commodity-name',
      'Apple Pie',
      '--quantity',
      String(quantity),
    ]);
  await give(worker, 0.4);
  await give(other, 0.4);
  const remainder = runtime.state.world.agents[owner].inventory['Apple Pie'];
  assert.equal(remainder, 0.19999999999999996);
  await call(owner, ['life', 'eat', '--commodity-name', 'Apple Pie', '--quantity', '0.2']);
  assert.equal(runtime.state.world.agents[owner].inventory['Apple Pie'], undefined);
  await call(
    owner,
    ['life', 'eat', '--commodity-name', 'Apple Pie', '--quantity', '0.000001'],
    1,
  );
  assert.equal(runtime.state.world.agents[worker].inventory['Apple Pie'], 0.4);
  assert.equal(runtime.state.world.agents[other].inventory['Apple Pie'], 0.4);
  const record = runtime.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .find((e) => e.type === 'InventoryChanged' && e.payload.quantityResolution);
  assert.equal(record.payload.delta, -remainder);
  assert.equal(record.payload.quantityResolution.requested, 0.2);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const reopened = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(reopened.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  } finally {
    reopened.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        results,
        actualRemainder: remainder,
        strictReplayPreserved: true,
        replayEqual: true,
        journalBytesUnchanged: true,
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
