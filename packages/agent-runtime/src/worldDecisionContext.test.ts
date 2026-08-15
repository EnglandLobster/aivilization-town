import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

describe('world decision context trace', () => {
  test('summarizes inventory, job, and location field coverage', () => {
    const context: WorldDecisionContext = {
      agent: {
        agentId: asAgentId('agent-1'),
        locationId: 'market',
        physiology: { energy: 72, satiety: 41, health: 93 },
        educationScore: 31,
        balance: 191696904,
        residentialTier: 5,
        job: 'stock-clerk',
        inventory: { Fish: 46 },
      },
      market: {
        spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
      },
    };

    expect(createWorldDecisionContextTrace(context)).toMatchObject({
      agentId: asAgentId('agent-1'),
      hasLocationId: true,
      hasJob: true,
      hasInventory: true,
    });
  });

  test('surfaces town weather only when the context carries it', () => {
    const base: WorldDecisionContext = {
      agent: {
        agentId: asAgentId('agent-1'),
        locationId: 'market',
        physiology: { energy: 72, satiety: 41, health: 93 },
        educationScore: 31,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      market: { spotPrices: [] },
    };

    expect(createWorldDecisionContextTrace(base).hasWeather).toBeUndefined();
    expect(createWorldDecisionContextTrace(base).conditionCount).toBeUndefined();
    expect(createWorldDecisionContextTrace(base).hasCalendar).toBeUndefined();
    expect(
      createWorldDecisionContextTrace({
        ...base,
        weather: { current: 'rainy', since: 3_600_000 },
      }),
    ).toMatchObject({ hasWeather: true, weatherCurrent: 'rainy' });
    expect(
      createWorldDecisionContextTrace({
        ...base,
        calendar: {
          dayIndex: 2,
          phase: 'day',
          phaseEndsAtMs: 241_920_000,
          nextPhase: 'dusk',
          dayLengthMs: 86_400_000,
        },
      }),
    ).toMatchObject({ hasCalendar: true, calendarDayIndex: 2, calendarPhase: 'day' });
    expect(
      createWorldDecisionContextTrace({
        ...base,
        conditions: [
          { kind: 'soaked', severity: 'moderate', need: 'shelter' },
          { kind: 'overtired', severity: 'severe', need: 'sleep' },
        ],
      }),
    ).toMatchObject({ conditionCount: 2, conditionKinds: ['soaked', 'overtired'] });
  });
});
