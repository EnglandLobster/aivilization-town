// Controlled archive verification; does not activate a migrated runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createAivilizationWorldCommandPolicies,
  resolveCanonicalPolicyContinuation,
} from '@aivilization/worker';
const archive = resolve(process.argv[2] ?? '.local/canonical-ownership-20261007/archive');
const output = resolve(process.argv[3] ?? '.local/canonical-policy-continuity-20261007.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const metadata = JSON.parse(readFileSync(join(archive, 'archive.json'), 'utf8'));
const files = metadata.entries.filter((e) => e.kind === 'file');
function read(entry) {
  assert.ok(entry && !entry.path.split('/').includes('..') && !entry.path.startsWith('/'));
  const bytes = readFileSync(join(archive, 'source', entry.path));
  assert.equal(hash(bytes), entry.sha256);
  return JSON.parse(bytes);
}
const sources = files.filter((e) => e.path.startsWith('operations/resolved-run-manifests/'));
assert.equal(sources.length, 1, 'controlled-fixture-expects-one-source-manifest');
const source = read(sources[0]);
const authorities = files.filter(
  (e) => e.path.startsWith('simulation-wide-authority/') && e.path.endsWith('/state.json'),
);
assert.equal(authorities.length, 1);
const authority = read(authorities[0]);
assert.equal(source.payload.scenario.manifest.id, authority.manifestId);
const continuation = {
  version: 'canonical-policy-continuation-v1',
  seed: source.payload.seed,
  // Explicit default configuration for this fixture; resolver must prove full source equality.
  configuration: {},
  sourcePolicyManifest: source.payload.policies,
};
const policies = resolveCanonicalPolicyContinuation(
  continuation,
  source.payload.seed,
  authority.projection,
);
const expected = createAivilizationWorldCommandPolicies(source.payload.seed)(authority.projection);
assert.deepEqual(JSON.parse(JSON.stringify(policies)), JSON.parse(JSON.stringify(expected)));
const wages = Object.fromEntries(
  ['Cleaner', 'CEO'].map((job) => {
    const amount = policies.wageCalculator(job);
    assert.equal(amount, expected.wageCalculator(job));
    return [job, amount];
  }),
);
read(sources[0]);
read(authorities[0]);
const report = {
  passed: true,
  archive,
  sourceManifestSha256: sources[0].sha256,
  sourceManifestId: source.runManifestId,
  seed: source.payload.seed,
  fullPolicyManifestMatched: true,
  wages,
  sourceFilesUnchanged: true,
  limitations: [
    'Explicit default-policy fixture, not a general configuration inference/importer.',
    'No target activation, full cognition migration or retired source; no free-model experiment.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
