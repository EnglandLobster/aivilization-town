import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileEventStore } from '@aivilization/sim-core';
import {
  FileShortTermMemoryRepository,
  FileLongTermProfileRepository,
  FileAgentIntentionRepository,
} from '@aivilization/memory';
import {
  FileBranchPlanRepository,
  FileBranchPlanProgressRepository,
} from '@aivilization/agent-runtime';
import {
  createCanonicalSocietyCandidate,
  readCanonicalResidentMemory,
  readCanonicalCognitiveDocuments,
  OpenSocietyRuntime,
} from '@aivilization/worker';
const archive = resolve(process.argv[2] ?? '.local/canonical-ownership-20261007/archive');
const output = resolve(process.argv[3] ?? '.local/canonical-society-candidate-20261007.json');
const digest = (b) => createHash('sha256').update(b).digest('hex');
const metadata = JSON.parse(readFileSync(join(archive, 'archive.json'), 'utf8'));
const files = new Map(
  metadata.entries.filter((e) => e.kind === 'file').map((e) => [e.path, e.sha256]),
);
function read(path) {
  assert.ok(!isAbsolute(path) && !path.split('/').includes('..') && files.has(path));
  const b = readFileSync(join(archive, 'source', path));
  assert.equal(digest(b), files.get(path));
  return b;
}
for (const path of files.keys()) read(path);
const authorityPaths = [...files.keys()].filter(
  (p) => p.startsWith('simulation-wide-authority/') && p.endsWith('/state.json'),
);
const manifestPaths = [...files.keys()].filter((p) =>
  p.startsWith('operations/resolved-run-manifests/'),
);
assert.equal(authorityPaths.length, 1);
assert.equal(manifestPaths.length, 1);
const authority = JSON.parse(read(authorityPaths[0]));
const source = JSON.parse(read(manifestPaths[0])).payload;
assert.equal(source.scenario.manifest.id, authority.manifestId);
const temp = mkdtempSync(join(tmpdir(), 'canonical-society-candidate-'));
let runtime;
try {
  const partitions = authority.partitionKeys.map((partitionKey) => {
    const dir = `simulations/${encodeURIComponent(authority.simulationId)}/partitions/${encodeURIComponent(partitionKey)}`;
    const checkpoint = read(`${dir}/checkpoints/projection-checkpoints.jsonl`)
      .toString()
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s))
      .at(-1);
    const snapshot = JSON.parse(
      read(relative(metadata.sourceRoot, fileURLToPath(checkpoint.snapshot.uri))),
    );
    assert.deepEqual(snapshot.reference, checkpoint.snapshot);
    const local = join(temp, encodeURIComponent(partitionKey));
    cpSync(join(archive, 'source', dir), local, { recursive: true });
    const store = new FileEventStore({ rootDir: join(local, 'events') });
    const stream = `simulation/${authority.simulationId}/partition/${partitionKey}/events`;
    assert.equal(store.getStreamVersion(stream), checkpoint.lastAppliedSequence);
    assert.equal(store.readStream(stream).length, checkpoint.lastAppliedSequence);
    const consumers = Object.values(authority.materializerCursors).filter(
      (c) => c.partitionKey === partitionKey,
    );
    assert.equal(consumers.length, 1);
    for (const name of [
      'memory/short-term-memory.deflate',
      'memory/long-term-profiles.jsonl',
      'memory/agent-intentions.jsonl',
      'planning/branch-plans.jsonl',
      'planning/branch-plan-progress.jsonl',
    ])
      assert.ok(files.has(`${dir}/${name}`), 'controlled fixture source required');
    return {
      partitionKey,
      consumerId: consumers[0].consumerId,
      projection: snapshot.projection,
      repository: new FileShortTermMemoryRepository({ rootDir: join(local, 'memory') }),
      profiles: new FileLongTermProfileRepository({ rootDir: join(local, 'memory') }),
      intentions: new FileAgentIntentionRepository({ rootDir: join(local, 'memory') }),
      planning: {
        plans: new FileBranchPlanRepository({ rootDir: join(local, 'planning') }),
        progress: new FileBranchPlanProgressRepository({ rootDir: join(local, 'planning') }),
      },
    };
  });
  const residentIds = Object.keys(authority.projection.agents);
  const memories = await readCanonicalResidentMemory({ residentIds, partitions });
  const documents = await readCanonicalCognitiveDocuments({
    residentIds,
    partitions,
    capturedAt: authority.projection.clock.now,
  });
  const seeds = source.scenario.scenarioPresets.flatMap((p) => p.agentSeeds);
  const residents = residentIds.map((id) => {
    const matches = seeds.filter((s) => s.agentId === id);
    assert.equal(matches.length, 1);
    return {
      id,
      displayName: matches[0].displayName,
      background: JSON.stringify(matches[0].profile),
    };
  });
  const candidate = createCanonicalSocietyCandidate({
    authority,
    partitions,
    residents,
    memories,
    documents,
    policies: {
      version: 'canonical-policy-continuation-v1',
      seed: source.seed,
      configuration: {},
      sourcePolicyManifest: source.policies,
    },
  });
  assert.equal(candidate.status, 'candidate', JSON.stringify(candidate.issues));
  const root = join(temp, 'candidate-runtime');
  runtime = new OpenSocietyRuntime(root, candidate.manifest);
  assert.deepEqual(runtime.state.world, candidate.manifest.initialWorld);
  const before = structuredClone(runtime.state);
  assert.equal(runtime.advanceTime(1, 'candidate-validation').ok, true);
  assert.equal(runtime.state.world.clock.now, before.world.clock.now + 1);
  assert.equal(runtime.state.world.moneySupply, before.world.moneySupply);
  assert.deepEqual(runtime.state.experiences, before.experiences);
  const transits = Object.values(before.world.transitByAgent ?? {});
  const lastArrival = Math.max(before.world.clock.now + 1, ...transits.map((t) => t.arrivesAt));
  if (lastArrival > runtime.state.world.clock.now) {
    const result = runtime.advanceTime(
      lastArrival - runtime.state.world.clock.now,
      'candidate-arrival-validation',
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  for (const trip of transits) {
    assert.equal(runtime.state.world.agents[trip.agentId].locationId, trip.toLocationId);
    assert.equal(runtime.state.world.transitByAgent?.[trip.agentId], undefined);
  }
  const after = structuredClone(runtime.state);
  runtime.close();
  runtime = new OpenSocietyRuntime(root);
  assert.deepEqual(runtime.state, after);
  for (const path of files.keys()) read(path);
  const report = {
    passed: true,
    archive,
    residents: residents.length,
    completedOriginalTrips: transits.length,
    retainedMoves: candidate.sourceBarrier.movementContinuity.retainedMoves.length,
    jobApplications: candidate.manifest.initialWorld.jobApplications.length,
    historicalRecords: Object.values(before.experiences).reduce((n, rows) => n + rows.length, 0),
    moneySupply: before.world.moneySupply,
    sourceTime: before.world.clock.now,
    isolatedValidationTime: after.world.clock.now,
    restartReplayMatched: true,
    archiveUnchanged: true,
    candidateManifestSha256: digest(JSON.stringify(candidate.manifest)),
    limitations: [
      'Isolated temporary runtime only; no production activation, retirement or model run.',
      'Explicit known source profile/default policy fixture; no general importer or full revision/operation history mapping.',
      'New social policies are not implicitly enabled; complete 25-capability delivery remains unfinished.',
    ],
  };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  runtime?.close();
  rmSync(temp, { recursive: true, force: true });
}
