import {
  aivilizationAblationScenarioPreset,
  createCommodityMarketPoolSeeds,
} from '@aivilization/content';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { bootstrapLocalScenarioRuntime } from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local scenario runtime bootstrap', () => {
  test('creates restart-safe storage, initial projection, profiles, and baseline checkpoint', async () => {
    const rootDir = createRootDir();

    const result = await bootstrapLocalScenarioRuntime({
      rootDir,
      simulationId: 'sim-ablation',
      partitionKey: 'world-main',
      preset: aivilizationAblationScenarioPreset,
      marketPools: createCommodityMarketPoolSeeds({
        commodityReserve: 100,
        currencyReserve: 1000,
      }),
      bootstrappedAt: 123,
    });

    expect(Object.keys(result.initialProjection.agents)).toHaveLength(80);
    expect(Object.keys(result.initialProjection.locations)).toHaveLength(7);
    expect(result.initialProjection.marketPools['Fish']).toEqual({
      commodity: 'Fish',
      commodityReserve: 100,
      currencyReserve: 1000,
    });
    expect(result.profileSeeding.seededAgentIds).toHaveLength(80);
    expect(result.profileSeeding.skippedAgentIds).toEqual([]);
    expect(result.initializedCheckpoint).toBe(true);
    expect(result.checkpoint).toMatchObject({
      simulationId: 'sim-ablation',
      partitionKey: 'world-main',
      lastAppliedSequence: 0,
    });
    expect(result.snapshot).toMatchObject({
      simulationId: 'sim-ablation',
      partitionKey: 'world-main',
      sequence: 0,
      createdAt: 123,
    });
    expect(result.storage.snapshotStore.loadSnapshot(result.snapshot)).toEqual(
      result.initialProjection,
    );
    await expect(
      result.storage.longTermProfileRepository.getOrCreate(
        aivilizationAblationScenarioPreset.agentSeeds[0]!.agentId,
      ),
    ).resolves.toMatchObject({
      personality: [
        {
          key: 'initial-mbti',
          statement: 'MBTI: INTJ.',
          updatedAt: 123,
        },
      ],
    });
  });

  test('reuses existing checkpoint and skips already seeded profiles on restart', async () => {
    const rootDir = createRootDir();
    const first = await bootstrapLocalScenarioRuntime({
      rootDir,
      simulationId: 'sim-restart',
      partitionKey: 'world-main',
      preset: aivilizationAblationScenarioPreset,
      bootstrappedAt: 100,
    });

    const restarted = await bootstrapLocalScenarioRuntime({
      rootDir,
      simulationId: 'sim-restart',
      partitionKey: 'world-main',
      preset: aivilizationAblationScenarioPreset,
      bootstrappedAt: 999,
    });

    expect(restarted.initializedCheckpoint).toBe(false);
    expect(restarted.checkpoint).toEqual(first.checkpoint);
    expect(restarted.snapshot).toEqual(first.snapshot);
    expect(restarted.profileSeeding.seededAgentIds).toEqual([]);
    expect(restarted.profileSeeding.skippedAgentIds).toHaveLength(80);
    await expect(
      restarted.storage.longTermProfileRepository.getOrCreate(
        aivilizationAblationScenarioPreset.agentSeeds[0]!.agentId,
      ),
    ).resolves.toMatchObject({
      personality: [
        {
          key: 'initial-mbti',
          statement: 'MBTI: INTJ.',
          updatedAt: 100,
        },
      ],
    });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-local-scenario-bootstrap-'));
  tmpRoots.push(root);
  return root;
}
