// Real compiled CLI/HTTP engineering acceptance. No model or spontaneous organization is claimed.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'public-housing-cli-'));
const m = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  publicGovernance: true,
  housingChoice: true,
});
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
    id = requestId ?? `public-housing-cli-${++ordinal}`;
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
  runtime.finishTurn(actor, { summary: 'Explicit public housing CLI acceptance' });
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
  await cmd(a, 'governance.housing', {}, 1);
  const before = structuredClone(runtime.state.world);
  assert.equal(runtime.enablePublicHousing().ok, true);
  assert.deepEqual(runtime.state.world.agents, before.agents);
  const first = (await cmd(a, 'governance.housing', { limit: 2 })).data;
  assert.equal(first.standards.items.length, 2);
  const second = (await cmd(b, 'governance.housing', { offset: 2, limit: 20 })).data;
  const terms = {
    ...first.terms,
    landValueCoefficientPerHour: 0,
    standards: [...first.standards.items, ...second.standards.items].map((s) => ({
      ...s,
      upkeepPerHour: 1,
    })),
  };
  const rev = (id) => runtime.state.world.publicGovernance.authority.proposals[id].revision;
  await cmd(
    a,
    'governance.propose',
    {
      id: 'invalid',
      text: 'Invalid debt writeoff',
      expectedProcedureRevision: 1,
      closesAt: 60000,
      action: { kind: 'set-housing', expectedRevision: 1, terms: { ...terms, upkeepArrears: 0 } },
    },
    1,
  );
  for (const id of ['tariff', 'stale']) {
    await cmd(a, 'governance.propose', {
      id,
      text: 'Directed public tariff proposal',
      expectedProcedureRevision: 1,
      closesAt: 60000,
      action: { kind: 'set-housing', expectedRevision: 1, terms },
    });
    await cmd(a, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
    await cmd(b, 'governance.vote', { id, expectedRevision: rev(id), choice: 'yes' });
  }
  await cmd(c, 'governance.execute', { id: 'tariff', expectedRevision: rev('tariff') }, 1);
  assert.equal(runtime.advanceTime(60000, 'deadline').ok, true);
  for (const id of ['tariff', 'stale'])
    await cmd(c, 'governance.close', { id, expectedRevision: rev(id) });
  const atExecution = structuredClone(runtime.state.world);
  await cmd(c, 'governance.execute', { id: 'tariff', expectedRevision: rev('tariff') });
  assert.deepEqual(runtime.state.world.agents, atExecution.agents);
  assert.deepEqual(runtime.state.world.locations, atExecution.locations);
  await cmd(c, 'governance.execute', { id: 'stale', expectedRevision: rev('stale') }, 1);
  const current = (await cmd(a, 'governance.housing')).data;
  assert.equal(current.revision, 2);
  assert.equal(current.source.actorId, c);
  const own = (await cmd(a, 'housing.standard')).data;
  assert.equal(own.publicHousingRevision, 2);
  assert.equal(own.currentUpkeepRatePerHour, 1);
  assert.equal(own.upkeepArrears, 17);
  await cmd(
    b,
    'governance.vote',
    { id: 'tariff', expectedRevision: rev('tariff'), choice: 'yes', actorId: a },
    2,
  );
  const historical = (await cmd(a, 'governance.housing', { revision: 1 })).data;
  assert.equal(historical.source.kind, 'inherited-scenario');
  assert.equal(runtime.advanceTime(3600000, 'new-tariff').ok, true);
  assert.ok(
    Math.abs(runtime.state.world.agents[a].balance - (atExecution.agents[a].balance - 1)) < 1e-8,
  );
  assert.equal(runtime.state.world.agents[a].upkeepArrears, 17);
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
