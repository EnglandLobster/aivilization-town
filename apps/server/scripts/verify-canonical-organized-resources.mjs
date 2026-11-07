// Existing explicit integration transitions, not resident decisions or organization creation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { OpenSocietyRuntime } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-cutover-20261007/society');
const output = resolve(
  process.argv[3] ?? '.local/canonical-cutover-20261007/organized-resources-verification.json',
);
const manifest = readFileSync(join(root, 'manifest.json'));
let r = new OpenSocietyRuntime(root);
assert.ok(r.manifest.canonicalPolicyContinuation);
const before = structuredClone(r.state);
r.close();
const commands = [
  'enable-resource-principals',
  'enable-premises-principals',
  'enable-principal-permits',
  'enable-principal-trade',
  'enable-construction-trade',
  'enable-resource-sales',
];
const results = [];
const call = (command) => {
  const p = spawnSync(process.execPath, ['apps/residents/dist/cli.js', command, '--root', root], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const result = JSON.parse(p.stdout);
  assert.equal(result.ok, true, JSON.stringify(result));
  results.push({ command, result });
};
for (const command of commands) call(command);
r = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(r.state);
  const a = after.world,
    b = before.world;
  for (const field of [
    'agents',
    'moneySupply',
    'treasury',
    'clock',
    'enterprises',
    'residentMobility',
    'serviceEngagements',
    'transitByAgent',
    'residentLabor',
    'commonAccounts',
  ])
    assert.deepEqual(a[field], b[field]);
  for (const field of ['stocks', 'productions', 'extraction', 'reservations'])
    assert.deepEqual(a.materials[field], b.materials[field]);
  for (const field of ['sites', 'buildings', 'projects', 'serviceFacilityEndowments'])
    assert.deepEqual(a.premises[field], b.premises[field]);
  for (const field of ['permits', 'provisions'])
    assert.deepEqual(a.premisesRights[field], b.premisesRights[field]);
  assert.deepEqual(a.publicGovernance, {
    ...b.publicGovernance,
    authority: { ...b.publicGovernance.authority, grant: a.publicGovernance.authority.grant },
  });
  assert.deepEqual(after.collectives, before.collectives);
  assert.equal(a.resourceSales.policy.version, 'resident-resource-sales-v1');
  assert.deepEqual(a.resourceSales.sales, {});
  assert.ok(
    a.materials.resourcePrincipals &&
      a.premises.resourcePrincipals &&
      a.premisesRights.principalPolicy &&
      a.residentTrade.principalOrders &&
      a.residentTrade.constructionOrders,
  );
} finally {
  r.close();
}
const journal = readFileSync(join(root, 'journal.jsonl'));
for (const command of commands) call(command);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
// Reproduce the real v2 prerequisite without manufacturing a vehicle domain.
const v2 = spawnSync(
  process.execPath,
  ['apps/residents/dist/cli.js', 'enable-resource-sales-v2', '--root', root],
  { encoding: 'utf8', timeout: 30000 },
);
assert.equal(v2.status, 1);
const denied = JSON.parse(v2.stdout);
assert.equal(denied.ok, false);
assert.notEqual(denied.error, 'unknown-command');
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), journal);
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
  results,
  v2Refusal: denied.error,
  publicGrantBefore: before.world.publicGovernance.authority.grant,
  publicGrantAfter: after.world.publicGovernance.authority.grant,
  manifestUnchanged: true,
  existingPeopleFundsGoodsWorkAndAgreementsUnchanged: true,
  noResidentDecisionsOrOrganizationsCreated: true,
  retryCreatedNoCommits: true,
  replayMatched: true,
  limitations: [
    'Existing explicit adapters add public grant scopes; they do not approve any public purchase or resident proposal.',
    'Inventory/vehicle pricing v2 remains blocked by its existing vehicle-principal prerequisite.',
    'No vehicle or enterprise is seeded to bypass that restriction.',
    'Private integration still has legacy public-domain dependencies; independent activation requires an explicit compatible transition.',
    'Whole 25-capability and full-mode integration remain incomplete.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
