import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileExperimentValidationReportRepository,
  InMemoryExperimentValidationReportRepository,
  createExperimentValidationReport,
  type ExperimentValidationReport,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-validation-reports-'));
  tmpRoots.push(root);
  return root;
}

function createReport(input: {
  readonly runId: string;
  readonly simulationId?: string;
  readonly generatedAt?: number;
}): ExperimentValidationReport {
  return createExperimentValidationReport({
    run: {
      runId: input.runId,
      simulationId: input.simulationId ?? 'sim-1',
      generatedAt: input.generatedAt ?? 100,
    },
    priceSeries: [
      { commodityId: 'Fish', observedAt: 0, closePrice: 100 },
      { commodityId: 'Fish', observedAt: 1, closePrice: 101 },
    ],
    wealthSnapshot: [
      { agentId: 'agent-a', educationScore: 10, netWorth: 100, occupationId: 'Teacher' },
      { agentId: 'agent-b', educationScore: 0, netWorth: 25, occupationId: 'Worker' },
    ],
    plannerRuns: [
      {
        taskId: 'task-1',
        variant: 'default',
        metrics: [{ metricId: 'net-worth', value: 100, higherIsBetter: true }],
      },
      {
        taskId: 'task-1',
        variant: 'without-branch',
        metrics: [{ metricId: 'net-worth', value: 80, higherIsBetter: true }],
      },
    ],
    expectedTrajectoryAgentIds: ['agent-a'],
    trajectories: [{ agentId: 'agent-a', stepCount: 1 }],
    thresholds: {
      heavyTailReturns: { minimumExcessKurtosis: -2 },
    },
  });
}

describe('experiment validation report repositories', () => {
  test('records and queries in-memory reports idempotently', async () => {
    const repository = new InMemoryExperimentValidationReportRepository();
    const older = createReport({ runId: 'run-100', generatedAt: 100 });
    const newer = createReport({ runId: 'run-200', generatedAt: 200 });
    const middle = createReport({ runId: 'run-150', generatedAt: 150 });
    const otherSimulation = createReport({
      runId: 'run-other-simulation',
      simulationId: 'sim-2',
      generatedAt: 300,
    });

    await repository.record(older);
    await repository.record(newer);
    await repository.record(middle);
    await repository.record(otherSimulation);
    await repository.record({
      ...newer,
      findings: [{ ...newer.findings[0]!, message: 'duplicate ignored' }],
    });

    await expect(repository.query({ simulationId: 'sim-1' })).resolves.toEqual([
      newer,
      middle,
      older,
    ]);
    await expect(repository.query({ simulationId: 'sim-1', limit: 2 })).resolves.toEqual([
      newer,
      middle,
    ]);
    await expect(
      repository.query({ simulationId: 'sim-1', fromGeneratedAt: 120, toGeneratedAt: 180 }),
    ).resolves.toEqual([middle]);
    await expect(repository.get('missing')).resolves.toBeUndefined();

    const read = await repository.get('run-200');
    if (read === undefined) {
      throw new Error('expected report to be readable');
    }
    Reflect.set(read, 'metrics', []);
    Reflect.set(read.findings[0]!.evidence, 'mutated', 1);

    await expect(repository.get('run-200')).resolves.toEqual(newer);
  });

  test('persists file-backed reports across repository instances', async () => {
    const rootDir = createRootDir();
    const first = new FileExperimentValidationReportRepository({ rootDir });
    const report = createReport({ runId: 'run-1', generatedAt: 100 });

    await first.record(report);
    await first.record({ ...report, findings: [] });

    const restarted = new FileExperimentValidationReportRepository({ rootDir });

    await expect(restarted.get('run-1')).resolves.toEqual(report);
    await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual([report]);
    await expect(restarted.query({ simulationId: 'sim-1', limit: 0 })).rejects.toThrow(
      'limit must be positive',
    );
  });
});
