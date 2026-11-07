// Directed public labor transport verification, not autonomous institution evidence.
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

const root = mkdtempSync(join(tmpdir(), 'public-labor-cli-'));
const manifest = createOpenSocietyManifest({
  count: 2,
  continuity: true,
  elapsedRest: true,
  elapsedLabor: true,
  publicLabor: true,
  initialization: 'newcomers',
});
const [worker, other] = manifest.residents.map((r) => r.id);
const initialWorld = {
  ...manifest.initialWorld,
  agents: Object.fromEntries(
    Object.entries(manifest.initialWorld.agents).map(([id, a]) => [
      id,
      {
        ...a,
        locationId: 'workshop',
        job: 'Cleaner',
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
const credentials = loadResidentCredentials(root, [worker, other]);
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
      [executable, ...argv, '--request-id', `public-labor-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed public labor CLI verification' });
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
const session = () =>
  Object.values(runtime.state.world.publicLabor.process.sessions).find((s) => s.actorId === worker);
try {
  const before = structuredClone(runtime.state.world);
  await call(worker, ['city', 'observe', '--view', 'rules', '--section', 'labor']);
  await call(
    worker,
    ['business', 'work', '--occupation-name', 'Cashier', '--labor-seconds', '3600'],
    1,
  );
  await call(worker, [
    'business',
    'work',
    '--occupation-name',
    'Cleaner',
    '--labor-seconds',
    '3600',
  ]);
  assert.equal(session().earnedMicros, 0);
  assert.equal(runtime.state.world.agents[worker].balance, before.agents[worker].balance);
  assert.deepEqual(runtime.state.world.agents[worker].physiology, before.agents[worker].physiology);
  assert.ok(runtime.state.world.treasury < before.treasury);
  await call(other, ['city', 'observe', '--view', 'labor', '--section', session().id], 1);
  await call(
    other,
    ['life', 'stop-work', '--id', session().id, '--expected-revision', String(session().revision)],
    1,
  );
  assert.equal(runtime.advanceTime(600000, 'actual-public-work').ok, true);
  assert.equal(session().elapsedMs, 600000);
  assert.ok(session().earnedMicros > 0);
  assert.equal(session().earnedMicros, session().paidMicros);
  await call(worker, ['city', 'observe', '--view', 'labor']);
  const details = await call(worker, [
    'city',
    'observe',
    '--view',
    'labor',
    '--section',
    session().id,
  ]);
  assert.equal(details.data.source.kind, 'initial-public-employment-regime');
  assert.ok(details.data.protectedGrossRemaining > 0);
  await call(worker, ['life', 'stop-work', '--id', session().id, '--expected-revision', '1'], 1);
  await call(worker, [
    'life',
    'stop-work',
    '--id',
    session().id,
    '--expected-revision',
    String(session().revision),
  ]);
  assert.equal(session().status, 'interrupted');
  assert.equal(session().paidMicros + session().refundedMicros, session().terms.grossMicros);
  await call(
    worker,
    [
      'business',
      'claim-wage',
      '--id',
      session().id,
      '--expected-revision',
      String(session().revision),
    ],
    1,
  );
  const own = await call(worker, ['city', 'observe', '--view', 'labor', '--section', session().id]);
  assert.equal(own.data.protectedGrossRemaining, 0);
  assert.equal(runtime.state.world.moneySupply, before.moneySupply);
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
        fundedBeforeStart: true,
        noFutureWageOrEffort: true,
        actualPublicWages: true,
        ownRecordPrivacy: true,
        unearnedRefund: true,
        noDoubleClaim: true,
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
