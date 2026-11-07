import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import {
  FileEventStore,
  FILE_EVENT_PENDING_APPEND_PATH,
  type ProjectionCheckpoint,
} from '@aivilization/sim-core';
import { applyWorldEvent, type WorldEvent, type WorldProjection } from '@aivilization/world';
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
  createCanonicalRequestHistory,
  readCanonicalResidentMemory,
  readCanonicalCognitiveDocuments,
  createLocalSimulationRuntimeResolvedRunManifest,
  type LocalSimulationRuntimeResolvedRunManifest,
  type SimulationWideAuthoritySnapshot,
  type CanonicalPolicyContinuation,
} from '@aivilization/worker';
import { verifyCanonicalSocietyArchive } from './canonicalSocietyArchive';

/** Read only verified archive bytes. Mutable legacy repositories operate on a disposable copy. */
export async function readCanonicalSocietySource(input: {
  readonly archiveRoot: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly policyConfiguration: CanonicalPolicyContinuation['configuration'];
  readonly consumerIds: Readonly<Record<string, string>>;
}) {
  const archive = verifyCanonicalSocietyArchive(input.archiveRoot);
  const files = new Map(
    archive.entries.filter((e) => e.kind === 'file').map((e) => [e.path, e.sha256]),
  );
  const read = (path: string) => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..') || !files.has(path))
      throw new Error('canonical-source-file-outside-archive');
    const bytes = readFileSync(join(input.archiveRoot, 'source', path));
    if (createHash('sha256').update(bytes).digest('hex') !== files.get(path))
      throw new Error('canonical-source-file-changed');
    return bytes;
  };
  // Typed persisted envelopes are subsequently bound to the requested identity, original hash,
  // checkpoint reference and domain/barrier validators. Never read their original file URI.
  const authorityPath = `simulation-wide-authority/${encodeURIComponent(input.simulationId)}/state.json`;
  const authority = JSON.parse(read(authorityPath).toString()) as SimulationWideAuthoritySnapshot;
  if (
    authority.schemaVersion !== 'simulation-wide-authority-v1' ||
    authority.simulationId !== input.simulationId
  )
    throw new Error('canonical-source-authority-mismatch');
  const manifests = [...files.keys()].filter(
    (p) => p.startsWith('operations/resolved-run-manifests/') && p.endsWith('.json'),
  );
  const selected = manifests
    .map((path) => ({
      path,
      record: JSON.parse(read(path).toString()) as LocalSimulationRuntimeResolvedRunManifest,
    }))
    .filter((m) => m.record.runManifestId === input.runManifestId);
  if (selected.length !== 1) throw new Error('canonical-source-run-manifest-not-unique');
  const source = selected[0]!;
  if (
    !isDeepStrictEqual(
      createLocalSimulationRuntimeResolvedRunManifest(source.record.payload),
      source.record,
    )
  )
    throw new Error('canonical-source-run-manifest-integrity');
  const payload = source.record.payload;
  const scenario = payload.scenario.manifest;
  if (
    !scenario ||
    typeof scenario !== 'object' ||
    Array.isArray(scenario) ||
    !('id' in scenario) ||
    scenario.id !== authority.manifestId
  )
    throw new Error('canonical-source-scenario-mismatch');
  if (
    !isDeepStrictEqual(Object.keys(input.consumerIds).sort(), [...authority.partitionKeys].sort())
  )
    throw new Error('canonical-source-consumer-set-mismatch');
  const temp = mkdtempSync(join(tmpdir(), 'canonical-source-reader-'));
  try {
    const partitions = authority.partitionKeys.map((partitionKey) => {
      const dir = `simulations/${encodeURIComponent(input.simulationId)}/partitions/${encodeURIComponent(partitionKey)}`;
      const checkpoints = read(`${dir}/checkpoints/projection-checkpoints.jsonl`).toString();
      if (!checkpoints.endsWith('\n') || !checkpoints.trim())
        throw new Error('canonical-source-checkpoint-incomplete');
      const rows = checkpoints
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line) as ProjectionCheckpoint);
      for (const row of rows)
        if (
          row.simulationId !== input.simulationId ||
          row.partitionKey !== partitionKey ||
          !Number.isSafeInteger(row.lastAppliedSequence) ||
          row.lastAppliedSequence < 0
        )
          throw new Error('canonical-source-checkpoint-identity');
      const checkpoint = rows.at(-1)!;
      const ref = checkpoint.snapshot;
      if (
        !ref ||
        ref.simulationId !== input.simulationId ||
        ref.partitionKey !== partitionKey ||
        !Number.isSafeInteger(ref.sequence) ||
        ref.sequence < 0 ||
        ref.sequence > checkpoint.lastAppliedSequence
      )
        throw new Error('canonical-source-snapshot-reference');
      const snapshot = JSON.parse(
        read(relative(archive.sourceRoot, fileURLToPath(ref.uri))).toString(),
      ) as { reference: unknown; projection: WorldProjection };
      if (!isDeepStrictEqual(snapshot.reference, ref))
        throw new Error('canonical-source-snapshot-mismatch');
      if (files.has(`${dir}/events/${FILE_EVENT_PENDING_APPEND_PATH}`))
        throw new Error('canonical-source-pending-append');
      const local = join(temp, encodeURIComponent(partitionKey));
      cpSync(join(input.archiveRoot, 'source', dir), local, { recursive: true });
      const store = new FileEventStore<WorldEvent>({ rootDir: join(local, 'events') });
      const stream = `simulation/${input.simulationId}/partition/${partitionKey}/events`;
      const events = store.readStream(stream);
      const version = store.getStreamVersion(stream);
      if (version < checkpoint.lastAppliedSequence || events.length !== version)
        throw new Error('canonical-source-event-history-incomplete');
      let projection = snapshot.projection;
      for (let i = 0; i < events.length; i++) {
        const event = events[i]!;
        if (
          event.sequence !== i + 1 ||
          event.simulationId !== input.simulationId ||
          (event.partitionKey !== undefined && event.partitionKey !== partitionKey)
        )
          throw new Error('canonical-source-event-identity');
        if (event.sequence > ref.sequence) projection = applyWorldEvent(projection, event);
      }
      const consumerId = input.consumerIds[partitionKey]!;
      const cursors = Object.values(authority.materializerCursors).filter(
        (c) => c.consumerId === consumerId && c.partitionKey === partitionKey,
      );
      if (cursors.length !== 1) throw new Error('canonical-source-consumer-unrecorded');
      for (const name of [
        'memory/long-term-profiles.jsonl',
        'memory/agent-intentions.jsonl',
        'planning/branch-plans.jsonl',
        'planning/branch-plan-progress.jsonl',
      ])
        read(`${dir}/${name}`);
      if (
        !files.has(`${dir}/memory/short-term-memory.jsonl`) &&
        !files.has(`${dir}/memory/short-term-memory.deflate`)
      )
        throw new Error('canonical-source-memory-ledger-missing');
      const profiles = new FileLongTermProfileRepository({ rootDir: join(local, 'memory') });
      const intentions = new FileAgentIntentionRepository({ rootDir: join(local, 'memory') });
      const plans = new FileBranchPlanRepository({ rootDir: join(local, 'planning') });
      const progress = new FileBranchPlanProgressRepository({ rootDir: join(local, 'planning') });
      return {
        partitionKey,
        consumerId,
        projection,
        appends: store.readIdempotentAppends(),
        repository: new FileShortTermMemoryRepository({ rootDir: join(local, 'memory') }),
        profiles,
        intentions,
        planning: { plans, progress },
        history: {
          profile: profiles,
          intentions,
          'branch-plan': plans,
          'branch-progress': progress,
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
    const presets = payload.scenario.scenarioPresets;
    if (!Array.isArray(presets)) throw new Error('canonical-source-resident-identities-missing');
    const presetRows: readonly unknown[] = presets;
    const seeds = presetRows.flatMap((p) => {
      if (
        !p ||
        typeof p !== 'object' ||
        Array.isArray(p) ||
        !('agentSeeds' in p) ||
        !Array.isArray(p.agentSeeds)
      )
        throw new Error('canonical-source-resident-identities-invalid');
      const agentSeeds: readonly unknown[] = p.agentSeeds;
      return agentSeeds;
    });
    const residents = residentIds.map((id) => {
      const matches = seeds.filter(
        (s) =>
          s && typeof s === 'object' && !Array.isArray(s) && 'agentId' in s && s.agentId === id,
      );
      const seed = matches[0];
      if (
        matches.length !== 1 ||
        !seed ||
        typeof seed !== 'object' ||
        Array.isArray(seed) ||
        !('displayName' in seed) ||
        typeof seed.displayName !== 'string' ||
        !('profile' in seed) ||
        !seed.profile
      )
        throw new Error('canonical-source-resident-identity-unmapped');
      return { id, displayName: seed.displayName, background: JSON.stringify(seed.profile) };
    });
    const candidate = createCanonicalSocietyCandidate({
      authority,
      partitions,
      residents,
      memories,
      documents,
      requestHistory: createCanonicalRequestHistory({
        authority,
        partitions: partitions.map(({ partitionKey, appends }) => ({ partitionKey, appends })),
      }),
      policies: {
        version: 'canonical-policy-continuation-v1',
        seed: payload.seed,
        configuration: input.policyConfiguration,
        sourcePolicyManifest: payload.policies,
      },
    });
    if (!isDeepStrictEqual(verifyCanonicalSocietyArchive(input.archiveRoot), archive))
      throw new Error('canonical-source-archive-changed');
    return {
      candidate,
      source: {
        archive,
        authorityPath,
        runManifestPath: source.path,
        runManifestId: source.record.runManifestId,
        sourceRevision: payload.sourceRevision,
        consumerIds: structuredClone(input.consumerIds),
      },
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
