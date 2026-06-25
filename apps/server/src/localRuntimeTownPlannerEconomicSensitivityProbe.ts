import {
  createBranchPlan,
  runSubtaskPrioritizationSensitivityProbe,
  scorePrioritizedSubtaskCandidates,
  type SubtaskPrioritizer,
  type SubtaskPrioritizerInput,
  type SubtaskPrioritizationSensitivityProbeResult,
  type WorldDecisionContext,
  type WorldDecisionOccupationRule,
  type WorldDecisionProductionRule,
} from '@aivilization/agent-runtime';
import { asAgentId, type SimulationTimestamp } from '@aivilization/sim-core';
import {
  createLocalRuntimeTownProfileSubtaskPrioritizer,
  type LocalRuntimeTownProfileSubtaskPrioritizerConfig,
} from './localRuntimeTownProfileLlmPlanning';

const ECONOMIC_SENSITIVITY_PROBE_AGENT_ID = asAgentId('economic-sensitivity-probe-agent');
const DEFAULT_PROBE_VARIANT = 'default';

type EconomicSensitivityProbeScenario = {
  readonly scenarioId: string;
  readonly plan: SubtaskPrioritizerInput['plan'];
  readonly baseline: EconomicSensitivityProbeObservation;
  readonly comparison: EconomicSensitivityProbeObservation;
};

type EconomicSensitivityProbeObservation = {
  readonly issuedAt: SimulationTimestamp;
  readonly observedStateSummary: string;
  readonly worldDecisionContext: WorldDecisionContext;
};

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

  return Promise.all(
    createEconomicSensitivityProbeScenarios(input.issuedAt).map((scenario) => {
      const candidates = scorePrioritizedSubtaskCandidates({ plan: scenario.plan, signals: [] });
      return runSubtaskPrioritizationSensitivityProbe({
        scenarioId: scenario.scenarioId,
        prioritizer,
        baseline: createProbePrioritizerInput({
          plan: scenario.plan,
          candidates,
          observation: scenario.baseline,
        }),
        comparison: createProbePrioritizerInput({
          plan: scenario.plan,
          candidates,
          observation: scenario.comparison,
        }),
      });
    }),
  );
}

function createEconomicSensitivityProbeScenarios(
  issuedAt: SimulationTimestamp,
): readonly EconomicSensitivityProbeScenario[] {
  return [
    createFishPriceAffordabilityScenario(issuedAt),
    createInventoryFoodBufferScenario(issuedAt + 10),
    createOccupationEligibilityGateScenario(issuedAt + 20),
    createProductionInputReadinessScenario(issuedAt + 30),
  ];
}

function createFishPriceAffordabilityScenario(
  issuedAt: SimulationTimestamp,
): EconomicSensitivityProbeScenario {
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

  return {
    scenarioId: 'fish-price-affordability',
    plan,
    baseline: createProbeObservation({
      issuedAt,
      balance: 80,
      fishSpotPrice: 8,
      inventory: {},
    }),
    comparison: createProbeObservation({
      issuedAt: issuedAt + 1,
      balance: 30,
      fishSpotPrice: 70,
      inventory: {},
    }),
  };
}

function createInventoryFoodBufferScenario(
  issuedAt: SimulationTimestamp,
): EconomicSensitivityProbeScenario {
  const plan = createBranchPlan({
    objective: 'Recover satiety with the least wasteful food source.',
    branches: [
      {
        id: 'market',
        objective: 'Buy food when inventory cannot cover recovery.',
        subtasks: [{ id: 'buy-food', description: 'Buy Fish from the market.', basePriority: 5 }],
      },
      {
        id: 'inventory',
        objective: 'Use existing food before spending scarce cash.',
        subtasks: [
          {
            id: 'consume-inventory-food',
            description: 'Consume Fish already held in inventory.',
            basePriority: 5,
          },
        ],
      },
    ],
  });

  return {
    scenarioId: 'inventory-food-buffer',
    plan,
    baseline: createProbeObservation({
      issuedAt,
      balance: 60,
      fishSpotPrice: 8,
      inventory: {},
    }),
    comparison: createProbeObservation({
      issuedAt: issuedAt + 1,
      balance: 60,
      fishSpotPrice: 8,
      inventory: { Fish: 3 },
    }),
  };
}

function createOccupationEligibilityGateScenario(
  issuedAt: SimulationTimestamp,
): EconomicSensitivityProbeScenario {
  const plan = createBranchPlan({
    objective: 'Choose between investing in education and applying for higher-tier work.',
    branches: [
      {
        id: 'development',
        objective: 'Increase human capital when the agent is not yet eligible.',
        subtasks: [{ id: 'study', description: 'Study to improve occupation eligibility.', basePriority: 5 }],
      },
      {
        id: 'employment',
        objective: 'Apply for work when education and residential tier unlock the role.',
        subtasks: [
          { id: 'apply-occupation', description: 'Apply for Stock Clerk occupation.', basePriority: 5 },
        ],
      },
    ],
  });

  return {
    scenarioId: 'occupation-eligibility-gate',
    plan,
    baseline: createProbeObservation({
      issuedAt,
      balance: 90,
      fishSpotPrice: 8,
      educationScore: 20,
      residentialTier: 1,
      occupations: [
        {
          occupationName: 'Stock Clerk',
          jobTier: 2,
          baseWage: 260,
          effectiveEducationThreshold: 42,
          requiredResidentialTier: 2,
          prerequisiteCommodity: null,
          eligible: false,
          rejectionReasons: ['education-too-low', 'residential-tier-too-low'],
          applicationQuota: {
            residentialTier: 1,
            limit: 1,
            currentApplications: 0,
            remaining: 1,
          },
        },
      ],
    }),
    comparison: createProbeObservation({
      issuedAt: issuedAt + 1,
      balance: 90,
      fishSpotPrice: 8,
      educationScore: 60,
      residentialTier: 2,
      occupations: [
        {
          occupationName: 'Stock Clerk',
          jobTier: 2,
          baseWage: 260,
          effectiveEducationThreshold: 42,
          requiredResidentialTier: 2,
          prerequisiteCommodity: null,
          eligible: true,
          rejectionReasons: [],
          applicationQuota: {
            residentialTier: 2,
            limit: 2,
            currentApplications: 0,
            remaining: 2,
          },
        },
      ],
    }),
  };
}

function createProductionInputReadinessScenario(
  issuedAt: SimulationTimestamp,
): EconomicSensitivityProbeScenario {
  const plan = createBranchPlan({
    objective: 'Choose whether to gather missing inputs or craft a higher-tier good.',
    branches: [
      {
        id: 'supply',
        objective: 'Collect inputs before attempting constrained production.',
        subtasks: [{ id: 'gather-inputs', description: 'Gather missing Chip inputs.', basePriority: 5 }],
      },
      {
        id: 'production',
        objective: 'Craft the good once inventory and production rules allow it.',
        subtasks: [{ id: 'craft-chip', description: 'Craft Chip from available inputs.', basePriority: 5 }],
      },
    ],
  });

  return {
    scenarioId: 'production-input-readiness',
    plan,
    baseline: createProbeObservation({
      issuedAt,
      balance: 90,
      fishSpotPrice: 8,
      residentialTier: 1,
      inventory: { Copper: 1 },
      production: [
        {
          commodity: 'Chip',
          minResidentialTier: 2,
          inputs: { Copper: 2, Silicon: 1 },
          energyCost: 12,
          satietyCost: 8,
          timeCostSeconds: 60,
          producible: false,
          rejectionReasons: ['residential-tier-too-low', 'missing-input'],
        },
      ],
    }),
    comparison: createProbeObservation({
      issuedAt: issuedAt + 1,
      balance: 90,
      fishSpotPrice: 8,
      residentialTier: 2,
      inventory: { Copper: 2, Silicon: 1 },
      production: [
        {
          commodity: 'Chip',
          minResidentialTier: 2,
          inputs: { Copper: 2, Silicon: 1 },
          energyCost: 12,
          satietyCost: 8,
          timeCostSeconds: 60,
          producible: true,
          rejectionReasons: [],
        },
      ],
    }),
  };
}

function createProbePrioritizerInput(input: {
  readonly plan: SubtaskPrioritizerInput['plan'];
  readonly candidates: SubtaskPrioritizerInput['candidates'];
  readonly observation: EconomicSensitivityProbeObservation;
}): SubtaskPrioritizerInput {
  return {
    agentId: ECONOMIC_SENSITIVITY_PROBE_AGENT_ID,
    issuedAt: input.observation.issuedAt,
    plan: input.plan,
    signals: [],
    candidates: input.candidates,
    observedStateSummary: input.observation.observedStateSummary,
    worldDecisionContext: input.observation.worldDecisionContext,
  };
}

function createProbeObservation(input: {
  readonly issuedAt: SimulationTimestamp;
  readonly balance: number;
  readonly fishSpotPrice: number;
  readonly energy?: number;
  readonly satiety?: number;
  readonly health?: number;
  readonly educationScore?: number;
  readonly residentialTier?: number;
  readonly job?: string | null;
  readonly inventory?: Readonly<Record<string, number>>;
  readonly occupations?: readonly WorldDecisionOccupationRule[];
  readonly production?: readonly WorldDecisionProductionRule[];
}): EconomicSensitivityProbeObservation {
  const worldDecisionContext = createProbeWorldDecisionContext(input);
  return {
    issuedAt: input.issuedAt,
    observedStateSummary: createObservedStateSummary(worldDecisionContext),
    worldDecisionContext,
  };
}

function createProbeWorldDecisionContext(input: {
  readonly issuedAt: SimulationTimestamp;
  readonly balance: number;
  readonly fishSpotPrice: number;
  readonly energy?: number;
  readonly satiety?: number;
  readonly health?: number;
  readonly educationScore?: number;
  readonly residentialTier?: number;
  readonly job?: string | null;
  readonly inventory?: Readonly<Record<string, number>>;
  readonly occupations?: readonly WorldDecisionOccupationRule[];
  readonly production?: readonly WorldDecisionProductionRule[];
}): WorldDecisionContext {
  const spotPrices = [
    { commodity: 'Chip', spotPrice: 45 },
    { commodity: 'Fish', spotPrice: input.fishSpotPrice },
  ];
  return {
    agent: {
      agentId: ECONOMIC_SENSITIVITY_PROBE_AGENT_ID,
      locationId: 'market',
      physiology: {
        energy: input.energy ?? 42,
        satiety: input.satiety ?? 18,
        health: input.health ?? 89,
      },
      educationScore: input.educationScore ?? 31,
      balance: input.balance,
      residentialTier: input.residentialTier ?? 2,
      job: input.job ?? 'Cleaner',
      inventory: input.inventory ?? {},
    },
    market: {
      spotPrices,
      latestPriceIndex: {
        baselineAt: 0,
        recordedAt: input.issuedAt,
        overall: input.fishSpotPrice / 10,
        ratios: Object.fromEntries(
          spotPrices.map((price) => [
            price.commodity,
            price.commodity === 'Fish' ? input.fishSpotPrice / 10 : 1,
          ]),
        ),
      },
    },
    rules: {
      criticalThresholds: { energy: 20, health: 35 },
      occupations: input.occupations ?? [],
      production: input.production ?? [],
    },
  };
}

function createObservedStateSummary(context: WorldDecisionContext): string {
  const inventoryEntries = Object.entries(context.agent.inventory);
  const inventory =
    inventoryEntries.length === 0
      ? 'empty'
      : inventoryEntries.map(([commodity, quantity]) => `${commodity}:${quantity}`).join(',');

  return [
    `energy=${context.agent.physiology.energy}`,
    `satiety=${context.agent.physiology.satiety}`,
    `health=${context.agent.physiology.health}`,
    `education=${context.agent.educationScore}`,
    `balance=${context.agent.balance}`,
    `residentialTier=${context.agent.residentialTier}`,
    `job=${context.agent.job ?? 'none'}`,
    `inventory=${inventory}`,
  ].join(' ');
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
