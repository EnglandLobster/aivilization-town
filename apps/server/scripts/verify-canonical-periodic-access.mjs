// Explicit operator migration after the sole daemon stops. No resident intentions or public grants.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { OpenSocietyRuntime } from '@aivilization/worker';

const [rootArg, outputArg] = process.argv.slice(2);
assert.ok(rootArg && outputArg, 'root and output required');
const root = resolve(rootArg);
const manifest = readFileSync(join(root, 'manifest.json'));
const initialJournal = readFileSync(join(root, 'journal.jsonl'));
let runtime = new OpenSocietyRuntime(root);
let before;
try {
  assert.ok(runtime.manifest.canonicalPolicyContinuation, 'canonical-source-required');
  assert.ok(
    Object.values(runtime.state.residents).every(
      (r) =>
        r.activeTurnId === undefined ||
        runtime.journal.lookup(r.actorId, `${r.activeTurnId}-finished`),
    ),
    'active-resident-turn',
  );
  before = structuredClone(runtime.state);
} finally {
  runtime.close();
}
const activate = () => {
  const p = spawnSync(
    process.execPath,
    ['apps/residents/dist/cli.js', 'enable-periodic-access', '--root', root],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const result = JSON.parse(p.stdout);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};
const result = activate();
runtime = new OpenSocietyRuntime(root);
let after;
try {
  after = structuredClone(runtime.state);
  const {
    periodicAccess: oldAccess,
    periodicObligations: oldAgreements,
    ...oldRest
  } = before.world;
  const { periodicAccess, periodicObligations, ...rest } = after.world;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(periodicAccess, { version: 'independent-periodic-access-v1' });
  assert.deepEqual(periodicObligations.contracts, oldAgreements?.contracts ?? {});
  if (oldAgreements) assert.deepEqual(periodicObligations, oldAgreements);
  assert.equal(after.revision - before.revision, oldAccess ? 0 : 1);
  // No forced turns, author changes, intentions, votes or social records.
  for (const key of Object.keys(before))
    if (!['world', 'worldSequence', 'revision'].includes(key))
      assert.deepEqual(after[key], before[key], `non-world-state-changed:${key}`);
} finally {
  runtime.close();
}
const finalJournal = readFileSync(join(root, 'journal.jsonl'));
assert.deepEqual(finalJournal.subarray(0, initialJournal.length), initialJournal);
assert.equal(activate().ok, true);
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), finalJournal);
assert.deepEqual(readFileSync(join(root, 'manifest.json')), manifest);
runtime = new OpenSocietyRuntime(root);
try {
  assert.deepEqual(runtime.state, after);
} finally {
  runtime.close();
}
assert.deepEqual(readFileSync(join(root, 'journal.jsonl')), finalJournal);
const report = {
  ok: true,
  version: 'canonical-independent-periodic-access-verification-v1',
  result,
  beforeRevision: before.revision,
  afterRevision: after.revision,
  policy: after.world.periodicAccess,
  agreementCount: Object.keys(after.world.periodicObligations.contracts).length,
  allOtherWorldFieldsUnchanged: true,
  nonWorldStateUnchanged: true,
  publicGrantUnchanged: true,
  existingAgreementsUnchanged: true,
  originalJournalPrefixPreserved: true,
  manifestUnchanged: true,
  retryNoCommit: true,
  replayMatched: true,
  journalHash: createHash('sha256').update(finalJournal).digest('hex'),
};
writeFileSync(resolve(outputArg), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
