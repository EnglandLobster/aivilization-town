// Run after `pnpm --filter @aivilization/residents... build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { OpenSocietyRuntime, createOpenSocietyManifest } from '@aivilization/worker';
import {
  loadResidentCredentials,
  startResidentServer,
  prepareResidentShell,
} from '../dist/index.js';

const root = mkdtempSync(join(tmpdir(), 'resident-cli-subprocess-'));
const runtime = new OpenSocietyRuntime(join(root, 'town'), createOpenSocietyManifest({ count: 2 }));
const [a, b] = runtime.manifest.residents.map((resident) => resident.id);
const credentials = loadResidentCredentials(join(root, 'town'), [a, b]);
const server = await startResidentServer(runtime, credentials);
const connection = { endpoint: server.url, token: credentials.residents[a] };
const shell = prepareResidentShell(root, connection);
const cli = fileURLToPath(new URL('../dist/town.js', import.meta.url));
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
const execute = (file, argv, input, token = connection.token) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, argv, {
      env: { TOWN_ENDPOINT: server.url, TOWN_RESIDENT_TOKEN: token },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
try {
  runtime.beginTurn(a);
  runtime.beginTurn(b);
  const entry = await execute(shell, ['-c', 'town wiki']);
  assert.equal(entry.code, 0);
  assert.match(entry.stdout, /capabilities.md/);
  const follow = await execute(
    shell,
    ['-c', `town subscriptions follow --kind author --target-id ${a}`],
    undefined,
    credentials.residents[b],
  );
  assert.equal(follow.code, 0, follow.stdout + follow.stderr);
  const original = "  原文\n$HOME $(touch /tmp/never-run) `whoami` ; && <script> ' \\n 尾部  ";
  const publish = `town apps publish --channel shops --title '计划' --content ${quote(original)} --request-id subprocess-post`;
  const posted = await execute(shell, ['-c', publish]);
  assert.equal(posted.code, 0, posted.stderr + posted.stdout);
  const revision = runtime.state.revision;
  assert.equal((await execute(shell, ['-c', publish])).stdout, posted.stdout);
  assert.equal(runtime.state.revision, revision);
  const document = Object.values(runtime.state.information.documents).find(
    (doc) => doc.authorId === a,
  );
  assert.equal(document.content, original);
  const read = await execute(
    shell,
    ['-c', `town apps read --channel shops --path ${quote(document.path)}`],
    undefined,
    credentials.residents[b],
  );
  assert.equal(read.code, 0);
  assert.equal(JSON.parse(read.stdout).data.content, original);
  const notifications = await execute(
    shell,
    ['-c', 'town notifications list'],
    undefined,
    credentials.residents[b],
  );
  const notification = JSON.parse(notifications.stdout).data.items[0];
  assert.equal(notification.publisherId, a);
  const acknowledged = await execute(
    shell,
    ['-c', `town notifications read --id ${notification.id}`],
    undefined,
    credentials.residents[b],
  );
  assert.equal(JSON.parse(acknowledged.stdout).data.original.content, original);
  assert.equal(JSON.parse(acknowledged.stdout).data.read, true);
  const shared = await execute(
    shell,
    ['-c', `town feed share --document-id ${quote(document.id)} --revision 1 --comment '转发原话'`],
    undefined,
    credentials.residents[b],
  );
  assert.equal(shared.code, 0, shared.stdout + shared.stderr);
  assert.equal(JSON.parse(shared.stdout).data.original.content, original);
  assert.equal(JSON.parse(shared.stdout).data.comment, '转发原话');
  const stdin = await execute(
    process.execPath,
    [
      cli,
      'files',
      'create',
      '--space-id',
      'app-community',
      '--path',
      'posts/stdin.md',
      '--content-stdin',
    ],
    original,
  );
  assert.equal(stdin.code, 0, stdin.stderr + stdin.stdout);
  assert.equal(
    runtime.state.information.documents['app-community/posts/stdin.md'].content,
    original,
  );
  const deniedEdit = await execute(
    shell,
    [
      '-c',
      `town files update --space-id app-shops --path ${quote(document.path)} --expected-revision 1 --content 'forged'`,
    ],
    undefined,
    credentials.residents[b],
  );
  assert.equal(deniedEdit.code, 1);
  const canary = join(root, 'escaped');
  for (const command of [
    `town context; touch ${canary}`,
    `town context > ${canary}`,
    'cat /etc/passwd',
    `town files create --content "$(touch ${canary})"`,
    'TOWN_RESIDENT_TOKEN=other town context',
  ])
    assert.equal((await execute(shell, ['-c', command])).code, 2);
  assert.equal(existsSync(canary), false);
  const rejected = await execute(shell, ['-c', 'town bank borrow --amount NaN']);
  assert.equal(rejected.code, 2);
  const deposit = await execute(shell, [
    '-c',
    'town bank deposit --amount 10 --request-id deposit-once',
  ]);
  assert.equal(deposit.code, 0, deposit.stdout + deposit.stderr);
  assert.equal(runtime.state.world.agents[a].balance, 90);
  assert.equal(runtime.state.world.moneySupply, runtime.manifest.initialWorld.moneySupply);
  assert.equal(
    (await execute(shell, ['-c', 'town bank deposit --amount 10 --request-id deposit-once']))
      .stdout,
    deposit.stdout,
  );
  const move = await execute(shell, ['-c', 'town travel go --target-location-id restaurant']);
  assert.equal(move.code, 0, move.stdout + move.stderr);
  assert.ok(runtime.state.world.transitByAgent[a]);
  assert.equal((await execute(shell, ['-c', 'town context'], undefined, 'invalid')).code, 2);
  const state = structuredClone(runtime.state);
  const journal = readFileSync(join(root, 'town', 'journal.jsonl'), 'utf8');
  await server.close();
  runtime.close();
  const replay = new OpenSocietyRuntime(join(root, 'town'));
  assert.deepEqual(replay.state, state);
  assert.equal(readFileSync(join(root, 'town', 'journal.jsonl'), 'utf8'), journal);
  replay.close();
  process.stdout.write(
    JSON.stringify({
      passed: true,
      checks: [
        'real-cli-process',
        'restricted-shell',
        'skill-entry',
        'subscription-notification-share',
        'original-text',
        'stdin',
        'identity',
        'idempotency',
        'owner-revision',
        'balanced-deposit',
        'travel',
        'exact-replay',
      ],
    }) + '\n',
  );
} finally {
  await server.close().catch(() => {});
  runtime.close();
  rmSync(root, { recursive: true, force: true });
}
