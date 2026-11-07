// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'housing-choice-cli-'));
const m = createOpenSocietyManifest({ count: 3, continuity: true, elapsedRest: true });
const [a, b, c] = m.residents.map((r) => r.id);
const runtime = new OpenSocietyRuntime(root, {
  ...m,
  initialWorld: {
    ...m.initialWorld,
    agents: {
      ...m.initialWorld.agents,
      [a]: { ...m.initialWorld.agents[a], residentialTier: 3, upkeepArrears: 17 },
    },
  },
});
const credentials = loadResidentCredentials(root, [a, b, c]),
  server = await startResidentServer(runtime, credentials);
const executable = fileURLToPath(new URL('../dist/town.js', import.meta.url)),
  results = [];
let ordinal = 0,
  closed = false;
async function cmd(actor, route, args = {}, expectedCode = 0, requestId) {
  const argv = [
      ...route.split('.'),
      ...Object.entries(args).flatMap(([key, value]) => {
        const flag = '--' + key.replace(/[A-Z]/g, (s) => '-' + s.toLowerCase());
        if (Array.isArray(value)) return value.flatMap((v) => [flag, String(v)]);
        return [flag, typeof value === 'object' ? JSON.stringify(value) : String(value)];
      }),
    ],
    id = requestId ?? `housing-choice-cli-${++ordinal}`;
  runtime.beginTurn(actor);
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
  runtime.finishTurn(actor, { summary: 'Explicit housing choice CLI acceptance' });
  assert.equal(result.code, expectedCode, `${route}: ${result.out} ${result.err}`);
  const parsed = JSON.parse(result.out);
  results.push({
    route,
    exitCode: result.code,
    ok: parsed.ok,
    ...(parsed.error ? { error: parsed.error } : {}),
  });
  return parsed;
}

try {
  const original = readFileSync(join(root, 'manifest.json'));
  await cmd(a, 'housing.standard', {}, 1);
  assert.equal(runtime.enableHousingChoice().ok, true);
  const first = (await cmd(a, 'housing.standard', { limit: 1 })).data;
  assert.equal(first.personalStandard, 3);
  assert.equal(first.standards.items.length, 1);
  assert.equal(first.standards.total, 6);
  await cmd(a, 'life.sleep', { durationSeconds: 3600 });
  const rest = runtime.context(a).action.rest.active;
  await cmd(a, 'housing.lower', { targetTier: 1, expectedRevision: 1 }, 1);
  await cmd(a, 'life.wake', { id: rest.id, expectedRevision: rest.revision });
  const before = structuredClone(runtime.state.world);
  await cmd(b, 'housing.lower', { actorId: a, targetTier: 1, expectedRevision: 1 }, 2);
  await cmd(a, 'housing.lower', { targetTier: 1, expectedRevision: 1 });
  assert.deepEqual(runtime.state.world.agents[a], { ...before.agents[a], residentialTier: 1 });
  assert.deepEqual(runtime.state.world.locations, before.locations);
  assert.equal(runtime.state.world.moneySupply, before.moneySupply);
  assert.equal(runtime.state.world.agents[a].upkeepArrears, 17);
  await cmd(a, 'housing.lower', { targetTier: 1, expectedRevision: 1 }, 1);
  await cmd(a, 'housing.lower', { targetTier: 2, expectedRevision: 2 }, 1);
  const after = (await cmd(a, 'housing.standard')).data;
  assert.equal(after.revision, 2);
  assert.equal(after.personalStandard, 1);
  assert.ok(after.currentUpkeepRatePerHour < first.currentUpkeepRatePerHour);
  assert.deepEqual(readFileSync(join(root, 'manifest.json')), original);
  const state = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  runtime.close();
  closed = true;
  const replay = new OpenSocietyRuntime(root);
  assert.deepEqual(replay.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
  replay.close();
  console.log(
    JSON.stringify(
      {
        ok: true,
        validation: 'compiled-authenticated-HTTP-CLI-not-emergence',
        calls: results.length,
        refusals: results.filter((r) => !r.ok).length,
        results,
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
