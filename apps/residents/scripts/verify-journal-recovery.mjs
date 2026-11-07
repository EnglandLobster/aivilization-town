// Offline operator recovery with a real killed writer; no mutation of an existing experiment.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createOpenSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/open-residents/journal-recovery-acceptance');
if (existsSync(join(root, 'manifest.json'))) throw Error('use-fresh-acceptance-directory');
mkdirSync(root, { recursive: true, mode: 0o700 });
const r = new OpenSocietyRuntime(root, createOpenSocietyManifest({ count: 2 }));
const a = r.manifest.residents[0].id;
r.beginTurn(a);
const request = { name: 'world.deposit', arguments: { amount: 9 }, requestId: 'original-deposit' };
const receipt = r.invoke(a, request);
assert.equal(receipt.ok, true);
const doc = r.invoke(a, {
  name: 'cognition.update',
  requestId: 'original-thought',
  arguments: {
    key: 'aim',
    kind: 'goal',
    statement: '保留原始认知与已发生存款',
    confidence: 1,
    evidenceIds: [],
    expectedRevision: 0,
    active: true,
  },
});
assert.equal(doc.ok, true, doc.error);
const expected = structuredClone(r.state);
r.close();
const journal = join(root, 'journal.jsonl'),
  manifest = readFileSync(join(root, 'manifest.json'));
const prefix = readFileSync(journal);
const worker = new URL('../../worker/dist/index.js', import.meta.url).href;
const child = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
import { OpenSocietyRuntime } from ${JSON.stringify(worker)};
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
new OpenSocietyRuntime(process.argv[1]);
appendFileSync(join(process.argv[1], 'journal.jsonl'), '{"worldEvents":[{"type":"unfinished');
process.kill(process.pid, 'SIGKILL');
`,
    root,
  ],
  { encoding: 'utf8', timeout: 30000 },
);
assert.equal(child.signal, 'SIGKILL', child.stderr);
const original = readFileSync(journal);
assert.ok(original.length > prefix.length);
assert.throws(() => new OpenSocietyRuntime(root), /truncated-open-society-journal/);
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function recover() {
  const result = spawnSync(process.execPath, [cli, 'recover-journal', '--root', root], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const report = recover();
assert.equal(report.action, 'removed-incomplete-tail');
assert.deepEqual(readFileSync(report.backupPath), original);
assert.deepEqual(readFileSync(journal), prefix);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
const reopened = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(reopened.state, expected);
  assert.deepEqual(reopened.invoke(a, request), receipt);
  assert.deepEqual(reopened.state, expected);
  assert.deepEqual(readFileSync(journal), prefix);
} finally {
  reopened.close();
}
assert.equal(recover().action, 'unchanged');
const verification = {
  passed: true,
  mode: 'killed-writer-and-compiled-operator-CLI-not-emergence',
  killedSignal: child.signal,
  report,
  fullStateReplayEqual: true,
  requestRetryUnchanged: true,
  manifestUnchanged: true,
};
writeFileSync(join(root, 'verification.json'), JSON.stringify(verification, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(verification, null, 2));
