import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperStratificationArtifactRepository,
  createPaperStratificationArtifact,
  createPaperStratificationPolicyManifest,
  type WealthSnapshotObservation,
} from './index';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('paper stratification artifacts', () => {
  test('applies paper education bins, quadratic regression, and employed occupation ranking', () => {
    const snapshot: WealthSnapshotObservation[] = [
      createObservation('agent-25', 25, quadraticWealth(25), 'Teacher'),
      createObservation('agent-75', 75, quadraticWealth(75), 'Doctor'),
      createObservation('agent-125', 125, quadraticWealth(125), 'Doctor'),
      createObservation('agent-175', 175, quadraticWealth(175), 'CEO'),
      createObservation('agent-unemployed', 125, quadraticWealth(125)),
      createObservation('agent-out-of-range', 1_600, 20_000, 'CEO'),
    ];

    const artifact = createPaperStratificationArtifact({
      run: createRun('stratification-run-1', 1_700_000_000),
      snapshot,
    });

    expect(artifact).toMatchObject({
      schemaVersion: 'paper-stratification-v2',
      run: {
        runId: 'stratification-run-1',
        runManifestId: `resolved-run-manifest:sha256:${'1'.repeat(64)}`,
      },
      source: {
        snapshotRule: 'all-agents-from-exact-run-manifest-partition-set',
        agentCount: 6,
      },
      educationWealth: {
        includedAgentCount: 5,
        excludedOutOfRangeAgentCount: 1,
        bins: [
          { binStart: 0, binEnd: 50, binCenter: 25, agentCount: 1 },
          { binStart: 50, binEnd: 100, binCenter: 75, agentCount: 1 },
          { binStart: 100, binEnd: 150, binCenter: 125, agentCount: 2 },
          { binStart: 150, binEnd: 200, binCenter: 175, agentCount: 1 },
        ],
      },
      occupationWealth: {
        employedAgentCount: 5,
        excludedUnemployedAgentCount: 1,
        rows: [
          { rank: 1, occupationId: 'CEO', agentCount: 2 },
          { rank: 2, occupationId: 'Doctor', agentCount: 2 },
          { rank: 3, occupationId: 'Teacher', agentCount: 1 },
        ],
      },
      figures: [
        {
          paperFigure: 'Figure 9',
          filename: 'figure-9-education-median-wealth.svg',
        },
        {
          paperFigure: 'Figure 10',
          filename: 'figure-10-occupation-median-wealth.svg',
        },
      ],
    });
    expect(artifact.educationWealth.quadraticRegression.quadraticCoefficient).toBeCloseTo(0.002, 6);
    expect(artifact.educationWealth.quadraticRegression.linearCoefficient).toBeCloseTo(3, 6);
    expect(artifact.educationWealth.quadraticRegression.rSquared).toBeGreaterThan(0.99);
    expect(
      artifact.educationWealth.quadraticRegression.monotonicIncreasingAcrossObservedRange,
    ).toBe(true);
    expect(artifact.figures[0].svg).toContain('quadratic trend');
    expect(artifact.figures[1].svg).toContain('excluding unemployed');
    expect(artifact.source.snapshotSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(artifact.figures[0].svg).not.toContain('M 80 430');
  });

  test('includes education score 1500 in the terminal bin and publishes exact paper semantics', () => {
    const artifact = createPaperStratificationArtifact({
      run: createRun('stratification-boundary', 1),
      snapshot: [
        createObservation('agent-0', 0, 10, 'Worker'),
        createObservation('agent-50', 50, 20, 'Worker'),
        createObservation('agent-100', 100, 30, 'Teacher'),
        createObservation('agent-1500', 1_500, 100, 'CEO'),
      ],
    });

    expect(artifact.educationWealth.bins.at(-1)).toMatchObject({
      binStart: 1_450,
      binEnd: 1_500,
      agentCount: 1,
      medianNetWorth: 100,
    });
    expect(createPaperStratificationPolicyManifest()).toEqual({
      policyVersion: 'paper-stratification-v2',
      snapshotRule: 'cross-sectional-end-of-experiment',
      educationRange: [0, 1_500],
      educationBinWidth: 50,
      educationAggregation: 'median-net-worth-per-non-empty-bin',
      trendModel: 'ordinary-least-squares-second-order-polynomial-on-bin-centers',
      occupationFilter: 'exclude-unemployed',
      occupationAggregation: 'median-net-worth',
      occupationOrder: 'median-net-worth-descending-then-occupation-id',
      trendRenderingRange: 'minimum-to-maximum-observed-non-empty-bin-center',
      sourceBinding:
        'resolved-run-manifest-source-revision-seed-partitions-event-boundaries-and-snapshot-sha256',
      outputFormat: 'deterministic-svg-plus-machine-readable-analysis',
    });
  });

  test('persists immutable analysis and Figure 9-10 SVGs across repository restart', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-paper-stratification-'));
    roots.push(rootDir);
    const artifact = createPaperStratificationArtifact({
      run: createRun('stratification/run:2', 2),
      snapshot: [
        createObservation('agent-a', 25, 100, 'Worker'),
        createObservation('agent-b', 75, 200, 'Teacher'),
        createObservation('agent-c', 125, 400, 'CEO'),
      ],
    });
    const repository = new FilePaperStratificationArtifactRepository({ rootDir });

    await expect(repository.save(artifact)).resolves.toEqual(artifact);
    const restarted = new FilePaperStratificationArtifactRepository({ rootDir });
    await expect(restarted.get(artifact.run.runId)).resolves.toEqual(artifact);

    const artifactDir = join(
      rootDir,
      'paper-stratification-artifacts',
      encodeURIComponent(artifact.run.runId),
    );
    expect(JSON.parse(readFileSync(join(artifactDir, 'artifact.json'), 'utf8'))).toMatchObject({
      run: { runId: artifact.run.runId },
    });
    for (const figure of artifact.figures) {
      expect(readFileSync(join(artifactDir, figure.filename), 'utf8')).toBe(figure.svg);
    }
    await expect(
      repository.save({ ...artifact, run: { ...artifact.run, generatedAt: 3 } }),
    ).rejects.toThrow(`paper stratification artifact ${artifact.run.runId} is immutable`);
  });
});

function createObservation(
  agentId: string,
  educationScore: number,
  netWorth: number,
  occupationId?: string,
): WealthSnapshotObservation {
  return {
    agentId,
    educationScore,
    netWorth,
    ...(occupationId === undefined ? {} : { occupationId }),
  };
}

function quadraticWealth(educationScore: number): number {
  return 0.002 * educationScore ** 2 + 3 * educationScore + 5;
}

function createRun(runId: string, generatedAt: number) {
  return {
    runId,
    simulationId: 'sim-stratification',
    runManifestId: `resolved-run-manifest:sha256:${'1'.repeat(64)}`,
    sourceRevision: { commit: '0'.repeat(40), dirty: false },
    seed: 'stratification-seed',
    generatedAt,
    partitions: [
      {
        partitionKey: 'world-main',
        eventCount: 10,
        lastEventSequence: 10,
        finalSimulatedAt: 1_000,
      },
    ],
  } as const;
}
