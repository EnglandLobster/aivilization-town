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
});
