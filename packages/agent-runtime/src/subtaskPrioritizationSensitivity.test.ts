import { createScriptedLlmProvider } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createTraceableLlmSubtaskPrioritizer } from './llmSubtaskPrioritizer';
import { createBranchPlan, scorePrioritizedSubtaskCandidates } from './planner';
import { runSubtaskPrioritizationSensitivityProbe } from './subtaskPrioritizationSensitivity';
import type { SubtaskPrioritizerInput } from './subtaskPrioritization';
import type { WorldDecisionContext } from './worldDecisionContext';

const agentId = asAgentId('agent-1');

describe('subtask prioritization market sensitivity probe', () => {
  test('detects contextual prioritization changes when market prices change', async () => {
    const plan = createBranchPlan({
      objective: 'Stay fed while preserving enough money for rent.',
      branches: [
        {
          id: 'income',
          objective: 'Earn cash when recovery is not immediately affordable.',
          subtasks: [{ id: 'work', description: 'Work a wage shift.', basePriority: 5 }],
        },
        {
          id: 'recovery',
          objective: 'Restore satiety using market food when affordable.',
          subtasks: [{ id: 'buy-food', description: 'Buy Fish to recover satiety.', basePriority: 4 }],
        },
      ],
    });
    const candidates = scorePrioritizedSubtaskCandidates({ plan, signals: [] });
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-price-sensitive-prioritizer',
      responses: [createPriceSensitivePrioritizationResponse, createPriceSensitivePrioritizationResponse],
    });
    const prioritizer = createTraceableLlmSubtaskPrioritizer({
      provider: scripted.provider,
      model: 'prioritizer-model',
      requestId: ({ issuedAt }) => `price-sensitive-prioritize-${issuedAt}`,
    });

    const result = await runSubtaskPrioritizationSensitivityProbe({
      scenarioId: 'fish-price-affordability',
      prioritizer,
      baseline: createPrioritizerInput({
        plan,
        candidates,
        issuedAt: 100,
        fishSpotPrice: 8,
        balance: 80,
      }),
      comparison: createPrioritizerInput({
        plan,
        candidates,
        issuedAt: 200,
        fishSpotPrice: 70,
        balance: 30,
      }),
    });

    expect(result).toMatchObject({
      scenarioId: 'fish-price-affordability',
      status: 'sensitive',
      selectionChanged: true,
      completeEconomicContext: true,
      baseline: {
        selected: {
          branchId: 'recovery',
          subtaskId: 'buy-food',
        },
        worldDecisionContext: {
          marketSpotPriceCount: 1,
          hasMarketPrices: true,
          completeEconomicContext: true,
        },
      },
      comparison: {
        selected: {
          branchId: 'income',
          subtaskId: 'work',
        },
        worldDecisionContext: {
          marketSpotPriceCount: 1,
          hasMarketPrices: true,
          completeEconomicContext: true,
        },
      },
    });

    expect(
      scripted
        .getRequests()
        .map((request) => readPrioritizerRequestEconomics(request.messages[1]?.content ?? '{}')),
    ).toEqual([
      { balance: 80, fishSpotPrice: 8 },
      { balance: 30, fishSpotPrice: 70 },
    ]);
  });
});

function createPriceSensitivePrioritizationResponse(request: {
  readonly model: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
}) {
  const userMessage = request.messages.find((message) => message.role === 'user');
  const payload = JSON.parse(userMessage?.content ?? '{}') as {
    readonly worldDecisionContext?: {
      readonly agent?: { readonly balance?: number };
      readonly market?: {
        readonly spotPrices?: readonly { readonly commodity: string; readonly spotPrice: number }[];
      };
    };
  };
  const fishSpotPrice =
    payload.worldDecisionContext?.market?.spotPrices?.find((price) => price.commodity === 'Fish')
      ?.spotPrice ?? Number.POSITIVE_INFINITY;
  const balance = payload.worldDecisionContext?.agent?.balance ?? 0;
  const canAffordFoodWithoutDepletingCash = fishSpotPrice <= balance * 0.5;
  const rankedSubtasks = canAffordFoodWithoutDepletingCash
    ? [
        {
          branchId: 'recovery',
          subtaskId: 'buy-food',
          priorityScore: 18,
          rationale: 'Fish is affordable relative to balance, so resolve low satiety now.',
        },
        {
          branchId: 'income',
          subtaskId: 'work',
          priorityScore: 7,
          rationale: 'Work is useful after immediate food recovery.',
        },
      ]
    : [
        {
          branchId: 'income',
          subtaskId: 'work',
          priorityScore: 18,
          rationale: 'Fish is expensive relative to balance, so earn money before buying food.',
        },
        {
          branchId: 'recovery',
          subtaskId: 'buy-food',
          priorityScore: 6,
          rationale: 'Food is still important but current market price makes it unaffordable.',
        },
      ];

  return {
    providerId: 'scripted-price-sensitive-prioritizer',
    model: request.model,
    finishReason: 'stop' as const,
    usage: { inputTokens: 50, outputTokens: 20 },
    content: JSON.stringify({ rankedSubtasks }),
  };
}

function readPrioritizerRequestEconomics(content: string): {
  readonly balance: number;
  readonly fishSpotPrice: number;
} {
  const payload = JSON.parse(content) as unknown;
  const root = readRecord(payload, 'prioritizer request payload');
  const worldDecisionContext = readRecord(
    root.worldDecisionContext,
    'prioritizer request worldDecisionContext',
  );
  const agent = readRecord(worldDecisionContext.agent, 'prioritizer request agent');
  const market = readRecord(worldDecisionContext.market, 'prioritizer request market');
  const spotPrices = readArray(market.spotPrices, 'prioritizer request spotPrices');
  const fishPrice = spotPrices.map((value) => readRecord(value, 'spot price')).find((price) => {
    return price.commodity === 'Fish';
  });
  if (fishPrice === undefined) {
    throw new Error('prioritizer request missing Fish spot price');
  }

  return {
    balance: readNumber(agent.balance, 'prioritizer request balance'),
    fishSpotPrice: readNumber(fishPrice.spotPrice, 'prioritizer request Fish spotPrice'),
  };
}

function readRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function readArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function readNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
}

function createPrioritizerInput(input: {
  readonly plan: SubtaskPrioritizerInput['plan'];
  readonly candidates: SubtaskPrioritizerInput['candidates'];
  readonly issuedAt: number;
  readonly fishSpotPrice: number;
  readonly balance: number;
}): SubtaskPrioritizerInput {
  return {
    agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: [],
    candidates: input.candidates,
    observedStateSummary: `energy=42 satiety=18 health=89 balance=${input.balance} inventory=empty`,
    worldDecisionContext: createWorldDecisionContext({
      fishSpotPrice: input.fishSpotPrice,
      balance: input.balance,
      issuedAt: input.issuedAt,
    }),
  };
}

function createWorldDecisionContext(input: {
  readonly fishSpotPrice: number;
  readonly balance: number;
  readonly issuedAt: number;
}): WorldDecisionContext {
  return {
    agent: {
      agentId,
      locationId: 'market',
      physiology: { energy: 42, satiety: 18, health: 89 },
      educationScore: 31,
      balance: input.balance,
      residentialTier: 2,
      job: 'Cleaner',
      inventory: {},
    },
    market: {
      spotPrices: [{ commodity: 'Fish', spotPrice: input.fishSpotPrice }],
      latestPriceIndex: {
        baselineAt: 0,
        recordedAt: input.issuedAt,
        overall: input.fishSpotPrice / 10,
        ratios: { Fish: input.fishSpotPrice / 10 },
      },
    },
    rules: {
      criticalThresholds: { energy: 20, health: 35 },
      occupations: [],
      production: [],
    },
  };
}
