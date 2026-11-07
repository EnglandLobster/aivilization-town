// Explicit adapter migration only; no public authorization or physical endowment.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/independent-resources-verification.json',
);
const manifest = readFileSync(join(root, 'manifest.json'));
let r = new OpenSocietyRuntime(root);
assert.ok(r.manifest.canonicalPolicyContinuation);
const before = structuredClone(r.state);
r.close();
const call = () => {
  const p = spawnSync(
    process.execPath,
    [
      'apps/residents/dist/cli.js',
      'enable-resource-adapters',
      '--root',
      root,
      '--args',
      '["stock"]',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const result = JSON.parse(p.stdout);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};
const result = call();
r = new OpenSocietyRuntime(root);
const after = structuredClone(r.state);
r.close();
const { resourceAdapters: oldAdapters, resourceSales: oldSales, ...oldRest } = before.world;
const { resourceAdapters, resourceSales, ...rest } = after.world;
assert.deepEqual(rest, oldRest);
assert.deepEqual(resourceSales.sales, oldSales?.sales ?? {});
assert.equal(resourceSales.policy.version, 'resident-resource-sales-v2');
assert.deepEqual(resourceAdapters, {
  version: 'independent-resource-adapters-v1',
  kinds: ['premises', 'stock'],
});
assert.equal(after.world.residentMobility, undefined);
const bytes = readFileSync(join(root, 'journal.jsonl'));
assert.equal(call().ok, true);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
r = new OpenSocietyRuntime(root);
assert.deepEqual(r.state, after);
r.close();
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), bytes);
const report = {
  ok: true,
  version: 'canonical-independent-resource-adapter-verification-v1',
  result,
  beforeRevision: before.revision,
  afterRevision: after.revision,
  oldAdapters: oldAdapters ?? null,
  resourceAdapters,
  previousSalesPolicy: oldSales?.policy.version ?? null,
  salesPolicy: resourceSales.policy.version,
  allOtherWorldFieldsUnchanged: true,
  publicGrantUnchanged: true,
  existingSalesUnchanged: true,
  noVehicleSeeded: true,
  manifestUnchanged: true,
  retryNoCommit: true,
  replayMatched: true,
  journalHash: createHash('sha256').update(bytes).digest('hex'),
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
