// Explicit integration acceptance, using the real compiled CLI and identity-bound HTTP adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-life-cli-'));
const runtime = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 3 }));
const [a, b, c] = runtime.manifest.residents.map((r) => r.id);
const credentials = loadResidentCredentials(root, [a, b, c]);
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
  await call(a, ['groups', 'create', '--id', 'group', '--title', '原文小组']);
  const invite = (await call(a, ['groups', 'invite', '--group-id', 'group', '--resident-id', b]))
    .data;
  await call(c, ['groups', 'accept', '--id', invite.id, '--expected-revision', '1'], 1);
  await call(b, ['groups', 'accept', '--id', invite.id, '--expected-revision', '1']);
  await call(a, ['groups', 'send', '--group-id', 'group', '--content', '原话\n完整保留']);
  assert.equal(
    (await call(b, ['groups', 'messages', '--group-id', 'group'])).data.items[0].content,
    '原话\n完整保留',
  );
  await call(a, [
    'proposals',
    'create',
    '--id',
    'proposal',
    '--participants',
    b,
    '--terms',
    '共同协商原文',
    '--expires-at',
    '100000',
  ]);
  await call(b, [
    'proposals',
    'respond',
    '--id',
    'proposal',
    '--expected-revision',
    '1',
    '--accept',
    'true',
  ]);
  await call(b, [
    'commitments',
    'declare',
    '--id',
    'proposal',
    '--kind',
    'fulfilled',
    '--content',
    '我的履行声明',
  ]);
  assert.equal(runtime.state.collaboration.proposals.proposal.status, 'accepted');
  const supply = runtime.state.world.moneySupply;
  await call(a, [
    'offers',
    'publish',
    '--id',
    'offer',
    '--kind',
    'service',
    '--commodity',
    'service',
    '--description',
    '原始服务承诺',
    '--unit-price',
    '4',
    '--max-quantity',
    '1',
  ]);
  await call(b, [
    'orders',
    'create',
    '--id',
    'order',
    '--offer-id',
    'offer',
    '--offer-revision',
    '1',
    '--quantity',
    '1',
  ]);
  await call(a, ['orders', 'accept', '--id', 'order', '--expected-revision', '1']);
  await call(b, ['orders', 'pay', '--id', 'order', '--expected-revision', '2']);
  await call(a, [
    'orders',
    'deliver',
    '--id',
    'order',
    '--expected-revision',
    '3',
    '--content',
    '我的交付声明',
  ]);
  await call(b, ['orders', 'confirm', '--id', 'order', '--expected-revision', '4']);
  await call(a, ['orders', 'refund', '--id', 'order', '--expected-revision', '5', '--amount', '1']);
  await call(a, [
    'payments',
    'request',
    '--id',
    'split',
    '--payers',
    b,
    '--payers',
    c,
    '--amount-each',
    '1',
    '--description',
    '均摊',
  ]);
  await call(b, ['payments', 'pay', '--id', 'split', '--expected-revision', '1']);
  await call(c, ['payments', 'pay', '--id', 'split', '--expected-revision', '2']);
  await call(b, [
    'deposits',
    'lock',
    '--id',
    'deposit',
    '--beneficiary-id',
    a,
    '--amount',
    '2',
    '--purpose',
    '押金',
  ]);
  await call(a, ['deposits', 'release', '--id', 'deposit', '--expected-revision', '1']);
  assert.equal(runtime.state.world.moneySupply, supply);
  await call(a, [
    'services',
    'publish',
    '--id',
    'event',
    '--kind',
    'event',
    '--location-id',
    'town-square',
    '--title',
    '活动',
    '--description',
    '活动原文',
    '--capacity',
    '1',
  ]);
  await call(a, [
    'services',
    'schedule',
    '--id',
    'slot',
    '--service-id',
    'event',
    '--start',
    '0',
    '--end',
    '1000',
    '--capacity',
    '1',
  ]);
  await call(b, ['queues', 'join', '--id', 'queue', '--service-id', 'event']);
  await call(a, [
    'queues',
    'call',
    '--id',
    'queue',
    '--slot-id',
    'slot',
    '--booking-id',
    'booking',
  ]);
  await call(b, ['bookings', 'check-in', '--id', 'booking', '--expected-revision', '1']);
  runtime.advanceTime(1000, 'attendance-complete');
  assert.equal(runtime.state.services.bookings.booking.status, 'completed');
  await call(a, [
    'households',
    'propose',
    '--id',
    'family',
    '--partner-id',
    b,
    '--kind',
    'family',
    '--terms',
    '双方确认原文',
  ]);
  await call(b, ['households', 'accept', '--id', 'family', '--expected-revision', '1']);
  await call(b, [
    'care',
    'request',
    '--id',
    'care',
    '--provider-id',
    a,
    '--location-id',
    'town-square',
    '--description',
    '照护请求',
    '--duration-ms',
    '1000',
  ]);
  await call(a, ['care', 'accept', '--id', 'care', '--expected-revision', '1']);
  await call(a, ['care', 'start', '--id', 'care', '--expected-revision', '2']);
  runtime.advanceTime(1000, 'care-complete');
  assert.equal(runtime.state.life.care.tasks.care.status, 'completed');
  await call(b, [
    'health',
    'record',
    '--id',
    'private-note',
    '--patient-id',
    b,
    '--kind',
    'note',
    '--content',
    '仅患者授权的原文',
  ]);
  await call(c, ['health', 'records', '--patient-id', b], 1);
  await call(b, ['health', 'grant', '--target-id', a]);
  assert.equal(
    (await call(a, ['health', 'records', '--patient-id', b])).data.items[0].content,
    '仅患者授权的原文',
  );
  await call(b, ['health', 'revoke', '--target-id', a]);
  await call(a, ['health', 'records', '--patient-id', b], 1);
  await call(a, ['civic', 'petition', '--topic', '公共议题', '--statement', '原始请愿']);
  assert.ok(Object.keys(runtime.state.world.petitions).length);
  const before = structuredClone(runtime.state),
    journal = readFileSync(join(root, 'journal.jsonl'), 'utf8');
  await server.close();
  serverClosed = true;
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  assert.deepEqual(replay.state, before);
  assert.equal(readFileSync(join(root, 'journal.jsonl'), 'utf8'), journal);
  replay.close();
  console.log(
    JSON.stringify({
      passed: true,
      commands: ordinal,
      checks: [
        'compiled-cli',
        'identity',
        'group-consent',
        'versioned-proposal',
        'raw-group-text',
        'escrow-order',
        'partial-refund',
        'independent-split-payments',
        'deposit',
        'queue-capacity',
        'real-attendance',
        'family-consent',
        'real-care-time',
        'medical-acl-revocation',
        'canonical-petition',
        'money-supply',
        'exact-replay',
      ],
    }),
  );
} finally {
  if (!serverClosed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
