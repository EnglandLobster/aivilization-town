// Explicit public jurisdiction extension, separate from private periodic agreement activation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { OpenSocietyRuntime, resolveCanonicalPolicyContinuation } from '@aivilization/worker';
import { inheritedPublicEmploymentTerms } from '@aivilization/society';
const [rootArg, outputArg] = process.argv.slice(2);
assert.ok(rootArg && outputArg, 'root and output required');
const root = resolve(rootArg),
  manifest = readFileSync(join(root, 'manifest.json'));
const oldJournal = readFileSync(join(root, 'journal.jsonl'));
let runtime = new OpenSocietyRuntime(root),
  before,
  policy;
try {
  assert.ok(runtime.manifest.canonicalPolicyContinuation);
  assert.equal(runtime.state.world.publicEmployment, undefined, 'fresh-activation-required');
  assert.ok(
    Object.values(runtime.state.residents).every(
      (r) =>
        r.activeTurnId === undefined ||
        runtime.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
    ),
    'active-turn',
  );
  before = structuredClone(runtime.state);
  policy = resolveCanonicalPolicyContinuation(
    runtime.manifest.canonicalPolicyContinuation,
    runtime.manifest.seed,
    before.world,
  ).jobApplication;
  assert.ok(policy?.recruitmentCycle);
} finally {
  runtime.close();
}
const activate = () => {
  const p = spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', 'enable-public-employment', '--root', root],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(JSON.parse(p.stdout).ok, true);
};
activate();
runtime = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(runtime.state);
  const { publicEmployment, publicGovernance, ...rest } = after.world;
  const { publicGovernance: oldGovernance, ...oldRest } = before.world;
  assert.deepEqual(rest, oldRest);
  const { grant, ...authority } = publicGovernance.authority;
  const { grant: oldGrant, ...oldAuthority } = oldGovernance.authority;
  assert.deepEqual(authority, oldAuthority);
  assert.deepEqual({ ...publicGovernance, authority: oldGovernance.authority }, oldGovernance);
  const { employment, actions, ...grantRest } = grant;
  assert.ok(employment);
  assert.deepEqual({ ...grantRest, actions: oldGrant.actions }, oldGrant);
  assert.deepEqual(actions, [...oldGrant.actions, 'set-employment']);
  assert.equal(publicEmployment.revisions.length, 1);
  const first = publicEmployment.revisions[0];
  assert.deepEqual(
    first.terms,
    inheritedPublicEmploymentTerms(policy.quotaByResidentialTier, policy.recruitmentCycle),
  );
  assert.deepEqual(first.source, {
    kind: 'inherited-scenario',
    version: policy.recruitmentCycle.policyVersion,
  });
  assert.equal(publicEmployment.cycleDurationMs, policy.recruitmentCycle.cycleDurationMs);
  assert.equal(first.recordedAt, before.world.clock.now);
  assert.equal(after.revision, before.revision + 1);
  for (const key of Object.keys(before))
    if (!['world', 'worldSequence', 'revision'].includes(key))
      assert.deepEqual(after[key], before[key]);
} finally {
  runtime.close();
}
const bytes = readFileSync(join(root, 'journal.jsonl'));
assert.deepEqual(bytes.subarray(0, oldJournal.length), oldJournal);
activate();
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
runtime = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(runtime.state, after);
} finally {
  runtime.close();
}
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
const report = {
  ok: true,
  version: 'canonical-public-employment-activation-verification-v1',
  beforeRevision: before.revision,
  afterRevision: after.revision,
  inheritedPolicy: after.world.publicEmployment,
  publicGrantExtension: after.world.publicGovernance.authority.grant.employment,
  source: 'explicit-operator-activation-not-resident-vote',
  existingApplicationsAndAllOtherWorldFactsUnchanged: true,
  nonWorldStateUnchanged: true,
  manifestUnchanged: true,
  originalJournalPrefixPreserved: true,
  retryNoCommit: true,
  replayMatched: true,
  journalHash: createHash('sha256').update(bytes).digest('hex'),
};
writeFileSync(resolve(outputArg), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    ok: true,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    replayMatched: true,
  }),
);
