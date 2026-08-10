import { describe, expect, test } from 'vitest';
import {
  createLocalRuntimeTownPaperMarketAnalysisCliHelp,
  resolveLocalRuntimeTownPaperMarketAnalysisCliConfig,
  runLocalRuntimeTownPaperMarketAnalysis,
} from './localRuntimeTownPaperMarketAnalysisCli';

describe('local runtime town paper market analysis CLI', () => {
  test('resolves a frozen dataset and requires paired real-world window boundaries', () => {
    expect(
      resolveLocalRuntimeTownPaperMarketAnalysisCliConfig({
        argv: [
          '--root-dir',
          './runtime',
          '--dataset-id',
          'paper-mature-market-dataset:sha256:abc',
          '--analysis-run-id',
          'analysis-1',
          '--real-world-window-started-at',
          '2025-09-09T00:00:00Z',
          '--real-world-window-ended-at',
          '2025-09-15T00:00:00Z',
        ],
        cwd: '/workspace',
        now: 123,
      }),
    ).toEqual({
      rootDir: '/workspace/runtime',
      datasetId: 'paper-mature-market-dataset:sha256:abc',
      analysisRunId: 'analysis-1',
      generatedAt: 123,
      realWorldWindow: {
        startedAtIso: '2025-09-09T00:00:00Z',
        endedAtIso: '2025-09-15T00:00:00Z',
      },
    });
    expect(() =>
      resolveLocalRuntimeTownPaperMarketAnalysisCliConfig({
        argv: [
          '--root-dir',
          './runtime',
          '--dataset-id',
          'dataset',
          '--analysis-run-id',
          'analysis',
          '--real-world-window-started-at',
          '2025-09-09T00:00:00Z',
        ],
      }),
    ).toThrow('start and end must be provided together');
    expect(createLocalRuntimeTownPaperMarketAnalysisCliHelp()).toContain('ten-commodity Table 1 CSV');
  });

  test('fails before creating repositories when the frozen dataset is absent', async () => {
    await expect(
      runLocalRuntimeTownPaperMarketAnalysis({
        rootDir: '/definitely-missing-paper-market-analysis-root',
        datasetId: 'paper-mature-market-dataset:sha256:abc',
        analysisRunId: 'analysis-1',
        generatedAt: 123,
      }),
    ).rejects.toThrow('paper mature market dataset does not exist');
  });
});
