import {
  createLocalRuntimeTownPaperMarketAnalysisCliHelp,
  hasLocalRuntimeTownPaperMarketAnalysisHelpFlag,
  resolveLocalRuntimeTownPaperMarketAnalysisCliConfig,
  runLocalRuntimeTownPaperMarketAnalysis,
} from './localRuntimeTownPaperMarketAnalysisCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownPaperMarketAnalysisHelpFlag(argv)) {
    console.log(createLocalRuntimeTownPaperMarketAnalysisCliHelp());
    return;
  }
  const config = resolveLocalRuntimeTownPaperMarketAnalysisCliConfig({ argv });
  const result = await runLocalRuntimeTownPaperMarketAnalysis(config);
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-market-analysis-completed',
      analysisId: result.artifact.analysisId,
      datasetId: result.artifact.dataset.datasetId,
      tableRowCount: result.artifact.table1.rows.length,
      figureCount: result.artifact.figures.figures.length,
      sourceBarCount: result.artifact.sourceBars.count,
      artifactRootDir: result.artifactRootDir,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
