import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import {
  FileLocalSimulationRuntimeResolvedRunManifestRepository,
  createLocalWorldRuntimeStorage,
  createWorldProjectionFromScenario,
  hydrateWorldProjectionFromEventStream,
  type LocalSimulationRuntimeResolvedRunManifest,
} from '@aivilization/worker';
import {
  createLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownDaemonScenarioProfileId,
} from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownPaperEvidencePartition = {
  readonly partitionKey: string;
  readonly initialProjection: WorldProjection;
  readonly finalProjection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly observabilityDir: string;
  readonly toSimulatedTime: (wallClockTimestamp: number) => number;
};

export type LocalRuntimeTownPaperEvidenceSource = {
  readonly runManifest: LocalSimulationRuntimeResolvedRunManifest;
  readonly profile: LocalRuntimeTownDaemonScenarioProfile;
  readonly partitions: readonly LocalRuntimeTownPaperEvidencePartition[];
};

export async function loadLocalRuntimeTownPaperEvidenceSource(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly runManifestId: string;
}): Promise<LocalRuntimeTownPaperEvidenceSource> {
  const { runManifest, profile } = await loadLocalRuntimeTownPaperRunManifest(input);
  assertExactPartitionDirectorySet({
    rootDir: input.rootDir,
    simulationId: input.simulationId,
    partitionKeys: profile.manifest.partitions.map((partition) => partition.partitionKey),
  });

  const partitions = profile.manifest.partitions.map((partition, index) => {
    if (partition.simulationId !== input.simulationId) {
      throw new Error(
        `profile partition ${partition.partitionKey} belongs to ${partition.simulationId}, not ${input.simulationId}`,
      );
    }
    const preset = profile.scenarioPresets[index];
    if (preset === undefined || preset.id !== partition.scenarioPresetId) {
      throw new Error(`scenario preset mismatch for partition ${partition.partitionKey}`);
    }
    const initialProjection = createWorldProjectionFromScenario({
      preset,
      ...(partition.marketPools === undefined ? {} : { marketPools: partition.marketPools }),
      ...(partition.moneySupply === undefined ? {} : { moneySupply: partition.moneySupply }),
    });
    const storage = createLocalWorldRuntimeStorage({
      rootDir: input.rootDir,
      simulationId: input.simulationId,
      partitionKey: partition.partitionKey,
    });
    const hydrated = hydrateWorldProjectionFromEventStream({
      initialProjection,
      eventStore: storage.eventStore,
      streamName: storage.partition.eventStreamName,
      checkpoint: {
        checkpointStore: storage.checkpointStore,
        snapshotStore: storage.snapshotStore,
        lookup: {
          simulationId: storage.partition.simulationId,
          partitionKey: storage.partition.partitionKey,
        },
      },
    });
    const rawEvents = storage.eventStore.readStream(storage.partition.eventStreamName);
    const toSimulatedTime = createWallClockToSimulatedTimeMapper({
      events: rawEvents,
      initialSimulatedTime: initialProjection.clock.now,
    });
    return {
      partitionKey: partition.partitionKey,
      initialProjection,
      finalProjection: hydrated.projection,
      events: normalizeWorldEventsToSimulatedTime(rawEvents, initialProjection.clock.now),
      observabilityDir: storage.paths.observabilityDir,
      toSimulatedTime,
    };
  });
  return { runManifest, profile, partitions };
}

function createWallClockToSimulatedTimeMapper(input: {
  readonly events: readonly WorldEvent[];
  readonly initialSimulatedTime: number;
}): (wallClockTimestamp: number) => number {
  const samples = input.events
    .filter(
      (event): event is Extract<WorldEvent, { readonly type: 'SimulationTimeAdvanced' }> =>
        event.type === 'SimulationTimeAdvanced',
    )
    .map((event) => ({ wallClockTimestamp: event.occurredAt, simulatedTime: event.payload.next.now }))
    .sort((left, right) => left.wallClockTimestamp - right.wallClockTimestamp);
  return (wallClockTimestamp: number) => {
    let simulatedTime = input.initialSimulatedTime;
    for (const sample of samples) {
      if (sample.wallClockTimestamp > wallClockTimestamp) {
        break;
      }
      simulatedTime = sample.simulatedTime;
    }
    return simulatedTime;
  };
}

function normalizeWorldEventsToSimulatedTime(
  events: readonly WorldEvent[],
  initialSimulatedTime: number,
): WorldEvent[] {
  let simulatedTime = initialSimulatedTime;
  return events.map((event) => {
    if (event.type === 'SimulationTimeAdvanced') {
      simulatedTime = event.payload.next.now;
    }
    return { ...event, occurredAt: simulatedTime };
  });
}

export async function loadLocalRuntimeTownPaperRunManifest(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly runManifestId: string;
}): Promise<{
  readonly runManifest: LocalSimulationRuntimeResolvedRunManifest;
  readonly profile: LocalRuntimeTownDaemonScenarioProfile;
}> {
  const runManifestRepository = new FileLocalSimulationRuntimeResolvedRunManifestRepository({
    rootDir: join(input.rootDir, 'operations'),
  });
  const runManifest = await runManifestRepository.get(input.runManifestId);
  if (runManifest === undefined) {
    throw new Error(`resolved run manifest does not exist: ${input.runManifestId}`);
  }
  const profileId = requireProfileId(runManifest.payload.scenario.profileId);
  const profile = createLocalRuntimeTownDaemonScenarioProfile(profileId);
  assertManifestScenarioMatchesProfile({ runManifest, profile, simulationId: input.simulationId });
  return { runManifest, profile };
}

export function resolvePaperEvidenceManifestPartitionKeys(
  scenario: Readonly<Record<string, unknown>>,
  simulationId: string,
): string[] {
  const manifest = scenario.manifest;
  if (!isRecord(manifest) || !Array.isArray(manifest.partitions) || manifest.partitions.length === 0) {
    throw new Error('resolved run manifest scenario must contain partitions');
  }
  const partitionKeys = new Set<string>();
  for (const [index, partition] of manifest.partitions.entries()) {
    if (!isRecord(partition)) {
      throw new Error(`resolved run manifest partition ${index} must be an object`);
    }
    if (partition.simulationId !== simulationId) {
      throw new Error(
        `resolved run manifest partition ${index} simulation ${String(partition.simulationId)} does not match ${simulationId}`,
      );
    }
    if (typeof partition.partitionKey !== 'string' || partition.partitionKey.trim().length === 0) {
      throw new Error(`resolved run manifest partition ${index} has no partitionKey`);
    }
    if (partitionKeys.has(partition.partitionKey)) {
      throw new Error(`resolved run manifest repeats partition ${partition.partitionKey}`);
    }
    partitionKeys.add(partition.partitionKey);
  }
  return [...partitionKeys].sort();
}

function assertManifestScenarioMatchesProfile(input: {
  readonly runManifest: LocalSimulationRuntimeResolvedRunManifest;
  readonly profile: LocalRuntimeTownDaemonScenarioProfile;
  readonly simulationId: string;
}): void {
  const manifestPartitionKeys = resolvePaperEvidenceManifestPartitionKeys(
    input.runManifest.payload.scenario,
    input.simulationId,
  );
  const profilePartitionKeys = input.profile.manifest.partitions
    .map((partition) => partition.partitionKey)
    .sort();
  if (JSON.stringify(manifestPartitionKeys) !== JSON.stringify(profilePartitionKeys)) {
    throw new Error('resolved run manifest partition set does not match its canonical profile');
  }
  const manifestId = input.runManifest.payload.scenario.manifest;
  if (!isRecord(manifestId) || manifestId.id !== input.profile.manifest.id) {
    throw new Error('resolved run manifest scenario ID does not match its canonical profile');
  }
}

function assertExactPartitionDirectorySet(input: {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly partitionKeys: readonly string[];
}): void {
  const partitionsDir = join(
    input.rootDir,
    'simulations',
    encodeURIComponent(input.simulationId),
    'partitions',
  );
  if (!existsSync(partitionsDir)) {
    throw new Error(`simulation partitions directory does not exist: ${partitionsDir}`);
  }
  const expected = new Set(input.partitionKeys.map((key) => encodeURIComponent(key)));
  const actual = readdirSync(partitionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const unexpected = actual.filter((name) => !expected.has(name));
  const missing = [...expected].filter((name) => !actual.includes(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `runtime partition directories differ from manifest (missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'})`,
    );
  }
}

function requireProfileId(value: unknown): LocalRuntimeTownDaemonScenarioProfileId {
  if (
    value !== 'smoke-25' &&
    value !== 'default-100' &&
    value !== 'headless-stress-1000' &&
    value !== 'recovery-drill-25' &&
    value !== 'ablation-80'
  ) {
    throw new Error(`resolved run manifest has unsupported scenario profile ${String(value)}`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
