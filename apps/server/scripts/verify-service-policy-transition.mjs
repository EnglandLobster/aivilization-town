import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/services-verification.json',
);
let r = new OpenSocietyRuntime(root);
const before = structuredClone(r.state);
assert.ok(r.manifest.canonicalPolicyContinuation);
r.close();
const manifest = readFileSync(join(root, 'manifest.json'));
const call = (command) =>
  spawnSync(process.execPath, ['apps/residents/dist/cli.js', command, '--root', root], {
    encoding: 'utf8',
    timeout: 30000,
  });
if (!before.world.publicGovernance) {
  const blocked = call('enable-society-services');
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stdout).reason, 'public-governance-not-enabled');
  const governance = call('enable-public-governance');
  assert.equal(governance.status, 0, governance.stderr);
  assert.equal(JSON.parse(governance.stdout).ok, true);
}
const first = call('enable-society-services');
assert.equal(first.status, 0, first.stderr);
const activation = JSON.parse(first.stdout);
assert.equal(activation.status, 'enabled');
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  assert.equal(after.services.policy.version, 'resident-services-v3');
  assert.ok(after.services.relationPolicy);
  assert.deepEqual(after.world.agents, before.world.agents);
  assert.equal(after.world.moneySupply, before.world.moneySupply);
  assert.equal(after.world.treasury, before.world.treasury);
  assert.deepEqual(after.world.clock, before.world.clock);
  assert.deepEqual(after.world.activityTimeByAgent, before.world.activityTimeByAgent);
  assert.deepEqual(after.world.transitByAgent, before.world.transitByAgent);
  assert.deepEqual(after.services.services, {});
  assert.deepEqual(after.services.slots, {});
  assert.deepEqual(after.services.bookings, {});
} finally {
  r.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
const again = call('enable-society-services');
assert.equal(again.status, 0, again.stderr);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
r = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(r.state, after);
} finally {
  r.close();
}
const report = {
  passed: true,
  root,
  activation,
  previousRevision: before.revision,
  revision: after.revision,
  publicAuthorization: before.world.publicGovernance
    ? 'previously-enabled'
    : 'explicit-enable-public-governance-operator-command-not-resident-consent',
  assetsClockTravelBodyUnchanged: true,
  originalManifestUnchanged: true,
  noServicesProvidersBookingsCreated: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'Legacy v1/v2 services must drain and close before transition; no automatic reinterpretation.',
    'Private multi-principal service registration currently depends on public authorization activation; this coupling remains for boundary review.',
    'No real facilities, teacher/doctor capacity, biological effects or complete integrated profile claim.',
    'Operator CLI evidence, not model emergence.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
