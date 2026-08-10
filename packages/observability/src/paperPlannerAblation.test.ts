import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperPlannerAblationArtifactRepository,
  createPaperPlannerAblationComparisonArtifact,
  createPaperPlannerAblationExperimentPolicyManifest,
  createPaperPlannerAblationRunArtifact,
  getPaperPlannerAblationTaskDefinition,
  type PaperPlannerAblationAgentOutcome,
  type PaperPlannerAblationRunArtifact,
  type PaperPlannerAblationTaskId,
  type PaperPlannerAblationVariant,
} from './index';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('paper planner ablation artifacts', () => {
  test('versions the exact Section 5 tasks and discloses paper ambiguities', () => {
    expect(getPaperPlannerAblationTaskDefinition('task-1')).toMatchObject({
      taskClass: 'complex-multi-objective',
      paperTable: 'Table 2',
      paperFigure: 'Figure 11',
      topLevelLongTermGoal:
        'Craft as much high value objectives as possible, earn as much money as possible, while maintaining an higher satiety/energy/health value',
    });
    expect(getPaperPlannerAblationTaskDefinition('task-4')).toMatchObject({
      taskClass: 'simple-single-objective',
      topLevelLongTermGoal: 'craft chips as efficiently as possible',
      metricIds: ['average-chips-produced'],
    });
    expect(createPaperPlannerAblationExperimentPolicyManifest()).toMatchObject({
      policyVersion: 'paper-planner-ablation-experiment-v1',
      experimentDurationRule:
        'explicit-runtime-input-required-because-section-5-does-not-report-duration',
      task3ActionIdentity:
        'normalized-candidate-action-description-with-whitespace-collapsed-and-case-folded',
      comparisonMatrix: 'four-tasks-times-three-variants-exactly-once',
    });
  });

  test('derives task metrics from 80 agent outcomes and explicit simulated time', () => {
    const artifact = createRunArtifact('task-3', 'default');

    expect(artifact.cohort).toMatchObject({ expectedAgentCount: 80, observedAgentCount: 80 });
    expect(artifact.metrics).toEqual([
      {
        metricId: 'unique-actions-per-turn',
        value: 1.5,
        unit: 'actions/turn',
        higherIsBetter: true,
        aggregation: 'mean-distinct-normalized-candidate-actions-per-agent-cycle-trace',
      },
      {
        metricId: 'unique-actions-per-simulated-minute',
        value: 1.5,
        unit: 'actions/simulated-minute',
        higherIsBetter: true,
        aggregation: 'total-distinct-normalized-candidate-actions-divided-by-window-minutes',
      },
      {
        metricId: 'total-unique-actions',
        value: 3,
        unit: 'actions',
        higherIsBetter: true,
        aggregation: 'distinct-normalized-candidate-actions-across-full-window',
      },
    ]);
  });

  test('requires a controlled 4x3 matrix and persists immutable Tables 2-5 and Figures 11-14', async () => {
    const runs = (['task-1', 'task-2', 'task-3', 'task-4'] as const).flatMap((taskId) =>
      variants.map((variant) => createRunArtifact(taskId, variant)),
    );
    const comparison = createPaperPlannerAblationComparisonArtifact({
      comparisonId: 'comparison-1',
      generatedAt: 130_000,
      runs,
    });

    expect(comparison.tables.map((table) => table.paperTable)).toEqual([
      'Table 2',
      'Table 3',
      'Table 4',
      'Table 5',
    ]);
    expect(comparison.figures.map((figure) => figure.paperFigure)).toEqual([
      'Figure 11',
      'Figure 12',
      'Figure 13',
      'Figure 14',
    ]);
    expect(comparison.figures.every((figure) => figure.svg.startsWith('<svg'))).toBe(true);

    const rootDir = mkdtempSync(join(tmpdir(), 'paper-planner-ablation-'));
    roots.push(rootDir);
    const repository = new FilePaperPlannerAblationArtifactRepository({ rootDir });
    await repository.saveRun(runs[0]!);
    await repository.saveComparison(comparison);
    const restarted = new FilePaperPlannerAblationArtifactRepository({ rootDir });
    await expect(restarted.getRun(runs[0]!.run.runId)).resolves.toEqual(runs[0]);
    await expect(restarted.getComparison('comparison-1')).resolves.toEqual(comparison);
    await expect(
      repository.saveComparison({ ...comparison, generatedAt: comparison.generatedAt + 1 }),
    ).rejects.toThrow('immutable');
  });

  test('rejects comparisons that change a controlled variant window', () => {
    const runs = (['task-1', 'task-2', 'task-3', 'task-4'] as const).flatMap((taskId) =>
      variants.map((variant) => createRunArtifact(taskId, variant)),
    );
    const changed = runs.map((run) =>
      run.run.taskId === 'task-2' && run.run.variant === 'without-branch'
        ? createPaperPlannerAblationRunArtifact({
            run: { ...run.run, seed: 'confounded-seed' },
            agentOutcomes: run.agentOutcomes,
            planningTurns: run.planningTurns,
          })
        : run,
    );

    expect(() =>
      createPaperPlannerAblationComparisonArtifact({
        comparisonId: 'confounded',
        generatedAt: 130_000,
        runs: changed,
      }),
    ).toThrow('must share seed, window, and cycle count');
  });
});

const variants: readonly PaperPlannerAblationVariant[] = [
  'default',
  'without-branch',
  'without-objective-decomposition',
];

function createRunArtifact(
  taskId: PaperPlannerAblationTaskId,
  variant: PaperPlannerAblationVariant,
): PaperPlannerAblationRunArtifact {
  return createPaperPlannerAblationRunArtifact({
    run: {
      runId: `${taskId}-${variant}`,
      simulationId: 'ablation-simulation',
      runManifestId: `manifest-${taskId}-${variant}`,
      sourceRevision: { commit: '0123456789abcdef0123456789abcdef01234567', dirty: false },
      seed: `controlled-${taskId}`,
      taskId,
      variant,
      experimentStartedAt: 0,
      experimentEndedAt: 120_000,
      completedCycleCount: 20,
      generatedAt: 125_000,
    },
    agentOutcomes: createAgentOutcomes(variant),
    planningTurns:
      taskId === 'task-3'
        ? [
            {
              turnId: `${variant}-turn-1`,
              agentId: 'agent-001',
              simulatedAt: 30_000,
              actionSignatures: ['Craft Chip', 'Buy Fish', ' craft   chip '],
              sourceTraceId: `${variant}-trace-1`,
            },
            {
              turnId: `${variant}-turn-2`,
              agentId: 'agent-002',
              simulatedAt: 60_000,
              actionSignatures: ['Self Study'],
              sourceTraceId: `${variant}-trace-2`,
            },
          ]
        : [],
  });
}

function createAgentOutcomes(
  variant: PaperPlannerAblationVariant,
): PaperPlannerAblationAgentOutcome[] {
  const offset = variants.indexOf(variant) * 10;
  return Array.from({ length: 80 }, (_, index) => ({
    agentId: `agent-${String(index + 1).padStart(3, '0')}`,
    currencyBalance: 100 + offset,
    inventoryValue: 50,
    netWorth: 150 + offset,
    educationScore: 20,
    satiety: 60,
    energy: 55,
    health: 70,
    highTechItemsProduced: index % 2,
    chipsProduced: index % 4,
    productionEventIds: [`production-${variant}-${index + 1}`],
  }));
}
