import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const declarationPath = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/material-endowment.json',
);
const output = resolve(
  process.argv[4] ?? '.local/canonical-cutover-20261007/body-materials-verification.json',
);
const declaration = JSON.parse(readFileSync(declarationPath, 'utf8'));
let r = new OpenSocietyRuntime(root);
const before = structuredClone(r.state);
assert.ok(r.manifest.canonicalPolicyContinuation);
r.close();
const manifest = readFileSync(join(root, 'manifest.json'));
const call = (command, args = []) =>
  spawnSync(process.execPath, ['apps/residents/dist/cli.js', command, '--root', root, ...args], {
    encoding: 'utf8',
    timeout: 30000,
  });
if (!before.world.materials?.extraction) {
  const missing = call('enable-physical-production');
  assert.equal(missing.status, 1);
  assert.equal(
    JSON.parse(missing.stdout).error,
    'canonical-material-endowment-declaration-required',
  );
}
const body = call('enable-society-body-learning');
assert.equal(body.status, 0, body.stderr);
assert.equal(JSON.parse(body.stdout).status, 'enabled');
const material = call('enable-physical-production', ['--material-endowment', declarationPath]);
assert.equal(material.status, 0, material.stderr);
assert.equal(JSON.parse(material.stdout).ok, true);
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  assert.deepEqual(after.world.agents, before.world.agents);
  assert.equal(after.world.moneySupply, before.world.moneySupply);
  assert.equal(after.world.treasury, before.world.treasury);
  assert.deepEqual(after.world.clock, before.world.clock);
  assert.deepEqual(after.world.transitByAgent, before.world.transitByAgent);
  assert.deepEqual(after.world.activityTimeByAgent, before.world.activityTimeByAgent);
  assert.deepEqual(after.world.materials.stocks, before.world.materials.stocks);
  assert.deepEqual(after.world.materials.extraction.origin, declaration.origin);
  assert.equal(
    Object.keys(after.world.materials.extraction.sources).length,
    declaration.sources.length,
  );
  for (const s of declaration.sources)
    assert.deepEqual(after.world.materials.extraction.sources[s.id], {
      ...s,
      remaining: s.initialQuantity,
      revision: 1,
      at: before.world.clock.now,
    });
  assert.deepEqual(after.world.residentRest.sessions, {});
  assert.ok(after.world.residentStudy);
  assert.equal(after.world.residentLabor, undefined);
} finally {
  r.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
assert.equal(call('enable-society-body-learning').status, 0);
assert.equal(
  call('enable-physical-production', ['--material-endowment', declarationPath]).status,
  0,
);
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
  bodyActivation: JSON.parse(body.stdout),
  endowment: declaration,
  existingAgentsMoneyClockTransitAndStocksUnchanged: true,
  manifestUnchanged: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'Explicit new finite endowment, not preservation of original raw assets.',
    'No actual sleep/study or extraction performed by this operator activation.',
    'Canonical wageCalculator has no explicit period-pay terms; labor migration remains pending.',
    'No emergence claim.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
