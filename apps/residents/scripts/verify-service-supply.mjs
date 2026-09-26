// Explicit integration acceptance, using the real compiled CLI and identity-bound HTTP adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-supply-cli-'));
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
  await call(a, [
    'business',
    'found',
    '--enterprise-id',
    'firm',
    '--name',
    '自主合作',
    '--occupation-name',
    'Cleaner',
    '--initial-capital',
    '100',
    '--max-employees',
    '3',
  ]);
  await call(a, [
    'business',
    'post-job',
    '--enterprise-id',
    'firm',
    '--wage-offer',
    '100',
    '--open-slots',
    '3',
  ]);
  await call(b, ['business', 'join', '--enterprise-id', 'firm']);
  await call(a, [
    'services',
    'publish',
    '--id',
    'svc',
    '--kind',
    'course',
    '--location-id',
    'town-square',
    '--title',
    '交流',
    '--description',
    '自主参与',
    '--capacity',
    '3',
    '--units-per-provider',
    '1',
    '--enterprise-id',
    'firm',
  ]);
  await call(a, [
    'services',
    'schedule',
    '--id',
    'slot',
    '--service-id',
    'svc',
    '--start',
    '1000',
    '--end',
    '10000',
    '--capacity',
    '3',
  ]);
  for (const [actor, id] of [
    [c, 'one'],
    [d, 'two'],
  ]) {
    await call(actor, ['bookings', 'request', '--id', id, '--slot-id', 'slot', '--units', '1']);
    await call(a, ['bookings', 'accept', '--id', id, '--expected-revision', '1']);
  }
  const economicState = () => ({
    moneySupply: runtime.state.world.moneySupply,
    residents: Object.values(runtime.state.world.agents).map((r) => ({
      id: r.agentId,
      balance: r.balance,
      inventory: r.inventory,
    })),
    enterprise: runtime.state.world.enterprises.firm,
  });
  const economicBefore = structuredClone(economicState());
  assert.equal(runtime.advanceTime(1000, 'tick').ok, true);
  await call(c, ['services', 'start', '--id', 'slot', '--expected-revision', '1'], 1);
  await call(b, ['services', 'start', '--id', 'slot', '--expected-revision', '1']);
  await call(c, ['bookings', 'check-in', '--id', 'one', '--expected-revision', '2']);
  const refused = await call(
    d,
    ['bookings', 'check-in', '--id', 'two', '--expected-revision', '2'],
    1,
  );
  assert.equal(refused.error, 'insufficient-provider-capacity');
  const read = await call(d, ['services', 'read', '--id', 'svc']);
  assert.equal(read.data.slots.items[0].supply.capacity, 1);
  assert.equal(read.data.slots.items[0].supply.available, 0);
  assert.equal(runtime.advanceTime(1000, 'tick2').ok, true);
  await call(a, ['services', 'stop', '--id', 'slot', '--expected-revision', '2'], 1);
  await call(b, ['services', 'stop', '--id', 'slot', '--expected-revision', '2']);
  const booking = await call(c, ['bookings', 'read', '--id', 'one']);
  assert.equal(booking.data.endReason, 'staffing-interrupted');
  assert.equal(booking.data.attendedMs, 1000);
  assert.equal(runtime.state.world.activityTimeByAgent[b].availableAt, 2000);
  assert.equal(runtime.state.world.activityTimeByAgent[c].availableAt, 2000);
  await call(
    a,
    ['courses', 'assess', '--id', 'not-teacher', '--booking-id', 'one', '--content', '我未授课'],
    1,
  );
  await call(b, [
    'courses',
    'assess',
    '--id',
    'teacher',
    '--booking-id',
    'one',
    '--content',
    '交流提前结束，这是我的观察',
  ]);
  const memories = await call(c, ['memory', 'search', '--source-id', 'one']);
  assert.ok(memories.data.items.some((e) => e.summary.includes('staffing-interrupted')));
  assert.deepEqual(economicState(), economicBefore);
  const before = structuredClone(runtime.state);
  const journal = readFileSync(join(root, 'journal.jsonl'), 'utf8');
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
      policy: runtime.manifest.servicesPolicy.version,
      checks: [
        'compiled-cli',
        'actual-enterprise-membership',
        'independent-provider-start',
        'whole-interval-staffing',
        'personal-stop-authorization',
        'atomic-interruption',
        'actual-teacher-assessment',
        'unchanged-money-and-inventory',
        'exact-replay',
      ],
    }),
  );
} finally {
  if (!serverClosed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
