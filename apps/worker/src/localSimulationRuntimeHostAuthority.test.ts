import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import { type ScenarioPreset } from '@aivilization/content';
import { type WorldCommandPolicies } from '@aivilization/world';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  bootstrapLocalSimulationRuntimeHostFromManifest,
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
