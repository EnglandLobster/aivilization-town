// Read a verified engineering archive into an explicitly sourced candidate. No new world is activated.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileEventStore } from '@aivilization/sim-core';
import { composeCanonicalWorldBoundary } from '@aivilization/worker';
const root = resolve(process.argv[2] ?? '.local/canonical-ownership-20261007/archive');
const simulationId = process.argv[3] ?? 'aivilization-smoke-25';
const output = resolve(process.argv[4] ?? '.local/canonical-world-composition-20261007.json');
const expectedBlocker = process.argv[5] === 'same-owner-v1' ? undefined : process.argv[5];
const movementContinuity = process.argv[5] === 'same-owner-v1' ? 'same-owner-v1' : undefined;
const digest = (b) => createHash('sha256').update(b).digest('hex');
const metadata = JSON.parse(readFileSync(join(root, 'archive.json'), 'utf8'));
const files = new Map(
  metadata.entries.filter((e) => e.kind === 'file').map((e) => [e.path, e.sha256]),
);
function read(path) {
  assert.ok(!isAbsolute(path) && !path.split('/').includes('..'));
  assert.ok(files.has(path), `unrecorded-source-file:${path}`);
  const bytes = readFileSync(join(root, 'source', path));
  assert.equal(digest(bytes), files.get(path));
  return bytes;
}
for (const path of files.keys()) read(path);
const authority = JSON.parse(
  read(`simulation-wide-authority/${encodeURIComponent(simulationId)}/state.json`).toString(),
);
const sourceBoundary = [];
const partitions = authority.partitionKeys.map((partitionKey) => {
  const dir = `simulations/${encodeURIComponent(simulationId)}/partitions/${encodeURIComponent(partitionKey)}`;
  const rows = read(`${dir}/checkpoints/projection-checkpoints.jsonl`)
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  const checkpoint = rows.at(-1);
  assert.ok(checkpoint);
  const path = relative(metadata.sourceRoot, fileURLToPath(checkpoint.snapshot.uri));
  const snapshot = JSON.parse(read(path).toString());
  assert.deepEqual(snapshot.reference, checkpoint.snapshot);
  const consumers = Object.values(authority.materializerCursors).filter(
    (c) => c.partitionKey === partitionKey,
  );
  assert.equal(consumers.length, 1, 'explicit-single-consumer-fixture-required');
  const temp = mkdtempSync(join(tmpdir(), 'canonical-stream-read-'));
  try {
    const events = join(temp, 'events');
    cpSync(join(root, 'source', dir, 'events'), events, { recursive: true });
    const inventory = (base) => {
      const result = {};
      const walk = (path) => {
        for (const e of readdirSync(path, { withFileTypes: true })) {
          const p = join(path, e.name);
          if (e.isDirectory()) walk(p);
          else result[relative(base, p)] = digest(readFileSync(p));
        }
      };
      walk(base);
      return result;
    };
    const before = inventory(events);
    const store = new FileEventStore({ rootDir: events });
    const stream = `simulation/${simulationId}/partition/${partitionKey}/events`;
    const version = store.getStreamVersion(stream);
    const eventRecords = store.readStream(stream);
    assert.equal(checkpoint.lastAppliedSequence, version, 'checkpoint-not-at-stream-tail');
    assert.equal(eventRecords.length, version, 'fixture-expects-unpruned-event-stream');
    assert.deepEqual(inventory(events), before, 'reader-would-repair-source');
    sourceBoundary.push({
      partitionKey,
      streamVersion: version,
      checkpointSequence: checkpoint.lastAppliedSequence,
      decodedEvents: eventRecords.length,
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  return { partitionKey, consumerId: consumers[0].consumerId, projection: snapshot.projection };
});
const result = composeCanonicalWorldBoundary({
  authority,
  partitions,
  ...(movementContinuity ? { movementContinuity } : {}),
});
if (expectedBlocker) {
  assert.equal(result.status, 'blocked');
  assert.ok(result.issues.length > 0);
  assert.ok(
    result.issues.every((issue) => issue.reason === expectedBlocker),
    JSON.stringify(result.issues),
  );
  assert.equal('projection' in result, false, 'blocked-source-must-not-produce-candidate');
} else {
  assert.equal(result.status, 'composed', JSON.stringify(result.issues));
  assert.deepEqual(result.projection.agents, authority.projection.agents);
  assert.equal(result.projection.moneySupply, authority.projection.moneySupply);
  assert.deepEqual(result.projection.marketPools, authority.projection.marketPools);
  for (const p of partitions)
    for (const application of p.projection.jobApplications)
      assert.ok(
        result.projection.jobApplications.some(
          (a) => JSON.stringify(a) === JSON.stringify(application),
        ),
      );
}
for (const path of files.keys()) read(path);
const report = {
  passed: true,
  archive: root,
  simulationId,
  sourceBoundary,
  barrier: result.barrier,
  status: result.status,
  issues: result.issues,
  authorityAgentCount: Object.keys(authority.projection.agents).length,
  sourceJobApplications: partitions.reduce((n, p) => n + p.projection.jobApplications.length, 0),
  authorityJobApplications: authority.projection.jobApplications.length,
  ...(result.status === 'composed'
    ? {
        fieldCount: Object.keys(result.projection).length,
        agentCount: Object.keys(result.projection.agents).length,
        jobApplicationsPreserved: result.projection.jobApplications.length,
        moneySupply: result.projection.moneySupply,
        candidateSha256: digest(JSON.stringify(result.projection)),
      }
    : { expectedBlocker, candidateProduced: false }),
  archiveUnchanged: true,
  limitations: [
    'Candidate only; no manifest, policy or cognition migration, no target runtime or source retirement.',
    'Validates decoded event tail and snapshot reference, not an independent full domain replay from scenario genesis.',
    'Existing controlled canonical archive, not a new free-agent observation.',
  ],
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
