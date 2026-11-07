// Explicit isolated cutover activation, not resident consent or emergence evidence.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/agreed-labor-verification.json',
);
let runtime = new OpenSocietyRuntime(root);
assert.ok(runtime.manifest.canonicalPolicyContinuation);
const before = structuredClone(runtime.state);
runtime.close();
const manifest = readFileSync(join(root, 'manifest.json'));
const activate = () =>
  spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', 'enable-agreed-labor', '--root', root],
    { encoding: 'utf8', timeout: 30000 },
  );
const result = activate();
assert.equal(result.status, 0, result.stderr + result.stdout);
assert.equal(JSON.parse(result.stdout).ok, true);
runtime = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(runtime.state);
  assert.equal(
    after.world.residentLabor.configuration.compensationSource,
    'accepted-enterprise-labor-terms-v1',
  );
  assert.equal(after.world.residentLabor.configuration.pay, undefined);
  assert.deepEqual(after.world.residentLabor.process.sessions, {});
  for (const field of [
    'agents',
    'moneySupply',
    'treasury',
    'clock',
    'transitByAgent',
    'activityTimeByAgent',
    'materials',
  ])
    assert.deepEqual(after.world[field], before.world[field]);
  for (const [id, e] of Object.entries(after.world.enterprises)) {
    assert.deepEqual(e.laborTerms, before.world.enterprises[id].laborTerms);
    assert.equal(e.balance, before.world.enterprises[id].balance);
  }
} finally {
  runtime.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
assert.equal(activate().status, 0);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
runtime = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(runtime.state, after);
} finally {
  runtime.close();
}
const report = {
  passed: true,
  previousRevision: before.revision,
  revision: after.revision,
  activation: JSON.parse(result.stdout),
  originalManifestUnchanged: true,
  noResidentConsentInvented: true,
  noMoneyBodyTimeOrGoodsChanged: true,
  replayMatched: true,
  retryCreatedNoCommits: true,
  limitations: [
    'Only enterprise mutual terms enabled; no initial-job wage period invented.',
    'No resident offer, acceptance or work performed by activation.',
    'Existing elapsed-labor mode transition and full original-mode integration remain incomplete.',
    'Not emergence evidence.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
