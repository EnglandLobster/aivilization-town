import type * as Fs from 'node:fs';
import { renameSync, existsSync } from 'node:fs';
import { publishCanonicalSocietyCutover } from './canonicalSocietyCutover';
import { acquireCanonicalRuntimeOwnership } from './canonicalRuntimeOwnership';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof Fs>();
  return { ...original, renameSync: vi.fn(original.renameSync) };
});
import {
  FileEventStore,
  FileProjectionSnapshotStore,
  FileProjectionCheckpointStore,
  createSimulationPartition,
  createEventEnvelope,
  asSimulationId,
} from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection, type WorldEvent } from '@aivilization/world';
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
  createOpenSocietyManifest,
  createLocalSimulationRuntimeResolvedRunManifest,
  createLocalSimulationRuntimeJsonObject,
  createAivilizationWorldPolicyManifest,
  type SimulationWideAuthoritySnapshot,
  OpenSocietyRuntime,
} from '@aivilization/worker';
import {
  exportCanonicalSocietyArchive,
  verifyCanonicalSocietyArchive,
} from './canonicalSocietyArchive';
import { readCanonicalSocietySource } from './canonicalSocietySource';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(legacyEvent = false) {
  const root = mkdtempSync(join(tmpdir(), 'canonical-source-test-'));
  roots.push(root);
  const sourceRoot = join(root, 'source');
  const m = createOpenSocietyManifest({ count: 2, life: false, societyKernel: false });
  const partition = createSimulationPartition({ simulationId: 'source', partitionKey: 'p' });
  const dir = join(sourceRoot, 'simulations', 'source', 'partitions', 'p');
  mkdirSync(dir, { recursive: true });
  const snapshot = new FileProjectionSnapshotStore<WorldProjection>({ rootDir: dir }).saveSnapshot({
    simulationId: 'source',
    partitionKey: partition.partitionKey,
    sequence: 0,
    createdAt: m.initialWorld.clock.now,
    projection: m.initialWorld,
  });
  new FileProjectionCheckpointStore({ rootDir: join(dir, 'checkpoints') }).saveCheckpoint({
    simulationId: asSimulationId('source'),
    partitionKey: partition.partitionKey,
    lastAppliedSequence: 0,
    snapshot,
  });
  const event: WorldEvent = createEventEnvelope({
    id: 'time-1',
    commandId: 'old-time',
    simulationId: 'source',
    ...(legacyEvent ? {} : { partitionKey: partition.partitionKey }),
    sequence: 1,
    occurredAt: 1,
    type: 'SimulationTimeAdvanced',
    payload: {
      previous: m.initialWorld.clock,
      next: { ...m.initialWorld.clock, now: m.initialWorld.clock.now + 1 },
      deltaMs: 1,
    },
  });
  new FileEventStore<WorldEvent>({ rootDir: join(dir, 'events') }).appendToStream({
    streamName: partition.eventStreamName,
    idempotencyKey: 'old-append',
    expectedVersion: 0,
    events: [event],
  });
  const world = applyWorldEvent(m.initialWorld, event);
  new FileShortTermMemoryRepository({ rootDir: join(dir, 'memory') });
  new FileLongTermProfileRepository({ rootDir: join(dir, 'memory') });
  new FileAgentIntentionRepository({ rootDir: join(dir, 'memory') });
  new FileBranchPlanRepository({ rootDir: join(dir, 'planning') });
  new FileBranchPlanProgressRepository({ rootDir: join(dir, 'planning') });
  const authority: SimulationWideAuthoritySnapshot = {
    schemaVersion: 'simulation-wide-authority-v1',
    simulationId: asSimulationId('source'),
    authorityId: 'source',
    manifestId: 'scenario',
    revision: 0,
    latestFencingToken: 0,
    projection: world,
    partitionKeys: ['p'],
    ownerPartitionKeyByAgentId: Object.fromEntries(m.residents.map((r) => [r.id, 'p'])),
    partitionClockNowByKey: { p: world.clock.now },
    partitionAccountsByKey: {
      p: {
        moneySupply: world.moneySupply,
        ...(world.treasury === undefined ? {} : { treasury: world.treasury }),
      },
    },
    pendingTransfers: {},
    operations: {},
    materializerCursors: {
      'p:reader': {
        partitionKey: 'p',
        consumerId: 'reader',
        throughFencingToken: 0,
        materializedAt: 0,
      },
    },
  };
  const authorityDir = join(sourceRoot, 'simulation-wide-authority', 'source');
  mkdirSync(authorityDir, { recursive: true });
  writeFileSync(join(authorityDir, 'state.json'), JSON.stringify(authority));
  const manifest = createLocalSimulationRuntimeResolvedRunManifest({
    schemaVersion: 'local-simulation-resolved-run-manifest-v1',
    sourceRevision: { commit: '0123456789abcdef0123456789abcdef01234567', dirty: false },
    seed: m.seed,
    composition: {},
    scenario: createLocalSimulationRuntimeJsonObject(
      {
        manifest: { id: 'scenario' },
        scenarioPresets: [
          {
            agentSeeds: m.residents.map((r) => ({
              agentId: r.id,
              displayName: r.displayName,
              profile: { original: r.background },
            })),
          },
        ],
      },
      'scenario',
    ),
    policies: createLocalSimulationRuntimeJsonObject(
      createAivilizationWorldPolicyManifest(),
      'policies',
    ),
    cognition: {},
    memory: {},
    observations: {},
    validation: {},
    runtime: {},
  });
  const manifestDir = join(sourceRoot, 'operations', 'resolved-run-manifests');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, 'source.json'), JSON.stringify(manifest));
  const archiveRoot = join(root, 'archive');
  const archive = () =>
    exportCanonicalSocietyArchive({
      sourceRoot,
      targetRoot: archiveRoot,
      sourceWriterConfirmedStopped: true,
    });
  const input = {
    archiveRoot,
    simulationId: 'source',
    runManifestId: manifest.runManifestId,
    policyConfiguration: {},
    consumerIds: { p: 'reader' },
  };
  return { root, sourceRoot, dir, archiveRoot, archive, input, world };
}
test('source-bound reader replays snapshot tail and imports complete receipts without mutating the archive', async () => {
  const f = fixture(true);
  const before = f.archive();
  const loaded = await readCanonicalSocietySource(f.input);
  expect(loaded.candidate.status).toBe('candidate');
  if (loaded.candidate.status !== 'candidate') throw Error(JSON.stringify(loaded.candidate.issues));
  expect(loaded.candidate.manifest.initialWorld).toEqual(f.world);
  expect(
    loaded.candidate.manifest.canonicalRequestHistory?.partitions[0]?.appends[0]?.idempotencyKey,
  ).toBe('old-append');
  expect(loaded.source.runManifestId).toBe(f.input.runManifestId);
  expect(verifyCanonicalSocietyArchive(f.archiveRoot)).toEqual(before);
  const runtime = new OpenSocietyRuntime(join(f.root, 'target'), loaded.candidate.manifest);
  try {
    expect(runtime.advanceTime(1, 'old-time')).toMatchObject({
      ok: false,
      error: 'historical-request-id',
    });
    expect(runtime.advanceTime(1, 'new-time').ok).toBe(true);
  } finally {
    runtime.close();
  }
  await expect(
    readCanonicalSocietySource({ ...f.input, consumerIds: { p: 'unknown' } }),
  ).rejects.toThrow('consumer-unrecorded');
  await expect(
    readCanonicalSocietySource({ ...f.input, runManifestId: 'missing' }),
  ).rejects.toThrow('manifest-not-unique');
});
test('missing original cognition and incomplete checkpoint tails are rejected instead of invented', async () => {
  const f = fixture();
  rmSync(join(f.dir, 'memory', 'agent-intentions.jsonl'));
  f.archive();
  await expect(readCanonicalSocietySource(f.input)).rejects.toThrow('file-outside-archive');
  const g = fixture();
  const path = join(g.dir, 'checkpoints', 'projection-checkpoints.jsonl');
  writeFileSync(path, readFileSync(path).toString().trimEnd());
  g.archive();
  await expect(readCanonicalSocietySource(g.input)).rejects.toThrow('checkpoint-incomplete');
});
test('snapshot URI cannot escape the archived source even when archive hashes are valid', async () => {
  const f = fixture();
  const path = join(f.dir, 'checkpoints', 'projection-checkpoints.jsonl');
  const checkpoint = JSON.parse(readFileSync(path, 'utf8')) as { snapshot: { uri: string } };
  checkpoint.snapshot.uri = 'file:///outside/source.json';
  writeFileSync(path, JSON.stringify(checkpoint) + '\n');
  f.archive();
  await expect(readCanonicalSocietySource(f.input)).rejects.toThrow('file-outside-archive');
});

test('pending storage transactions and altered run manifest content cannot become migration candidates', async () => {
  const f = fixture();
  writeFileSync(join(f.dir, 'events', 'append-transaction.pending.json'), '{}');
  f.archive();
  await expect(readCanonicalSocietySource(f.input)).rejects.toThrow('pending-append');
  const g = fixture();
  const path = join(g.sourceRoot, 'operations', 'resolved-run-manifests', 'source.json');
  const record = JSON.parse(readFileSync(path, 'utf8')) as { payload: { seed: string } };
  record.payload.seed = 'changed';
  writeFileSync(path, JSON.stringify(record));
  g.archive();
  await expect(readCanonicalSocietySource(g.input)).rejects.toThrow('run-manifest-integrity');
});

test('publication retires the unchanged source, preserves target facts on retry and replays', async () => {
  const f = fixture();
  const archived = f.archive();
  const targetRoot = join(f.root, 'published');
  const input = { ...f.input, targetRoot, sourceWriterConfirmedStopped: true as const };
  const receipt = await publishCanonicalSocietyCutover(input);
  expect(receipt.status).toBe('published');
  expect(() => acquireCanonicalRuntimeOwnership(f.sourceRoot, 'writer')).toThrow('source-retired');
  const runtime = new OpenSocietyRuntime(targetRoot);
  try {
    expect(runtime.advanceTime(1, 'after-cutover').ok).toBe(true);
  } finally {
    runtime.close();
  }
  const journal = readFileSync(join(targetRoot, 'journal.jsonl'));
  expect((await publishCanonicalSocietyCutover(input)).status).toBe('already-published');
  expect(readFileSync(join(targetRoot, 'journal.jsonl'))).toEqual(journal);
  expect(verifyCanonicalSocietyArchive(f.archiveRoot)).toEqual(archived);
  const resumed = new OpenSocietyRuntime(targetRoot);
  try {
    expect(resumed.state.world.clock.now).toBe(f.world.clock.now + 1);
  } finally {
    resumed.close();
  }
});
test('publication failure after retirement stays fenced and resumes the same binding', async () => {
  const f = fixture();
  f.archive();
  const targetRoot = join(f.root, 'published');
  const input = { ...f.input, targetRoot, sourceWriterConfirmedStopped: true as const };
  vi.mocked(renameSync).mockImplementationOnce(() => {
    throw new Error('injected-publication-failure');
  });
  await expect(publishCanonicalSocietyCutover(input)).rejects.toThrow(
    'injected-publication-failure',
  );
  expect(existsSync(targetRoot)).toBe(false);
  expect(() => acquireCanonicalRuntimeOwnership(f.sourceRoot, 'writer')).toThrow('source-retired');
  await expect(
    publishCanonicalSocietyCutover({ ...input, targetRoot: join(f.root, 'other') }),
  ).rejects.toThrow('binding-conflict');
  expect((await publishCanonicalSocietyCutover(input)).status).toBe('published');
});
test('changed source, overlapping or occupied targets, and extra simulations reject before retirement', async () => {
  for (const mode of ['changed', 'overlap', 'occupied', 'multiple'] as const) {
    const f = fixture();
    if (mode === 'multiple') mkdirSync(join(f.sourceRoot, 'simulations', 'other'));
    f.archive();
    const targetRoot = mode === 'overlap' ? join(f.sourceRoot, 'target') : join(f.root, 'target');
    if (mode === 'changed') writeFileSync(join(f.sourceRoot, 'new-fact'), 'changed');
    if (mode === 'occupied') {
      mkdirSync(targetRoot);
      writeFileSync(join(targetRoot, 'original'), 'keep');
    }
    await expect(
      publishCanonicalSocietyCutover({
        ...f.input,
        targetRoot,
        sourceWriterConfirmedStopped: true,
      }),
    ).rejects.toThrow();
    const writer = acquireCanonicalRuntimeOwnership(f.sourceRoot, 'writer');
    writer.release();
    if (mode === 'occupied')
      expect(readFileSync(join(targetRoot, 'original'), 'utf8')).toBe('keep');
    else expect(existsSync(targetRoot)).toBe(false);
  }
});
