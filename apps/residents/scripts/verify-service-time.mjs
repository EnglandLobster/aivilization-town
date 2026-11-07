// Directed service/body integration verification, not autonomous service organization.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

const declaredFacilities = process.argv.includes('--declared-facilities');
const root = mkdtempSync(join(tmpdir(), 'service-time-cli-'));
const manifest = createOpenSocietyManifest({
  count: 3,
  continuity: true,
  elapsedRest: true,
  serviceTime: true,
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
        physiology: { energy: 100, satiety: 100, health: declaredFacilities ? 50 : 100 },
      },
    ]),
  ),
};
let runtime = new OpenSocietyRuntime(root, {
  ...manifest,
  initialWorld,
  worldPolicies: serializableWorldPolicy(manifest.seed, initialWorld, manifest.rhythm),
});
if (declaredFacilities) {
  const declaration = [
    {
      locationId: 'town-square',
      careStations: 1,
      teachingStations: 0,
      sourceId: 'directed-new-care-station',
    },
  ];
  const before = structuredClone(runtime.state);
  runtime.close();
  const admin = (value) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/cli.js', import.meta.url)),
        'register-service-facilities',
        '--root',
        root,
        '--args',
        JSON.stringify(value),
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
  const rejected = admin([{ ...declaration[0], careStations: 36 }]);
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).ok, false);
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, before);
  runtime.close();
  const accepted = admin(declaration);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).ok, true);
  const bytes = readFileSync(join(root, 'journal.jsonl'));
  assert.equal(admin(declaration).status, 0);
  assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
  runtime = new OpenSocietyRuntime(root);
}
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
      [executable, ...argv, '--request-id', `service-body-cli-${++n}`],
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
  runtime.finishTurn(actor, { summary: 'Directed actual service/body CLI verification' });
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
const engagement = () => runtime.state.world.serviceEngagements.engagements.service;
const operation = (actor, action, more = [], code = 0) =>
  call(
    actor,
    [
      'engagements',
      action,
      '--id',
      'service',
      '--expected-revision',
      String(engagement().revision),
      ...more,
    ],
    code,
  );
try {
  const models = await call(owner, ['engagements', 'models']);
  assert.equal(models.data.actualBody.policyVersion, 'resident-service-time-v1');
  const providerBalance = runtime.state.world.agents[owner].balance,
    recipientBalance = runtime.state.world.agents[worker].balance;
  await call(owner, [
    'engagements',
    'offer',
    '--id',
    'service',
    '--controller-kind',
    'resident',
    '--controller-id',
    owner,
    '--title',
    'Actual resident service',
    '--terms',
    'Measured presence and effects; not employment wages',
    '--location-id',
    'town-square',
    '--provider-id',
    owner,
    '--recipient-id',
    worker,
    '--payer-sector',
    'agent',
    '--payer-id',
    worker,
    '--revenue-sector',
    'agent',
    '--revenue-id',
    owner,
    '--provider-share-bps',
    '5000',
    '--price-per-hour',
    '36',
    '--model-id',
    declaredFacilities ? 'supportive-care-v1' : 'personal-assistance-v1',
    '--max-duration-ms',
    '3600000',
    '--start-at',
    '0',
    '--end-at',
    '7200000',
  ]);
  await operation(worker, 'fund', [], 1);
  await operation(worker, 'accept');
  await operation(worker, 'fund');
  await operation(owner, 'start', ['--until', '3600000']);
  assert.equal(runtime.advanceTime(60000, 'waiting').ok, true);
  assert.equal(engagement().progressMs, 0);
  await call(owner, ['life', 'sleep', '--duration-seconds', '60'], 1);
  await operation(worker, 'start', ['--until', '3600000']);
  assert.equal(runtime.advanceTime(900000, 'real-service').ok, true);
  await call(owner, ['engagements', 'read', '--id', 'service']);
  await call(other, ['engagements', 'read', '--id', 'service'], 1);
  assert.equal(engagement().progressMs, 900000);
  if (declaredFacilities) assert.ok(runtime.state.world.agents[worker].physiology.health > 50);
  assert.equal(engagement().charged, 9);
  assert.equal(engagement().providerPaid, 4.5);
  assert.equal(engagement().revenuePaid, 4.5);
  const stale = engagement().revision;
  await operation(worker, 'leave');
  await call(
    worker,
    ['engagements', 'leave', '--id', 'service', '--expected-revision', String(stale)],
    1,
  );
  await call(worker, ['engagements', 'read', '--id', 'service']);
  assert.equal(engagement().refunded, 27);
  assert.equal(runtime.state.world.activityTimeByAgent[owner].availableAt, 960000);
  assert.ok(Math.abs(runtime.state.world.agents[owner].balance - providerBalance - 9) < 1e-8);
  assert.ok(Math.abs(runtime.state.world.agents[worker].balance - recipientBalance + 9) < 1e-8);
  assert.equal(runtime.advanceTime(60000, 'after-ending').ok, true);
  assert.equal(engagement().progressMs, 900000);
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
        declaredFacilities,
        evidenceKind: 'directed-compiled-http-cli-not-free-emergence',
        calls: results.length,
        expectedRefusals: results.filter((r) => !r.ok).length,
        results,
        independentPresence: true,
        waitingHasNoServiceCharge: true,
        actualBodyAndFeesTogether: true,
        oneBodyReservation: true,
        unusedFeesRefunded: true,
        privateRead: true,
        replayEqual: true,
        journalBytesUnchanged: true,
        serviceEmploymentStillPending: true,
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
