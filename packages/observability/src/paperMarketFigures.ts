import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MarketOhlcBar } from './marketObservationRepository';

export const PAPER_MARKET_FIGURE_POLICY_VERSION = 'paper-market-figures-v1';
export const PAPER_MARKET_FIGURE_INTERVAL_MS = 5 * 60 * 1_000;

export type PaperMarketFigureArtifact = {
  readonly figureId:
    | 'fish-ohlc-volume'
    | 'silicon-chain-normalized-prices'
    | 'wood-chain-normalized-prices'
    | 'fish-standardized-return-histogram'
    | 'fish-log-return-volatility';
  readonly paperFigure: 'Figure 4' | 'Figure 5' | 'Figure 6' | 'Figure 7' | 'Figure 8';
  readonly filename: string;
  readonly mimeType: 'image/svg+xml';
  readonly title: string;
  readonly svg: string;
};

export type PaperMarketFigureBundle = {
  readonly schemaVersion: typeof PAPER_MARKET_FIGURE_POLICY_VERSION;
  readonly runId: string;
  readonly simulationId: string;
  readonly generatedAt: number;
  readonly intervalMs: number;
  readonly sourceBarIds: readonly string[];
  readonly figures: readonly PaperMarketFigureArtifact[];
};

export class FilePaperMarketFigureBundleRepository {
  private readonly rootDir: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = join(input.rootDir, 'paper-market-figure-bundles');
    mkdirSync(this.rootDir, { recursive: true });
  }

  save(bundle: PaperMarketFigureBundle): Promise<PaperMarketFigureBundle> {
    return Promise.resolve().then(() => {
      assertValidBundle(bundle);
      const bundleDir = this.resolveBundleDir(bundle.runId);
      const manifestPath = join(bundleDir, 'bundle.json');
      const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
      if (existsSync(manifestPath)) {
        const existing = readFileSync(manifestPath, 'utf8');
        if (existing !== serialized) {
          throw new Error(`paper market figure bundle ${bundle.runId} is immutable`);
        }
        return cloneBundle(bundle);
      }
      mkdirSync(bundleDir, { recursive: true });
      for (const figure of bundle.figures) {
        assertSafeFilename(figure.filename);
        writeAtomically(join(bundleDir, figure.filename), figure.svg);
      }
      writeAtomically(manifestPath, serialized);
      return cloneBundle(bundle);
    });
  }

  get(runId: string): Promise<PaperMarketFigureBundle | undefined> {
    return Promise.resolve().then(() => {
      assertNonEmpty(runId, 'runId');
      const manifestPath = join(this.resolveBundleDir(runId), 'bundle.json');
      if (!existsSync(manifestPath)) {
        return undefined;
      }
      const bundle = JSON.parse(readFileSync(manifestPath, 'utf8')) as PaperMarketFigureBundle;
      assertValidBundle(bundle);
      for (const figure of bundle.figures) {
        const svgPath = join(this.resolveBundleDir(runId), figure.filename);
        if (!existsSync(svgPath) || readFileSync(svgPath, 'utf8') !== figure.svg) {
          throw new Error(`paper market figure bundle ${runId} has missing or inconsistent SVG`);
        }
      }
      return cloneBundle(bundle);
    });
  }

  private resolveBundleDir(runId: string): string {
    return join(this.rootDir, encodeURIComponent(runId));
  }
}

export function createPaperMarketFigurePolicyManifest() {
  return {
    policyVersion: PAPER_MARKET_FIGURE_POLICY_VERSION,
    intervalMs: PAPER_MARKET_FIGURE_INTERVAL_MS,
    requiredCommodities: ['Fish', 'Silicon Ore', 'Pure Silicon', 'Transistor', 'Wood', 'Book'],
    figures: [
      'fish-ohlc-volume',
      'silicon-chain-normalized-prices',
      'wood-chain-normalized-prices',
      'fish-standardized-return-histogram',
      'fish-log-return-volatility',
    ],
    normalizationRule: 'commodity-close-divided-by-first-close',
    returnRule: 'consecutive-ohlc-close-log-return',
    histogramRule: '30-bin-standardized-return-density-with-standard-normal-reference',
    outputFormat: 'deterministic-svg-plus-source-bar-manifest',
  } as const;
}

export function createPaperMarketFigureBundle(input: {
  readonly runId: string;
  readonly simulationId: string;
  readonly generatedAt: number;
  readonly bars: readonly MarketOhlcBar[];
  readonly intervalMs?: number;
}): PaperMarketFigureBundle {
  assertNonEmpty(input.runId, 'runId');
  assertNonEmpty(input.simulationId, 'simulationId');
  assertFinite(input.generatedAt, 'generatedAt');
  const intervalMs = input.intervalMs ?? PAPER_MARKET_FIGURE_INTERVAL_MS;
  assertPositiveInteger(intervalMs, 'intervalMs');
  const bars = input.bars.map(cloneAndValidateBar).sort(compareBars);
  if (bars.length === 0) {
    throw new Error('paper market figures require OHLC bars');
  }
  for (const bar of bars) {
    if (bar.simulationId !== input.simulationId) {
      throw new Error(`bar ${bar.barId} simulationId must match ${input.simulationId}`);
    }
    if (bar.intervalEndedAt - bar.intervalStartedAt !== intervalMs) {
      throw new Error(`bar ${bar.barId} must use ${intervalMs}-ms intervals`);
    }
  }

  const byCommodity = groupBarsByCommodity(bars);
  const fish = requireCommodityBars(byCommodity, 'Fish');
  const siliconChain = [
    requireCommodityBars(byCommodity, 'Silicon Ore'),
    requireCommodityBars(byCommodity, 'Pure Silicon'),
    requireCommodityBars(byCommodity, 'Transistor'),
  ];
  const woodChain = [
    requireCommodityBars(byCommodity, 'Wood'),
    requireCommodityBars(byCommodity, 'Book'),
  ];
  const fishReturns = calculateLogReturns(fish);
  if (fishReturns.length < 2) {
    throw new Error('paper market figures require at least three Fish OHLC bars');
  }

  return {
    schemaVersion: PAPER_MARKET_FIGURE_POLICY_VERSION,
    runId: input.runId,
    simulationId: input.simulationId,
    generatedAt: input.generatedAt,
    intervalMs,
    sourceBarIds: bars.map((bar) => bar.barId).sort((left, right) => left.localeCompare(right)),
    figures: [
      createFigure(
        'fish-ohlc-volume',
        'Figure 4',
        'figure-4-fish-ohlc-volume.svg',
        'Fish 5-minute OHLC and traded volume',
        renderFishOhlcVolume(fish),
      ),
      createFigure(
        'silicon-chain-normalized-prices',
        'Figure 5',
        'figure-5-silicon-chain-normalized-prices.svg',
        'Normalized silicon supply-chain close prices',
        renderNormalizedPriceSeries(siliconChain),
      ),
      createFigure(
        'wood-chain-normalized-prices',
        'Figure 6',
        'figure-6-wood-chain-normalized-prices.svg',
        'Normalized wood supply-chain close prices',
        renderNormalizedPriceSeries(woodChain),
      ),
      createFigure(
        'fish-standardized-return-histogram',
        'Figure 7',
        'figure-7-fish-standardized-return-histogram.svg',
        'Fish standardized log-return density with Gaussian reference',
        renderStandardizedReturnHistogram(fishReturns),
      ),
      createFigure(
        'fish-log-return-volatility',
        'Figure 8',
        'figure-8-fish-log-return-volatility.svg',
        'Fish high-frequency log returns',
        renderReturnSeries(fish, fishReturns),
      ),
    ],
  };
}

function createFigure(
  figureId: PaperMarketFigureArtifact['figureId'],
  paperFigure: PaperMarketFigureArtifact['paperFigure'],
  filename: string,
  title: string,
  body: string,
): PaperMarketFigureArtifact {
  return {
    figureId,
    paperFigure,
    filename,
    mimeType: 'image/svg+xml',
    title,
    svg: wrapSvg(title, body),
  };
}

function renderFishOhlcVolume(bars: readonly MarketOhlcBar[]): string {
  const minimumPrice = Math.min(...bars.map((bar) => bar.lowPrice));
  const maximumPrice = Math.max(...bars.map((bar) => bar.highPrice));
  const maximumVolume = Math.max(...bars.map((bar) => bar.commodityVolume));
  const x = createIndexScale(bars.length, 70, 930);
  const priceY = createValueScale(minimumPrice, maximumPrice, 300, 45);
  const volumeY = createValueScale(0, maximumVolume, 445, 350);
  const candleWidth = Math.max(2, Math.min(12, 700 / bars.length));
  const candles = bars
    .map((bar, index) => {
      const center = x(index);
      const open = priceY(bar.openPrice);
      const close = priceY(bar.closePrice);
      const color = bar.closePrice >= bar.openPrice ? '#238636' : '#da3633';
      const bodyTop = Math.min(open, close);
      const bodyHeight = Math.max(1, Math.abs(open - close));
      return [
        `<line x1="${center}" y1="${priceY(bar.highPrice)}" x2="${center}" y2="${priceY(bar.lowPrice)}" stroke="${color}"/>`,
        `<rect x="${center - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" fill="${color}"/>`,
        `<rect x="${center - candleWidth / 2}" y="${volumeY(bar.commodityVolume)}" width="${candleWidth}" height="${445 - volumeY(bar.commodityVolume)}" fill="#58a6ff" opacity="0.7"/>`,
      ].join('');
    })
    .join('');
  return `${chartFrame('OHLC', 'Volume')}${candles}`;
}

function renderNormalizedPriceSeries(series: readonly (readonly MarketOhlcBar[])[]): string {
  const normalized = series.map((bars) => ({
    commodityId: bars[0]!.commodityId,
    points: bars.map((bar) => ({
      observedAt: bar.intervalStartedAt,
      value: bar.closePrice / bars[0]!.closePrice,
    })),
  }));
  const allPoints = normalized.flatMap((item) => item.points);
  const minimumAt = Math.min(...allPoints.map((point) => point.observedAt));
  const maximumAt = Math.max(...allPoints.map((point) => point.observedAt));
  const minimumValue = Math.min(...allPoints.map((point) => point.value));
  const maximumValue = Math.max(...allPoints.map((point) => point.value));
  const x = createValueScale(minimumAt, maximumAt, 70, 930);
  const y = createValueScale(minimumValue, maximumValue, 430, 45);
  const colors = ['#58a6ff', '#f0883e', '#a371f7'];
  const paths = normalized
    .map((item, index) => {
      const path = item.points
        .map((point, pointIndex) =>
          `${pointIndex === 0 ? 'M' : 'L'} ${x(point.observedAt)} ${y(point.value)}`,
        )
        .join(' ');
      return `<path d="${path}" fill="none" stroke="${colors[index]}" stroke-width="2"/><text x="${80 + index * 210}" y="28" fill="${colors[index]}" font-size="13">${escapeXml(item.commodityId)}</text>`;
    })
    .join('');
  return `${chartFrame('Normalized close-price multiplier')}${paths}`;
}

function renderStandardizedReturnHistogram(logReturns: readonly number[]): string {
  const mean = calculateMean(logReturns);
  const standardDeviation = Math.sqrt(calculateVariance(logReturns));
  if (standardDeviation === 0) {
    throw new Error('Fish log returns must vary to render the standardized-return histogram');
  }
  const standardized = logReturns.map((value) => (value - mean) / standardDeviation);
  const binCount = 30;
  const minimum = Math.min(-4, ...standardized);
  const maximum = Math.max(4, ...standardized);
  const width = (maximum - minimum) / binCount;
  const counts = Array<number>(binCount).fill(0);
  for (const value of standardized) {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - minimum) / width)));
    counts[index] = counts[index]! + 1;
  }
  const densities = counts.map((count) => count / (standardized.length * width));
  const gaussianPoints = Array.from({ length: 121 }, (_, index) => {
    const value = minimum + ((maximum - minimum) * index) / 120;
    return { value, density: Math.exp(-(value ** 2) / 2) / Math.sqrt(2 * Math.PI) };
  });
  const maximumDensity = Math.max(...densities, ...gaussianPoints.map((point) => point.density));
  const x = createValueScale(minimum, maximum, 70, 930);
  const y = createValueScale(0, maximumDensity, 430, 45);
  const bars = densities
    .map((density, index) => {
      const left = minimum + index * width;
      const right = left + width;
      return `<rect x="${x(left)}" y="${y(density)}" width="${Math.max(1, x(right) - x(left) - 1)}" height="${430 - y(density)}" fill="#58a6ff" opacity="0.65"/>`;
    })
    .join('');
  const gaussian = gaussianPoints
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.value)} ${y(point.density)}`)
    .join(' ');
  return `${chartFrame('Density')}${bars}<path d="${gaussian}" fill="none" stroke="#f0883e" stroke-width="2"/><text x="760" y="28" fill="#f0883e" font-size="13">Standard normal</text>`;
}

function renderReturnSeries(
  fishBars: readonly MarketOhlcBar[],
  logReturns: readonly number[],
): string {
  const points = logReturns.map((value, index) => ({
    observedAt: fishBars[index + 1]!.intervalStartedAt,
    value,
  }));
  const maximumAbsolute = Math.max(...points.map((point) => Math.abs(point.value)), Number.EPSILON);
  const x = createValueScale(points[0]!.observedAt, points.at(-1)!.observedAt, 70, 930);
  const y = createValueScale(-maximumAbsolute, maximumAbsolute, 430, 45);
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.observedAt)} ${y(point.value)}`)
    .join(' ');
  return `${chartFrame('Log return')}<line x1="70" y1="${y(0)}" x2="930" y2="${y(0)}" stroke="#8b949e"/><path d="${path}" fill="none" stroke="#da3633" stroke-width="1.5"/>`;
}

function wrapSvg(title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="480" viewBox="0 0 960 480" role="img" aria-label="${escapeXml(title)}"><rect width="960" height="480" fill="#0d1117"/><text x="24" y="28" fill="#f0f6fc" font-family="system-ui,sans-serif" font-size="16" font-weight="600">${escapeXml(title)}</text><g font-family="system-ui,sans-serif">${body}</g></svg>`;
}

function chartFrame(primaryLabel: string, secondaryLabel?: string): string {
  return `<line x1="70" y1="45" x2="70" y2="430" stroke="#8b949e"/><line x1="70" y1="430" x2="930" y2="430" stroke="#8b949e"/><text x="8" y="55" fill="#8b949e" font-size="12">${escapeXml(primaryLabel)}</text>${secondaryLabel === undefined ? '' : `<text x="8" y="365" fill="#8b949e" font-size="12">${escapeXml(secondaryLabel)}</text>`}`;
}

function groupBarsByCommodity(
  bars: readonly MarketOhlcBar[],
): ReadonlyMap<string, readonly MarketOhlcBar[]> {
  const groups = new Map<string, MarketOhlcBar[]>();
  for (const bar of bars) {
    const existing = groups.get(bar.commodityId) ?? [];
    existing.push(bar);
    groups.set(bar.commodityId, existing);
  }
  return groups;
}

function requireCommodityBars(
  byCommodity: ReadonlyMap<string, readonly MarketOhlcBar[]>,
  commodityId: string,
): readonly MarketOhlcBar[] {
  const bars = byCommodity.get(commodityId);
  if (bars === undefined || bars.length === 0) {
    throw new Error(`paper market figures require ${commodityId} OHLC bars`);
  }
  return bars;
}

function calculateLogReturns(bars: readonly MarketOhlcBar[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    returns.push(Math.log(bars[index]!.closePrice) - Math.log(bars[index - 1]!.closePrice));
  }
  return returns;
}

function calculateMean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateVariance(values: readonly number[]): number {
  const mean = calculateMean(values);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function createIndexScale(count: number, start: number, end: number): (index: number) => number {
  if (count <= 1) {
    return () => (start + end) / 2;
  }
  return (index) => start + (index / (count - 1)) * (end - start);
}

function createValueScale(
  minimum: number,
  maximum: number,
  outputMinimum: number,
  outputMaximum: number,
): (value: number) => number {
  if (maximum === minimum) {
    return () => (outputMinimum + outputMaximum) / 2;
  }
  return (value) =>
    outputMinimum + ((value - minimum) / (maximum - minimum)) * (outputMaximum - outputMinimum);
}

function cloneAndValidateBar(bar: MarketOhlcBar): MarketOhlcBar {
  assertNonEmpty(bar.barId, 'barId');
  assertNonEmpty(bar.simulationId, 'simulationId');
  assertNonEmpty(bar.commodityId, 'commodityId');
  for (const [name, value] of [
    ['intervalStartedAt', bar.intervalStartedAt],
    ['intervalEndedAt', bar.intervalEndedAt],
    ['openPrice', bar.openPrice],
    ['highPrice', bar.highPrice],
    ['lowPrice', bar.lowPrice],
    ['closePrice', bar.closePrice],
    ['commodityVolume', bar.commodityVolume],
    ['currencyVolume', bar.currencyVolume],
  ] as const) {
    assertFinite(value, name);
  }
  if (bar.intervalEndedAt <= bar.intervalStartedAt) {
    throw new Error('intervalEndedAt must be greater than intervalStartedAt');
  }
  if (Math.min(bar.openPrice, bar.highPrice, bar.lowPrice, bar.closePrice) <= 0) {
    throw new Error('OHLC prices must be positive');
  }
  if (bar.highPrice < Math.max(bar.openPrice, bar.lowPrice, bar.closePrice)) {
    throw new Error('highPrice must be the OHLC maximum');
  }
  if (bar.lowPrice > Math.min(bar.openPrice, bar.highPrice, bar.closePrice)) {
    throw new Error('lowPrice must be the OHLC minimum');
  }
  assertPositiveInteger(bar.tradeCount, 'tradeCount');
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

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function assertValidBundle(bundle: PaperMarketFigureBundle): void {
  if (bundle.schemaVersion !== PAPER_MARKET_FIGURE_POLICY_VERSION) {
    throw new Error('paper market figure bundle schemaVersion must be paper-market-figures-v1');
  }
  assertNonEmpty(bundle.runId, 'runId');
  assertNonEmpty(bundle.simulationId, 'simulationId');
  assertFinite(bundle.generatedAt, 'generatedAt');
  assertPositiveInteger(bundle.intervalMs, 'intervalMs');
  if (bundle.figures.length !== 5) {
    throw new Error('paper market figure bundle must contain Figures 4-8');
  }
  for (const sourceBarId of bundle.sourceBarIds) {
    assertNonEmpty(sourceBarId, 'sourceBarId');
  }
  for (const figure of bundle.figures) {
    assertNonEmpty(figure.figureId, 'figureId');
    assertSafeFilename(figure.filename);
    if (figure.mimeType !== 'image/svg+xml' || !figure.svg.startsWith('<svg')) {
      throw new Error(`paper market figure ${figure.figureId} must contain SVG`);
    }
  }
}

function cloneBundle(bundle: PaperMarketFigureBundle): PaperMarketFigureBundle {
  return {
    schemaVersion: bundle.schemaVersion,
    runId: bundle.runId,
    simulationId: bundle.simulationId,
    generatedAt: bundle.generatedAt,
    intervalMs: bundle.intervalMs,
    sourceBarIds: [...bundle.sourceBarIds],
    figures: bundle.figures.map((figure) => ({ ...figure })),
  };
}

function assertSafeFilename(filename: string): void {
  assertNonEmpty(filename, 'filename');
  if (filename.includes('/') || filename.includes('\\') || filename === '.' || filename === '..') {
    throw new Error('paper market figure filename must be a basename');
  }
}

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.tmp`;
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

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
