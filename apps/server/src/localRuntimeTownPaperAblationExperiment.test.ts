import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  resolveLocalRuntimeTownCliConfig,
  runLocalRuntimeTownPaperAblationExperiment,
} from './index';

const roots: string[] = [];
const sourceRevision = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
} as const;

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town paper ablation experiment runner', () => {
  test('executes a bounded 80-agent task and persists a manifest-bound run artifact', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-ablation-runner-'));
    roots.push(rootDir);
    const config = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--llm-mode',
        'deterministic',
        '--profile',
        'ablation-80',
        '--paper-ablation-task',
        'task-3',
        '--planner-variant',
        'without-objective-decomposition',
        '--root-dir',
        rootDir,
      ],
      env: {},
      cwd: '/workspace',
      sourceRevision,
    });

    const result = await runLocalRuntimeTownPaperAblationExperiment({
      config,
      cycleCount: 1,
      operationId: 'bounded-task-3-without-od',
      requestedAt: 0,
      generatedAt: 40_000,
    });

    expect(result.run).toMatchObject({
      outcome: 'succeeded',
      requestedCycleCount: 1,
      completedCycleCount: 1,
      stopReason: 'cycle-count-completed',
    });
    expect(result.artifact).toMatchObject({
      schemaVersion: 'paper-planner-ablation-experiment-v1',
      run: {
        runId: 'bounded-task-3-without-od',
        runManifestId: result.run.runManifestId,
        seed: 'canonical-runtime-composition-v1:ablation-80:task-3',
        taskId: 'task-3',
        variant: 'without-objective-decomposition',
        experimentStartedAt: 0,
        experimentEndedAt: 35_000,
        completedCycleCount: 1,
      },
      cohort: { expectedAgentCount: 80, observedAgentCount: 80 },
      sourceRecordCounts: { planningTurnCount: 80 },
    });
    expect(result.artifact.metrics.map((metric) => metric.metricId)).toEqual([
      'unique-actions-per-turn',
      'unique-actions-per-simulated-minute',
      'total-unique-actions',
    ]);
    expect(result.artifact.planningTurns).toHaveLength(80);

    await expect(
      runLocalRuntimeTownPaperAblationExperiment({
        config,
        cycleCount: 1,
        operationId: 'must-not-reuse-durable-root',
        requestedAt: 0,
        generatedAt: 40_001,
      }),
    ).rejects.toThrow('requires a fresh durable root');
  });

  test('requires an explicit paper task and positive cycle count', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'paper-ablation-runner-invalid-'));
    roots.push(rootDir);
    const config = resolveLocalRuntimeTownCliConfig({
      argv: ['--llm-mode', 'deterministic', '--root-dir', rootDir],
      env: {},
      cwd: '/workspace',
      sourceRevision,
    });

    await expect(
      runLocalRuntimeTownPaperAblationExperiment({ config, cycleCount: 0 }),
    ).rejects.toThrow('requires --paper-ablation-task');
  });
});
