import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/independent-services-verification.json',
);
let r = new OpenSocietyRuntime(root);
const before = structuredClone(r.state);
assert.ok(r.manifest.canonicalPolicyContinuation);
r.close();
const manifest = readFileSync(join(root, 'manifest.json'));
const call = () =>
  spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', 'enable-independent-society-services', '--root', root],
    { encoding: 'utf8', timeout: 30000 },
  );
const first = call();
assert.equal(first.status, 0, first.stderr);
const activation = JSON.parse(first.stdout);
assert.equal(activation.status, 'enabled');
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  assert.deepEqual(after.world, before.world);
  assert.equal(after.services.principalPolicy.version, 'resident-service-principals-v3');
  assert.deepEqual(after.services, {
    ...before.services,
    principalPolicy: {
      ...before.services.principalPolicy,
      version: 'resident-service-principals-v3',
    },
  });
} finally {
  r.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
assert.equal(call().status, 0);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
r = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(r.state, after);
} finally {
  r.close();
}
const result = {
  passed: true,
  root,
  activation,
  previousRevision: before.revision,
  revision: after.revision,
  worldAndPublicGrantsUnchanged: true,
  originalManifestUnchanged: true,
  serviceAgreementsUnchanged: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  scope: 'operator-transition-not-emergence',
};
writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
