import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  composePersonaSystemPrompt,
  createWorldDecisionContextTrace,
  describeCitizenFraming,
  sanitizeDecisionDisplayName,
  type WorldDecisionAgentContext,
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

  test('records the identity view flags when the agent carries a display name', () => {
    const context: WorldDecisionContext = {
      agent: {
        agentId: asAgentId('agent-1'),
        locationId: 'market',
        displayName: 'Li Na',
        physiology: { energy: 72, satiety: 41, health: 93 },
        educationScore: 31,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      market: { spotPrices: [] },
    };

    expect(createWorldDecisionContextTrace(context)).toMatchObject({
      hasDisplayName: true,
      displayNameLength: 5,
    });
  });
});

describe('decision display name sanitizer', () => {
  test('keeps ordinary names untouched', () => {
    expect(sanitizeDecisionDisplayName('Li Na')).toBe('Li Na');
    expect(sanitizeDecisionDisplayName('张伟')).toBe('张伟');
  });

  test('strips control characters, bidi marks, and zero-width characters', () => {
    expect(sanitizeDecisionDisplayName('Li\u0000\u001fNa\u200b')).toBe('LiNa');
    expect(sanitizeDecisionDisplayName('\u202eLi Na\ufeff')).toBe('Li Na');
  });

  test('collapses whitespace and drops names that sanitize to nothing', () => {
    expect(sanitizeDecisionDisplayName('  Li \t Na  ')).toBe('Li Na');
    expect(sanitizeDecisionDisplayName(' \u0000 ')).toBeUndefined();
    expect(sanitizeDecisionDisplayName(undefined)).toBeUndefined();
  });

  test('truncates on a code-point boundary at the hard cap', () => {
    expect(sanitizeDecisionDisplayName('a'.repeat(80))).toBe('a'.repeat(64));
    // 70 surrogate pairs must truncate to 64 whole pairs, not 64 code units.
    expect(sanitizeDecisionDisplayName('😀'.repeat(70))).toBe('😀'.repeat(64));
  });
});

describe('citizen framing', () => {
  const baseAgent: WorldDecisionAgentContext = {
    agentId: asAgentId('agent-1'),
    locationId: 'market',
    displayName: 'Li Na',
    physiology: { energy: 72, satiety: 41, health: 93 },
    educationScore: 31,
    balance: 100,
    residentialTier: 1,
    job: 'cook',
    inventory: {},
  };

  test('composes stage and occupation from authoritative fields', () => {
    expect(
      describeCitizenFraming({ ...baseAgent, lifecycle: { stage: 'adult', ageDays: 9000, retired: false } }),
    ).toBe('You are acting as Li Na — adult cook of this town.');
  });

  test('prefers retired over the raw stage and falls back to resident without a job', () => {
    expect(
      describeCitizenFraming({ ...baseAgent, lifecycle: { stage: 'elderly', ageDays: 30000, retired: true } }),
    ).toBe('You are acting as Li Na — retired cook of this town.');
    expect(describeCitizenFraming({ ...baseAgent, job: null })).toBe(
      'You are acting as Li Na — resident of this town.',
    );
  });

  test('returns null without a display name so callers keep the module framing', () => {
    const { displayName: omitted, ...anonymous } = baseAgent;
    void omitted;
    expect(describeCitizenFraming(anonymous)).toBeNull();
  });

  test('persona system prompt wraps the module prompt only when framing exists', () => {
    const modulePrompt = 'You are the test module. Return JSON.';
    expect(composePersonaSystemPrompt({ framing: null, modulePrompt })).toBe(modulePrompt);
    expect(composePersonaSystemPrompt({ framing: 'You are acting as Li Na — cook of this town.', modulePrompt })).toBe(
      'You are acting as Li Na — cook of this town. You are the test module. Return JSON. The citizen framing must not contradict the JSON state; all authoritative facts live in the JSON payload.',
    );
  });
});
