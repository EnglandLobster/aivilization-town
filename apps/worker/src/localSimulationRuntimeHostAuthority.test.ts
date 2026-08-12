import { asAgentId, asLocationId, createCommandEnvelope, type AgentId } from '@aivilization/sim-core';
import { type ScenarioPreset } from '@aivilization/content';
import { type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
  createAivilizationSocialMattersPolicy,
  createAivilizationTownBulletinPolicy,
  createAivilizationTownConflictPolicy,
  createAivilizationWorldCommandPolicies,
  type LocalSimulationRuntimeManifest,
} from './index';

const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const mainSquare = asLocationId('main-square');

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
};

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local simulation runtime host simulation-wide authority wiring', () => {
  test('exposes authority and materializers when enabled and keeps legacy interactions disabled', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });

    expect(host.authorityEnabled).toBe(true);
    expect(host.authority).toBeDefined();
    expect(host.materializers.size).toBe(2);
    expect([...host.materializers.keys()].sort()).toEqual(['world-east', 'world-main']);
    expect(host.authority?.getSnapshot().partitionKeys).toEqual(['world-east', 'world-main']);

    // The legacy cross-partition conversation transaction is intentionally
    // disabled while the authority owns social interaction settlement.
    await expect(
      host.socialInteractions.executeConversation({
        operationId: 'should-be-disabled',
        simulationId: 'sim-1',
        initiatorAgentId: agentOne,
        targetAgentId: agentTwo,
        topic: 'disabled',
        turns: [{ speakerAgentId: agentOne, utterance: 'ignored' }],
        issuedAt: 100,
      }),
    ).rejects.toThrow('simulation-wide authority');
  });

  test('fails bootstrap closed when two partitions claim the same location affinity', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const conflicted: LocalSimulationRuntimeManifest = {
      ...manifest,
      partitions: manifest.partitions.map((partition) => ({
        ...partition,
        ownedLocationIds: ['main-square'],
      })),
    };

    await expect(
      bootstrapLocalSimulationRuntimeHostFromManifest({
        rootDir,
        bootstrappedAt: 100,
        manifest: conflicted,
        scenarioPresets: createScenarioPresets(),
        policies,
        localizedPlanners: [],
        steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
        agents: [],
        simulationWideAuthority: {
          enabled: true,
          workerId: 'authority-worker',
          leaseDurationMs: 30_000,
        },
      }),
    ).rejects.toThrow(/affinity must be unambiguous/);
  });

  test('settles a trade through the authority and materializes it onto the owner partition', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    const trade = authority.settleTrade({
      operationId: 'trade-fish-1',
      agentId: agentOne,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      ...lease,
    });
    expect(trade.ownerPartitionKey).toBe('world-main');

    const before = host.partitions[0]!.bootstrap.storage.eventStore.getStreamVersion(
      host.partitions[0]!.bootstrap.storage.partition.eventStreamName,
    );
    expect(before).toBe(0);

    const materialized = await host.materializers.get('world-main')!.materializeInbox({
      lease,
    });
    expect(materialized.materializedOperationIds).toEqual(['trade-fish-1']);
    expect(materialized.cursor?.throughFencingToken).toBe(1);

    const after = host.partitions[0]!.bootstrap.storage.eventStore.getStreamVersion(
      host.partitions[0]!.bootstrap.storage.partition.eventStreamName,
    );
    expect(after).toBeGreaterThan(0);

    // The owner partition checkpoint advanced to the materialized boundary.
    const mainStorage = host.partitions[0]!.bootstrap.storage;
    const checkpoint = mainStorage.checkpointStore.getLatestCheckpoint({
      simulationId: mainStorage.partition.simulationId,
      partitionKey: 'world-main',
    });
    expect(checkpoint?.lastAppliedSequence).toBe(after);

    // Replaying materialize consumes nothing (inbox cursor already advanced).
    const replay = await host.materializers.get('world-main')!.materializeInbox({ lease });
    expect(replay.materializedOperationIds).toEqual([]);
    expect(replay.idempotent).toBe(true);
  });

  test('merges per-partition pools into one global pool both partitions trade against', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    // The two partitions each seed an identical Fish pool (100 / 1000) and a
    // money supply of 1000. The authority seed sums both into ONE global pool.
    // Identical reserves mean summing preserves the seed spot price (10) while
    // doubling depth, and the money supply is the conserved town total.
    const seed = authority.getSnapshot().projection;
    expect(seed.marketPools.Fish!.commodityReserve).toBe(200);
    expect(seed.marketPools.Fish!.currencyReserve).toBe(2_000);
    expect(seed.moneySupply).toBe(2_000);

    // agentOne is owned by world-main; buying 1 Fish moves the single global
    // pool from 200 to 199.
    authority.settleTrade({
      operationId: 'trade-main-buy',
      agentId: agentOne,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      ...lease,
    });
    expect(authority.getSnapshot().projection.marketPools.Fish!.commodityReserve).toBe(199);

    // agentTwo is owned by world-east; its buy starts from 199 (not a fresh
    // per-partition 200), proving both partitions settle against ONE shared
    // pool rather than isolated replicas.
    authority.settleTrade({
      operationId: 'trade-east-buy',
      agentId: agentTwo,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      ...lease,
    });
    expect(authority.getSnapshot().projection.marketPools.Fish!.commodityReserve).toBe(198);
  });

  test('reports a unified-authority market from the global pool in the society projection', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });

    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(projection.market.status).toBe('unified-authority');
    if (projection.market.status !== 'unified-authority') {
      throw new Error('expected a unified-authority market');
    }
    // The two partitions' identical Fish pools (100 / 1000) are summed into one
    // global pool (200 / 2000), and money supply is the town total (2000).
    expect(projection.market.pools).toEqual([
      { commodity: 'Fish', commodityReserve: 200, currencyReserve: 2_000 },
    ]);
    expect(projection.market.moneySupply).toBe(2_000);
  });

  test('sources society-level facts from the authority snapshot before partitions materialize', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    host.authority!.settleConversation({
      operationId: 'conversation-society-view',
      initiatorAgentId: agentOne,
      targetAgentId: agentTwo,
      topic: 'settlement truth',
      turns: [
        { speakerAgentId: agentOne, utterance: 'Are we settled?', intent: 'cooperate' },
        { speakerAgentId: agentTwo, utterance: 'Yes.', intent: 'cooperate' },
      ],
      ...lease,
    });

    // Nothing has been materialized yet: the partition snapshots know no
    // conversation. The society view must still report the authoritative
    // social graph, market, and ledger position rather than the lagging merge.
    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(projection.socialRelations).toHaveLength(2);
    expect(projection.market.status).toBe('unified-authority');
    expect(projection.authority).toMatchObject({ revision: 1, latestFencingToken: 1 });

    // Per-partition boundaries remain honest materialization positions (still
    // at their bootstrap checkpoint while the inbox is unconsumed).
    expect(projection.partitionBoundaries.map((boundary) => boundary.streamVersion)).toEqual([
      0, 0,
    ]);
  });

  test('materializes a cross-owner conversation onto both owner partitions', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    const conversation = authority.settleConversation({
      operationId: 'conversation-1',
      initiatorAgentId: agentOne,
      targetAgentId: agentTwo,
      topic: 'coordinated supply',
      turns: [
        { speakerAgentId: agentOne, utterance: 'Can we coordinate?', intent: 'cooperate' },
        { speakerAgentId: agentTwo, utterance: 'Yes.', intent: 'cooperate' },
      ],
      ...lease,
    });
    expect(conversation.sourcePartitionKey).toBe('world-main');
    expect(conversation.targetPartitionKey).toBe('world-east');

    const mainMaterialized = await host.materializers.get('world-main')!.materializeInbox({
      lease,
    });
    const eastMaterialized = await host.materializers.get('world-east')!.materializeInbox({
      lease,
    });
    expect(mainMaterialized.materializedOperationIds).toEqual(['conversation-1']);
    expect(eastMaterialized.materializedOperationIds).toEqual(['conversation-1']);

    for (const partition of host.partitions) {
      const events = partition.bootstrap.storage.eventStore.readStream(
        partition.bootstrap.storage.partition.eventStreamName,
      );
      const hasConversation = events.some((event) => event.type === 'ConversationRecorded');
      expect(hasConversation).toBe(true);
    }
  });

  test('materializes settlement memory only for the agents each partition owns', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    // The settled conversation emits a short-term memory record for BOTH
    // participants, and the identical event set is delivered to both inboxes.
    authority.settleConversation({
      operationId: 'conversation-memory-scope',
      initiatorAgentId: agentOne,
      targetAgentId: agentTwo,
      topic: 'memory ownership',
      turns: [
        { speakerAgentId: agentOne, utterance: 'Who remembers what?', intent: 'cooperate' },
        { speakerAgentId: agentTwo, utterance: 'Each owner does.', intent: 'cooperate' },
      ],
      ...lease,
    });
    await host.materializers.get('world-main')!.materializeInbox({ lease });
    await host.materializers.get('world-east')!.materializeInbox({ lease });

    const mainMemory = await host.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve(
      { agentId: agentOne, limit: 64 },
    );
    const mainRemoteMemory =
      await host.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        limit: 64,
      });
    const eastMemory = await host.partitions[1]!.bootstrap.storage.shortTermMemoryRepository.retrieve(
      { agentId: agentTwo, limit: 64 },
    );
    const eastRemoteMemory =
      await host.partitions[1]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        limit: 64,
      });

    // Every partition keeps exactly its own Agent's record; the remote
    // participant's record never crosses the ownership boundary.
    expect(mainMemory).toHaveLength(1);
    expect(mainRemoteMemory).toHaveLength(0);
    expect(eastMemory).toHaveLength(1);
    expect(eastRemoteMemory).toHaveLength(0);

    // Replaying the materializer stays duplicate-free without relying on
    // recover-before-tick ordering.
    await host.materializers.get('world-main')!.recover(lease);
    expect(
      await host.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        limit: 64,
      }),
    ).toHaveLength(1);
  });

  test('rolls forward already-materialized deliveries as idempotent no-ops on recover', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    const first = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    first.authority!.settleTrade({
      operationId: 'trade-fish-recover',
      agentId: agentOne,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1 },
      ...lease,
    });
    await first.materializers.get('world-main')!.materializeInbox({ lease });
    const versionAfterFirstMaterialize =
      first.partitions[0]!.bootstrap.storage.eventStore.getStreamVersion(
        first.partitions[0]!.bootstrap.storage.partition.eventStreamName,
      );

    // Restart re-bootstraps the host, which calls materializer.recover() on
    // every partition. Because the inbox cursor is durable, recover replays
    // the already-acknowledged delivery as a no-op and does not advance the
    // stream a second time.
    const restarted = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 999,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const recovered = await restarted.materializers.get('world-main')!.recover(lease);
    expect(recovered.materializedOperationIds).toEqual([]);
    const versionAfterRecover =
      restarted.partitions[0]!.bootstrap.storage.eventStore.getStreamVersion(
        restarted.partitions[0]!.bootstrap.storage.partition.eventStreamName,
      );
    expect(versionAfterRecover).toBe(versionAfterFirstMaterialize);
  });

  test('leaves authority disabled and legacy interactions active by default', async () => {
    const rootDir = createRootDir();
    const manifest = createManifest();
    const scenarioPresets = createScenarioPresets();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest,
      scenarioPresets,
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
    });

    expect(host.authorityEnabled).toBe(false);
    expect(host.authority).toBeUndefined();
    expect(host.materializers.size).toBe(0);

    await expect(
      host.socialInteractions.executeConversation({
        operationId: 'legacy-conversation',
        simulationId: 'sim-1',
        initiatorAgentId: agentOne,
        targetAgentId: agentTwo,
        topic: 'legacy',
        turns: [
          { speakerAgentId: agentOne, utterance: 'legacy path still works' },
          { speakerAgentId: agentTwo, utterance: 'yes' },
        ],
        issuedAt: 100,
      }),
    ).resolves.toMatchObject({
      schemaVersion: 'local-simulation-social-interaction-v1',
      sourcePartitionKey: 'world-main',
      targetPartitionKey: 'world-east',
    });
  });
});

describe('regional markets in the simulation-wide authority', () => {
  const downtownMarket = asLocationId('downtown-market');
  const harborMarket = asLocationId('harbor-market');

  test('regional markets off (default): region-tagged pools still merge within region', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createRegionalManifest(),
      scenarioPresets: createRegionalScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const seed = host.authority!.getSnapshot().projection;

    // Pool merging is driven by whether pools carry a regionId, not by the
    // runtime switch: region-tagged pools merge within their region across
    // partitions regardless of the switch. The switch only governs trade
    // settlement co-location gating. Here both regions still sum to 200 each.
    expect(seed.marketPools['downtown::Fish']?.commodityReserve).toBe(200);
    expect(seed.marketPools['harbor::Fish']?.commodityReserve).toBe(200);
    // The bare-commodity key is absent because the seeds were region-tagged.
    expect(seed.marketPools['Fish']).toBeUndefined();
  });

  test('regional markets on: per-region pools stay independent with divergent prices', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createRegionalManifest(),
      scenarioPresets: createRegionalScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        regionalMarkets: true,
      },
    });
    const authority = host.authority!;
    const seed = authority.getSnapshot().projection;

    // With regional markets ON, downtown and harbor pools are merged *within*
    // their region (2 partitions each) but stay separate *across* regions.
    // downtown: 200 commodity / 2000 currency -> spot 10
    // harbor:   200 commodity / 800  currency -> spot 4
    expect(seed.marketPools['downtown::Fish']?.commodityReserve).toBe(200);
    expect(seed.marketPools['downtown::Fish']?.currencyReserve).toBe(2_000);
    expect(seed.marketPools['downtown::Fish']?.regionId).toBe('downtown');
    expect(seed.marketPools['harbor::Fish']?.commodityReserve).toBe(200);
    expect(seed.marketPools['harbor::Fish']?.currencyReserve).toBe(800);
    expect(seed.marketPools['harbor::Fish']?.regionId).toBe('harbor');
    // The bare-commodity global key must NOT exist when regional markets are on.
    expect(seed.marketPools['Fish']).toBeUndefined();
    // money supply is still the conserved town total (2 partitions x 1000).
    expect(seed.moneySupply).toBe(2_000);
  });

  test('regional markets on: society projection reports a regional-authority market', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createRegionalManifest(),
      scenarioPresets: createRegionalScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        regionalMarkets: true,
      },
    });

    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    // Region-tagged pools surface as a `regional-authority` market: one authority,
    // multiple regional markets with divergent prices, never a hidden town average.
    expect(projection.market.status).toBe('regional-authority');
    if (projection.market.status !== 'regional-authority') {
      throw new Error('expected a regional-authority market');
    }
    expect(projection.market.moneySupply).toBe(2_000);
    const regionIds = projection.market.regions.map((region) => region.regionId).sort();
    expect(regionIds).toEqual(['downtown', 'harbor']);
    const downtown = projection.market.regions.find((region) => region.regionId === 'downtown');
    const harbor = projection.market.regions.find((region) => region.regionId === 'harbor');
    expect(downtown?.pools).toEqual([
      { commodity: 'Fish', commodityReserve: 200, currencyReserve: 2_000, regionId: 'downtown' },
    ]);
    expect(harbor?.pools).toEqual([
      { commodity: 'Fish', commodityReserve: 200, currencyReserve: 800, regionId: 'harbor' },
    ]);
  });

  test('regional markets on: a trade settles against the agent region pool only', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createRegionalManifest(),
      scenarioPresets: createRegionalScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        regionalMarkets: true,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    // agentOne stands in the downtown region. Buying 1 Fish settles against the
    // downtown pool (spot ~10), leaving the harbor pool (spot 4) untouched.
    authority.settleTrade({
      operationId: 'trade-downtown-buy',
      agentId: agentOne,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1, regionId: 'downtown' },
      ...lease,
    });
    const after = authority.getSnapshot().projection;
    expect(after.marketPools['downtown::Fish']?.commodityReserve).toBe(199);
    expect(after.marketPools['harbor::Fish']?.commodityReserve).toBe(200);

    // agentTwo stands in the harbor region. Its buy moves the harbor pool, not
    // downtown — proving the two regions price independently.
    authority.settleTrade({
      operationId: 'trade-harbor-buy',
      agentId: agentTwo,
      trade: { side: 'buy', commodityName: 'Fish', quantity: 1, regionId: 'harbor' },
      ...lease,
    });
    const afterBoth = authority.getSnapshot().projection;
    expect(afterBoth.marketPools['downtown::Fish']?.commodityReserve).toBe(199);
    expect(afterBoth.marketPools['harbor::Fish']?.commodityReserve).toBe(199);
  });

  test('town weather on: authority settles WeatherChanged and the society projection exposes it', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        townWeather: true,
      },
    });
    const authority = host.authority!;

    // No weather exists until the town-weather-v1 cadence (3_600_000 ms of
    // simulation time) has been evaluated at least once with a state change.
    expect(authority.getSnapshot().projection.weather).toBeUndefined();
    for (
      let tick = 0;
      tick < 20 && authority.getSnapshot().projection.weather === undefined;
      tick += 1
    ) {
      authority.advanceTime({
        operationId: `advance-weather-${tick}`,
        workerId: 'authority-worker',
        observedAt: 200 + tick,
        durationMs: 30_000,
        deltaMs: 3_600_000,
      });
    }
    const weather = authority.getSnapshot().projection.weather;
    expect(weather).toBeDefined();
    expect(weather?.since).toBeGreaterThan(0);

    // The society projection reads weather from the authority snapshot.
    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(projection.weather).toEqual(weather);
  });

  test('town weather on: the daemon tick loop settles WeatherChanged into the partition stream', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      // One weather cadence per tick so a handful of ticks crosses several
      // transition evaluations.
      timeDeltaMs: 3_600_000,
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        townWeather: true,
      },
    });
    const authority = host.authority!;

    // Drive ticks through the lifecycle start path — the same route the
    // daemon's supervisor runCycles takes (registry api → lifecycle → tick
    // loop), so the pre-tick materializer hook must keep the authority clock
    // level and let the authority settle the weather cadence. Each cadence is
    // a seeded coin flip, so loop until a transition actually fires.
    for (
      let tick = 0;
      tick < 20 && authority.getSnapshot().projection.weather === undefined;
      tick += 1
    ) {
      await host.registry.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt: 200 + tick,
      });
    }
    const weather = authority.getSnapshot().projection.weather;
    expect(weather).toBeDefined();

    // The transition is delivered town-wide: the partition stream records
    // WeatherChanged and the hydrated partition projection carries the slice.
    const events = await host.registry.api.getEvents({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(events.events.some((event) => event.type === 'WeatherChanged')).toBe(true);
    const projection = await host.registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(projection.projection.weather).toEqual(weather);
    expect(host.societyProjection.getProjection({ simulationId: 'sim-1' }).weather).toEqual(
      weather,
    );
  });

  test('town bulletin on: the daemon tick loop settles operator bulletins onto the authoritative board', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      // The same policy factory the CLI uses, with the town-bulletin switch on.
      policies: createAivilizationWorldCommandPolicies('host-bulletin-test', undefined, {
        townBulletin: true,
      }),
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        townBulletin: true,
      },
    });
    const authority = host.authority!;
    const mainStorage = host.partitions[0]!.bootstrap.storage;

    // An operator steering command lands in the partition command stream, the
    // same ingress the daemon's steering submission port writes to.
    mainStorage.commandStore.appendToStream({
      streamName: mainStorage.partition.commandStreamName,
      expectedVersion: 0,
      idempotencyKey: 'append-bulletin-command',
      commands: [
        createCommandEnvelope({
          id: 'cmd-bulletin-1',
          simulationId: 'sim-1',
          source: 'human',
          humanAttribution: {
            principalSubjectId: 'operator-1',
            principalRoles: ['operator'],
            accessPolicyVersion: 'town-access-v1',
            consentPolicyVersion: 'town-consent-v1',
          },
          type: 'IssueTownBulletin',
          payload: { title: 'Storm warning', body: 'A storm is coming.', priority: 'high' },
          issuedAt: 150,
        }),
      ],
    });

    // Tick 1 drains the command and settles the bulletin against the
    // authority board through the wired issuer; tick 2 materializes the
    // town-wide BulletinPosted delivery into the partition stream.
    for (const [offset, requestedAt] of [200, 201].entries()) {
      await host.registry.api.startSimulation({
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        requestedAt,
        operationId: `bulletin-tick-${offset}`,
      });
    }

    const bulletins = authority.getSnapshot().projection.bulletins;
    expect(bulletins).toHaveLength(1);
    expect(bulletins?.[0]).toMatchObject({ title: 'Storm warning', priority: 'high' });

    const events = await host.registry.api.getEvents({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(events.events.some((event) => event.type === 'BulletinPosted')).toBe(true);
    const projection = await host.registry.api.getProjection({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
    });
    expect(projection.projection.bulletins).toHaveLength(1);
    expect(
      host.societyProjection.getProjection({ simulationId: 'sim-1' }).bulletins,
    ).toHaveLength(1);
  });

  test('town weather off (default): advancing time produces no weather state or events', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    authority.advanceTime({
      operationId: 'advance-no-weather',
      workerId: 'authority-worker',
      observedAt: 200,
      durationMs: 30_000,
      deltaMs: 3_600_000,
    });

    expect(authority.getSnapshot().projection.weather).toBeUndefined();
    expect(host.societyProjection.getProjection({ simulationId: 'sim-1' }).weather).toBeUndefined();
  });

  test('town conditions on: society projection derives per-agent conditions from the authority snapshot', async () => {
    const exhaustedPreset = createScenarioPreset({
      id: 'scenario-main',
      agentId: agentOne,
      educationScore: 10,
    });
    const exhaustedMain = {
      ...exhaustedPreset,
      agentSeeds: exhaustedPreset.agentSeeds.map((seed) => ({
        ...seed,
        physiology: { energy: 5, satiety: 80, health: 100 },
      })),
    };
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: [
        exhaustedMain,
        createScenarioPreset({ id: 'scenario-east', agentId: agentTwo, educationScore: 20 }),
      ],
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        townConditions: true,
      },
    });

    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    // agentOne is exhausted (energy 5 < severeBelow 10): severe overtired.
    // agentTwo (energy 50) has no active condition and is not listed.
    expect(projection.agentConditions).toEqual([
      {
        agentId: 'agent-1',
        conditions: [{ kind: 'overtired', severity: 'severe', need: 'sleep' }],
      },
    ]);
  });

  test('town conditions off (default): society projection omits agent conditions', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });

    expect(
      host.societyProjection.getProjection({ simulationId: 'sim-1' }).agentConditions,
    ).toBeUndefined();
  });

  test('town bulletin on: authority settles idempotently, fans out hearsay awareness, and high priority preempts', async () => {
    const bulletinPolicies: WorldCommandPolicies = {
      ...policies,
      bulletin: createAivilizationTownBulletinPolicy(),
    };
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies: bulletinPolicies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
        townBulletin: true,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };
    const operator = {
      principalSubjectId: 'operator-1',
      principalRoles: ['operator'],
      accessPolicyVersion: 'town-access-v1',
      consentPolicyVersion: 'town-consent-v1',
    };

    const posted = authority.settleBulletin({
      operationId: 'bulletin-storm',
      bulletin: { title: 'Storm warning', body: 'A storm is coming.', priority: 'high' },
      humanAttribution: operator,
      ...lease,
    });
    expect(posted.status).toBe('posted');
    // Idempotent replay: the same operationId returns the stored operation.
    expect(
      authority.settleBulletin({
        operationId: 'bulletin-storm',
        bulletin: { title: 'Storm warning', body: 'A storm is coming.', priority: 'high' },
        humanAttribution: operator,
        ...lease,
      }),
    ).toEqual(posted);

    await host.materializers.get('world-main')!.materializeInbox({ lease });
    await host.materializers.get('world-east')!.materializeInbox({ lease });

    // Every resident gains a hearsay awareness memory on their owner partition.
    const mainMemory = await host.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve(
      { agentId: agentOne, limit: 64 },
    );
    expect(mainMemory).toHaveLength(1);
    expect(mainMemory[0]).toMatchObject({
      kind: 'observation',
      status: 'observed',
      provenance: { kind: 'hearsay', status: 'influencing' },
    });
    expect(mainMemory[0]?.summary).toContain('Storm warning');
    expect(mainMemory[0]?.tags).toContain('town-bulletin');
    expect(mainMemory[0]?.tags).toContain('bulletin-priority-high');
    const eastMemory = await host.partitions[1]!.bootstrap.storage.shortTermMemoryRepository.retrieve(
      { agentId: agentTwo, limit: 64 },
    );
    expect(eastMemory).toHaveLength(1);

    // High priority preempts: a forced-attention intention per resident.
    const mainIntentions = await host.partitions[0]!.bootstrap.storage.intentionRepository.getOrCreate(
      agentOne,
    );
    const bulletinIntentions = mainIntentions.scheduledIntentions.filter((intention) =>
      intention.affinityTags.includes('town-bulletin'),
    );
    expect(bulletinIntentions).toHaveLength(1);
    expect(bulletinIntentions[0]?.priority).toBe(90);
    expect(bulletinIntentions[0]?.status).toBe('planned');

    // The society projection exposes the board from the authority snapshot.
    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(projection.bulletins).toHaveLength(1);
    expect(projection.bulletins?.[0]).toMatchObject({
      status: 'effective',
      priority: 'high',
      authorSubjectId: 'operator-1',
    });

    // A normal-priority bulletin adds awareness but no new preemption.
    authority.settleBulletin({
      operationId: 'bulletin-picnic',
      bulletin: { title: 'Picnic', body: 'Community picnic on the square.' },
      humanAttribution: operator,
      ...lease,
    });
    await host.materializers.get('world-main')!.materializeInbox({ lease });
    const afterNormal = await host.partitions[0]!.bootstrap.storage.intentionRepository.getOrCreate(
      agentOne,
    );
    expect(
      afterNormal.scheduledIntentions.filter((intention) =>
        intention.affinityTags.includes('town-bulletin'),
      ),
    ).toHaveLength(1);
    const mainMemoryAfter =
      await host.partitions[0]!.bootstrap.storage.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        limit: 64,
      });
    expect(mainMemoryAfter).toHaveLength(2);
    expect(host.societyProjection.getProjection({ simulationId: 'sim-1' }).bulletins).toHaveLength(2);
  });

  test('social matters on: authority settles the lifecycle idempotently and exposes the board', async () => {
    const mattersPolicies: WorldCommandPolicies = {
      ...policies,
      socialMatters: createAivilizationSocialMattersPolicy(),
    };
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies: mattersPolicies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    const raised = authority.settleMatter({
      operationId: 'matter-raise-1',
      agentId: agentOne,
      commandType: 'AgentRaiseMatter',
      payload: { topic: 'apples', statement: 'Need an apple.', expiresInMs: 60_000 },
      ...lease,
    });
    expect(raised.matterId).toBe('matter-simulation-wide-matter-matter-raise-1');
    // Idempotent replay: the same operationId returns the stored operation.
    expect(
      authority.settleMatter({
        operationId: 'matter-raise-1',
        agentId: agentOne,
        commandType: 'AgentRaiseMatter',
        payload: { topic: 'apples', statement: 'Need an apple.', expiresInMs: 60_000 },
        ...lease,
      }),
    ).toEqual(raised);

    authority.settleMatter({
      operationId: 'matter-respond-1',
      agentId: agentTwo,
      commandType: 'AgentRespondMatter',
      payload: { matterId: raised.matterId, decision: 'accept' },
      ...lease,
    });
    authority.settleMatter({
      operationId: 'matter-assign-1',
      agentId: agentOne,
      commandType: 'AgentAssignMatter',
      payload: { matterId: raised.matterId, assigneeAgentId: agentTwo },
      ...lease,
    });
    const snapshot = authority.getSnapshot().projection;
    expect(snapshot.socialMatters?.[raised.matterId]).toMatchObject({
      status: 'assigned',
      assigneeAgentId: agentTwo,
    });

    // Every partition materializes the town-wide board.
    await host.materializers.get('world-main')!.materializeInbox({ lease });
    await host.materializers.get('world-east')!.materializeInbox({ lease });
    const mainCheckpoint = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(mainCheckpoint.socialMatters).toHaveLength(1);
    expect(mainCheckpoint.socialMatters?.[0]).toMatchObject({
      matterId: raised.matterId,
      status: 'assigned',
    });

    // Expiry settles during advance and reaches every partition: the assigned
    // matter breaches with the canonical betrayal outcome.
    authority.advanceTime({
      operationId: 'advance-matter-expiry',
      deltaMs: 3_600_000,
      ...lease,
    });
    expect(authority.getSnapshot().projection.socialMatters?.[raised.matterId]).toMatchObject({
      status: 'closed',
      closure: 'breached',
    });
    await host.materializers.get('world-main')!.materializeInbox({ lease });
    const after = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(after.socialMatters?.[0]).toMatchObject({ status: 'closed', closure: 'breached' });
  });

  test('town conflict on: confront issues a grievance, attack settles damage, and the log is exposed', async () => {
    const conflictPolicies: WorldCommandPolicies = {
      ...policies,
      conflict: createAivilizationTownConflictPolicy(),
    };
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies: conflictPolicies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const authority = host.authority!;
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };

    // No grievance yet: the attack is rejected before any hostility exists.
    expect(() =>
      authority.settleConflict({
        operationId: 'conflict-attack-early',
        agentId: agentOne,
        commandType: 'AgentAttack',
        payload: { targetAgentId: agentTwo },
        ...lease,
      }),
    ).toThrow(/grievance/);

    // The confrontation drops the relation below the grievance threshold.
    const confrontation = authority.settleConflict({
      operationId: 'conflict-confront-1',
      agentId: agentOne,
      commandType: 'AgentConfront',
      payload: { targetAgentId: agentTwo, statement: 'You cheated me.' },
      ...lease,
    });
    expect(confrontation.status).toBe('completed');
    // Idempotent replay.
    expect(
      authority.settleConflict({
        operationId: 'conflict-confront-1',
        agentId: agentOne,
        commandType: 'AgentConfront',
        payload: { targetAgentId: agentTwo, statement: 'You cheated me.' },
        ...lease,
      }),
    ).toEqual(confrontation);

    const attack = authority.settleConflict({
      operationId: 'conflict-attack-1',
      agentId: agentOne,
      commandType: 'AgentAttack',
      payload: { targetAgentId: agentTwo },
      ...lease,
    });
    expect(attack.status).toBe('completed');
    const snapshot = authority.getSnapshot().projection;
    const target = snapshot.agents[agentTwo];
    // base 15 + energy 50*0.05 - 50*0.02 = 16.5 damage on health 100.
    expect(target?.physiology.health).toBeCloseTo(83.5, 6);
    expect(snapshot.agents[agentOne]?.physiology.energy).toBe(40);
    expect(snapshot.conflictRecords).toHaveLength(2);

    // Every partition materializes the conflict events and party memories.
    await host.materializers.get('world-main')!.materializeInbox({ lease });
    await host.materializers.get('world-east')!.materializeInbox({ lease });
    const eastMemory = await host.partitions[1]!.bootstrap.storage.shortTermMemoryRepository.retrieve(
      { agentId: agentTwo, limit: 64 },
    );
    expect(eastMemory.some((record) => record.tags.includes('attack'))).toBe(true);

    const projection = host.societyProjection.getProjection({ simulationId: 'sim-1' });
    expect(projection.conflictRecords).toHaveLength(2);
    expect(projection.conflictRecords?.map((record) => record.kind)).toEqual([
      'confrontation',
      'attack',
    ]);
  });

  test('town bulletin off (default): agent posts are rejected and no board exists', async () => {
    const rootDir = createRootDir();
    const host = await bootstrapLocalSimulationRuntimeHostFromManifest({
      rootDir,
      bootstrappedAt: 100,
      manifest: createManifest(),
      scenarioPresets: createScenarioPresets(),
      policies,
      localizedPlanners: [],
      steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
      agents: [],
      simulationWideAuthority: {
        enabled: true,
        workerId: 'authority-worker',
        leaseDurationMs: 30_000,
      },
    });
    const lease = { workerId: 'authority-worker', observedAt: 200, durationMs: 30_000 };
    expect(() =>
      host.authority!.settleBulletin({
        operationId: 'bulletin-off',
        bulletin: { title: 'T', body: 'B' },
        authorAgentId: agentOne,
        ...lease,
      }),
    ).toThrow(/missing bulletin policy/);
    expect(
      host.societyProjection.getProjection({ simulationId: 'sim-1' }).bulletins,
    ).toBeUndefined();
  });

  function createRegionalManifest(): LocalSimulationRuntimeManifest {
    // Each partition seeds BOTH a downtown pool (100/1000) and a harbor pool
    // (100/400). moneySupply 1000 each. Across 2 partitions this gives downtown
    // 200/2000 and harbor 200/800.
    const marketPools = [
      { commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000, source: 'test', regionId: 'downtown' },
      { commodity: 'Fish', commodityReserve: 100, currencyReserve: 400, source: 'test', regionId: 'harbor' },
    ];
    return {
      id: 'town-regional',
      defaults: {
        tickBatchSize: 1,
        tickIntervalMs: 100,
        commandConsumerIdPrefix: 'worker',
      },
      partitions: [
        {
          simulationId: 'sim-1',
          partitionKey: 'world-main',
          scenarioPresetId: 'scenario-regional-main',
          marketPools,
          moneySupply: 1_000,
        },
        {
          simulationId: 'sim-1',
          partitionKey: 'world-east',
          scenarioPresetId: 'scenario-regional-east',
          marketPools,
          moneySupply: 1_000,
        },
      ],
    };
  }

  function createRegionalScenarioPresets(): readonly ScenarioPreset[] {
    return [
      createRegionalScenarioPreset({
        id: 'scenario-regional-main',
        agentId: agentOne,
        locationId: downtownMarket,
        regionId: 'downtown',
      }),
      createRegionalScenarioPreset({
        id: 'scenario-regional-east',
        agentId: agentTwo,
        locationId: harborMarket,
        regionId: 'harbor',
      }),
    ];
  }

  function createRegionalScenarioPreset(input: {
    readonly id: string;
    readonly agentId: AgentId;
    readonly locationId: typeof downtownMarket;
    readonly regionId: string;
  }): ScenarioPreset {
    return {
      id: input.id,
      name: input.id,
      description: `${input.id} regional test scenario`,
      clock: { now: 0, tickDurationMs: 1000 },
      timeScale: 35,
      locations: [
        {
          locationId: downtownMarket,
          name: 'Downtown Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: null,
          regionId: 'downtown',
          source: 'test',
        },
        {
          locationId: harborMarket,
          name: 'Harbor Market',
          kind: 'market',
          activityAffinities: ['trade'],
          capacity: null,
          regionId: 'harbor',
          source: 'test',
        },
      ],
      agentSeeds: [
        {
          agentId: input.agentId,
          displayName: input.agentId,
          profile: { personality: { mbti: 'INTJ' }, source: 'test' },
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 500,
          residentialTier: 1,
          job: null,
          inventory: {},
          locationId: input.locationId,
          source: 'test',
          tags: ['test'],
        },
      ],
      source: 'test',
    };
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-authority-host-'));
  tmpRoots.push(root);
  return root;
}

function createManifest(): LocalSimulationRuntimeManifest {
  const marketPools = [
    { commodity: 'Fish', commodityReserve: 100, currencyReserve: 1_000, source: 'test' },
  ];
  return {
    id: 'town-runtime',
    defaults: {
      tickBatchSize: 1,
      tickIntervalMs: 100,
      commandConsumerIdPrefix: 'worker',
    },
    partitions: [
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
        marketPools,
        moneySupply: 1_000,
      },
      {
        simulationId: 'sim-1',
        partitionKey: 'world-east',
        scenarioPresetId: 'scenario-east',
        marketPools,
        moneySupply: 1_000,
      },
    ],
  };
}

function createScenarioPresets(): readonly ScenarioPreset[] {
  return [
    createScenarioPreset({ id: 'scenario-main', agentId: agentOne, educationScore: 10 }),
    createScenarioPreset({ id: 'scenario-east', agentId: agentTwo, educationScore: 20 }),
  ];
}

function createScenarioPreset(input: {
  readonly id: string;
  readonly agentId: AgentId;
  readonly educationScore: number;
}): ScenarioPreset {
  return {
    id: input.id,
    name: input.id,
    description: `${input.id} test scenario`,
    clock: { now: 0, tickDurationMs: 1000 },
    timeScale: 35,
    locations: [
      {
        locationId: mainSquare,
        name: 'Main Square',
        kind: 'social',
        activityAffinities: ['study'],
        capacity: null,
        source: 'test',
      },
    ],
    agentSeeds: [
      {
        agentId: input.agentId,
        displayName: input.agentId,
        profile: { personality: { mbti: 'INTJ' }, source: 'test' },
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: input.educationScore,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
        locationId: mainSquare,
        source: 'test',
        tags: ['test'],
      },
    ],
    source: 'test',
  };
}
