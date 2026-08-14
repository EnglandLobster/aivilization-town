import {
  aivilizationAblationScenarioPreset,
  createCommodityMarketPoolSeeds,
} from '@aivilization/content';
import { describe, expect, test } from 'vitest';
import { createWorldProjectionFromScenario } from './index';

describe('scenario projection adapter', () => {
  test('maps the AIvilization ablation preset into a world projection', () => {
    const projection = createWorldProjectionFromScenario({
      preset: aivilizationAblationScenarioPreset,
      marketPools: createCommodityMarketPoolSeeds({
        commodityReserve: 100,
        currencyReserve: 1000,
      }),
    });

    expect(Object.keys(projection.agents)).toHaveLength(80);
    expect(Object.keys(projection.locations)).toHaveLength(7);
    expect(projection.clock).toEqual({ now: 0, tickDurationMs: 1000 });
    expect(projection.agents['ablation-agent-001']).toMatchObject({
      locationId: null,
      physiology: { energy: 60, satiety: 60, health: 60 },
      educationScore: 0,
      balance: 0,
      residentialTier: 1,
      job: null,
      inventory: {},
    });
    expect(projection.marketPools['Fish']).toEqual({
      commodity: 'Fish',
      commodityReserve: 100,
      currencyReserve: 1000,
    });
    expect(projection.marketPools['Gold Apple']).toBeUndefined();
    expect(projection.moneySupply).toBe(0);
    expect(projection.locations.school?.capacity).toBe(40);
    expect(projection.locations.school?.mapPosition).toMatchObject({ x: 0.82, y: 0.22 });
    expect(projection.locations.school?.source).toContain('AIvilization');
    expect(projection.locations.school?.connections).toContainEqual({
      targetLocationId: 'residential-block',
      travelDurationSeconds: 360,
    });
  });

  test('defaults initial money supply to circulating agent balances unless overridden', () => {
    const [firstAgent, secondAgent] = aivilizationAblationScenarioPreset.agentSeeds;
    if (firstAgent === undefined || secondAgent === undefined) {
      throw new Error('expected ablation preset agents');
    }
    const preset = {
      ...aivilizationAblationScenarioPreset,
      agentSeeds: [
        { ...firstAgent, balance: 12 },
        { ...secondAgent, balance: 30 },
      ],
    };

    expect(createWorldProjectionFromScenario({ preset }).moneySupply).toBe(42);
    expect(createWorldProjectionFromScenario({ preset, moneySupply: 100 }).moneySupply).toBe(100);
  });

  test('seeds the public treasury only when the scenario provides one', () => {
    const withoutTreasury = createWorldProjectionFromScenario({
      preset: aivilizationAblationScenarioPreset,
    });
    expect(withoutTreasury.treasury).toBeUndefined();

    const withTreasury = createWorldProjectionFromScenario({
      preset: aivilizationAblationScenarioPreset,
      moneySupply: 50_000,
      treasury: 50_000,
    });
    expect(withTreasury.treasury).toBe(50_000);
    expect(withTreasury.moneySupply).toBe(50_000);
  });

  test('seeds the town-bank reserves only when the scenario provides them', () => {
    const withoutBank = createWorldProjectionFromScenario({
      preset: aivilizationAblationScenarioPreset,
    });
    expect(withoutBank.bank).toBeUndefined();

    const withBank = createWorldProjectionFromScenario({
      preset: aivilizationAblationScenarioPreset,
      moneySupply: 200_000,
      bankReserves: 200_000,
    });
    expect(withBank.bank).toEqual({
      balance: 200_000,
      deposits: {},
      loans: {},
      creditHistoryByAgent: {},
    });
    expect(withBank.moneySupply).toBe(200_000);
  });
});
