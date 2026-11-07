// Explicit transport acceptance, separate from free Agent evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-rest-cli-'));
const runtime = new OpenSocietyRuntime(
  root,
  createOpenSocietyManifest({ count: 2, continuity: true }),
);
const [a, b] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b]);
const server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url));
let ordinal = 0,
  refused = 0,
  serverClosed = false;
async function call(actor, argv, expected = 0) {
  runtime.beginTurn(actor);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [executable, ...argv, '--request-id', `rest-cli-${++ordinal}`],
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
  runtime.finishTurn(actor, { summary: 'Explicit elapsed-rest CLI acceptance' });
  assert.equal(result.code, expected, `${argv.join(' ')}\n${result.out}\n${result.err}`);
  if (expected) refused++;
  return JSON.parse(result.out);
}
try {
  assert.equal(runtime.enableElapsedRest().ok, true);
  assert.equal(runtime.advanceTime(3600000, 'awake-hour').ok, true);
  const before = runtime.state.world.agents[a].physiology.energy;
  const start = await call(a, ['life', 'sleep', '--duration-seconds', '3600']);
  assert.equal(runtime.state.world.agents[a].physiology.energy, before);
  assert.equal(start.data.activity.settlementTiming, 'effects-during-activity');
  const initial = (await call(a, ['city', 'observe', '--view', 'action'])).data.rest.active;
  assert.equal((await call(b, ['city', 'observe', '--view', 'action'])).data.rest.active, null);
  assert.equal(
    (
      await call(
        b,
        ['life', 'wake', '--id', initial.id, '--expected-revision', String(initial.revision)],
        1,
      )
    ).error,
    'own-rest-required',
  );
  await call(a, ['life', 'sleep', '--duration-seconds', '60'], 1);
  assert.equal(runtime.advanceTime(120000, 'partial-sleep').ok, true);
  const partial = (await call(a, ['city', 'observe', '--view', 'action'])).data.rest.active;
  assert.equal(partial.elapsedMs, 120000);
  assert.ok(runtime.state.world.agents[a].physiology.energy > before);
  assert.equal(
    (
      await call(
        a,
        ['life', 'wake', '--id', initial.id, '--expected-revision', String(initial.revision)],
        1,
      )
    ).error,
    'rest-revision-conflict',
  );
  await call(a, [
    'life',
    'wake',
    '--id',
    partial.id,
    '--expected-revision',
    String(partial.revision),
  ]);
  const stopped = (await call(a, ['city', 'observe', '--view', 'action'])).data;
  assert.equal(stopped.rest.active, null);
  assert.equal(stopped.activity.availableAt, runtime.state.world.clock.now);
  const energy = runtime.state.world.agents[a].physiology.energy;
  assert.equal(runtime.advanceTime(60000, 'awake-again').ok, true);
  assert.ok(runtime.state.world.agents[a].physiology.energy < energy);
  await call(a, ['life', 'sleep', '--duration-seconds', '125']);
  assert.equal(runtime.advanceTime(180000, 'off-grid-completion').ok, true);
  assert.equal((await call(a, ['city', 'observe', '--view', 'action'])).data.rest.active, null);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  serverClosed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  try {
    assert.deepEqual(replay.state, state);
    assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  } finally {
    replay.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      commands: ordinal,
      expectedRefusals: refused,
      checks: [
        'identity-bound-real-cli',
        'no-prepaid-recovery',
        'private-own-progress',
        'elapsed-recovery',
        'busy-body',
        'own-current-consent',
        'cancel-future-recovery',
        'exact-off-grid-completion',
        'durable-exact-replay',
      ],
    }),
  );
} finally {
  if (!serverClosed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
