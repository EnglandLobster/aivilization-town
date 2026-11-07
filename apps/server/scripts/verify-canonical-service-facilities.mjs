// New explicitly declared resources, never inferred historical facilities.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const declaration = JSON.parse(
  readFileSync(
    resolve(process.argv[3] ?? '.local/canonical-cutover-20261007/service-facility-endowment.json'),
    'utf8',
  ),
);
const output = resolve(
  process.argv[4] ?? '.local/canonical-cutover-20261007/service-facility-verification.json',
);
const manifest = readFileSync(join(root, 'manifest.json'));
let r = new OpenSocietyRuntime(root);
assert.ok(r.manifest.canonicalPolicyContinuation);
const before = structuredClone(r.state);
r.close();
const call = () =>
  spawnSync(
    process.execPath,
    [
      'apps/residents/dist/cli.js',
      'register-service-facilities',
      '--root',
      root,
      '--args',
      JSON.stringify(declaration),
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
const result = call();
assert.equal(result.status, 0, result.stderr + result.stdout);
assert.equal(JSON.parse(result.stdout).ok, true);
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  for (const field of [
    'agents',
    'moneySupply',
    'treasury',
    'clock',
    'materials',
    'enterprises',
    'serviceEngagements',
    'serviceTime',
    'transitByAgent',
    'publicGovernance',
  ])
    assert.deepEqual(after.world[field], before.world[field]);
  assert.deepEqual(after.world.premises.buildings, before.world.premises.buildings);
  assert.deepEqual(after.world.premises.sites, before.world.premises.sites);
  for (const f of declaration)
    assert.deepEqual(after.world.premises.serviceFacilityEndowments[f.locationId], {
      ...f,
      source: 'authorized-extension',
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
const report = {
  passed: true,
  previousRevision: before.revision,
  revision: after.revision,
  declaration,
  origin:
    'Explicit new operator endowment; not inferred from legacy clinic/school names or historical ownership.',
  existingPeopleFundsGoodsTimeWorkAndAgreementsUnchanged: true,
  manifestUnchanged: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'No teacher, caregiver, organization or resident consent created.',
    'No original building/title history inferred.',
    'Actual effects still require valid personal service participation.',
    'Complete original-mode and partition integration remain unfinished.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
