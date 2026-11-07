import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/foundations-verification.json',
);
let r = new OpenSocietyRuntime(root);
assert.ok(r.manifest.canonicalPolicyContinuation, 'requires-real-migrated-source');
const before = structuredClone(r.state);
const manifest = readFileSync(join(root, 'manifest.json'));
r.close();
const enable = () =>
  spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', 'enable-society-foundations', '--root', root],
    { encoding: 'utf8', timeout: 30000 },
  );
const first = enable();
assert.equal(first.status, 0, first.stderr);
const result = JSON.parse(first.stdout);
assert.equal(result.status, 'enabled');
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  assert.deepEqual(after.world.agents, before.world.agents);
  assert.equal(after.world.moneySupply, before.world.moneySupply);
  assert.equal(after.world.treasury, before.world.treasury);
  assert.deepEqual(after.world.clock, before.world.clock);
  assert.deepEqual(after.world.transitByAgent, before.world.transitByAgent);
  assert.deepEqual(after.world.materials.stocks, {});
  assert.deepEqual(after.world.premises.sites, {});
  assert.equal(r.discover('stocks.list').tools[0].availability.adapterEnabled, true);
  assert.equal(r.discover('sources.list').tools[0].availability.adapterEnabled, false);
} finally {
  r.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
const again = enable();
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
  activation: result,
  previousRevision: before.revision,
  revision: after.revision,
  originalManifestUnchanged: true,
  agentsBalancesClockTravelUnchanged: true,
  stocksAndSitesEmpty: true,
  materialCustodyAvailable: true,
  finiteSourcesUnavailable: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'Explicit foundations phase only; no complete integrated profile claim.',
    'No physical sources, vehicles, sites or resident consent created.',
    'Service provider policy upgrade, bodily time regime and source-backed facilities/resources remain required for full activation.',
    'Operator CLI verification, not new model emergence evidence.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
