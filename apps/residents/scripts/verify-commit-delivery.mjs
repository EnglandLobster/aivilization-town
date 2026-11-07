// Actual HTTP + compiled operator process. Engineering recovery evidence, not an Agent emergence run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createIntegratedSocietyManifest,
  OpenSocietyRuntime,
  SocietyCommitReplica,
} from '@aivilization/worker';
import { loadResidentCredentials, startResidentServer } from '../dist/index.js';
const root = resolve(process.argv[2] ?? '.local/open-residents/commit-delivery-acceptance');
assert.equal(existsSync(root), false, 'use-fresh-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const sourceRoot = join(root, 'authority'),
  replicaRoot = join(root, 'replica');
const manifest = createIntegratedSocietyManifest({ count: 2 });
const source = new OpenSocietyRuntime(sourceRoot, manifest);
const actor = manifest.residents[0].id;
source.beginTurn(actor);
for (const [name, args, requestId] of [
  [
    'spaces.create',
    { id: 'notes', title: '本人记录', visibility: 'private', posting: 'owner' },
    'space',
  ],
  [
    'files.create',
    { spaceId: 'notes', path: 'original.md', content: '本人原文，不是自动扣款许可' },
    'file',
  ],
  ['world.deposit', { amount: 11 }, 'deposit'],
]) {
  const result = source.invoke(actor, { name, arguments: args, requestId });
  assert.equal(result.ok, true, result.error);
}
const credentials = loadResidentCredentials(
  sourceRoot,
  manifest.residents.map((r) => r.id),
);
const server = await startResidentServer(source, credentials);
const cli = resolve('apps/residents/dist/cli.js');
async function run(args) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    const timeout = globalThis.setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      globalThis.clearTimeout(timeout);
      done({ code, signal, out, err });
    });
  });
}
try {
  const childPath = join(root, 'receiver.txt');
  writeFileSync(
    childPath,
    `import {syncSocietyReplica} from ${JSON.stringify(pathToFileURL(resolve('apps/residents/dist/index.js')).href)};\nimport {readFileSync} from 'node:fs';\nawait syncSocietyReplica({root:${JSON.stringify(replicaRoot)},endpoint:${JSON.stringify(server.url)},token:JSON.parse(readFileSync(${JSON.stringify(join(sourceRoot, 'credentials.json'))},'utf8')).admin,maxPages:1});\nconsole.log('durable');setInterval(()=>{},1000);\n`,
    { mode: 0o600 },
  );
  const killed = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.end(readFileSync(childPath));
    let out = '',
      err = '';
    const timeout = globalThis.setTimeout(() => child.kill('SIGKILL'), 30000);
    child.stdout.on('data', (b) => {
      out += b;
      if (out.includes('durable')) child.kill('SIGKILL');
    });
    child.stderr.on('data', (b) => (err += b));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      globalThis.clearTimeout(timeout);
      done({ code, signal, out, err });
    });
  });
  assert.equal(killed.signal, 'SIGKILL');
  assert.match(killed.out, /durable/);
  const bytes = readFileSync(join(replicaRoot, 'journal.jsonl'));
  const args = [
    cli,
    'replicate',
    '--root',
    replicaRoot,
    '--source',
    server.url,
    '--source-credentials',
    join(sourceRoot, 'credentials.json'),
  ];
  const resumed = await run(args);
  assert.equal(resumed.code, 0, resumed.err);
  assert.equal(JSON.parse(resumed.out).status, 'caught-up');
  assert.deepEqual(readFileSync(join(replicaRoot, 'journal.jsonl')), bytes);
  assert.equal(source.advanceTime(60000, 'advance').ok, true);
  const appended = await run(args);
  assert.equal(appended.code, 0, appended.err);
  const replica = new SocietyCommitReplica(replicaRoot);
  try {
    assert.deepEqual(replica.state, source.state);
    assert.equal(replica.state.world.bank.balance, manifest.initialWorld.bank.balance + 11);
    assert.equal(replica.state.world.moneySupply, source.state.world.moneySupply);
  } finally {
    replica.close();
  }
  assert.throws(() => new OpenSocietyRuntime(replicaRoot), /replica-cannot-own-authority/);
  const denied = await globalThis.fetch(server.url + '/admin/replication/manifest', {
    headers: { authorization: `Bearer ${credentials.residents[actor]}` },
  });
  assert.equal(denied.status, 403);
  const report = {
    passed: true,
    evidenceClass: 'scripted-real-process-not-emergence',
    lostAcknowledgement: 'receiver-killed-after-durable-return-no-cursor-saved',
    signal: killed.signal,
    restartFromDurableCursor: true,
    retryJournalUnchanged: true,
    completeStateEqual: true,
    originalDepositOnce: true,
    residentFeedDenied: true,
    replicaCannotOwnAuthority: true,
  };
  writeFileSync(join(root, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  await server.close();
  source.close();
}
