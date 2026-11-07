import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readCanonicalSocietySource } from '@aivilization/server';
import { OpenSocietyRuntime, canonicalHistoricalRequestIds } from '@aivilization/worker';
const archiveRoot = resolve(process.argv[2] ?? '.local/canonical-ownership-20261007/archive');
const output = resolve(process.argv[3] ?? '.local/canonical-source-reader-20261007.json');
const metadata = JSON.parse(readFileSync(join(archiveRoot, 'archive.json'), 'utf8'));
const manifests = metadata.entries.filter(
  (e) => e.kind === 'file' && e.path.startsWith('operations/resolved-run-manifests/'),
);
const authorities = metadata.entries.filter(
  (e) =>
    e.kind === 'file' &&
    e.path.startsWith('simulation-wide-authority/') &&
    e.path.endsWith('/state.json'),
);
assert.equal(manifests.length, 1);
assert.equal(authorities.length, 1);
const original = JSON.parse(readFileSync(join(archiveRoot, 'source', manifests[0].path), 'utf8'));
const authority = JSON.parse(
  readFileSync(join(archiveRoot, 'source', authorities[0].path), 'utf8'),
);
const consumerIds = Object.fromEntries(
  authority.partitionKeys.map((key) => {
    const cursors = Object.values(authority.materializerCursors).filter(
      (c) => c.partitionKey === key,
    );
    assert.equal(cursors.length, 1);
    return [key, cursors[0].consumerId];
  }),
);
const loaded = await readCanonicalSocietySource({
  archiveRoot,
  simulationId: authority.simulationId,
  runManifestId: original.runManifestId,
  policyConfiguration: {},
  consumerIds,
});
assert.equal(loaded.candidate.status, 'candidate', JSON.stringify(loaded.candidate.issues));
const candidate = loaded.candidate;
const baseline = JSON.parse(
  readFileSync('.local/canonical-request-candidate-20261007.json', 'utf8'),
);
const manifestHash = createHash('sha256').update(JSON.stringify(candidate.manifest)).digest('hex');
assert.equal(manifestHash, baseline.candidateManifestSha256);
const root = mkdtempSync(join(tmpdir(), 'source-reader-runtime-'));
let runtime;
try {
  runtime = new OpenSocietyRuntime(root, candidate.manifest);
  const before = structuredClone(runtime.state);
  const ids = [
    ...canonicalHistoricalRequestIds(
      candidate.manifest.canonicalRequestHistory,
      authority.simulationId,
    ),
  ];
  for (const id of ids) assert.equal(runtime.advanceTime(1, id).error, 'historical-request-id');
  assert.deepEqual(runtime.state, before);
  const trips = Object.values(before.world.transitByAgent ?? {});
  const until = Math.max(before.world.clock.now + 1, ...trips.map((t) => t.arrivesAt));
  assert.equal(runtime.advanceTime(until - before.world.clock.now, 'reader-validation').ok, true);
  for (const trip of trips)
    assert.equal(runtime.state.world.agents[trip.agentId].locationId, trip.toLocationId);
  const after = structuredClone(runtime.state);
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, after);
  const report = {
    passed: true,
    archiveRoot,
    sourceTreeSha256: loaded.source.archive.sourceTreeSha256,
    runManifestId: loaded.source.runManifestId,
    sourceRevision: loaded.source.sourceRevision,
    candidateManifestSha256: manifestHash,
    matchedPriorCandidate: true,
    residents: candidate.manifest.residents.length,
    historicalIds: ids.length,
    completedOriginalTrips: trips.length,
    restartReplayMatched: true,
    limitations: [
      'Read-only verified archive adapter with temporary runtime, no source retirement or target publication.',
      'Explicit original manifest selection/default policy and recorded consumers; not proof every historical custom configuration has an adapter.',
      'Current resident identities come from original scenario seeds; later or exited subjects require additional provenance mapping.',
      'Full 25 capabilities remain unfinished.',
    ],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  runtime?.close();
  rmSync(root, { recursive: true, force: true });
}
