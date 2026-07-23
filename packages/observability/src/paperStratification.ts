import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  assertReproducibleSourceRevision,
  cloneSourceRevision,
  type SourceRevision,
} from '@aivilization/sim-core';
import type { WealthSnapshotObservation } from './experimentValidation';

export const PAPER_STRATIFICATION_POLICY_VERSION = 'paper-stratification-v2';
export const PAPER_EDUCATION_MINIMUM = 0;
export const PAPER_EDUCATION_MAXIMUM = 1_500;
export const PAPER_EDUCATION_BIN_WIDTH = 50;

export type PaperEducationWealthBin = {
  readonly binStart: number;
  readonly binEnd: number;
  readonly binCenter: number;
  readonly agentCount: number;
  readonly medianNetWorth: number;
};

export type PaperOccupationWealthRow = {
  readonly rank: number;
  readonly occupationId: string;
  readonly agentCount: number;
  readonly medianNetWorth: number;
};

export type PaperStratificationRun = {
  readonly runId: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly sourceRevision: SourceRevision;
  readonly seed: string;
  readonly generatedAt: number;
  readonly partitions: readonly {
    readonly partitionKey: string;
    readonly eventCount: number;
    readonly lastEventSequence: number;
    readonly finalSimulatedAt: number;
  }[];
};

export type PaperStratificationArtifact = {
  readonly schemaVersion: typeof PAPER_STRATIFICATION_POLICY_VERSION;
  readonly run: PaperStratificationRun;
  readonly policy: ReturnType<typeof createPaperStratificationPolicyManifest>;
  readonly source: {
    readonly snapshotRule: 'all-agents-from-exact-run-manifest-partition-set';
    readonly snapshotSha256: string;
    readonly agentCount: number;
  };
  readonly sourceAgentIds: readonly string[];
  readonly educationWealth: {
    readonly includedAgentCount: number;
    readonly excludedOutOfRangeAgentCount: number;
    readonly bins: readonly PaperEducationWealthBin[];
    readonly quadraticRegression: {
      readonly quadraticCoefficient: number;
      readonly linearCoefficient: number;
      readonly intercept: number;
      readonly rSquared: number;
      readonly monotonicIncreasingAcrossObservedRange: boolean;
    };
  };
  readonly occupationWealth: {
    readonly employedAgentCount: number;
    readonly excludedUnemployedAgentCount: number;
    readonly rows: readonly PaperOccupationWealthRow[];
  };
  readonly figures: readonly [
    {
      readonly paperFigure: 'Figure 9';
      readonly filename: 'figure-9-education-median-wealth.svg';
      readonly mimeType: 'image/svg+xml';
      readonly svg: string;
    },
    {
      readonly paperFigure: 'Figure 10';
      readonly filename: 'figure-10-occupation-median-wealth.svg';
      readonly mimeType: 'image/svg+xml';
      readonly svg: string;
    },
  ];
};

export function createPaperStratificationPolicyManifest() {
  return {
    policyVersion: PAPER_STRATIFICATION_POLICY_VERSION,
    snapshotRule: 'cross-sectional-end-of-experiment',
    educationRange: [PAPER_EDUCATION_MINIMUM, PAPER_EDUCATION_MAXIMUM],
    educationBinWidth: PAPER_EDUCATION_BIN_WIDTH,
    educationAggregation: 'median-net-worth-per-non-empty-bin',
    trendModel: 'ordinary-least-squares-second-order-polynomial-on-bin-centers',
    occupationFilter: 'exclude-unemployed',
    occupationAggregation: 'median-net-worth',
    occupationOrder: 'median-net-worth-descending-then-occupation-id',
    trendRenderingRange: 'minimum-to-maximum-observed-non-empty-bin-center',
    sourceBinding:
      'resolved-run-manifest-source-revision-seed-partitions-event-boundaries-and-snapshot-sha256',
    outputFormat: 'deterministic-svg-plus-machine-readable-analysis',
  } as const;
}

export function createPaperStratificationArtifact(input: {
  readonly run: PaperStratificationRun;
  readonly snapshot: readonly WealthSnapshotObservation[];
}): PaperStratificationArtifact {
  const run = cloneAndValidateRun(input.run);
  if (input.snapshot.length === 0) {
    throw new Error('paper stratification requires a non-empty wealth snapshot');
  }
  const snapshot = input.snapshot.map(cloneAndValidateObservation);
  const sourceAgentIds = snapshot
    .map((observation) => observation.agentId)
    .sort((left, right) => left.localeCompare(right));
  if (new Set(sourceAgentIds).size !== sourceAgentIds.length) {
    throw new Error('paper stratification snapshot agentId values must be unique');
  }

  const inRange = snapshot.filter(
    (observation) =>
      observation.educationScore >= PAPER_EDUCATION_MINIMUM &&
      observation.educationScore <= PAPER_EDUCATION_MAXIMUM,
  );
  const bins = createEducationWealthBins(inRange);
  if (bins.length < 3) {
    throw new Error('paper stratification requires at least three non-empty education bins');
  }
  const quadraticRegression = fitQuadraticRegression(bins);
  const employed = snapshot.filter((observation) => observation.occupationId !== undefined);
  const occupationRows = createOccupationRows(employed);
  if (occupationRows.length === 0) {
    throw new Error('paper stratification requires at least one employed occupation');
  }

  const educationWealth = {
    includedAgentCount: inRange.length,
    excludedOutOfRangeAgentCount: snapshot.length - inRange.length,
    bins,
    quadraticRegression,
  };
  const occupationWealth = {
    employedAgentCount: employed.length,
    excludedUnemployedAgentCount: snapshot.length - employed.length,
    rows: occupationRows,
  };
  return {
    schemaVersion: PAPER_STRATIFICATION_POLICY_VERSION,
    run,
    policy: createPaperStratificationPolicyManifest(),
    source: {
      snapshotRule: 'all-agents-from-exact-run-manifest-partition-set',
      snapshotSha256: hashSnapshot(snapshot),
      agentCount: sourceAgentIds.length,
    },
    sourceAgentIds,
    educationWealth,
    occupationWealth,
    figures: [
      {
        paperFigure: 'Figure 9',
        filename: 'figure-9-education-median-wealth.svg',
        mimeType: 'image/svg+xml',
        svg: renderEducationWealthFigure(bins, quadraticRegression),
      },
      {
        paperFigure: 'Figure 10',
        filename: 'figure-10-occupation-median-wealth.svg',
        mimeType: 'image/svg+xml',
        svg: renderOccupationWealthFigure(occupationRows),
      },
    ],
  };
}

export class FilePaperStratificationArtifactRepository {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = join(input.rootDir, 'paper-stratification-artifacts');
    mkdirSync(this.rootDir, { recursive: true });
  }

  save(artifact: PaperStratificationArtifact): Promise<PaperStratificationArtifact> {
    return Promise.resolve().then(() => {
      assertValidArtifact(artifact);
      const artifactDir = this.resolveArtifactDir(artifact.run.runId);
      const manifestPath = join(artifactDir, 'artifact.json');
      const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
      if (existsSync(manifestPath)) {
        if (readFileSync(manifestPath, 'utf8') !== serialized) {
          throw new Error(`paper stratification artifact ${artifact.run.runId} is immutable`);
        }
        return cloneArtifact(artifact);
      }
      mkdirSync(artifactDir, { recursive: true });
      for (const figure of artifact.figures) {
        writeAtomically(join(artifactDir, figure.filename), figure.svg);
      }
      writeAtomically(manifestPath, serialized);
      return cloneArtifact(artifact);
    });
  }

  get(runId: string): Promise<PaperStratificationArtifact | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const artifactDir = this.resolveArtifactDir(runId);
      const manifestPath = join(artifactDir, 'artifact.json');
      if (!existsSync(manifestPath)) {
        return undefined;
      }
      const artifact = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as PaperStratificationArtifact;
      assertValidArtifact(artifact);
      for (const figure of artifact.figures) {
        if (readFileSync(join(artifactDir, figure.filename), 'utf8') !== figure.svg) {
          throw new Error(`paper stratification artifact ${runId} has inconsistent SVG`);
        }
      }
      return cloneArtifact(artifact);
    });
  }

  private resolveArtifactDir(runId: string): string {
    return join(this.rootDir, encodeURIComponent(runId));
  }
}

function createEducationWealthBins(
  snapshot: readonly WealthSnapshotObservation[],
): PaperEducationWealthBin[] {
  const wealthByBinStart = new Map<number, number[]>();
  for (const observation of snapshot) {
    const binStart = Math.min(
      PAPER_EDUCATION_MAXIMUM - PAPER_EDUCATION_BIN_WIDTH,
      Math.floor(observation.educationScore / PAPER_EDUCATION_BIN_WIDTH) *
        PAPER_EDUCATION_BIN_WIDTH,
    );
    const wealth = wealthByBinStart.get(binStart) ?? [];
    wealth.push(observation.netWorth);
    wealthByBinStart.set(binStart, wealth);
  }
  return [...wealthByBinStart.entries()]
    .sort(([left], [right]) => left - right)
    .map(([binStart, wealth]) => ({
      binStart,
      binEnd: binStart + PAPER_EDUCATION_BIN_WIDTH,
      binCenter: binStart + PAPER_EDUCATION_BIN_WIDTH / 2,
      agentCount: wealth.length,
      medianNetWorth: calculateMedian(wealth),
    }));
}

function fitQuadraticRegression(
  bins: readonly PaperEducationWealthBin[],
): PaperStratificationArtifact['educationWealth']['quadraticRegression'] {
  const sums = bins.reduce(
    (result, bin) => {
      const x = bin.binCenter;
      const y = bin.medianNetWorth;
      return {
        x: result.x + x,
        x2: result.x2 + x ** 2,
        x3: result.x3 + x ** 3,
        x4: result.x4 + x ** 4,
        y: result.y + y,
        xy: result.xy + x * y,
        x2y: result.x2y + x ** 2 * y,
      };
    },
    { x: 0, x2: 0, x3: 0, x4: 0, y: 0, xy: 0, x2y: 0 },
  );
  const [quadraticCoefficient, linearCoefficient, intercept] = solveThreeByThree(
    [
      [sums.x4, sums.x3, sums.x2],
      [sums.x3, sums.x2, sums.x],
      [sums.x2, sums.x, bins.length],
    ],
    [sums.x2y, sums.xy, sums.y],
  );
  const values = bins.map((bin) => bin.medianNetWorth);
  const mean = calculateMean(values);
  const residual = bins.reduce(
    (sum, bin) =>
      sum +
      (bin.medianNetWorth -
        evaluateQuadratic(quadraticCoefficient, linearCoefficient, intercept, bin.binCenter)) **
        2,
    0,
  );
  const total = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const minimumCenter = bins[0]!.binCenter;
  const maximumCenter = bins.at(-1)!.binCenter;
  return {
    quadraticCoefficient,
    linearCoefficient,
    intercept,
    rSquared: total === 0 ? (residual === 0 ? 1 : 0) : 1 - residual / total,
    monotonicIncreasingAcrossObservedRange:
      2 * quadraticCoefficient * minimumCenter + linearCoefficient >= 0 &&
      2 * quadraticCoefficient * maximumCenter + linearCoefficient >= 0,
  };
}

function createOccupationRows(
  snapshot: readonly WealthSnapshotObservation[],
): PaperOccupationWealthRow[] {
  const wealthByOccupation = new Map<string, number[]>();
  for (const observation of snapshot) {
    const occupationId = observation.occupationId;
    if (occupationId === undefined) {
      continue;
    }
    const wealth = wealthByOccupation.get(occupationId) ?? [];
    wealth.push(observation.netWorth);
    wealthByOccupation.set(occupationId, wealth);
  }
  return [...wealthByOccupation.entries()]
    .map(([occupationId, wealth]) => ({
      occupationId,
      agentCount: wealth.length,
      medianNetWorth: calculateMedian(wealth),
    }))
    .sort((left, right) => {
      if (left.medianNetWorth !== right.medianNetWorth) {
        return right.medianNetWorth - left.medianNetWorth;
      }
      return left.occupationId.localeCompare(right.occupationId);
    })
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function renderEducationWealthFigure(
  bins: readonly PaperEducationWealthBin[],
  regression: PaperStratificationArtifact['educationWealth']['quadraticRegression'],
): string {
  const maximumWealth = Math.max(...bins.map((bin) => bin.medianNetWorth));
  const x = createScale(0, PAPER_EDUCATION_MAXIMUM, 80, 930);
  const y = createScale(0, Math.max(1, maximumWealth), 430, 50);
  const dots = bins
    .map(
      (bin) =>
        `<circle cx="${x(bin.binCenter)}" cy="${y(bin.medianNetWorth)}" r="4" fill="#58a6ff"><title>${bin.agentCount} agents</title></circle>`,
    )
    .join('');
  const minimumObservedEducation = bins[0]!.binCenter;
  const maximumObservedEducation = bins.at(-1)!.binCenter;
  const trend = Array.from({ length: 101 }, (_, index) => {
    const education =
      minimumObservedEducation +
      ((maximumObservedEducation - minimumObservedEducation) * index) / 100;
    const wealth = evaluateQuadratic(
      regression.quadraticCoefficient,
      regression.linearCoefficient,
      regression.intercept,
      education,
    );
    return `${index === 0 ? 'M' : 'L'} ${x(education)} ${y(Math.max(0, wealth))}`;
  }).join(' ');
  return wrapSvg(
    'Median wealth by education score with quadratic trend',
    `${frame('Education score', 'Median net worth')}${dots}<path d="${trend}" fill="none" stroke="#f0883e" stroke-width="2"/>`,
  );
}

function renderOccupationWealthFigure(rows: readonly PaperOccupationWealthRow[]): string {
  const height = Math.max(480, 90 + rows.length * 28);
  const maximumWealth = Math.max(...rows.map((row) => row.medianNetWorth));
  const x = createScale(0, Math.max(1, maximumWealth), 220, 930);
  const bars = rows
    .map((row, index) => {
      const y = 55 + index * 28;
      return `<text x="210" y="${y + 14}" text-anchor="end" fill="#c9d1d9" font-size="12">${escapeXml(row.occupationId)}</text><rect x="220" y="${y}" width="${x(row.medianNetWorth) - 220}" height="18" fill="#a371f7"><title>rank ${row.rank}; ${row.agentCount} agents; median ${row.medianNetWorth}</title></rect>`;
    })
    .join('');
  return wrapSvg('Median net worth by occupation (excluding unemployed)', bars, height);
}

function solveThreeByThree(
  matrix: readonly (readonly number[])[],
  vector: readonly number[],
): [number, number, number] {
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let pivotRow = pivot;
    for (let row = pivot + 1; row < 3; row += 1) {
      if (Math.abs(augmented[row]![pivot]!) > Math.abs(augmented[pivotRow]![pivot]!)) {
        pivotRow = row;
      }
    }
    [augmented[pivot], augmented[pivotRow]] = [augmented[pivotRow]!, augmented[pivot]!];
    const divisor = augmented[pivot]![pivot]!;
    if (Math.abs(divisor) < 1e-12) {
      throw new Error('education wealth quadratic regression is singular');
    }
    for (let column = pivot; column < 4; column += 1) {
      augmented[pivot]![column] = augmented[pivot]![column]! / divisor;
    }
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) {
        continue;
      }
      const factor = augmented[row]![pivot]!;
      for (let column = pivot; column < 4; column += 1) {
        augmented[row]![column] = augmented[row]![column]! - factor * augmented[pivot]![column]!;
      }
    }
  }
  return [augmented[0]![3]!, augmented[1]![3]!, augmented[2]![3]!];
}

function evaluateQuadratic(a: number, b: number, c: number, x: number): number {
  return a * x ** 2 + b * x + c;
}

function calculateMedian(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function calculateMean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createScale(
  minimum: number,
  maximum: number,
  outputMinimum: number,
  outputMaximum: number,
): (value: number) => number {
  return (value) =>
    outputMinimum + ((value - minimum) / (maximum - minimum)) * (outputMaximum - outputMinimum);
}

function frame(xLabel: string, yLabel: string): string {
  return `<line x1="80" y1="50" x2="80" y2="430" stroke="#8b949e"/><line x1="80" y1="430" x2="930" y2="430" stroke="#8b949e"/><text x="500" y="468" text-anchor="middle" fill="#8b949e" font-size="12">${escapeXml(xLabel)}</text><text x="12" y="60" fill="#8b949e" font-size="12">${escapeXml(yLabel)}</text>`;
}

function wrapSvg(title: string, body: string, height: number = 480): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}" role="img" aria-label="${escapeXml(title)}"><rect width="960" height="${height}" fill="#0d1117"/><text x="24" y="28" fill="#f0f6fc" font-family="system-ui,sans-serif" font-size="16" font-weight="600">${escapeXml(title)}</text><g font-family="system-ui,sans-serif">${body}</g></svg>`;
}

function cloneAndValidateObservation(
  observation: WealthSnapshotObservation,
): WealthSnapshotObservation {
  assertNonEmpty(observation.agentId, 'agentId');
  assertFinite(observation.educationScore, 'educationScore');
  assertFinite(observation.netWorth, 'netWorth');
  if (observation.netWorth < 0) {
    throw new Error('netWorth must be non-negative');
  }
  if (observation.occupationId !== undefined) {
    assertNonEmpty(observation.occupationId, 'occupationId');
  }
  return { ...observation };
}

function assertValidArtifact(artifact: PaperStratificationArtifact): void {
  if (artifact.schemaVersion !== PAPER_STRATIFICATION_POLICY_VERSION) {
    throw new Error('paper stratification schemaVersion must be paper-stratification-v2');
  }
  cloneAndValidateRun(artifact.run);
  if (
    artifact.source.snapshotRule !== 'all-agents-from-exact-run-manifest-partition-set' ||
    artifact.source.agentCount !== artifact.sourceAgentIds.length ||
    !/^sha256:[a-f0-9]{64}$/u.test(artifact.source.snapshotSha256)
  ) {
    throw new Error('paper stratification artifact has invalid source binding');
  }
  if (artifact.policy.policyVersion !== PAPER_STRATIFICATION_POLICY_VERSION) {
    throw new Error('paper stratification artifact policy does not match its schema');
  }
  if (artifact.figures.length !== 2) {
    throw new Error('paper stratification artifact must contain Figures 9 and 10');
  }
}

function cloneArtifact(artifact: PaperStratificationArtifact): PaperStratificationArtifact {
  return JSON.parse(JSON.stringify(artifact)) as PaperStratificationArtifact;
}

function cloneAndValidateRun(run: PaperStratificationRun): PaperStratificationRun {
  assertNonEmpty(run.runId, 'run.runId');
  assertNonEmpty(run.simulationId, 'run.simulationId');
  assertNonEmpty(run.runManifestId, 'run.runManifestId');
  assertNonEmpty(run.seed, 'run.seed');
  assertFinite(run.generatedAt, 'run.generatedAt');
  assertReproducibleSourceRevision(run.sourceRevision, 'run.sourceRevision');
  if (run.partitions.length === 0) {
    throw new Error('paper stratification run must contain at least one source partition');
  }
  const partitions = run.partitions.map((partition) => {
    assertNonEmpty(partition.partitionKey, 'run partitionKey');
    assertNonNegativeInteger(partition.eventCount, 'run partition eventCount');
    assertNonNegativeInteger(partition.lastEventSequence, 'run partition lastEventSequence');
    assertFinite(partition.finalSimulatedAt, 'run partition finalSimulatedAt');
    if (partition.finalSimulatedAt < 0) {
      throw new Error('run partition finalSimulatedAt must be non-negative');
    }
    if (
      (partition.eventCount === 0 && partition.lastEventSequence !== 0) ||
      (partition.eventCount > 0 && partition.lastEventSequence < 1)
    ) {
      throw new Error('run partition event boundary is inconsistent');
    }
    return { ...partition };
  });
  const keys = partitions.map((partition) => partition.partitionKey);
  if (new Set(keys).size !== keys.length || !sameStrings(keys, [...keys].sort())) {
    throw new Error('paper stratification run partitions must be unique and sorted');
  }
  return {
    runId: run.runId,
    simulationId: run.simulationId,
    runManifestId: run.runManifestId,
    sourceRevision: cloneSourceRevision(run.sourceRevision),
    seed: run.seed,
    generatedAt: run.generatedAt,
    partitions,
  };
}

function hashSnapshot(snapshot: readonly WealthSnapshotObservation[]): string {
  const canonical = [...snapshot]
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
    .map((observation) => ({
      agentId: observation.agentId,
      educationScore: observation.educationScore,
      netWorth: observation.netWorth,
      occupationId: observation.occupationId ?? null,
    }));
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
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
