import {
  createBranchPlan,
  runSubtaskPrioritizationSensitivityProbe,
  scorePrioritizedSubtaskCandidates,
  type SubtaskPrioritizer,
  type SubtaskPrioritizerInput,
  type SubtaskPrioritizationSensitivityProbeResult,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import { asAgentId, type SimulationTimestamp } from '@aivilization/sim-core';
import {
  createLocalRuntimeTownProfileSubtaskPrioritizer,
  type LocalRuntimeTownProfileSubtaskPrioritizerConfig,
} from './localRuntimeTownProfileLlmPlanning';

const ECONOMIC_SENSITIVITY_PROBE_AGENT_ID = asAgentId('economic-sensitivity-probe-agent');
const DEFAULT_PROBE_VARIANT = 'default';

export type LocalRuntimeTownPlannerEconomicSensitivityProbeInput = {
  readonly profileId: string;
  readonly variant: string;
  readonly issuedAt: SimulationTimestamp;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly subtaskPrioritization?: LocalRuntimeTownProfileSubtaskPrioritizerConfig;
};

export async function createLocalRuntimeTownPlannerEconomicSensitivityProbeResults(
  input: LocalRuntimeTownPlannerEconomicSensitivityProbeInput,
): Promise<readonly SubtaskPrioritizationSensitivityProbeResult[]> {
  assertNonEmpty(input.profileId, 'profileId');
  assertNonEmpty(input.variant, 'variant');
  assertNonNegativeFinite(input.issuedAt, 'issuedAt');
  if (input.variant !== DEFAULT_PROBE_VARIANT) {
    return [];
  }

  const prioritizer =
    input.subtaskPrioritizer ??
    createLocalRuntimeTownProfileSubtaskPrioritizer(input.subtaskPrioritization);
  if (prioritizer === undefined) {
    return [];
  }

  const plan = createEconomicSensitivityProbePlan();
  const candidates = scorePrioritizedSubtaskCandidates({ plan, signals: [] });

  return [
    await runSubtaskPrioritizationSensitivityProbe({
      scenarioId: 'fish-price-affordability',
      prioritizer,
      baseline: createProbePrioritizerInput({
        issuedAt: input.issuedAt,
        plan,
        candidates,
        balance: 80,
        fishSpotPrice: 8,
      }),
      comparison: createProbePrioritizerInput({
        issuedAt: input.issuedAt + 1,
        plan,
        candidates,
        balance: 30,
        fishSpotPrice: 70,
      }),
    }),
  ];
}

function createEconomicSensitivityProbePlan(): SubtaskPrioritizerInput['plan'] {
  return createBranchPlan({
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
}

function createProbePrioritizerInput(input: {
  readonly issuedAt: SimulationTimestamp;
  readonly plan: SubtaskPrioritizerInput['plan'];
  readonly candidates: SubtaskPrioritizerInput['candidates'];
  readonly balance: number;
  readonly fishSpotPrice: number;
}): SubtaskPrioritizerInput {
  return {
    agentId: ECONOMIC_SENSITIVITY_PROBE_AGENT_ID,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: [],
    candidates: input.candidates,
    observedStateSummary: [
      'energy=42',
      'satiety=18',
      'health=89',
      'education=31',
      `balance=${input.balance}`,
      'residentialTier=2',
      'job=Cleaner',
      'inventory=empty',
    ].join(' '),
    worldDecisionContext: createProbeWorldDecisionContext({
      issuedAt: input.issuedAt,
      balance: input.balance,
      fishSpotPrice: input.fishSpotPrice,
    }),
  };
}

function createProbeWorldDecisionContext(input: {
  readonly issuedAt: SimulationTimestamp;
  readonly balance: number;
  readonly fishSpotPrice: number;
}): WorldDecisionContext {
  return {
    agent: {
      agentId: ECONOMIC_SENSITIVITY_PROBE_AGENT_ID,
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

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
