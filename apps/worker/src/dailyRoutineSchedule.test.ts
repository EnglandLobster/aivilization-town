import {
  createDailyPlan,
  type DailyPlanCompiler,
  type DailyPlanCompilerInput,
} from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import {
  asMemoryRecordId,
  createShortTermMemoryRecord,
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
  type LongTermAgentProfile,
} from '@aivilization/memory';
import type { DailyPlanRenewalTrace } from '@aivilization/observability';
import { asAgentId, asLocationId, type AgentId } from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldAgentState,
  type WorldCommandPolicies,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import {
  createDailyRoutineScheduledIntentions,
  createProfileAwareDailyRoutineSchedule,
  renewDailyPlanScheduledIntentions,
  renewDailyRoutineScheduledIntentions,
} from './index';

const agentId = asAgentId('agent-a');
const hourMs = 60 * 60 * 1000;

describe('daily routine scheduling', () => {
  test('creates stable morning study routine windows for the current simulation day', () => {
    const intentions = createDailyRoutineScheduledIntentions({
      agentId,
      at: 8.5 * hourMs,
      createdAt: 8.5 * hourMs,
    });

    expect(intentions.find((intention) => intention.id.endsWith(':morning-study'))).toEqual({
      id: 'daily-routine:agent-a:0:morning-study',
      agentId,
      description: 'Attend the morning study routine at school.',
      priority: 2,
      startsAt: 8 * hourMs,
      endsAt: 12 * hourMs,
      status: 'planned',
      affinityTags: ['routine', 'study', 'education', 'school'],
      createdAt: 8.5 * hourMs,
      updatedAt: 8.5 * hourMs,
    });
  });

  test('creates midday meal and social routine windows from the same day anchor', () => {
    const intentions = createDailyRoutineScheduledIntentions({
      agentId,
      at: 12.5 * hourMs,
      createdAt: 12.5 * hourMs,
    });

    expect(intentions.find((intention) => intention.id.endsWith(':midday-meal'))).toMatchObject({
      id: 'daily-routine:agent-a:0:midday-meal',
      description: 'Take a midday meal and social break at the restaurant.',
      startsAt: 12 * hourMs,
      endsAt: 14 * hourMs,
      affinityTags: ['routine', 'eat', 'satiety', 'social', 'restaurant'],
    });
  });

  test('upserts a daily routine once per agent and day', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const projection = createWorldProjection({ agents: [createAgent(agentId)] });

    await renewDailyRoutineScheduledIntentions({
      projection,
      intentionRepository,
      issuedAt: 8.5 * hourMs,
    });
    await renewDailyRoutineScheduledIntentions({
      projection,
      intentionRepository,
      issuedAt: 8.75 * hourMs,
    });

    const state = await intentionRepository.getOrCreate(agentId);
    const ids = state.scheduledIntentions.map((intention) => intention.id);
    expect(ids).toEqual([
      'daily-routine:agent-a:0:early-rest',
      'daily-routine:agent-a:0:morning-study',
      'daily-routine:agent-a:0:midday-meal',
      'daily-routine:agent-a:0:afternoon-work',
      'daily-routine:agent-a:0:evening-social',
      'daily-routine:agent-a:0:night-rest',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('adds a higher-priority job shift for employed agents', () => {
    const schedule = createProfileAwareDailyRoutineSchedule({
      agentId,
      agent: createAgent(agentId, { job: 'Stock Clerk' }),
    });

    expect(schedule.find((slot) => slot.slotId === 'job-work-shift')).toEqual({
      slotId: 'job-work-shift',
      description: 'Work the scheduled Stock Clerk shift.',
      priority: 3,
      startsAtOffsetMs: 9 * hourMs,
      endsAtOffsetMs: 17 * hourMs,
      affinityTags: ['routine', 'work', 'income', 'job', 'stock-clerk'],
    });
  });

  test('adds evening study from long-term study habits', () => {
    const schedule = createProfileAwareDailyRoutineSchedule({
      agentId,
      agent: createAgent(agentId),
      longTermProfile: createProfile(agentId, {
        habits: [
          {
            key: 'study-routine',
            statement: 'Consistently engages in self-study after completing work tasks.',
            confidence: 0.9,
            updatedAt: 100,
            provenanceRecordIds: [],
          },
        ],
      }),
    });

    expect(schedule.find((slot) => slot.slotId === 'habit-evening-study')).toMatchObject({
      description: 'Follow the learned evening self-study habit.',
      priority: 3,
      startsAtOffsetMs: 20 * hourMs,
      endsAtOffsetMs: 22 * hourMs,
      affinityTags: ['routine', 'study', 'education', 'profile', 'habit'],
    });
  });

  test('adds extroverted evening social routine from seeded MBTI profile', () => {
    const schedule = createProfileAwareDailyRoutineSchedule({
      agentId,
      agent: createAgent(agentId),
      longTermProfile: createProfile(agentId, {
        personality: [
          {
            key: 'initial-mbti',
            statement: 'MBTI: ENFP.',
            confidence: 1,
            updatedAt: 100,
            provenanceRecordIds: [],
          },
        ],
      }),
    });

    expect(schedule.find((slot) => slot.slotId === 'profile-evening-social')).toMatchObject({
      description: 'Extend the evening social routine from extroverted profile preference.',
      priority: 2.5,
      startsAtOffsetMs: 20 * hourMs,
      endsAtOffsetMs: 22 * hourMs,
      affinityTags: ['routine', 'social', 'community', 'profile', 'mbti'],
    });
  });

  test('uses long-term profile context during repository-backed routine renewal', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const projection = createWorldProjection({ agents: [createAgent(agentId)] });
    await longTermProfileRepository.save(
      createProfile(agentId, {
        habits: [
          {
            key: 'study-routine',
            statement: 'Repeated successful study sessions suggest a reliable study routine.',
            confidence: 0.8,
            updatedAt: 100,
            provenanceRecordIds: [],
          },
        ],
      }),
    );

    await renewDailyRoutineScheduledIntentions({
      projection,
      intentionRepository,
      longTermProfileRepository,
      issuedAt: 20.5 * hourMs,
    });

    await expect(intentionRepository.getOrCreate(agentId)).resolves.toMatchObject({
      scheduledIntentions: [
        expect.objectContaining({ id: 'daily-routine:agent-a:0:early-rest' }),
        expect.objectContaining({ id: 'daily-routine:agent-a:0:morning-study' }),
        expect.objectContaining({ id: 'daily-routine:agent-a:0:midday-meal' }),
        expect.objectContaining({ id: 'daily-routine:agent-a:0:afternoon-work' }),
        expect.objectContaining({ id: 'daily-routine:agent-a:0:evening-social' }),
        expect.objectContaining({ id: 'daily-routine:agent-a:0:habit-evening-study' }),
        expect.objectContaining({ id: 'daily-routine:agent-a:0:night-rest' }),
      ],
    });
  });

  test('materializes repository-backed daily plans into scheduled intentions', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const projection = createWorldProjection({
      agents: [createAgent(agentId, { job: 'Stock Clerk' })],
    });
    await longTermProfileRepository.save(
      createProfile(agentId, {
        habits: [
          {
            key: 'study-routine',
            statement: 'Repeated successful study sessions suggest a reliable study routine.',
            confidence: 0.8,
            updatedAt: 100,
            provenanceRecordIds: [],
          },
        ],
      }),
    );
    const memory = createShortTermMemoryRecord({
      id: 'memory-social-party',
      agentId,
      kind: 'social-interaction',
      status: 'observed',
      summary: 'Maria invited agent-a to coordinate the Valentine party at the town square.',
      occurredAt: 7 * hourMs,
      importanceScore: 0.9,
      source: { eventIds: [] },
      tags: ['social', 'party', 'agent-maria', 'town-square'],
    });
    await shortTermMemoryRepository.append(memory);

    const results = await renewDailyPlanScheduledIntentions({
      projection,
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      issuedAt: 8 * hourMs,
      memoryRetrievalLimit: 5,
    });

    expect(results).toEqual([
      {
        agentId,
        dailyPlanId: 'daily-plan:agent-a:0',
        scheduledIntentionIds: [
          'daily-plan:agent-a:0:early-rest',
          'daily-plan:agent-a:0:morning-study',
          'daily-plan:agent-a:0:job-work-shift',
          'daily-plan:agent-a:0:midday-meal',
          'daily-plan:agent-a:0:afternoon-work',
          'daily-plan:agent-a:0:memory-social-follow-up',
          'daily-plan:agent-a:0:evening-social',
          'daily-plan:agent-a:0:profile-evening-study',
          'daily-plan:agent-a:0:night-rest',
        ],
      },
    ]);
    const state = await intentionRepository.getOrCreate(agentId);
    expect(
      state.scheduledIntentions.find(
        (intention) => intention.id === 'daily-plan:agent-a:0:memory-social-follow-up',
      ),
    ).toMatchObject({
      id: 'daily-plan:agent-a:0:memory-social-follow-up',
      sourcePlanId: 'daily-plan:agent-a:0',
      provenanceRecordIds: [memory.id],
      affinityTags: ['daily-plan', 'social', 'memory', 'party', 'agent-maria', 'town-square'],
    });
  });

  test('uses an injected daily plan compiler and surfaces planning trace metadata', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const longTermProfileRepository = new InMemoryLongTermProfileRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const homeLocationId = asLocationId('home');
    const projection = createWorldProjection({
      agents: [
        createAgent(agentId, {
          job: 'Stock Clerk',
          locationId: homeLocationId,
          educationScore: 31,
          balance: 191696904,
          residentialTier: 5,
          inventory: { Fish: 46, Transistor: 12 },
        }),
      ],
      marketPools: [
        createAmmPool({ commodity: 'Fish', commodityReserve: 10, currencyReserve: 3045 }),
      ],
      locations: [
        {
          locationId: homeLocationId,
          name: 'Home',
          kind: 'residence',
          activityAffinities: ['home', 'rest'],
          capacity: null,
        },
      ],
    });
    const profileMemoryId = asMemoryRecordId('profile-study-memory');
    await longTermProfileRepository.save(
      createProfile(agentId, {
        habits: [
          {
            key: 'study-routine',
            statement: 'Repeated successful study sessions suggest a reliable study routine.',
            confidence: 0.8,
            updatedAt: 100,
            provenanceRecordIds: [profileMemoryId],
          },
        ],
      }),
    );
    const memory = createShortTermMemoryRecord({
      id: 'memory-social-party',
      agentId,
      kind: 'social-interaction',
      status: 'observed',
      summary: 'Maria invited agent-a to coordinate the Valentine party at the town square.',
      occurredAt: 7 * hourMs,
      importanceScore: 0.9,
      source: { eventIds: [] },
      tags: ['social', 'party', 'agent-maria', 'town-square'],
    });
    await shortTermMemoryRepository.append(memory);

    let compilerInput: DailyPlanCompilerInput | undefined;
    const compileDailyPlan: DailyPlanCompiler = (input) => {
      compilerInput = input;
      return {
        plan: createDailyPlan({
          id: 'daily-plan:agent-a:0',
          agentId,
          dayStart: 0,
          generatedAt: 8 * hourMs,
          summary: 'Injected LLM-style daily plan.',
          items: [
            {
              id: 'party-follow-up',
              description: 'Coordinate the Valentine party with Maria.',
              priority: 4,
              startsAtOffsetMs: 18 * hourMs,
              endsAtOffsetMs: 20 * hourMs,
              affinityTags: ['social', 'party'],
              source: 'memory-context',
              evidenceRecordIds: [memory.id],
            },
          ],
        }),
        planningTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'daily-plan-agent-a-8',
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          attempts: [
            {
              attemptIndex: 1,
              status: 'succeeded',
              providerId: 'scripted-daily-planner',
              model: 'daily-planner-model',
              message: 'LLM structured response validated',
              usage: {
                inputTokens: 12,
                outputTokens: 20,
                totalTokens: 32,
                estimatedCostMicros: 84,
              },
            },
          ],
          usage: {
            inputTokens: 12,
            outputTokens: 20,
            totalTokens: 32,
            estimatedCostMicros: 84,
          },
        },
      };
    };
    const traces: DailyPlanRenewalTrace[] = [];

    const results = await renewDailyPlanScheduledIntentions({
      projection,
      policies: createRulesPolicies(),
      intentionRepository,
      longTermProfileRepository,
      shortTermMemoryRepository,
      issuedAt: 8 * hourMs,
      memoryRetrievalLimit: 5,
      compileDailyPlan,
      dailyPlanRenewalTraceScope: {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
      },
      dailyPlanRenewalTraceSink: {
        record: (trace) => {
          traces.push(trace);
        },
      },
    });

    expect(compilerInput).toMatchObject({
      agentId,
      issuedAt: 8 * hourMs,
      agent: {
        job: 'Stock Clerk',
        locationId: 'home',
        physiology: { energy: 90, satiety: 90, health: 100 },
      },
      worldDecisionContext: {
        agent: {
          agentId,
          locationId: 'home',
          educationScore: 31,
          balance: 191696904,
          residentialTier: 5,
          job: 'Stock Clerk',
          inventory: { Fish: 46, Transistor: 12 },
        },
        market: {
          spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
        },
      },
      longTermProfile: {
        habits: [expect.objectContaining({ key: 'study-routine' })],
      },
      memoryContext: [expect.objectContaining({ id: memory.id })],
    });
    expect(compilerInput?.observedStateSummary).toBe(
      'energy=90 satiety=90 health=100 education=31 balance=191696904 residentialTier=5 job=Stock Clerk inventory=Fish:46,Transistor:12',
    );
    const rules = compilerInput?.worldDecisionContext?.rules;
    if (rules === undefined) {
      throw new Error('expected daily compiler world decision rules');
    }
    expect(rules.criticalThresholds).toEqual({ energy: 1, health: 1 });
    expect(
      rules.occupations.some(
        (rule) => rule.occupationName.length > 0 && rule.applicationQuota?.residentialTier === 5,
      ),
    ).toBe(true);
    expect(
      rules.production.some(
        (rule) => rule.commodity.length > 0 && Number.isFinite(rule.timeCostSeconds),
      ),
    ).toBe(true);
    expect(results).toEqual([
      {
        agentId,
        dailyPlanId: 'daily-plan:agent-a:0',
        scheduledIntentionIds: ['daily-plan:agent-a:0:party-follow-up'],
        planningTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'daily-plan-agent-a-8',
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          attempts: [
            {
              attemptIndex: 1,
              status: 'succeeded',
              providerId: 'scripted-daily-planner',
              model: 'daily-planner-model',
              message: 'LLM structured response validated',
              usage: {
                inputTokens: 12,
                outputTokens: 20,
                totalTokens: 32,
                estimatedCostMicros: 84,
              },
            },
          ],
          usage: {
            inputTokens: 12,
            outputTokens: 20,
            totalTokens: 32,
            estimatedCostMicros: 84,
          },
        },
      },
    ]);
    expect(traces).toEqual([
      {
        traceId: 'daily-plan-renewal:sim-1:world-main:agent-a:daily-plan:agent-a:0:28800000',
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        agentId,
        dailyPlanId: 'daily-plan:agent-a:0',
        scheduledIntentionIds: ['daily-plan:agent-a:0:party-follow-up'],
        shortTermMemoryContextIds: [memory.id],
        profileEntryKeys: ['habits:study-routine'],
        profileEvidenceRecordIds: [profileMemoryId],
        planningTrace: {
          status: 'accepted',
          source: 'llm',
          requestId: 'daily-plan-agent-a-8',
          providerId: 'scripted-daily-planner',
          model: 'daily-planner-model',
          attempts: [
            {
              attemptIndex: 1,
              status: 'succeeded',
              providerId: 'scripted-daily-planner',
              model: 'daily-planner-model',
              message: 'LLM structured response validated',
              usage: {
                inputTokens: 12,
                outputTokens: 20,
                totalTokens: 32,
                estimatedCostMicros: 84,
              },
            },
          ],
          usage: {
            inputTokens: 12,
            outputTokens: 20,
            totalTokens: 32,
            estimatedCostMicros: 84,
          },
        },
        issuedAt: 8 * hourMs,
      },
    ]);
    const state = await intentionRepository.getOrCreate(agentId);
    expect(state.scheduledIntentions).toEqual([
      {
        id: 'daily-plan:agent-a:0:party-follow-up',
        agentId,
        sourcePlanId: 'daily-plan:agent-a:0',
        description: 'Coordinate the Valentine party with Maria.',
        priority: 4,
        startsAt: 18 * hourMs,
        endsAt: 20 * hourMs,
        status: 'planned',
        affinityTags: ['daily-plan', 'social', 'party'],
        provenanceRecordIds: [memory.id],
        createdAt: 8 * hourMs,
        updatedAt: 8 * hourMs,
      },
    ]);
  });
});

function createAgent(
  agentId: AgentId,
  overrides: Partial<Omit<WorldAgentState, 'agentId'>> = {},
): WorldAgentState {
  return {
    agentId,
    locationId: overrides.locationId ?? null,
    physiology: overrides.physiology ?? { energy: 90, satiety: 90, health: 100 },
    educationScore: overrides.educationScore ?? 150,
    balance: overrides.balance ?? 200,
    residentialTier: overrides.residentialTier ?? 1,
    job: overrides.job ?? null,
    inventory: overrides.inventory ?? {},
  };
}

function createProfile(
  agentId: AgentId,
  partial: Partial<Omit<LongTermAgentProfile, 'agentId'>> = {},
): LongTermAgentProfile {
  return {
    agentId,
    beliefs: [],
    habits: [],
    mood: [],
    values: [],
    personality: [],
    socialRecords: [],
    ...partial,
  };
}

function createRulesPolicies(): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: { Bread: 15 },
    maxSatiety: 100,
    wageCalculator: () => 10,
    laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
    criticalThresholds: { energy: 1, health: 1 },
    jobApplication: {
      populationEducationScores: [0, 100],
      quotaByResidentialTier: [1, 1, 1, 1, 1],
    },
  };
}
