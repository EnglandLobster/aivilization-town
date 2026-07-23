import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cloneSourceRevision, type SourceRevision } from '@aivilization/sim-core';

export const PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION =
  'paper-planner-ablation-experiment-v1';

export type PaperPlannerAblationTaskId = 'task-1' | 'task-2' | 'task-3' | 'task-4';
export type PaperPlannerAblationVariant =
  | 'default'
  | 'without-branch'
  | 'without-objective-decomposition';

export type PaperPlannerAblationMetricId =
  | 'average-currency-balance'
  | 'average-inventory-value'
  | 'average-net-worth'
  | 'average-education-score'
  | 'average-satiety'
  | 'average-energy'
  | 'average-health'
  | 'average-high-tech-items-produced'
  | 'unique-actions-per-turn'
  | 'unique-actions-per-simulated-minute'
  | 'total-unique-actions'
  | 'average-chips-produced';

export type PaperPlannerAblationTaskDefinition = {
  readonly taskId: PaperPlannerAblationTaskId;
  readonly taskClass: 'complex-multi-objective' | 'simple-single-objective';
  readonly name: string;
  readonly topLevelLongTermGoal: string;
  readonly affinityTags: readonly string[];
  readonly paperTable: 'Table 2' | 'Table 3' | 'Table 4' | 'Table 5';
  readonly paperFigure: 'Figure 11' | 'Figure 12' | 'Figure 13' | 'Figure 14';
  readonly metricIds: readonly PaperPlannerAblationMetricId[];
};

const TASK_DEFINITIONS: Readonly<
  Record<PaperPlannerAblationTaskId, PaperPlannerAblationTaskDefinition>
> = {
  'task-1': {
    taskId: 'task-1',
    taskClass: 'complex-multi-objective',
    name: 'High-Tech Industrial Production with State Maintenance',
    topLevelLongTermGoal:
      'Craft as much high value objectives as possible, earn as much money as possible, while maintaining an higher satiety/energy/health value',
    affinityTags: [
      'production',
      'trade',
      'work',
      'education',
      'satiety',
      'energy',
      'health',
    ],
    paperTable: 'Table 2',
    paperFigure: 'Figure 11',
    metricIds: [
      'average-currency-balance',
      'average-net-worth',
      'average-education-score',
      'average-satiety',
      'average-energy',
      'average-health',
      'average-high-tech-items-produced',
    ],
  },
  'task-2': {
    taskId: 'task-2',
    taskClass: 'complex-multi-objective',
    name: 'Wealth and Education',
    topLevelLongTermGoal:
      'Try to earn as much money as possible and increase your study experience as much as possible',
    affinityTags: ['work', 'trade', 'production', 'education', 'study'],
    paperTable: 'Table 3',
    paperFigure: 'Figure 12',
    metricIds: [
      'average-currency-balance',
      'average-inventory-value',
      'average-net-worth',
      'average-education-score',
    ],
  },
  'task-3': {
    taskId: 'task-3',
    taskClass: 'complex-multi-objective',
    name: 'Action Diversity',
    topLevelLongTermGoal:
      'Generate diverse actions and encourage trying various available actions to explore the world.',
    affinityTags: [
      'exploration',
      'production',
      'trade',
      'work',
      'education',
      'social',
      'health',
    ],
    paperTable: 'Table 4',
    paperFigure: 'Figure 13',
    metricIds: [
      'unique-actions-per-turn',
      'unique-actions-per-simulated-minute',
      'total-unique-actions',
    ],
  },
  'task-4': {
    taskId: 'task-4',
    taskClass: 'simple-single-objective',
    name: 'Efficient Chip Production',
    topLevelLongTermGoal: 'craft chips as efficiently as possible',
    affinityTags: ['production', 'chip'],
    paperTable: 'Table 5',
    paperFigure: 'Figure 14',
    metricIds: ['average-chips-produced'],
  },
};

export type PaperPlannerAblationAgentOutcome = {
  readonly agentId: string;
  readonly currencyBalance: number;
  readonly inventoryValue: number;
  readonly netWorth: number;
  readonly educationScore: number;
  readonly satiety: number;
  readonly energy: number;
  readonly health: number;
  readonly highTechItemsProduced: number;
  readonly chipsProduced: number;
  readonly productionEventIds: readonly string[];
};

export type PaperPlannerAblationPlanningTurn = {
  readonly turnId: string;
  readonly agentId: string;
  readonly simulatedAt: number;
  readonly actionSignatures: readonly string[];
  readonly sourceTraceId: string;
};

export type PaperPlannerAblationRun = {
  readonly runId: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly sourceRevision: SourceRevision;
  readonly seed: string;
  readonly taskId: PaperPlannerAblationTaskId;
  readonly variant: PaperPlannerAblationVariant;
  readonly experimentStartedAt: number;
  readonly experimentEndedAt: number;
  readonly completedCycleCount: number;
  readonly generatedAt: number;
};

export type PaperPlannerAblationMetric = {
  readonly metricId: PaperPlannerAblationMetricId;
  readonly value: number;
  readonly unit: string;
  readonly higherIsBetter: true;
  readonly aggregation: string;
};

export type PaperPlannerAblationRunArtifact = {
  readonly schemaVersion: typeof PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION;
  readonly run: PaperPlannerAblationRun;
  readonly task: PaperPlannerAblationTaskDefinition;
  readonly policy: ReturnType<typeof createPaperPlannerAblationExperimentPolicyManifest>;
  readonly cohort: {
    readonly expectedAgentCount: 80;
    readonly observedAgentCount: number;
    readonly agentIds: readonly string[];
  };
  readonly sourceRecordCounts: {
    readonly planningTurnCount: number;
    readonly candidateActionSignatureCount: number;
    readonly productionEventCount: number;
  };
  readonly metrics: readonly PaperPlannerAblationMetric[];
  readonly agentOutcomes: readonly PaperPlannerAblationAgentOutcome[];
  readonly planningTurns: readonly PaperPlannerAblationPlanningTurn[];
  readonly limitations: readonly string[];
};

export type PaperPlannerAblationTableRow = {
  readonly variant: PaperPlannerAblationVariant;
  readonly values: Readonly<Record<PaperPlannerAblationMetricId, number | null>>;
};

export type PaperPlannerAblationComparisonArtifact = {
  readonly schemaVersion: typeof PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION;
  readonly comparisonId: string;
  readonly generatedAt: number;
  readonly policy: ReturnType<typeof createPaperPlannerAblationExperimentPolicyManifest>;
  readonly sourceRunIds: readonly string[];
  readonly sourceRunManifestIds: readonly string[];
  readonly tables: readonly {
    readonly taskId: PaperPlannerAblationTaskId;
    readonly paperTable: PaperPlannerAblationTaskDefinition['paperTable'];
    readonly rows: readonly PaperPlannerAblationTableRow[];
  }[];
  readonly figures: readonly {
    readonly taskId: PaperPlannerAblationTaskId;
    readonly paperFigure: PaperPlannerAblationTaskDefinition['paperFigure'];
    readonly filename: string;
    readonly mimeType: 'image/svg+xml';
    readonly svg: string;
  }[];
  readonly limitations: readonly string[];
};

export function assertPaperPlannerAblationTaskId(
  value: string,
): asserts value is PaperPlannerAblationTaskId {
  if (!(value in TASK_DEFINITIONS)) {
    throw new Error(`unsupported paper planner ablation task ${value}`);
  }
}

export function getPaperPlannerAblationTaskDefinition(
  taskId: PaperPlannerAblationTaskId,
): PaperPlannerAblationTaskDefinition {
  assertPaperPlannerAblationTaskId(taskId);
  return cloneTaskDefinition(TASK_DEFINITIONS[taskId]);
}

export function createPaperPlannerAblationExperimentPolicyManifest() {
  return {
    policyVersion: PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION,
    paperSection: 'Section 5',
    cohort: {
      agentCount: 80,
      mbtiTypes: 16,
      agentsPerMbtiType: 5,
      initialPhysiology: { health: 60, satiety: 60, energy: 60 },
      initialCurrencyBalance: 0,
      initialEducationScore: 0,
      initialInventory: 'empty',
      timeScale: 35,
    },
    requiredVariants: [
      'default',
      'without-branch',
      'without-objective-decomposition',
    ],
    taskIds: ['task-1', 'task-2', 'task-3', 'task-4'],
    topLevelGoalRule: 'same-paper-reported-long-term-goal-for-all-agents-in-a-task-run',
    experimentDurationRule:
      'explicit-runtime-input-required-because-section-5-does-not-report-duration',
    terminalAggregation: 'arithmetic-mean-across-80-agent-end-state',
    netWorthDefinition: 'terminal-currency-balance-plus-terminal-inventory-amm-spot-value',
    task1ItemCountDefinition:
      'cumulative-produced-quantity-of-all-TertiaryHighTech-commodities',
    task3ActionIdentity:
      'normalized-candidate-action-description-with-whitespace-collapsed-and-case-folded',
    task3TurnDefinition: 'one-persisted-agent-cycle-trace',
    task3PerTurnDefinition: 'mean-distinct-action-signatures-per-turn',
    task3PerMinuteDefinition:
      'total-distinct-action-signatures-divided-by-explicit-simulated-window-minutes',
    task4ChipDefinition: 'mean-cumulative-Chip-quantity-produced-per-agent',
    comparisonMatrix: 'four-tasks-times-three-variants-exactly-once',
    outputFormat: 'immutable-json-plus-deterministic-svg',
    paperAmbiguities: [
      'Task 1 table does not explicitly label group aggregation; arithmetic mean is versioned here.',
      'Task 3 does not define action identity or turn boundaries; repository definitions are versioned here.',
      'Section 5 does not report experiment duration, cycle count, model, or seed.',
    ],
  } as const;
}

export function createPaperPlannerAblationRunArtifact(input: {
  readonly run: PaperPlannerAblationRun;
  readonly agentOutcomes: readonly PaperPlannerAblationAgentOutcome[];
  readonly planningTurns: readonly PaperPlannerAblationPlanningTurn[];
}): PaperPlannerAblationRunArtifact {
  validateRun(input.run);
  const task = getPaperPlannerAblationTaskDefinition(input.run.taskId);
  const agentOutcomes = input.agentOutcomes.map(cloneAndValidateAgentOutcome).sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
  if (agentOutcomes.length !== 80) {
    throw new Error('paper planner ablation run requires exactly 80 agent outcomes');
  }
  const agentIds = agentOutcomes.map((outcome) => outcome.agentId);
  if (new Set(agentIds).size !== agentIds.length) {
    throw new Error('paper planner ablation agent outcome IDs must be unique');
  }
  const knownAgentIds = new Set(agentIds);
  const planningTurns = input.planningTurns
    .map((turn) => cloneAndValidatePlanningTurn(turn, input.run, knownAgentIds))
    .sort(comparePlanningTurns);
  if (input.run.taskId === 'task-3' && planningTurns.length === 0) {
    throw new Error('paper planner ablation task-3 requires planning turn observations');
  }

  return {
    schemaVersion: PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION,
    run: cloneRun(input.run),
    task,
    policy: createPaperPlannerAblationExperimentPolicyManifest(),
    cohort: {
      expectedAgentCount: 80,
      observedAgentCount: agentOutcomes.length,
      agentIds,
    },
    sourceRecordCounts: {
      planningTurnCount: planningTurns.length,
      candidateActionSignatureCount: planningTurns.reduce(
        (total, turn) => total + turn.actionSignatures.length,
        0,
      ),
      productionEventCount: new Set(
        agentOutcomes.flatMap((outcome) => outcome.productionEventIds),
      ).size,
    },
    metrics: task.metricIds.map((metricId) =>
      createMetric(metricId, agentOutcomes, planningTurns, input.run),
    ),
    agentOutcomes,
    planningTurns,
    limitations: [
      'This artifact reports repository execution, not the paper values, until an independently configured mature run is supplied.',
      'The paper omits duration, seed, and model; compare runs only when their manifests and explicit windows match.',
      'Task 1 aggregation and Task 3 action identity follow versioned repository decisions disclosed in policy.',
    ],
  };
}

export function createPaperPlannerAblationComparisonArtifact(input: {
  readonly comparisonId: string;
  readonly generatedAt: number;
  readonly runs: readonly PaperPlannerAblationRunArtifact[];
}): PaperPlannerAblationComparisonArtifact {
  assertNonEmpty(input.comparisonId, 'comparisonId');
  assertFinite(input.generatedAt, 'generatedAt');
  const runs = input.runs.map(cloneAndValidateRunArtifact);
  const expectedKeys = new Set<string>();
  for (const taskId of Object.keys(TASK_DEFINITIONS) as PaperPlannerAblationTaskId[]) {
    for (const variant of requiredVariants()) {
      expectedKeys.add(`${taskId}:${variant}`);
    }
  }
  const runsByKey = new Map<string, PaperPlannerAblationRunArtifact>();
  for (const run of runs) {
    const key = `${run.run.taskId}:${run.run.variant}`;
    if (!expectedKeys.has(key)) {
      throw new Error(`unexpected paper planner ablation comparison run ${key}`);
    }
    if (runsByKey.has(key)) {
      throw new Error(`duplicate paper planner ablation comparison run ${key}`);
    }
    runsByKey.set(key, run);
  }
  const missingKeys = [...expectedKeys].filter((key) => !runsByKey.has(key));
  if (missingKeys.length > 0) {
    throw new Error(`paper planner ablation comparison missing runs ${missingKeys.join(',')}`);
  }
  assertControlledRunsMatch(runsByKey);

  const tables = (Object.keys(TASK_DEFINITIONS) as PaperPlannerAblationTaskId[]).map((taskId) => {
    const task = TASK_DEFINITIONS[taskId];
    return {
      taskId,
      paperTable: task.paperTable,
      rows: requiredVariants().map((variant) =>
        createTableRow(requireComparisonRun(runsByKey, taskId, variant)),
      ),
    };
  });
  const figures = tables.map((table) => {
    const task = TASK_DEFINITIONS[table.taskId];
    return {
      taskId: table.taskId,
      paperFigure: task.paperFigure,
      filename: `${task.paperFigure.toLowerCase().replace(' ', '-')}-${table.taskId}.svg`,
      mimeType: 'image/svg+xml' as const,
      svg: renderComparisonFigure(task, table.rows),
    };
  });
  return {
    schemaVersion: PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION,
    comparisonId: input.comparisonId,
    generatedAt: input.generatedAt,
    policy: createPaperPlannerAblationExperimentPolicyManifest(),
    sourceRunIds: runs.map((run) => run.run.runId).sort(),
    sourceRunManifestIds: runs.map((run) => run.run.runManifestId).sort(),
    tables,
    figures,
    limitations: [
      'Generated tables and figures reproduce the paper schema, not the published numeric results.',
      'A comparison is valid only for the exact content-addressed run manifests listed here.',
      'No causal or paper-replication claim is permitted without mature, independently audited runs.',
    ],
  };
}

export class FilePaperPlannerAblationArtifactRepository {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = join(input.rootDir, 'paper-planner-ablation-artifacts');
    mkdirSync(this.rootDir, { recursive: true });
  }

  saveRun(artifact: PaperPlannerAblationRunArtifact): Promise<PaperPlannerAblationRunArtifact> {
    return Promise.resolve().then(() => {
      const validated = cloneAndValidateRunArtifact(artifact);
      writeImmutableJson(
        join(this.rootDir, 'runs', encodeURIComponent(validated.run.runId), 'artifact.json'),
        validated,
        `paper planner ablation run artifact ${validated.run.runId}`,
      );
      return validated;
    });
  }

  getRun(runId: string): Promise<PaperPlannerAblationRunArtifact | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const path = join(this.rootDir, 'runs', encodeURIComponent(runId), 'artifact.json');
      if (!existsSync(path)) {
        return undefined;
      }
      return cloneAndValidateRunArtifact(
        JSON.parse(readFileSync(path, 'utf8')) as PaperPlannerAblationRunArtifact,
      );
    });
  }

  saveComparison(
    artifact: PaperPlannerAblationComparisonArtifact,
  ): Promise<PaperPlannerAblationComparisonArtifact> {
    return Promise.resolve().then(() => {
      validateComparisonArtifact(artifact);
      const artifactDir = join(
        this.rootDir,
        'comparisons',
        encodeURIComponent(artifact.comparisonId),
      );
      for (const figure of artifact.figures) {
        writeImmutableText(
          join(artifactDir, figure.filename),
          figure.svg,
          `paper planner ablation comparison figure ${figure.filename}`,
        );
      }
      writeImmutableJson(
        join(artifactDir, 'artifact.json'),
        artifact,
        `paper planner ablation comparison artifact ${artifact.comparisonId}`,
      );
      return cloneComparisonArtifact(artifact);
    });
  }

  getComparison(comparisonId: string): Promise<PaperPlannerAblationComparisonArtifact | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(comparisonId, 'comparisonId');
      const artifactDir = join(this.rootDir, 'comparisons', encodeURIComponent(comparisonId));
      const path = join(artifactDir, 'artifact.json');
      if (!existsSync(path)) {
        return undefined;
      }
      const artifact = JSON.parse(
        readFileSync(path, 'utf8'),
      ) as PaperPlannerAblationComparisonArtifact;
      validateComparisonArtifact(artifact);
      for (const figure of artifact.figures) {
        if (readFileSync(join(artifactDir, figure.filename), 'utf8') !== figure.svg) {
          throw new Error(`paper planner ablation comparison ${comparisonId} has inconsistent SVG`);
        }
      }
      return cloneComparisonArtifact(artifact);
    });
  }
}

function createMetric(
  metricId: PaperPlannerAblationMetricId,
  outcomes: readonly PaperPlannerAblationAgentOutcome[],
  turns: readonly PaperPlannerAblationPlanningTurn[],
  run: PaperPlannerAblationRun,
): PaperPlannerAblationMetric {
  const terminalMetric = (
    values: readonly number[],
    unit: string,
    aggregation: string = 'arithmetic-mean-across-80-agent-end-state',
  ): PaperPlannerAblationMetric => ({
    metricId,
    value: mean(values),
    unit,
    higherIsBetter: true,
    aggregation,
  });
  switch (metricId) {
    case 'average-currency-balance':
      return terminalMetric(outcomes.map((outcome) => outcome.currencyBalance), 'currency');
    case 'average-inventory-value':
      return terminalMetric(outcomes.map((outcome) => outcome.inventoryValue), 'currency');
    case 'average-net-worth':
      return terminalMetric(outcomes.map((outcome) => outcome.netWorth), 'currency');
    case 'average-education-score':
      return terminalMetric(outcomes.map((outcome) => outcome.educationScore), 'score');
    case 'average-satiety':
      return terminalMetric(outcomes.map((outcome) => outcome.satiety), 'physiology');
    case 'average-energy':
      return terminalMetric(outcomes.map((outcome) => outcome.energy), 'physiology');
    case 'average-health':
      return terminalMetric(outcomes.map((outcome) => outcome.health), 'physiology');
    case 'average-high-tech-items-produced':
      return terminalMetric(
        outcomes.map((outcome) => outcome.highTechItemsProduced),
        'items',
        'mean-cumulative-produced-quantity-per-agent',
      );
    case 'average-chips-produced':
      return terminalMetric(
        outcomes.map((outcome) => outcome.chipsProduced),
        'chips',
        'mean-cumulative-produced-Chip-quantity-per-agent',
      );
    case 'unique-actions-per-turn':
      return {
        metricId,
        value: mean(turns.map((turn) => new Set(turn.actionSignatures).size)),
        unit: 'actions/turn',
        higherIsBetter: true,
        aggregation: 'mean-distinct-normalized-candidate-actions-per-agent-cycle-trace',
      };
    case 'unique-actions-per-simulated-minute': {
      const minutes = (run.experimentEndedAt - run.experimentStartedAt) / 60_000;
      return {
        metricId,
        value: uniqueActionSignatures(turns).length / minutes,
        unit: 'actions/simulated-minute',
        higherIsBetter: true,
        aggregation: 'total-distinct-normalized-candidate-actions-divided-by-window-minutes',
      };
    }
    case 'total-unique-actions':
      return {
        metricId,
        value: uniqueActionSignatures(turns).length,
        unit: 'actions',
        higherIsBetter: true,
        aggregation: 'distinct-normalized-candidate-actions-across-full-window',
      };
  }
}

function cloneAndValidateAgentOutcome(
  outcome: PaperPlannerAblationAgentOutcome,
): PaperPlannerAblationAgentOutcome {
  assertNonEmpty(outcome.agentId, 'agent outcome agentId');
  for (const [name, value] of Object.entries({
    currencyBalance: outcome.currencyBalance,
    inventoryValue: outcome.inventoryValue,
    netWorth: outcome.netWorth,
    educationScore: outcome.educationScore,
    satiety: outcome.satiety,
    energy: outcome.energy,
    health: outcome.health,
    highTechItemsProduced: outcome.highTechItemsProduced,
    chipsProduced: outcome.chipsProduced,
  })) {
    assertNonNegativeFinite(value, `agent outcome ${name}`);
  }
  if (Math.abs(outcome.netWorth - outcome.currencyBalance - outcome.inventoryValue) > 1e-6) {
    throw new Error('agent outcome netWorth must equal currencyBalance plus inventoryValue');
  }
  for (const eventId of outcome.productionEventIds) {
    assertNonEmpty(eventId, 'production event ID');
  }
  return { ...outcome, productionEventIds: [...outcome.productionEventIds] };
}

function cloneAndValidatePlanningTurn(
  turn: PaperPlannerAblationPlanningTurn,
  run: PaperPlannerAblationRun,
  knownAgentIds: ReadonlySet<string>,
): PaperPlannerAblationPlanningTurn {
  assertNonEmpty(turn.turnId, 'planning turn turnId');
  assertNonEmpty(turn.agentId, 'planning turn agentId');
  assertNonEmpty(turn.sourceTraceId, 'planning turn sourceTraceId');
  assertFinite(turn.simulatedAt, 'planning turn simulatedAt');
  if (!knownAgentIds.has(turn.agentId)) {
    throw new Error(`planning turn references unknown agent ${turn.agentId}`);
  }
  if (turn.simulatedAt < run.experimentStartedAt || turn.simulatedAt > run.experimentEndedAt) {
    throw new Error('planning turn simulatedAt must fall within the experiment window');
  }
  const actionSignatures = turn.actionSignatures.map(normalizeActionSignature);
  return { ...turn, actionSignatures };
}

function validateRun(run: PaperPlannerAblationRun): void {
  assertNonEmpty(run.runId, 'runId');
  assertNonEmpty(run.simulationId, 'simulationId');
  assertNonEmpty(run.runManifestId, 'runManifestId');
  assertNonEmpty(run.sourceRevision.commit, 'sourceRevision.commit');
  assertNonEmpty(run.seed, 'seed');
  assertPaperPlannerAblationTaskId(run.taskId);
  if (!requiredVariants().includes(run.variant)) {
    throw new Error(`unsupported paper planner ablation variant ${run.variant}`);
  }
  assertFinite(run.experimentStartedAt, 'experimentStartedAt');
  assertFinite(run.experimentEndedAt, 'experimentEndedAt');
  if (run.experimentEndedAt <= run.experimentStartedAt) {
    throw new Error('experimentEndedAt must be greater than experimentStartedAt');
  }
  if (!Number.isInteger(run.completedCycleCount) || run.completedCycleCount < 1) {
    throw new Error('completedCycleCount must be a positive integer');
  }
  assertFinite(run.generatedAt, 'generatedAt');
}

function cloneRun(run: PaperPlannerAblationRun): PaperPlannerAblationRun {
  return { ...run, sourceRevision: cloneSourceRevision(run.sourceRevision) };
}

function cloneAndValidateRunArtifact(
  artifact: PaperPlannerAblationRunArtifact,
): PaperPlannerAblationRunArtifact {
  if (artifact.schemaVersion !== PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION) {
    throw new Error('invalid paper planner ablation run artifact schemaVersion');
  }
  const recreated = createPaperPlannerAblationRunArtifact({
    run: artifact.run,
    agentOutcomes: artifact.agentOutcomes,
    planningTurns: artifact.planningTurns,
  });
  if (JSON.stringify(recreated.metrics) !== JSON.stringify(artifact.metrics)) {
    throw new Error('paper planner ablation run artifact metrics are inconsistent with sources');
  }
  return recreated;
}

function assertControlledRunsMatch(
  runsByKey: ReadonlyMap<string, PaperPlannerAblationRunArtifact>,
): void {
  for (const taskId of Object.keys(TASK_DEFINITIONS) as PaperPlannerAblationTaskId[]) {
    const taskRuns = requiredVariants().map((variant) =>
      requireComparisonRun(runsByKey, taskId, variant),
    );
    const reference = taskRuns[0]!.run;
    for (const candidate of taskRuns.slice(1)) {
      if (
        candidate.run.seed !== reference.seed ||
        candidate.run.experimentStartedAt !== reference.experimentStartedAt ||
        candidate.run.experimentEndedAt !== reference.experimentEndedAt ||
        candidate.run.completedCycleCount !== reference.completedCycleCount
      ) {
        throw new Error(
          `paper planner ablation ${taskId} variants must share seed, window, and cycle count`,
        );
      }
    }
  }
}

function requireComparisonRun(
  runsByKey: ReadonlyMap<string, PaperPlannerAblationRunArtifact>,
  taskId: PaperPlannerAblationTaskId,
  variant: PaperPlannerAblationVariant,
): PaperPlannerAblationRunArtifact {
  const run = runsByKey.get(`${taskId}:${variant}`);
  if (run === undefined) {
    throw new Error(`missing paper planner ablation comparison run ${taskId}:${variant}`);
  }
  return run;
}

function createTableRow(run: PaperPlannerAblationRunArtifact): PaperPlannerAblationTableRow {
  const values = Object.fromEntries(
    allMetricIds().map((metricId) => [
      metricId,
      run.metrics.find((metric) => metric.metricId === metricId)?.value ?? null,
    ]),
  ) as Record<PaperPlannerAblationMetricId, number | null>;
  return { variant: run.run.variant, values };
}

function renderComparisonFigure(
  task: PaperPlannerAblationTaskDefinition,
  rows: readonly PaperPlannerAblationTableRow[],
): string {
  const width = 1_080;
  const panelWidth = 980 / task.metricIds.length;
  const colors: Readonly<Record<PaperPlannerAblationVariant, string>> = {
    default: '#58a6ff',
    'without-branch': '#f0883e',
    'without-objective-decomposition': '#a371f7',
  };
  const panels = task.metricIds
    .map((metricId, metricIndex) => {
      const values = rows.map((row) => row.values[metricId] ?? 0);
      const maximum = Math.max(1, ...values);
      const x = 60 + metricIndex * panelWidth;
      const bars = rows
        .map((row, rowIndex) => {
          const value = row.values[metricId] ?? 0;
          const barHeight = (value / maximum) * 260;
          const barX = x + 20 + rowIndex * 42;
          return `<rect x="${barX}" y="${360 - barHeight}" width="30" height="${barHeight}" fill="${colors[row.variant]}"><title>${escapeXml(row.variant)}: ${value}</title></rect>`;
        })
        .join('');
      return `${bars}<text x="${x + panelWidth / 2}" y="385" text-anchor="middle" fill="#c9d1d9" font-size="11">${escapeXml(metricId)}</text>`;
    })
    .join('');
  const legend = requiredVariants()
    .map(
      (variant, index) =>
        `<rect x="${60 + index * 260}" y="420" width="14" height="14" fill="${colors[variant]}"/><text x="${80 + index * 260}" y="432" fill="#c9d1d9" font-size="12">${escapeXml(variant)}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="470" viewBox="0 0 ${width} 470" role="img" aria-label="${escapeXml(task.paperFigure)} ${escapeXml(task.name)}"><rect width="${width}" height="470" fill="#0d1117"/><text x="24" y="30" fill="#f0f6fc" font-family="system-ui,sans-serif" font-size="16" font-weight="600">${escapeXml(task.paperFigure)} — ${escapeXml(task.name)}</text><g font-family="system-ui,sans-serif">${panels}${legend}</g></svg>`;
}

function validateComparisonArtifact(artifact: PaperPlannerAblationComparisonArtifact): void {
  if (artifact.schemaVersion !== PAPER_PLANNER_ABLATION_EXPERIMENT_POLICY_VERSION) {
    throw new Error('invalid paper planner ablation comparison schemaVersion');
  }
  assertNonEmpty(artifact.comparisonId, 'comparisonId');
  assertFinite(artifact.generatedAt, 'generatedAt');
  if (artifact.tables.length !== 4 || artifact.figures.length !== 4) {
    throw new Error('paper planner ablation comparison requires four tables and four figures');
  }
  for (const figure of artifact.figures) {
    if (!figure.svg.startsWith('<svg') || !figure.svg.endsWith('</svg>')) {
      throw new Error(`invalid paper planner ablation SVG ${figure.filename}`);
    }
  }
}

function uniqueActionSignatures(turns: readonly PaperPlannerAblationPlanningTurn[]): string[] {
  return [...new Set(turns.flatMap((turn) => turn.actionSignatures))].sort();
}

function normalizeActionSignature(value: string): string {
  assertNonEmpty(value, 'action signature');
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function comparePlanningTurns(
  left: PaperPlannerAblationPlanningTurn,
  right: PaperPlannerAblationPlanningTurn,
): number {
  if (left.simulatedAt !== right.simulatedAt) {
    return left.simulatedAt - right.simulatedAt;
  }
  if (left.agentId !== right.agentId) {
    return left.agentId.localeCompare(right.agentId);
  }
  return left.turnId.localeCompare(right.turnId);
}

function cloneTaskDefinition(
  definition: PaperPlannerAblationTaskDefinition,
): PaperPlannerAblationTaskDefinition {
  return {
    ...definition,
    affinityTags: [...definition.affinityTags],
    metricIds: [...definition.metricIds],
  };
}

function requiredVariants(): readonly PaperPlannerAblationVariant[] {
  return ['default', 'without-branch', 'without-objective-decomposition'];
}

function allMetricIds(): readonly PaperPlannerAblationMetricId[] {
  return [
    'average-currency-balance',
    'average-inventory-value',
    'average-net-worth',
    'average-education-score',
    'average-satiety',
    'average-energy',
    'average-health',
    'average-high-tech-items-produced',
    'unique-actions-per-turn',
    'unique-actions-per-simulated-minute',
    'total-unique-actions',
    'average-chips-produced',
  ];
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('mean requires at least one value');
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function writeImmutableJson(path: string, value: unknown, description: string): void {
  writeImmutableText(path, `${JSON.stringify(value, null, 2)}\n`, description);
}

function writeImmutableText(path: string, content: string, description: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== content) {
      throw new Error(`${description} is immutable`);
    }
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
}

function cloneComparisonArtifact(
  artifact: PaperPlannerAblationComparisonArtifact,
): PaperPlannerAblationComparisonArtifact {
  return JSON.parse(JSON.stringify(artifact)) as PaperPlannerAblationComparisonArtifact;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
