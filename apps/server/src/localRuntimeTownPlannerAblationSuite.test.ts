import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileBranchPlanRepository,
  createBranchPlan,
  normalizeStrategicPlanCompilerOutput,
  type BranchPlanRecord,
  type SubtaskPrioritizer,
  type SubtaskPrioritizerInput,
  type SubtaskPrioritizationSensitivityProbeResult,
} from '@aivilization/agent-runtime';
import {
  FileAgentCycleTraceRepository,
  InMemoryRuntimeProfileRunReportRepository,
  createAgentCycleTrace,
  createPlannerExperimentRunsFromRuntimeProfileReports,
  type AgentCycleTrace,
} from '@aivilization/observability';
import { asAgentId } from '@aivilization/sim-core';
import { afterEach, describe, expect, test } from 'vitest';
import { runLocalRuntimeTownPlannerAblationSuite } from './localRuntimeTownPlannerAblationSuite';
import {
  type LocalRuntimeTownProfileRunnerInput,
  type LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town planner ablation suite', () => {
  test('runs default and ablated profile variants into validation-ready reports', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const repository = new InMemoryRuntimeProfileRunReportRepository();

    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-ablation',
      profileRunReportRepository: repository,
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      cycleIntervalMs: 25,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createVariantSummary(input));
      },
    });

    expect(result).toMatchObject({
      status: 'completed',
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      variantCount: 3,
      requestedAt: 100,
    });
    expect(result.variants.map((variant) => variant.variant)).toEqual([
      'default',
      'without-branch',
      'without-objective-decomposition',
    ]);
    expect(inputs.map((input) => input.runIdSuffix)).toEqual([
      'default',
      'without-branch',
      'without-objective-decomposition',
    ]);
    expect(inputs.map((input) => input.rootDir)).toEqual([
      '/tmp/aivilization-planner-ablation/default',
      '/tmp/aivilization-planner-ablation/without-branch',
      '/tmp/aivilization-planner-ablation/without-objective-decomposition',
    ]);
    expect(
      result.variants.map((variant) => variant.report.plannerExperiment?.metrics.slice(0, 3)),
    ).toEqual([
      [
        { metricId: 'completed-cycle-count', value: 2, higherIsBetter: true },
        { metricId: 'total-agent-trace-count', value: 2, higherIsBetter: true },
        { metricId: 'total-event-count', value: 6, higherIsBetter: true },
      ],
      [
        { metricId: 'completed-cycle-count', value: 1, higherIsBetter: true },
        { metricId: 'total-agent-trace-count', value: 1, higherIsBetter: true },
        { metricId: 'total-event-count', value: 3, higherIsBetter: true },
      ],
      [
        { metricId: 'completed-cycle-count', value: 2, higherIsBetter: true },
        { metricId: 'total-agent-trace-count', value: 2, higherIsBetter: true },
        { metricId: 'total-event-count', value: 6, higherIsBetter: true },
      ],
    ]);
    expect(result.variants[0]?.report.plannerExperiment?.metrics).toEqual(
      expect.arrayContaining([{ metricId: 'planner-plan-count', value: 0, higherIsBetter: true }]),
    );

    const plannerRuns = createPlannerExperimentRunsFromRuntimeProfileReports(
      await repository.query({ profileId: 'smoke-25' }),
    );

    expect(plannerRuns.map((run) => ({ taskId: run.taskId, variant: run.variant }))).toEqual([
      { taskId: 'high-tech-production', variant: 'default' },
      { taskId: 'high-tech-production', variant: 'without-branch' },
      { taskId: 'high-tech-production', variant: 'without-objective-decomposition' },
    ]);
  });

  test('wires default without-branch variant to a real strategic compiler', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];

    await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-ablation',
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 300,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createVariantSummary(input));
      },
    });

    expect(inputs).toHaveLength(3);
    expect(inputs[0]?.runIdSuffix).toBe('default');
    expect(inputs[0]?.strategicPlanCompiler).toBeUndefined();
    expect(inputs[1]?.runIdSuffix).toBe('without-branch');
    expect(inputs[1]?.strategicPlanCompiler).not.toBeUndefined();

    const compiler = inputs[1]?.strategicPlanCompiler;
    if (compiler === undefined) {
      throw new Error('expected without-branch compiler');
    }
    const compiled = normalizeStrategicPlanCompilerOutput(
      await compiler({
        objective: {
          id: 'objective-study',
          agentId: asAgentId('agent-1'),
          statement: 'Study before applying for work.',
          priority: 4,
          source: 'agent',
          affinityTags: ['study', 'work', 'study'],
          createdAt: 300,
          updatedAt: 300,
        },
        issuedAt: 333,
      }),
    );

    expect(compiled.plan).toEqual({
      objective: 'Study before applying for work.',
      branches: [
        {
          id: 'without-branch',
          objective: 'Pursue the objective without alternative branch decomposition.',
          subtasks: [
            {
              id: 'pursue-objective',
              description:
                'Pursue the objective directly without branch decomposition: Study before applying for work.',
              basePriority: 12,
              signalKeys: ['study', 'work'],
              intentionAffinityTags: ['study', 'work'],
              memoryAffinityTags: ['study', 'work'],
              profileAffinityTags: ['study', 'work'],
            },
          ],
        },
      ],
    });
    expect(compiled.planningTrace).toEqual({
      status: 'deterministic',
      source: 'deterministic',
      message: 'Planner ablation without branch decomposition',
    });
  });

  test('wires default without-objective-decomposition variant to a real strategic compiler', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];

    await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-ablation',
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 325,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createVariantSummary(input));
      },
    });

    expect(inputs).toHaveLength(3);
    expect(inputs[2]?.runIdSuffix).toBe('without-objective-decomposition');
    expect(inputs[2]?.strategicPlanCompiler).not.toBeUndefined();

    const compiler = inputs[2]?.strategicPlanCompiler;
    if (compiler === undefined) {
      throw new Error('expected without-objective-decomposition compiler');
    }
    const compiled = normalizeStrategicPlanCompilerOutput(
      await compiler({
        objective: {
          id: 'objective-study-production',
          agentId: asAgentId('agent-1'),
          statement: 'Study, apply for work, craft Chip, and trade for resources.',
          priority: 4,
          source: 'agent',
          affinityTags: ['study', 'work', 'production', 'trade'],
          createdAt: 325,
          updatedAt: 325,
        },
        issuedAt: 333,
      }),
    );

    expect(compiled.planningTrace).toEqual({
      status: 'deterministic',
      source: 'deterministic',
      message: 'Planner ablation without objective decomposition',
    });
    expect(compiled.plan.branches.map((branch) => branch.id)).toEqual([
      'without-objective-decomposition-development',
      'without-objective-decomposition-employment',
      'without-objective-decomposition-production',
      'without-objective-decomposition-market',
    ]);
    expect(compiled.plan.branches.every((branch) => branch.subtasks.length === 1)).toBe(true);
    expect(
      compiled.plan.branches.flatMap((branch) => branch.subtasks.map((subtask) => subtask.id)),
    ).toEqual([
      'study-direct-action',
      'work-direct-action',
      'production-direct-action',
      'trade-direct-action',
    ]);
  });

  test('adds planner shape metrics from durable branch plan artifacts', async () => {
    const rootDir = createRootDir();

    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir,
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 400,
      runProfile: async (input) => {
        const summary = createVariantSummary(input);
        await saveSuiteBranchPlanArtifact(summary, input.runIdSuffix ?? 'default');
        return summary;
      },
    });

    expect(result.structureStatus).toBe('pass');
    expect(result.structureFailureCount).toBe(0);
    expect(result.variants.map((variant) => variant.structureGate.status)).toEqual([
      'pass',
      'pass',
      'pass',
    ]);

    const defaultMetrics = result.variants[0]?.report.plannerExperiment?.metrics ?? [];
    const withoutBranchMetrics = result.variants[1]?.report.plannerExperiment?.metrics ?? [];

    expect(defaultMetrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-plan-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-branch-count', value: 2, higherIsBetter: true },
        { metricId: 'planner-mean-subtask-count', value: 3, higherIsBetter: true },
        { metricId: 'planner-mean-subtasks-per-branch', value: 1.5, higherIsBetter: true },
        { metricId: 'planner-single-branch-plan-ratio', value: 0, higherIsBetter: false },
        { metricId: 'planner-multi-subtask-branch-ratio', value: 0.5, higherIsBetter: true },
        { metricId: 'planner-llm-source-count', value: 1, higherIsBetter: true },
      ]),
    );
    expect(withoutBranchMetrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-plan-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-branch-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-subtask-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-mean-subtasks-per-branch', value: 1, higherIsBetter: true },
        { metricId: 'planner-single-branch-plan-ratio', value: 1, higherIsBetter: false },
        { metricId: 'planner-multi-subtask-branch-ratio', value: 0, higherIsBetter: true },
        { metricId: 'planner-deterministic-source-count', value: 1, higherIsBetter: true },
      ]),
    );
  });

  test('fails planner ablation structure gate when a variant violates the paper ablation shape', async () => {
    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-ablation',
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 450,
      variants: [{ variant: 'default' }, { variant: 'without-objective-decomposition' }],
      createMetrics: (_summary, variant) =>
        variant.variant === 'default'
          ? createStructureMetrics({
              planCount: 1,
              meanBranchCount: 2,
              singleBranchPlanRatio: 0,
              multiSubtaskBranchRatio: 0.5,
            })
          : createStructureMetrics({
              planCount: 1,
              meanBranchCount: 2,
              singleBranchPlanRatio: 0,
              multiSubtaskBranchRatio: 0.25,
            }),
      runProfile: (input) => Promise.resolve(createVariantSummary(input)),
    });

    expect(result.structureStatus).toBe('fail');
    expect(result.structureFailureCount).toBe(1);
    expect(result.variants[1]?.structureGate).toEqual({
      variant: 'without-objective-decomposition',
      status: 'fail',
      failureCount: 1,
      failures: [
        {
          code: 'without-objective-decomposition-retains-objective-decomposition',
          message:
            'without-objective-decomposition planner must remove branch-internal objective decomposition',
          evidence: { actual: 0.25, expected: 0 },
        },
      ],
    });
  });

  test('adds planner outcome metrics from durable agent cycle traces', async () => {
    const rootDir = createRootDir();

    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir,
      profileId: 'smoke-25',
      taskId: 'high-tech-production',
      requestedAt: 500,
      runProfile: async (input) => {
        const summary = createVariantSummary(input);
        await saveSuiteAgentCycleTraceArtifact(summary, input.runIdSuffix ?? 'default');
        return summary;
      },
    });

    const defaultMetrics = result.variants[0]?.report.plannerExperiment?.metrics ?? [];
    const withoutBranchMetrics = result.variants[1]?.report.plannerExperiment?.metrics ?? [];

    expect(defaultMetrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-cycle-trace-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-command-emitting-cycle-ratio', value: 1, higherIsBetter: true },
        { metricId: 'planner-simulator-accepted-ratio', value: 1, higherIsBetter: true },
        { metricId: 'planner-simulator-rejected-ratio', value: 0, higherIsBetter: false },
      ]),
    );
    expect(withoutBranchMetrics).toEqual(
      expect.arrayContaining([
        { metricId: 'planner-cycle-trace-count', value: 1, higherIsBetter: true },
        { metricId: 'planner-command-emitting-cycle-ratio', value: 0, higherIsBetter: true },
        { metricId: 'planner-simulator-accepted-ratio', value: 0, higherIsBetter: true },
        { metricId: 'planner-simulator-rejected-ratio', value: 1, higherIsBetter: false },
        { metricId: 'planner-replanning-cycle-ratio', value: 1, higherIsBetter: false },
      ]),
    );
  });

  test('adds planner economic sensitivity metrics from configured probe results', async () => {
    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-economic-sensitivity',
      profileId: 'smoke-25',
      taskId: 'economic-contextual-prioritization',
      requestedAt: 550,
      createEconomicSensitivityProbeResults: (_summary, variant) =>
        variant.variant === 'default'
          ? [
              createSensitivityProbeResult({
                scenarioId: 'fish-price-spike',
                status: 'sensitive',
                selectionChanged: true,
                completeEconomicContext: true,
              }),
              createSensitivityProbeResult({
                scenarioId: 'missing-market-prices',
                status: 'insensitive',
                selectionChanged: false,
                completeEconomicContext: false,
              }),
            ]
          : [],
      runProfile: (input) => Promise.resolve(createVariantSummary(input)),
    });

    const defaultMetrics = result.variants[0]?.report.plannerExperiment?.metrics ?? [];
    const withoutBranchMetrics = result.variants[1]?.report.plannerExperiment?.metrics ?? [];

    expect(defaultMetrics).toEqual(
      expect.arrayContaining([
        {
          metricId: 'planner-economic-sensitivity-scenario-count',
          value: 2,
          higherIsBetter: true,
        },
        {
          metricId: 'planner-economic-sensitivity-selection-change-count',
          value: 1,
          higherIsBetter: true,
        },
        {
          metricId: 'planner-economic-sensitivity-complete-economic-context-count',
          value: 1,
          higherIsBetter: true,
        },
      ]),
    );
    expect(withoutBranchMetrics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: 'planner-economic-sensitivity-scenario-count' }),
      ]),
    );
  });

  test('runs default planner economic sensitivity probe from configured subtask prioritizer', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const prioritizerInputs: SubtaskPrioritizerInput[] = [];
    const subtaskPrioritizer = createPriceSensitiveProbePrioritizer(prioritizerInputs);

    const result = await runLocalRuntimeTownPlannerAblationSuite({
      rootDir: '/tmp/aivilization-planner-economic-sensitivity-probe',
      profileId: 'smoke-25',
      taskId: 'economic-contextual-prioritization',
      requestedAt: 575,
      subtaskPrioritizer,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createVariantSummary(input));
      },
    });

    const defaultMetrics = result.variants[0]?.report.plannerExperiment?.metrics ?? [];
    const withoutBranchMetrics = result.variants[1]?.report.plannerExperiment?.metrics ?? [];

    expect(inputs).toHaveLength(3);
    expect(inputs.every((input) => input.subtaskPrioritizer === subtaskPrioritizer)).toBe(true);
    expect(prioritizerInputs).toHaveLength(2);
    expect(prioritizerInputs.map(readProbePrioritizerEconomics)).toEqual([
      { balance: 80, fishSpotPrice: 8 },
      { balance: 30, fishSpotPrice: 70 },
    ]);
    expect(defaultMetrics).toEqual(
      expect.arrayContaining([
        {
          metricId: 'planner-economic-sensitivity-scenario-count',
          value: 1,
          higherIsBetter: true,
        },
        {
          metricId: 'planner-economic-sensitivity-selection-change-count',
          value: 1,
          higherIsBetter: true,
        },
        {
          metricId: 'planner-economic-sensitivity-complete-economic-context-count',
          value: 1,
          higherIsBetter: true,
        },
      ]),
    );
    expect(withoutBranchMetrics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricId: 'planner-economic-sensitivity-scenario-count' }),
      ]),
    );
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-planner-ablation-suite-'));
  tmpRoots.push(root);
  return root;
}

async function saveSuiteBranchPlanArtifact(
  summary: LocalRuntimeTownProfileRunnerSummary,
  variant: string,
): Promise<void> {
  const partition = summary.partitions[0];
  if (partition === undefined) {
    throw new Error('expected at least one profile partition');
  }
  const repository = new FileBranchPlanRepository({
    rootDir: join(
      summary.rootDir,
      'simulations',
      partition.simulationId,
      'partitions',
      partition.partitionKey,
      'planning',
    ),
  });
  await repository.save(createSuitePlanRecord(variant));
}

async function saveSuiteAgentCycleTraceArtifact(
  summary: LocalRuntimeTownProfileRunnerSummary,
  variant: string,
): Promise<void> {
  const partition = summary.partitions[0];
  if (partition === undefined) {
    throw new Error('expected at least one profile partition');
  }
  const repository = new FileAgentCycleTraceRepository({
    rootDir: join(
      summary.rootDir,
      'simulations',
      partition.simulationId,
      'partitions',
      partition.partitionKey,
      'observability',
    ),
  });
  await repository.record(createSuiteAgentCycleTrace(variant, partition.simulationId));
}

function createSuitePlanRecord(variant: string): BranchPlanRecord {
  const isWithoutBranch = variant === 'without-branch';
  const isWithoutObjectiveDecomposition = variant === 'without-objective-decomposition';
  return {
    planId: `${variant}-plan`,
    agentId: asAgentId(`${variant}-agent`),
    plan: createBranchPlan({
      objective: `${variant} objective`,
      branches: isWithoutBranch
        ? [
            {
              id: 'without-branch',
              objective: 'Direct pursuit.',
              subtasks: [
                {
                  id: 'pursue-objective',
                  description: 'Pursue directly.',
                  basePriority: 1,
                },
              ],
            },
          ]
        : isWithoutObjectiveDecomposition
          ? [
              {
                id: 'research',
                objective: 'Research direct action.',
                subtasks: [{ id: 'study-direct', description: 'Study directly.', basePriority: 1 }],
              },
              {
                id: 'production',
                objective: 'Production direct action.',
                subtasks: [
                  { id: 'produce-direct', description: 'Produce directly.', basePriority: 1 },
                ],
              },
            ]
        : [
            {
              id: 'research',
              objective: 'Research alternatives.',
              subtasks: [{ id: 'study', description: 'Study.', basePriority: 1 }],
            },
            {
              id: 'production',
              objective: 'Produce resources.',
              subtasks: [
                { id: 'source-inputs', description: 'Source inputs.', basePriority: 1 },
                { id: 'produce-output', description: 'Produce output.', basePriority: 1 },
              ],
            },
          ],
    }),
    planningTrace: {
      status: isWithoutBranch ? 'deterministic' : 'accepted',
      source: isWithoutBranch ? 'deterministic' : 'llm',
    },
    createdAt: 100,
    updatedAt: 100,
  };
}

function createStructureMetrics(input: {
  readonly planCount: number;
  readonly meanBranchCount: number;
  readonly singleBranchPlanRatio: number;
  readonly multiSubtaskBranchRatio: number;
}) {
  return [
    { metricId: 'planner-plan-count', value: input.planCount, higherIsBetter: true },
    {
      metricId: 'planner-mean-branch-count',
      value: input.meanBranchCount,
      higherIsBetter: true,
    },
    {
      metricId: 'planner-single-branch-plan-ratio',
      value: input.singleBranchPlanRatio,
      higherIsBetter: false,
    },
    {
      metricId: 'planner-multi-subtask-branch-ratio',
      value: input.multiSubtaskBranchRatio,
      higherIsBetter: true,
    },
  ];
}

function createPriceSensitiveProbePrioritizer(
  calls: SubtaskPrioritizerInput[],
): SubtaskPrioritizer {
  return (input) => {
    calls.push(input);
    const { balance, fishSpotPrice } = readProbePrioritizerEconomics(input);
    const canBuyFoodWithoutDepletingCash = fishSpotPrice <= balance * 0.5;
    const rankedCandidateKeys = canBuyFoodWithoutDepletingCash
      ? [
          { branchId: 'recovery', subtaskId: 'buy-food' },
          { branchId: 'income', subtaskId: 'work' },
        ]
      : [
          { branchId: 'income', subtaskId: 'work' },
          { branchId: 'recovery', subtaskId: 'buy-food' },
        ];

    return {
      candidates: rankedCandidateKeys.map((key) =>
        requireCandidate(input.candidates, key.branchId, key.subtaskId),
      ),
      trace: { status: 'accepted', source: 'llm' },
    };
  };
}

function readProbePrioritizerEconomics(input: SubtaskPrioritizerInput): {
  readonly balance: number;
  readonly fishSpotPrice: number;
} {
  const worldDecisionContext = input.worldDecisionContext;
  if (worldDecisionContext === undefined) {
    throw new Error('probe prioritizer input missing worldDecisionContext');
  }
  const fishSpotPrice = worldDecisionContext.market.spotPrices.find(
    (price) => price.commodity === 'Fish',
  )?.spotPrice;
  if (fishSpotPrice === undefined) {
    throw new Error('probe prioritizer input missing Fish spot price');
  }

  return {
    balance: worldDecisionContext.agent.balance,
    fishSpotPrice,
  };
}

function requireCandidate(
  candidates: SubtaskPrioritizerInput['candidates'],
  branchId: string,
  subtaskId: string,
): SubtaskPrioritizerInput['candidates'][number] {
  const candidate = candidates.find(
    (value) => value.branchId === branchId && value.subtaskId === subtaskId,
  );
  if (candidate === undefined) {
    throw new Error(`missing probe candidate ${branchId}/${subtaskId}`);
  }
  return candidate;
}

function createSensitivityProbeResult(input: {
  readonly scenarioId: string;
  readonly status: SubtaskPrioritizationSensitivityProbeResult['status'];
  readonly selectionChanged: boolean;
  readonly completeEconomicContext: boolean;
}): SubtaskPrioritizationSensitivityProbeResult {
  const worldDecisionContext = createWorldDecisionContextTrace(input.completeEconomicContext);

  return {
    scenarioId: input.scenarioId,
    status: input.status,
    selectionChanged: input.selectionChanged,
    completeEconomicContext: input.completeEconomicContext,
    baseline: {
      selected: { branchId: 'trade', subtaskId: 'buy-fish', score: 12 },
      trace: { status: 'deterministic', source: 'deterministic', worldDecisionContext },
      worldDecisionContext,
    },
    comparison: {
      selected: input.selectionChanged
        ? { branchId: 'work', subtaskId: 'earn-income', score: 13 }
        : { branchId: 'trade', subtaskId: 'buy-fish', score: 12 },
      trace: { status: 'deterministic', source: 'deterministic', worldDecisionContext },
      worldDecisionContext,
    },
  };
}

function createWorldDecisionContextTrace(
  completeEconomicContext: boolean,
): NonNullable<SubtaskPrioritizationSensitivityProbeResult['baseline']['worldDecisionContext']> {
  return {
    agentId: asAgentId('agent-1'),
    hasLocationId: true,
    hasPhysiology: true,
    hasJob: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    hasInventory: true,
    inventoryItemCount: 1,
    marketSpotPriceCount: completeEconomicContext ? 2 : 0,
    hasLatestPriceIndex: completeEconomicContext,
    hasEconomicState: true,
    hasMarketPrices: completeEconomicContext,
    completeEconomicContext,
    occupationRuleCount: 1,
    eligibleOccupationRuleCount: 1,
    productionRuleCount: 1,
    producibleCommodityRuleCount: 1,
  };
}

function createSuiteAgentCycleTrace(variant: string, simulationId: string): AgentCycleTrace {
  const isWithoutBranch = variant === 'without-branch';
  const acceptedActions = isWithoutBranch
    ? []
    : [
        {
          id: `${variant}:study-action`,
          description: 'Study from planner output.',
          commandType: 'AgentStudy',
        },
      ];

  return createAgentCycleTrace({
    traceId: `${variant}:trace`,
    simulationId,
    agentId: `${variant}:agent`,
    cycleStartedAt: 100,
    observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
    selectedBranch: isWithoutBranch ? 'without-branch' : 'development',
    subtaskCandidates: [
      {
        branchId: isWithoutBranch ? 'without-branch' : 'development',
        subtaskId: 'study',
        description: 'study',
        score: 5,
        scoreBreakdown: {
          basePriorityScore: 5,
          signalInfluenceScore: 0,
          intentionInfluenceScore: 0,
          memoryInfluenceScore: 0,
          profileInfluenceScore: 0,
        },
      },
    ],
    actionSynthesis: {
      acceptedActions,
      rejectedActions: isWithoutBranch
        ? [
            {
              action: {
                id: `${variant}:blocked-action`,
                description: 'Blocked planner action.',
                commandType: 'AgentStudy',
              },
              reason: 'blocked by ablation test fixture',
            },
          ]
        : [],
    },
    candidateActions: acceptedActions.map((action) => action.description),
    simulatorResult: isWithoutBranch
      ? { status: 'rejected', reason: 'blocked by ablation test fixture' }
      : { status: 'accepted' },
    simulatorEvents: [],
    selectionEvidence: {
      selectedSubtaskId: 'study',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: isWithoutBranch
      ? {
          kind: 'memory-guided-correction',
          trigger: 'simulator-rejection',
          reason: 'blocked by ablation test fixture',
          failedActionIds: [`${variant}:blocked-action`],
          evidenceRecordIds: [],
        }
      : { kind: 'none' },
    subtaskReplanningDecisions: [
      {
        branchId: isWithoutBranch ? 'without-branch' : 'development',
        subtaskId: 'study',
        decision: isWithoutBranch
          ? {
              kind: 'memory-guided-correction',
              trigger: 'simulator-rejection',
              reason: 'blocked by ablation test fixture',
              failedActionIds: [`${variant}:blocked-action`],
              evidenceRecordIds: [],
            }
          : { kind: 'none' },
      },
    ],
    emittedCommandIds: isWithoutBranch ? [] : [`${variant}:command-1`],
    memoryContextIds: [],
    memoryWriteIds: [],
  });
}

function createVariantSummary(
  input: LocalRuntimeTownProfileRunnerInput,
): LocalRuntimeTownProfileRunnerSummary {
  const summary = createPassingProfileSummary(input);
  if (input.runIdSuffix === 'without-branch') {
    return {
      ...summary,
      totalEventCount: 3,
      totalAgentTraceCount: 1,
      agentCycleDiagnostics: createAgentCycleDiagnostics(1),
      run: {
        ...summary.run,
        completedCycleCount: 1,
      },
      partitions: summary.partitions.map((partition) => ({
        ...partition,
        eventCount: 3,
        agentTraceCount: 1,
      })),
    };
  }
  return summary;
}

function createPassingProfileSummary(
  input: LocalRuntimeTownProfileRunnerInput,
): LocalRuntimeTownProfileRunnerSummary {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(input.profileId);
  const criteria = createLocalRuntimeTownProfileGateCriteria(input.profileId, {
    minimumCompletedCycleCount: input.cycleCount,
  });
  const partitions = profile.manifest.partitions.map((partition) => {
    const projectionAgentCount =
      criteria.expectedProjectionAgentCountByPartition[partition.partitionKey];
    if (projectionAgentCount === undefined) {
      throw new Error(`missing expected agent count for ${partition.partitionKey}`);
    }

    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status: 'completed',
      health: 'healthy',
      lastAppliedSequence: 3,
      streamVersion: 3,
      eventCount: 6,
      projectionAgentCount,
      agentTraceCount: 2,
    };
  });

  const totalAgentTraceCount = partitions.reduce(
    (total, partition) => total + partition.agentTraceCount,
    0,
  );

  return {
    profileId: input.profileId,
    manifestId: profile.manifest.id,
    rootDir: input.rootDir,
    requestedAt: input.requestedAt,
    daemonHealth: 'healthy',
    partitionCount: partitions.length,
    totalProjectionAgentCount: partitions.reduce(
      (total, partition) => total + partition.projectionAgentCount,
      0,
    ),
    totalEventCount: partitions.reduce((total, partition) => total + partition.eventCount, 0),
    totalAgentTraceCount,
    agentCycleDiagnostics: createAgentCycleDiagnostics(totalAgentTraceCount),
    run: {
      traceId: `${profile.manifest.id}:profile-run:${input.requestedAt}:${input.runIdSuffix}`,
      outcome: 'succeeded',
      requestedCycleCount: input.cycleCount,
      completedCycleCount: input.cycleCount,
      stopReason: 'cycle-count-completed',
    },
    partitions,
  };
}

function createAgentCycleDiagnostics(traceCount: number) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    simulatorRolloutEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
    simulatorRolloutCoverageRatio: traceCount === 0 ? 0 : 1,
  };
}
