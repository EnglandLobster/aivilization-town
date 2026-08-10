import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FilePaperMarketFigureBundleRepository,
  createPaperMarketFigureBundle,
  createPaperMarketFigurePolicyManifest,
  type MarketOhlcBar,
} from './index';

const simulationId = 'sim-paper-market';
const intervalMs = 300_000;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('paper market figure artifacts', () => {
  test('generates deterministic SVG artifacts for paper Figures 4-8 from five-minute OHLC bars', () => {
    const bars = [
      ...createCommodityBars('Fish', 100, 0.8),
      ...createCommodityBars('Silicon Ore', 80, 0.1),
      ...createCommodityBars('Pure Silicon', 120, 0.5),
      ...createCommodityBars('Transistor', 200, 1.2),
      ...createCommodityBars('Wood', 40, -0.2),
      ...createCommodityBars('Book', 70, 0.6),
    ];

    const bundle = createPaperMarketFigureBundle({
      runId: 'paper-market-run-1',
      simulationId,
      generatedAt: 1_700_000_000,
      bars,
    });

    expect(bundle).toMatchObject({
      schemaVersion: 'paper-market-figures-v1',
      runId: 'paper-market-run-1',
      simulationId,
      generatedAt: 1_700_000_000,
      intervalMs,
    });
    expect(bundle.sourceBarIds).toHaveLength(bars.length);
    expect(bundle.figures.map((figure) => [figure.paperFigure, figure.figureId])).toEqual([
      ['Figure 4', 'fish-ohlc-volume'],
      ['Figure 5', 'silicon-chain-normalized-prices'],
      ['Figure 6', 'wood-chain-normalized-prices'],
      ['Figure 7', 'fish-standardized-return-histogram'],
      ['Figure 8', 'fish-log-return-volatility'],
    ]);
    for (const figure of bundle.figures) {
      expect(figure.mimeType).toBe('image/svg+xml');
      expect(figure.filename).toMatch(/^figure-[4-8].+\.svg$/u);
      expect(figure.svg).toContain('<svg');
      expect(figure.svg).toContain(figure.title);
    }
    expect(bundle.figures[0]?.svg).toContain('Volume');
    expect(bundle.figures[1]?.svg).toContain('Silicon Ore');
    expect(bundle.figures[1]?.svg).toContain('Pure Silicon');
    expect(bundle.figures[1]?.svg).toContain('Transistor');
    expect(bundle.figures[2]?.svg).toContain('Wood');
    expect(bundle.figures[2]?.svg).toContain('Book');
    expect(bundle.figures[3]?.svg).toContain('Standard normal');
  });

  test('publishes the paper figure policy and rejects non-five-minute or incomplete inputs', () => {
    expect(createPaperMarketFigurePolicyManifest()).toMatchObject({
      policyVersion: 'paper-market-figures-v1',
      intervalMs,
      normalizationRule: 'commodity-close-divided-by-first-close',
      returnRule: 'consecutive-ohlc-close-log-return',
      outputFormat: 'deterministic-svg-plus-source-bar-manifest',
    });

    expect(() =>
      createPaperMarketFigureBundle({
        runId: 'bad-interval',
        simulationId,
        generatedAt: 1,
        bars: [{ ...createCommodityBars('Fish', 100, 1)[0]!, intervalEndedAt: 60_000 }],
      }),
    ).toThrow('must use 300000-ms intervals');

    expect(() =>
      createPaperMarketFigureBundle({
        runId: 'missing-chain',
        simulationId,
        generatedAt: 1,
        bars: createCommodityBars('Fish', 100, 1),
      }),
    ).toThrow('paper market figures require Silicon Ore OHLC bars');
  });

  test('persists an immutable bundle manifest and five standalone SVG files across restart', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-paper-market-figures-'));
    roots.push(rootDir);
    const bundle = createPaperMarketFigureBundle({
      runId: 'paper/market:run-2',
      simulationId,
      generatedAt: 1_700_000_001,
      bars: [
        ...createCommodityBars('Fish', 100, 0.8),
        ...createCommodityBars('Silicon Ore', 80, 0.1),
        ...createCommodityBars('Pure Silicon', 120, 0.5),
        ...createCommodityBars('Transistor', 200, 1.2),
        ...createCommodityBars('Wood', 40, -0.2),
        ...createCommodityBars('Book', 70, 0.6),
      ],
    });
    const repository = new FilePaperMarketFigureBundleRepository({ rootDir });

    await expect(repository.save(bundle)).resolves.toEqual(bundle);
    await expect(repository.save(bundle)).resolves.toEqual(bundle);
    const restarted = new FilePaperMarketFigureBundleRepository({ rootDir });
    await expect(restarted.get(bundle.runId)).resolves.toEqual(bundle);

    const bundleDir = join(rootDir, 'paper-market-figure-bundles', encodeURIComponent(bundle.runId));
    expect(JSON.parse(readFileSync(join(bundleDir, 'bundle.json'), 'utf8'))).toMatchObject({
      runId: bundle.runId,
      schemaVersion: 'paper-market-figures-v1',
    });
    for (const figure of bundle.figures) {
      expect(readFileSync(join(bundleDir, figure.filename), 'utf8')).toBe(figure.svg);
    }

    await expect(
      repository.save({ ...bundle, generatedAt: bundle.generatedAt + 1 }),
    ).rejects.toThrow(`paper market figure bundle ${bundle.runId} is immutable`);
  });
});

function createCommodityBars(
  commodityId: string,
  startingPrice: number,
  drift: number,
): MarketOhlcBar[] {
  return Array.from({ length: 12 }, (_, index) => {
    const intervalStartedAt = index * intervalMs;
    const oscillation = index % 3 === 0 ? 1.5 : index % 3 === 1 ? -0.8 : 0.4;
    const openPrice = startingPrice + drift * index + oscillation;
    const closePrice = startingPrice + drift * (index + 1) - oscillation / 2;
    return {
      barId: `${simulationId}:${commodityId}:${intervalStartedAt}`,
      simulationId,
      commodityId,
      intervalStartedAt,
      intervalEndedAt: intervalStartedAt + intervalMs,
      openPrice,
      highPrice: Math.max(openPrice, closePrice) + 1,
      lowPrice: Math.min(openPrice, closePrice) - 1,
      closePrice,
      tradeCount: 10 + index,
      commodityVolume: 20 + index * 2,
      currencyVolume: closePrice * (20 + index * 2),
    };
  });
}
