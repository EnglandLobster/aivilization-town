// Isolated cutover verification. Advances only an already committed material session deadline.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/livelihoods-verification.json',
);
const manifest = readFileSync(join(root, 'manifest.json'));
const open = () => new OpenSocietyRuntime(root);
let runtime = open();
assert.ok(runtime.manifest.canonicalPolicyContinuation);
const before = structuredClone(runtime.state);
runtime.close();
const call = () =>
  spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', 'enable-society-livelihoods', '--root', root],
    { encoding: 'utf8', timeout: 30000 },
  );
const first = call(),
  firstResult = JSON.parse(first.stdout);
assert.ok([0, 1].includes(first.status), first.stderr);
runtime = open();
let advancement = null;
try {
  // Activation itself never changes people, goods, travel, time, public grants or enterprise obligations.
  for (const field of [
    'agents',
    'materials',
    'premises',
    'enterprises',
    'moneySupply',
    'treasury',
    'clock',
    'transitByAgent',
    'publicGovernance',
  ])
    assert.deepEqual(runtime.state.world[field], before.world[field]);
  if (firstResult.status === 'blocked') {
    assert.equal(
      firstResult.reason,
      'productive-employment:productive-employment-needs-labor-materials-and-no-active-material-or-prepaid-work',
    );
    assert.deepEqual(firstResult.completed, [
      'service-engagements',
      'service-time',
      'service-employment',
    ]);
    const jobs = Object.values(runtime.state.world.materials.productions).filter((j) => j.session);
    assert.ok(jobs.length > 0, 'Refusal must be explained by actual committed work');
    const now = runtime.state.world.clock.now;
    const until = Math.max(...jobs.map((j) => j.session.until));
    assert.ok(Number.isSafeInteger(until) && until > now && until - now <= 86400000);
    const result = runtime.advanceTime(
      until - now,
      'verify-committed-material-deadline-before-livelihood-activation',
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    advancement = {
      from: now,
      to: until,
      alreadyCommittedJobs: jobs.map((j) => j.id),
      revision: runtime.state.revision,
    };
    for (const job of jobs)
      assert.equal(runtime.state.world.materials.productions[job.id].session, undefined);
  }
} finally {
  runtime.close();
}
runtime = open();
const beforeRetry = structuredClone(runtime.state.world);
runtime.close();
const resumed = call();
assert.equal(resumed.status, 0, resumed.stdout + resumed.stderr);
const finalResult = JSON.parse(resumed.stdout);
assert.equal(finalResult.status, 'enabled');
runtime = open();
let state;
try {
  state = structuredClone(runtime.state);
  for (const field of [
    'agents',
    'materials',
    'premises',
    'enterprises',
    'moneySupply',
    'treasury',
    'clock',
    'transitByAgent',
    'publicGovernance',
  ])
    assert.deepEqual(state.world[field], beforeRetry[field]);
  assert.ok(
    state.world.productiveEmployment &&
      state.world.serviceTime &&
      state.world.serviceEmployment &&
      state.world.serviceEngagements,
  );
  assert.deepEqual(state.world.serviceEngagements.engagements, {});
} finally {
  runtime.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
assert.equal(call().status, 0);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
runtime = open();
try {
  assert.deepEqual(runtime.state, state);
} finally {
  runtime.close();
}
const report = {
  passed: true,
  previousRevision: before.revision,
  revision: state.revision,
  first: firstResult,
  advancement,
  final: finalResult,
  manifestUnchanged: true,
  activationPreservedExistingFacts: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'No provider, facility, wage consent, service or organization created by activation.',
    'Simulation advancement completes prior resident work; it is not a new autonomous model decision.',
    'Original non-enterprise wages, physical facilities and full-mode integration remain incomplete.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
