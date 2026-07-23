import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloneSourceRevision, type SourceRevision } from '@aivilization/sim-core';
import {
  createCommodityPriceSeriesDiagnostics,
  type CommodityPriceSeriesDiagnostics,
  type PriceCloseObservation,
} from './experimentValidation';
import type { MarketOhlcBar } from './marketObservationRepository';
import {
  PAPER_MARKET_FIGURE_INTERVAL_MS,
  createPaperMarketFigureBundle,
  createPaperMarketFigurePolicyManifest,
  type PaperMarketFigureBundle,
} from './paperMarketFigures';
import type { PaperMatureMarketDatasetArtifact } from './paperMatureMarketDataset';

export const PAPER_MARKET_ANALYSIS_SCHEMA_VERSION = 'paper-market-analysis-v2';
export const PAPER_MARKET_ANALYSIS_MINIMUM_RETURN_COUNT = 100;
export const PAPER_MARKET_ANALYSIS_LJUNG_BOX_LAG_COUNT = 10;

const ARTIFACT_ID_PREFIX = 'paper-market-analysis:sha256:';
const MANIFEST_FILENAME = 'artifact.json';
const TABLE_FILENAME = 'table-1-market-statistics.csv';

export const PAPER_TABLE_1_COMMODITIES = [
  'Wood',
  'Apple',
  'Fish',
  'Copper Ore',
  'Silicon Ore',
  'Wheat',
  'Iron Ore',
  'Chicken',
  'Circuit Board',
  'Copper Ingot',
] as const;

export type PaperTableOneCommodityId = (typeof PAPER_TABLE_1_COMMODITIES)[number];

export type PaperTableOneReferenceRow = {
  readonly commodityId: PaperTableOneCommodityId;
  readonly excessKurtosis: number;
  readonly skewness: number;
  readonly absoluteReturnAutocorrelationLagOne: number;
  readonly pValueReported: '<1e-6';
  readonly pValueUpperBound: 1e-6;
};

export const PAPER_TABLE_1_REFERENCE_ROWS: readonly PaperTableOneReferenceRow[] = [
  createReferenceRow('Wood', 9.644, -1.659, 0.45),
  createReferenceRow('Apple', 6.637, 1.382, 0.585),
  createReferenceRow('Fish', 9.489, -0.254, 0.189),
  createReferenceRow('Copper Ore', 9.695, 0.009, 0.133),
  createReferenceRow('Silicon Ore', 9.873, -0.636, 0.108),
  createReferenceRow('Wheat', 9.502, 0.168, 0.118),
  createReferenceRow('Iron Ore', 9.28, -0.204, 0.127),
  createReferenceRow('Chicken', 9.516, 0.289, 0.105),
  createReferenceRow('Circuit Board', 8.203, 0.7, 0.187),
  createReferenceRow('Copper Ingot', 9.737, -0.632, 0.082),
];

export type PaperMarketAnalysisRow = CommodityPriceSeriesDiagnostics & {
  readonly commodityId: PaperTableOneCommodityId;
  readonly absoluteReturnAutocorrelationLagOne: number;
  readonly paperReference: PaperTableOneReferenceRow;
  readonly differenceFromPaper: {
    readonly excessKurtosis: number;
    readonly skewness: number;
    readonly absoluteReturnAutocorrelationLagOne: number;
  };
  readonly meetsMinimumReturnCount: boolean;
  readonly meetsPaperHeavyTailStatement: boolean;
  readonly hasPositiveLagOneAbsoluteReturnAutocorrelation: boolean;
  readonly rejectsNoSerialCorrelationAtOnePercent: boolean;
  readonly meetsTablePValueUpperBound: boolean;
};

export type PaperMarketAnalysisArtifact = {
  readonly schemaVersion: typeof PAPER_MARKET_ANALYSIS_SCHEMA_VERSION;
  readonly analysisId: string;
  readonly run: {
    readonly analysisRunId: string;
    readonly runManifestId: string;
    readonly simulationId: string;
    readonly sourceRevision: SourceRevision;
    readonly seed: string;
    readonly generatedAt: number;
  };
  readonly dataset: {
    readonly datasetId: string;
    readonly transactionsSha256: string;
    readonly selectedTradeCount: number;
    readonly firstObservationId: string;
    readonly lastObservationId: string;
    readonly firstObservedAt: number;
    readonly lastObservedAt: number;
  };
  readonly method: {
    readonly policyVersion: typeof PAPER_MARKET_ANALYSIS_SCHEMA_VERSION;
    readonly intervalMs: number;
    readonly intervalOriginAt: number;
    readonly representativePrice: 'last-traded-close';
    readonly returnRule: 'consecutive-ohlc-close-log-return';
    readonly momentRule: 'population-central-moments';
    readonly autocorrelationRule: 'paper-equation-19-full-sample-mean-and-denominator';
    readonly ljungBoxLagCount: number;
    readonly ljungBoxDegreesOfFreedomRule: 'tested-lag-count-no-fitted-model-parameters';
    readonly minimumReturnCount: number;
    readonly paperTimeCompressionRatio: 7;
    readonly realWorldWindow:
      | {
          readonly status: 'provided';
          readonly startedAtIso: string;
          readonly endedAtIso: string;
        }
      | { readonly status: 'not-provided' };
  };
  readonly sourceBars: {
    readonly count: number;
    readonly sha256: string;
    readonly barIds: readonly string[];
  };
  readonly marketStability: {
    readonly paperSection: '4.2';
    readonly commodityDiagnostics: readonly CommodityPriceSeriesDiagnostics[];
    readonly fishCaseStudy: {
      readonly minimumClosePrice: number;
      readonly maximumClosePrice: number;
      readonly logPriceRange: number;
      readonly maximumDrawdown: number;
      readonly logReturnStandardDeviation: number;
      readonly hasNonZeroReturnVariation: boolean;
      readonly paperReference: {
        readonly minimumClosePrice: 304.398;
        readonly maximumClosePrice: 304.808;
        readonly logPriceRangeReported: 0.001;
        readonly maximumDrawdownReported: 0.000715;
      };
    };
  };
  readonly table1: {
    readonly paperTable: 'Table 1';
    readonly filename: typeof TABLE_FILENAME;
    readonly mimeType: 'text/csv';
    readonly rows: readonly PaperMarketAnalysisRow[];
    readonly claimChecks: {
      readonly allCommoditiesMeetMinimumReturnCount: boolean;
      readonly allCommoditiesExceedPaperHeavyTailFloor: boolean;
      readonly allCommoditiesHavePositiveLagOneAbsoluteReturnAutocorrelation: boolean;
      readonly allCommoditiesRejectNoSerialCorrelationAtOnePercent: boolean;
      readonly allCommoditiesMeetRenderedTablePValueUpperBound: boolean;
    };
    readonly paperSourceInconsistency: {
      readonly status: 'disclosed';
      readonly tableStatement: 'Table 1 renders p < 1e-6 for every commodity';
      readonly proseStatement: 'Section 4.3.2 says Copper Ingot p < 0.001';
      readonly comparisonRule: 'retain-table-bound-and-disclose-prose-conflict';
    };
    readonly csv: string;
  };
  readonly figures: PaperMarketFigureBundle;
  readonly evidenceClassification: {
    readonly mechanism: 'verified-by-artifact-contract';
    readonly sourceDatasetPolicy: 'canonical-paper-scale' | 'noncanonical-contract';
    readonly empiricalEvaluationEligibility:
      | 'eligible-subject-to-source-authenticity-and-run-review'
      | 'not-eligible-noncanonical-dataset-policy';
    readonly syntheticInputsMayEstablishPaperReproduction: false;
  };
};

export type PaperMarketAnalysisArtifactInput = {
  readonly run: PaperMarketAnalysisArtifact['run'];
  readonly dataset: PaperMatureMarketDatasetArtifact;
  readonly bars: readonly MarketOhlcBar[];
  readonly intervalOriginAt?: number;
  readonly realWorldWindow?: {
    readonly startedAtIso: string;
    readonly endedAtIso: string;
  };
};

export function createPaperMarketAnalysisPolicyManifest() {
  return {
    policyVersion: PAPER_MARKET_ANALYSIS_SCHEMA_VERSION,
    sourceDatasetPolicy: 'paper-mature-market-dataset-v2',
    representativeCommodities: [...PAPER_TABLE_1_COMMODITIES],
    intervalMs: PAPER_MARKET_FIGURE_INTERVAL_MS,
    representativePrice: 'last-traded-close',
    returnRule: 'consecutive-ohlc-close-log-return',
    momentRule: 'population-central-moments',
    autocorrelationRule: 'paper-equation-19-full-sample-mean-and-denominator',
    ljungBoxLagCount: PAPER_MARKET_ANALYSIS_LJUNG_BOX_LAG_COUNT,
    minimumReturnCount: PAPER_MARKET_ANALYSIS_MINIMUM_RETURN_COUNT,
    paperHeavyTailFloor: 6,
    volatilitySignificanceLevel: 0.01,
    paperTimeCompressionRatio: 7,
    paperTableOneReferenceRows: PAPER_TABLE_1_REFERENCE_ROWS.map((row) => ({ ...row })),
    paperSourceInconsistency:
      'Table 1 renders p < 1e-6 for every commodity while Section 4.3.2 says Copper Ingot p < 0.001',
    figurePolicy: createPaperMarketFigurePolicyManifest(),
    evidenceRule: 'synthetic-contract-output-is-not-empirical-reproduction',
  } as const;
}

export function createPaperMarketAnalysisArtifact(
  input: PaperMarketAnalysisArtifactInput,
): PaperMarketAnalysisArtifact {
  assertValidRun(input.run);
  assertDatasetProvenance(input.dataset, input.run);
  const intervalOriginAt = input.intervalOriginAt ?? 0;
  assertFinite(intervalOriginAt, 'intervalOriginAt');
  const bars = input.bars.map(cloneAndValidateBar).sort(compareBars);
  assertSourceBars(bars, input.dataset, input.run.simulationId, intervalOriginAt);
  const diagnostics = createCommodityPriceSeriesDiagnostics({
    priceSeries: bars.map(toCloseObservation),
    ljungBoxLagCount: PAPER_MARKET_ANALYSIS_LJUNG_BOX_LAG_COUNT,
  });
  const diagnosticsByCommodity = new Map(
    diagnostics.map((row) => [row.commodityId, row] as const),
  );
  const tableRows = PAPER_TABLE_1_COMMODITIES.map((commodityId, index) =>
    createTableRow(
      commodityId,
      requireDiagnostics(diagnosticsByCommodity, commodityId),
      PAPER_TABLE_1_REFERENCE_ROWS[index]!,
    ),
  );
  const fishDiagnostics = requireDiagnostics(diagnosticsByCommodity, 'Fish');
  const fishBars = bars.filter((bar) => bar.commodityId === 'Fish');
  const fishClosePrices = fishBars.map((bar) => bar.closePrice);
  const figureBundle = createPaperMarketFigureBundle({
    runId: input.run.analysisRunId,
    simulationId: input.run.simulationId,
    generatedAt: input.run.generatedAt,
    bars,
    intervalMs: PAPER_MARKET_FIGURE_INTERVAL_MS,
  });
  const tableCsv = renderTableCsv(tableRows);
  const canonicalPaperDatasetPolicy = hasCanonicalPaperDatasetPolicy(input.dataset);
  const artifactWithoutId: Omit<PaperMarketAnalysisArtifact, 'analysisId'> = {
    schemaVersion: PAPER_MARKET_ANALYSIS_SCHEMA_VERSION,
    run: cloneRun(input.run),
    dataset: {
      datasetId: input.dataset.datasetId,
      transactionsSha256: input.dataset.selection.transactionFile.sha256,
      selectedTradeCount: input.dataset.selection.tradeCount,
      firstObservationId: input.dataset.selection.firstObservationId,
      lastObservationId: input.dataset.selection.lastObservationId,
      firstObservedAt: input.dataset.selection.firstObservedAt,
      lastObservedAt: input.dataset.selection.lastObservedAt,
    },
    method: {
      policyVersion: PAPER_MARKET_ANALYSIS_SCHEMA_VERSION,
      intervalMs: PAPER_MARKET_FIGURE_INTERVAL_MS,
      intervalOriginAt,
      representativePrice: 'last-traded-close',
      returnRule: 'consecutive-ohlc-close-log-return',
      momentRule: 'population-central-moments',
      autocorrelationRule: 'paper-equation-19-full-sample-mean-and-denominator',
      ljungBoxLagCount: PAPER_MARKET_ANALYSIS_LJUNG_BOX_LAG_COUNT,
      ljungBoxDegreesOfFreedomRule: 'tested-lag-count-no-fitted-model-parameters',
      minimumReturnCount: PAPER_MARKET_ANALYSIS_MINIMUM_RETURN_COUNT,
      paperTimeCompressionRatio: 7,
      realWorldWindow:
        input.realWorldWindow === undefined
          ? { status: 'not-provided' }
          : {
              status: 'provided',
              startedAtIso: normalizeIso(input.realWorldWindow.startedAtIso, 'startedAtIso'),
              endedAtIso: normalizeIso(input.realWorldWindow.endedAtIso, 'endedAtIso'),
            },
    },
    sourceBars: {
      count: bars.length,
      sha256: hashBars(bars),
      barIds: bars.map((bar) => bar.barId),
    },
    marketStability: {
      paperSection: '4.2',
      commodityDiagnostics: diagnostics.map(cloneDiagnostics),
      fishCaseStudy: {
        minimumClosePrice: Math.min(...fishClosePrices),
        maximumClosePrice: Math.max(...fishClosePrices),
        logPriceRange: fishDiagnostics.logPriceRange,
        maximumDrawdown: fishDiagnostics.maximumDrawdown,
        logReturnStandardDeviation: fishDiagnostics.logReturnStandardDeviation,
        hasNonZeroReturnVariation: fishDiagnostics.logReturnStandardDeviation > 0,
        paperReference: {
          minimumClosePrice: 304.398,
          maximumClosePrice: 304.808,
          logPriceRangeReported: 0.001,
          maximumDrawdownReported: 0.000715,
        },
      },
    },
    table1: {
      paperTable: 'Table 1',
      filename: TABLE_FILENAME,
      mimeType: 'text/csv',
      rows: tableRows,
      claimChecks: {
        allCommoditiesMeetMinimumReturnCount: tableRows.every(
          (row) => row.meetsMinimumReturnCount,
        ),
        allCommoditiesExceedPaperHeavyTailFloor: tableRows.every(
          (row) => row.meetsPaperHeavyTailStatement,
        ),
        allCommoditiesHavePositiveLagOneAbsoluteReturnAutocorrelation: tableRows.every(
          (row) => row.hasPositiveLagOneAbsoluteReturnAutocorrelation,
        ),
        allCommoditiesRejectNoSerialCorrelationAtOnePercent: tableRows.every(
          (row) => row.rejectsNoSerialCorrelationAtOnePercent,
        ),
        allCommoditiesMeetRenderedTablePValueUpperBound: tableRows.every(
          (row) => row.meetsTablePValueUpperBound,
        ),
      },
      paperSourceInconsistency: {
        status: 'disclosed',
        tableStatement: 'Table 1 renders p < 1e-6 for every commodity',
        proseStatement: 'Section 4.3.2 says Copper Ingot p < 0.001',
        comparisonRule: 'retain-table-bound-and-disclose-prose-conflict',
      },
      csv: tableCsv,
    },
    figures: figureBundle,
    evidenceClassification: {
      mechanism: 'verified-by-artifact-contract',
      sourceDatasetPolicy: canonicalPaperDatasetPolicy
        ? 'canonical-paper-scale'
        : 'noncanonical-contract',
      empiricalEvaluationEligibility: canonicalPaperDatasetPolicy
        ? 'eligible-subject-to-source-authenticity-and-run-review'
        : 'not-eligible-noncanonical-dataset-policy',
      syntheticInputsMayEstablishPaperReproduction: false,
    },
  };
  const artifact: PaperMarketAnalysisArtifact = {
    ...artifactWithoutId,
    analysisId: createAnalysisId(artifactWithoutId),
  };
  assertValidArtifact(artifact);
  return cloneArtifact(artifact);
}

export class FilePaperMarketAnalysisArtifactRepository {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = join(input.rootDir, 'paper-market-analysis-artifacts');
    mkdirSync(this.rootDir, { recursive: true });
  }

  save(artifact: PaperMarketAnalysisArtifact): Promise<PaperMarketAnalysisArtifact> {
    return Promise.resolve().then(() => {
      assertValidArtifact(artifact);
      const clone = cloneArtifact(artifact);
      const artifactDir = this.resolveArtifactDir(clone.analysisId);
      const manifestPath = join(artifactDir, MANIFEST_FILENAME);
      const manifest = `${JSON.stringify(clone, null, 2)}\n`;
      if (existsSync(manifestPath)) {
        assertFilesEqual(artifactDir, clone, manifest);
        return clone;
      }
      mkdirSync(artifactDir, { recursive: true });
      writeAtomically(join(artifactDir, TABLE_FILENAME), clone.table1.csv);
      for (const figure of clone.figures.figures) {
        writeAtomically(join(artifactDir, figure.filename), figure.svg);
      }
      writeAtomically(manifestPath, manifest);
      return clone;
    });
  }

  get(analysisId: string): Promise<PaperMarketAnalysisArtifact | undefined> {
    return Promise.resolve().then(() => {
      assertAnalysisId(analysisId);
      const artifactDir = this.resolveArtifactDir(analysisId);
      const manifestPath = join(artifactDir, MANIFEST_FILENAME);
      if (!existsSync(manifestPath)) {
        return undefined;
      }
      const artifact = JSON.parse(
        readFileSync(manifestPath, 'utf8'),
      ) as PaperMarketAnalysisArtifact;
      assertValidArtifact(artifact);
      if (artifact.analysisId !== analysisId) {
        throw new Error(`paper market analysis path does not match ${artifact.analysisId}`);
      }
      assertFilesEqual(artifactDir, artifact, `${JSON.stringify(artifact, null, 2)}\n`);
      return cloneArtifact(artifact);
    });
  }

  private resolveArtifactDir(analysisId: string): string {
    return join(this.rootDir, encodeURIComponent(analysisId));
  }
}

function createTableRow(
  commodityId: PaperTableOneCommodityId,
  diagnostics: CommodityPriceSeriesDiagnostics,
  reference: PaperTableOneReferenceRow,
): PaperMarketAnalysisRow {
  const lagOne = diagnostics.absoluteReturnAutocorrelations.find((item) => item.lag === 1);
  if (lagOne === undefined) {
    throw new Error(`paper market analysis ${commodityId} requires lag-one autocorrelation`);
  }
  return {
    ...cloneDiagnostics(diagnostics),
    commodityId,
    absoluteReturnAutocorrelationLagOne: lagOne.autocorrelation,
    paperReference: { ...reference },
    differenceFromPaper: {
      excessKurtosis: diagnostics.excessKurtosis - reference.excessKurtosis,
      skewness: diagnostics.skewness - reference.skewness,
      absoluteReturnAutocorrelationLagOne:
        lagOne.autocorrelation - reference.absoluteReturnAutocorrelationLagOne,
    },
    meetsMinimumReturnCount:
      diagnostics.returnObservationCount >= PAPER_MARKET_ANALYSIS_MINIMUM_RETURN_COUNT,
    meetsPaperHeavyTailStatement: diagnostics.excessKurtosis > 6,
    hasPositiveLagOneAbsoluteReturnAutocorrelation: lagOne.autocorrelation > 0,
    rejectsNoSerialCorrelationAtOnePercent: diagnostics.ljungBox.pValue < 0.01,
    meetsTablePValueUpperBound: diagnostics.ljungBox.pValue < reference.pValueUpperBound,
  };
}

function assertSourceBars(
  bars: readonly MarketOhlcBar[],
  dataset: PaperMatureMarketDatasetArtifact,
  simulationId: string,
  intervalOriginAt: number,
): void {
  if (bars.length === 0) {
    throw new Error('paper market analysis requires OHLC bars');
  }
  const barIds = new Set<string>();
  for (const bar of bars) {
    if (bar.simulationId !== simulationId) {
      throw new Error(`bar ${bar.barId} simulationId must match ${simulationId}`);
    }
    if (bar.intervalEndedAt - bar.intervalStartedAt !== PAPER_MARKET_FIGURE_INTERVAL_MS) {
      throw new Error(`bar ${bar.barId} must use five-minute intervals`);
    }
    if (
      (bar.intervalStartedAt - intervalOriginAt) % PAPER_MARKET_FIGURE_INTERVAL_MS !==
      0
    ) {
      throw new Error(`bar ${bar.barId} does not align with interval origin`);
    }
    if (
      bar.intervalEndedAt <= dataset.selection.firstObservedAt ||
      bar.intervalStartedAt > dataset.selection.lastObservedAt
    ) {
      throw new Error(`bar ${bar.barId} falls outside the selected dataset window`);
    }
    if (barIds.has(bar.barId)) {
      throw new Error(`duplicate source bar ID ${bar.barId}`);
    }
    barIds.add(bar.barId);
  }
  for (const commodityId of PAPER_TABLE_1_COMMODITIES) {
    const commodityBarCount = bars.filter((bar) => bar.commodityId === commodityId).length;
    if (commodityBarCount < PAPER_MARKET_ANALYSIS_MINIMUM_RETURN_COUNT + 1) {
      throw new Error(
        `paper market analysis requires at least ${PAPER_MARKET_ANALYSIS_MINIMUM_RETURN_COUNT + 1} ${commodityId} OHLC bars`,
      );
    }
  }
}

function assertDatasetProvenance(
  dataset: PaperMatureMarketDatasetArtifact,
  run: PaperMarketAnalysisArtifact['run'],
): void {
  assertNonEmpty(dataset.datasetId, 'dataset.datasetId');
  if (!/^paper-mature-market-dataset:sha256:[a-f0-9]{64}$/u.test(dataset.datasetId)) {
    throw new Error('paper market analysis requires a content-addressed mature dataset ID');
  }
  if (dataset.schemaVersion !== 'paper-mature-market-dataset-v2') {
    throw new Error('paper market analysis requires paper-mature-market-dataset-v2');
  }
  if (dataset.run.runManifestId !== run.runManifestId) {
    throw new Error('paper market analysis run manifest must match source dataset');
  }
  if (dataset.run.simulationId !== run.simulationId) {
    throw new Error('paper market analysis simulation must match source dataset');
  }
  assertNonEmpty(dataset.selection.transactionFile.sha256, 'dataset transaction SHA-256');
  if (!/^sha256:[a-f0-9]{64}$/u.test(dataset.selection.transactionFile.sha256)) {
    throw new Error('paper market analysis requires a valid transaction SHA-256');
  }
}

function assertValidArtifact(artifact: PaperMarketAnalysisArtifact): void {
  if (artifact.schemaVersion !== PAPER_MARKET_ANALYSIS_SCHEMA_VERSION) {
    throw new Error('paper market analysis schemaVersion is unsupported');
  }
  assertValidRun(artifact.run);
  assertAnalysisId(artifact.analysisId);
  const withoutId = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== 'analysisId'),
  ) as Omit<PaperMarketAnalysisArtifact, 'analysisId'>;
  if (createAnalysisId(withoutId) !== artifact.analysisId) {
    throw new Error('paper market analysis ID does not match artifact content');
  }
  if (artifact.table1.rows.length !== PAPER_TABLE_1_COMMODITIES.length) {
    throw new Error('paper market analysis Table 1 must contain ten rows');
  }
  artifact.table1.rows.forEach((row, index) => {
    if (row.commodityId !== PAPER_TABLE_1_COMMODITIES[index]) {
      throw new Error('paper market analysis Table 1 row order is invalid');
    }
  });
  if (artifact.figures.figures.length !== 5) {
    throw new Error('paper market analysis must contain Figures 4-8');
  }
  if (artifact.figures.runId !== artifact.run.analysisRunId) {
    throw new Error('paper market figure run ID must match analysis run ID');
  }
  if (artifact.figures.sourceBarIds.length !== artifact.sourceBars.barIds.length) {
    throw new Error('paper market figure and analysis bar manifests must match');
  }
  if (
    JSON.stringify(artifact.figures.sourceBarIds) !==
    JSON.stringify([...artifact.sourceBars.barIds].sort((left, right) => left.localeCompare(right)))
  ) {
    throw new Error('paper market figure and analysis bar IDs must match');
  }
  if (artifact.method.realWorldWindow.status === 'provided') {
    const startedAt = Date.parse(artifact.method.realWorldWindow.startedAtIso);
    const endedAt = Date.parse(artifact.method.realWorldWindow.endedAtIso);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
      throw new Error('paper market analysis real-world window must have positive duration');
    }
  }
  if (!artifact.table1.csv.startsWith('commodity_id,')) {
    throw new Error('paper market analysis Table 1 CSV is invalid');
  }
}

function assertValidRun(run: PaperMarketAnalysisArtifact['run']): void {
  assertNonEmpty(run.analysisRunId, 'run.analysisRunId');
  assertNonEmpty(run.runManifestId, 'run.runManifestId');
  assertNonEmpty(run.simulationId, 'run.simulationId');
  assertNonEmpty(run.sourceRevision.commit, 'run.sourceRevision.commit');
  if (typeof run.sourceRevision.dirty !== 'boolean') {
    throw new Error('run.sourceRevision.dirty must be boolean');
  }
  assertNonEmpty(run.seed, 'run.seed');
  assertFinite(run.generatedAt, 'run.generatedAt');
}

function assertFilesEqual(
  artifactDir: string,
  artifact: PaperMarketAnalysisArtifact,
  manifest: string,
): void {
  if (readFileSync(join(artifactDir, MANIFEST_FILENAME), 'utf8') !== manifest) {
    throw new Error(`paper market analysis ${artifact.analysisId} manifest is inconsistent`);
  }
  if (readFileSync(join(artifactDir, TABLE_FILENAME), 'utf8') !== artifact.table1.csv) {
    throw new Error(`paper market analysis ${artifact.analysisId} CSV is inconsistent`);
  }
  for (const figure of artifact.figures.figures) {
    const path = join(artifactDir, figure.filename);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== figure.svg) {
      throw new Error(`paper market analysis ${artifact.analysisId} SVG is inconsistent`);
    }
  }
}

function renderTableCsv(rows: readonly PaperMarketAnalysisRow[]): string {
  const header = [
    'commodity_id',
    'observation_count',
    'return_observation_count',
    'log_price_range',
    'maximum_drawdown',
    'log_return_standard_deviation',
    'excess_kurtosis',
    'skewness',
    'absolute_return_acf_lag_1',
    'ljung_box_statistic',
    'ljung_box_lag_count',
    'ljung_box_degrees_of_freedom',
    'ljung_box_p_value',
    'paper_excess_kurtosis',
    'paper_skewness',
    'paper_absolute_return_acf_lag_1',
    'paper_p_value_reported',
  ];
  return `${[header, ...rows.map(toCsvRow)]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n')}\n`;
}

function toCsvRow(row: PaperMarketAnalysisRow): readonly (string | number)[] {
  return [
    row.commodityId,
    row.observationCount,
    row.returnObservationCount,
    row.logPriceRange,
    row.maximumDrawdown,
    row.logReturnStandardDeviation,
    row.excessKurtosis,
    row.skewness,
    row.absoluteReturnAutocorrelationLagOne,
    row.ljungBox.statistic,
    row.ljungBox.lagCount,
    row.ljungBox.degreesOfFreedom,
    row.ljungBox.pValue,
    row.paperReference.excessKurtosis,
    row.paperReference.skewness,
    row.paperReference.absoluteReturnAutocorrelationLagOne,
    row.paperReference.pValueReported,
  ];
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCloseObservation(bar: MarketOhlcBar): PriceCloseObservation {
  return {
    commodityId: bar.commodityId,
    observedAt: bar.intervalStartedAt,
    closePrice: bar.closePrice,
  };
}

function requireDiagnostics(
  diagnostics: ReadonlyMap<string, CommodityPriceSeriesDiagnostics>,
  commodityId: string,
): CommodityPriceSeriesDiagnostics {
  const row = diagnostics.get(commodityId);
  if (row === undefined) {
    throw new Error(`paper market analysis requires ${commodityId} diagnostics`);
  }
  return row;
}

function cloneDiagnostics(
  diagnostics: CommodityPriceSeriesDiagnostics,
): CommodityPriceSeriesDiagnostics {
  return {
    ...diagnostics,
    absoluteReturnAutocorrelations: diagnostics.absoluteReturnAutocorrelations.map((item) => ({
      ...item,
    })),
    ljungBox: { ...diagnostics.ljungBox },
  };
}

function cloneAndValidateBar(bar: MarketOhlcBar): MarketOhlcBar {
  assertNonEmpty(bar.barId, 'bar.barId');
  assertNonEmpty(bar.simulationId, 'bar.simulationId');
  assertNonEmpty(bar.commodityId, 'bar.commodityId');
  assertFinite(bar.intervalStartedAt, 'bar.intervalStartedAt');
  assertFinite(bar.intervalEndedAt, 'bar.intervalEndedAt');
  if (bar.intervalEndedAt <= bar.intervalStartedAt) {
    throw new Error('bar interval must have positive duration');
  }
  for (const [name, value] of [
    ['openPrice', bar.openPrice],
    ['highPrice', bar.highPrice],
    ['lowPrice', bar.lowPrice],
    ['closePrice', bar.closePrice],
    ['commodityVolume', bar.commodityVolume],
    ['currencyVolume', bar.currencyVolume],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`bar.${name} must be positive and finite`);
    }
  }
  if (!Number.isInteger(bar.tradeCount) || bar.tradeCount <= 0) {
    throw new Error('bar.tradeCount must be a positive integer');
  }
  return { ...bar };
}

function compareBars(left: MarketOhlcBar, right: MarketOhlcBar): number {
  if (left.commodityId !== right.commodityId) {
    return left.commodityId.localeCompare(right.commodityId);
  }
  if (left.intervalStartedAt !== right.intervalStartedAt) {
    return left.intervalStartedAt - right.intervalStartedAt;
  }
  return left.barId.localeCompare(right.barId);
}

function hashBars(bars: readonly MarketOhlcBar[]): string {
  return `sha256:${sha256(stableStringify(bars))}`;
}

function createAnalysisId(
  artifact: Omit<PaperMarketAnalysisArtifact, 'analysisId'>,
): string {
  return `${ARTIFACT_ID_PREFIX}${sha256(stableStringify(artifact))}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createReferenceRow(
  commodityId: PaperTableOneCommodityId,
  excessKurtosis: number,
  skewness: number,
  absoluteReturnAutocorrelationLagOne: number,
): PaperTableOneReferenceRow {
  return {
    commodityId,
    excessKurtosis,
    skewness,
    absoluteReturnAutocorrelationLagOne,
    pValueReported: '<1e-6',
    pValueUpperBound: 1e-6,
  };
}

function cloneRun(run: PaperMarketAnalysisArtifact['run']): PaperMarketAnalysisArtifact['run'] {
  return { ...run, sourceRevision: cloneSourceRevision(run.sourceRevision) };
}

function cloneArtifact(artifact: PaperMarketAnalysisArtifact): PaperMarketAnalysisArtifact {
  return JSON.parse(JSON.stringify(artifact)) as PaperMarketAnalysisArtifact;
}

function normalizeIso(value: string, name: string): string {
  assertNonEmpty(value, name);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${name} must be an ISO-8601 timestamp`);
  }
  return new Date(timestamp).toISOString();
}

function hasCanonicalPaperDatasetPolicy(dataset: PaperMatureMarketDatasetArtifact): boolean {
  return (
    dataset.policy.minimumSourceTradeCountExclusive === 600_000 &&
    dataset.policy.selectedTradeCount === 400_000 &&
    dataset.policy.dayDurationMs === 86_400_000 &&
    dataset.policy.dayOriginAt === 0 &&
    dataset.policy.stabilityWindowDayCount === 7 &&
    dataset.policy.maximumDailyCurrencyVolumeCoefficientOfVariation === 0.1 &&
    dataset.policy.maximumDailyParticipantCountCoefficientOfVariation === 0.1 &&
    dataset.source.tradeCount > 600_000 &&
    dataset.selection.tradeCount === 400_000
  );
}

function assertAnalysisId(analysisId: string): void {
  if (!new RegExp(`^${ARTIFACT_ID_PREFIX}[a-f0-9]{64}$`, 'u').test(analysisId)) {
    throw new Error('paper market analysis ID must be content-addressed SHA-256');
  }
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporaryPath, content, 'utf8');
  renameSync(temporaryPath, path);
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
