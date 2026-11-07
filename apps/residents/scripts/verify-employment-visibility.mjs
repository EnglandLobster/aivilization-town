// Directed authenticated query acceptance; no free social outcome claim.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { startResidentServer, loadResidentCredentials } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'employment-visibility-cli-'));
const manifest = createOpenSocietyManifest({
  count: 2,
  continuity: true,
  publicGovernance: true,
  publicEmployment: true,
});
let runtime = new OpenSocietyRuntime(root, manifest),
  server;
const results = [];
try {
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
      `employment-visibility-${results.length}`,
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
    runtime.finishTurn(actor, { summary: 'Directed employment visibility CLI acceptance' });
    assert.equal(outcome.code, expected, outcome.stdout + outcome.stderr);
    const value = JSON.parse(outcome.stdout);
    results.push({ route, ok: value.ok, error: value.error ?? null });
    return value.data;
  };

  const rules = await call(a, 'governance.employment');
  assert.equal(rules.applicationsWith, 'town governance employment --section applications');
  await call(a, 'business.apply-job', { 'occupation-name': 'Cleaner' });
  const before = structuredClone(runtime.state.world);
  const own = await call(a, 'governance.employment', { section: 'applications', limit: 1 });
  assert.equal(own.applications.total, 1);
  assert.equal(own.applications.items[0].agentId, a);
  assert.equal(own.applications.items[0].occupationName, 'Cleaner');
  assert.equal(own.applications.items[0].status, 'pending');
  assert.deepEqual(
    (await call(b, 'governance.employment', { section: 'applications' })).applications.items,
    [],
  );
  assert.deepEqual(
    (await call(a, 'governance.employment', { section: 'applications', offset: 1 })).applications
      .items,
    [],
  );
  await call(a, 'governance.employment', { section: 'applications', revision: 1 }, 1);
  assert.deepEqual(runtime.state.world, before);
  const state = structuredClone(runtime.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  await server.close();
  server = undefined;
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, state);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  console.log(
    JSON.stringify({
      ok: true,
      calls: results.length,
      expectedRefusals: results.filter((r) => !r.ok).length,
      ownRecordedPending: true,
      otherPrivate: true,
      queryWorldUnchanged: true,
      replayEqual: true,
    }),
  );
} finally {
  if (server) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
