// Explicit new finite land declaration plus existing adapters. Never infer historical ownership.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const declaration = JSON.parse(
  readFileSync(
    resolve(
      process.argv[3] ?? '.local/canonical-cutover-20261007/construction-site-endowment.json',
    ),
    'utf8',
  ),
);
const output = resolve(
  process.argv[4] ?? '.local/canonical-cutover-20261007/physical-exchange-verification.json',
);
const manifest = readFileSync(join(root, 'manifest.json'));
let r = new OpenSocietyRuntime(root);
assert.ok(r.manifest.canonicalPolicyContinuation);
const before = structuredClone(r.state);
r.close();
const calls = [];
const call = (command, args = []) => {
  const result = spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', command, '--root', root, ...args],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, true, JSON.stringify(body));
  calls.push({ command, result: body });
  return body;
};
call('register-construction-site', ['--args', JSON.stringify(declaration)]);
for (const command of ['enable-premises-rights', 'enable-logistics', 'enable-paid-permits'])
  call(command);
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  for (const field of [
    'agents',
    'moneySupply',
    'treasury',
    'clock',
    'transitByAgent',
    'enterprises',
    'publicGovernance',
    'residentMobility',
    'serviceEngagements',
  ])
    assert.deepEqual(after.world[field], before.world[field]);
  assert.deepEqual(after.world.materials.stocks, before.world.materials.stocks);
  assert.deepEqual(after.world.materials.productions, before.world.materials.productions);
  assert.deepEqual(after.world.premises.buildings, before.world.premises.buildings);
  assert.deepEqual(after.world.premises.projects, before.world.premises.projects);
  assert.deepEqual(after.world.premises.sites[declaration.id], {
    ...declaration,
    source: 'authorized-extension',
    revision: 1,
    occupiedFloorArea: 0,
    reservedFloorArea: 0,
  });
  assert.equal(after.world.residentTrade.policy.version, 'resident-evidence-trade-v2');
  assert.ok(after.world.logistics && after.world.premisesRights);
} finally {
  r.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
call('register-construction-site', ['--args', JSON.stringify(declaration)]);
for (const command of ['enable-premises-rights', 'enable-logistics', 'enable-paid-permits'])
  call(command);
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
    'Explicit new operator land endowment; not migrated historic ownership or an existing building.',
  calls,
  manifestUnchanged: true,
  existingBodiesMoneyGoodsWorkAndObligationsUnchanged: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'No buildings, providers, care/teaching stations, vehicles or resident consent created.',
    'Residents still supply actual materials and labor to construct facilities.',
    'Unconstructed land is not usable storage, private title, a lease or a service.',
    'Full original-mode and partition integration remains incomplete.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
