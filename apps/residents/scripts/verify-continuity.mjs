// Explicit integration acceptance, using the real compiled CLI and identity-bound HTTP adapter.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = mkdtempSync(join(tmpdir(), 'resident-continuity-cli-'));
const runtime = new OpenSocietyRuntime(
  root,
  createOpenSocietyManifest({ count: 3, continuity: true, initialization: 'newcomers' }),
);
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
  const reminderId = 'x'.repeat(96);
  const reminder = (
    await call(a, ['schedule', 'remind', '--id', reminderId, '--at', '10000', '--text', '可以取消'])
  ).data;
  await call(b, ['schedule', 'remind', '--id', reminderId, '--at', '10000', '--text', '独立提醒']);
  await call(b, ['schedule', 'cancel', '--id', reminder.id], 1);
  await call(a, ['schedule', 'cancel', '--id', reminder.id]);
  assert.equal(runtime.state.reminders[`${b}:${reminderId}`].done, false);
  await call(b, ['schedule', 'cancel', '--id', reminderId]);
  assert.equal((await call(a, ['schedule', 'list'])).data.items[0].done, true);
  const ownIdea = [
    'cognition',
    'update',
    '--key',
    'new-idea',
    '--kind',
    'goal',
    '--statement',
    '自主的新想法，不假称有证据',
    '--confidence',
    '0.5',
    '--expected-revision',
    '0',
    '--active',
    'true',
  ];
  await call(a, [...ownIdea, '--evidence-ids', ''], 1);
  assert.deepEqual((await call(a, ownIdea)).data.evidenceIds, []);
  await call(a, ['groups', 'create', '--id', 'g', '--title', '自由讨论']);
  const invitation = (await call(a, ['groups', 'invite', '--group-id', 'g', '--resident-id', b]))
    .data;
  await call(b, ['groups', 'accept', '--id', invitation.id, '--expected-revision', '1']);
  const sent = (
    await call(b, ['groups', 'send', '--group-id', 'g', '--content', '我的原话，允许不认同。'])
  ).data;
  const cite = [
    'cognition',
    'update',
    '--key',
    'receipt',
    '--kind',
    'note',
    '--statement',
    '这是一条已发生的发言，不代表他人同意',
    '--confidence',
    '0.8',
    '--evidence-ids',
    sent.id,
    '--expected-revision',
    '0',
    '--active',
    'true',
  ];
  await call(b, cite);
  assert.equal((await call(b, ['memory', 'search', '--source-id', sent.id])).data.total, 1);
  assert.equal((await call(a, cite, 1)).error, 'evidence-not-visible');
  assert.equal((await call(c, cite, 1)).error, 'evidence-not-visible');
  const message = (await call(a, ['groups', 'messages', '--group-id', 'g', '--limit', '1'])).data
    .items[0];
  await call(a, cite);
  const memories = (
    await call(a, ['memory', 'search', '--person-id', b, '--source-id', message.id])
  ).data;
  assert.equal(memories.total, 1);
  await call(a, ['groups', 'messages', '--group-id', 'g', '--limit', '1']);
  assert.equal((await call(a, ['memory', 'search', '--source-id', message.id])).data.total, 1);
  assert.equal(
    runtime.context(a).lifeInbox.sections.find((s) => s.section === 'messages').total,
    0,
  );
  await call(a, [
    'cognition',
    'update',
    '--key',
    'own-goal',
    '--kind',
    'goal',
    '--statement',
    '我可以独处，也可以改变主意',
    '--confidence',
    '0.5',
    '--expected-revision',
    '0',
    '--active',
    'true',
    '--pinned',
    'true',
  ]);
  await call(a, ['schedule', 'configure', '--free-activity-interval-ms', '7200000']);
  assert.equal(runtime.state.residents[a].nextWakeAt - runtime.state.world.clock.now, 7200000);
  const supply = runtime.state.world.moneySupply;
  await call(a, [
    'offers',
    'publish',
    '--id',
    'f',
    '--kind',
    'service',
    '--commodity',
    'service',
    '--description',
    '远程写作',
    '--unit-price',
    '10',
    '--max-quantity',
    '1',
    '--delivery-mode',
    'remote',
  ]);
  await call(b, [
    'orders',
    'create',
    '--id',
    'o',
    '--offer-id',
    'f',
    '--offer-revision',
    '1',
    '--quantity',
    '1',
  ]);
  const order = async (actor, operation, extra = [], expected = 0) =>
    call(
      actor,
      [
        'orders',
        operation,
        '--id',
        'o',
        '--expected-revision',
        String(runtime.state.world.residentCommerce.orders.o.revision),
        ...extra,
      ],
      expected,
    );
  await order(a, 'accept');
  await order(b, 'pay');
  await order(a, 'deliver', ['--content', '原始交付作品']);
  await order(b, 'dispute', ['--content', '希望部分退款']);
  await order(a, 'refund', ['--amount', '2']);
  await order(a, 'propose-settlement', ['--amount', '0', '--content', '已退2元，剩余8元结算']);
  await order(a, 'respond-settlement', ['--accept', 'true'], 1);
  await order(c, 'respond-settlement', ['--accept', 'true'], 1);
  await order(b, 'respond-settlement', ['--accept', 'true']);
  assert.equal(runtime.state.world.residentCommerce.orders.o.status, 'settled');
  assert.equal(runtime.state.world.residentCommerce.orders.o.escrow, 0);
  assert.equal(runtime.state.world.moneySupply, supply);
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
      checks: [
        'compiled-cli',
        'original-reading',
        'own-sent-message-is-firsthand-evidence',
        'unread-member-and-outsider-cannot-cite-message',
        'exact-page-receipts',
        'search-by-person-source',
        'personal-pin',
        'self-chosen-interval',
        'receipt-reminder-id-cancels-own-only',
        'legacy-local-reminder-id-preserved',
        'empty-array-omission-is-not-empty-string-evidence',
        'remote-service',
        'independent-settlement-consent',
        'escrow-conservation',
        'actual-provider-time',
        'voluntary-early-departure',
        'exact-replay',
      ],
    }),
  );
} finally {
  if (!serverClosed) await server.close();
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
