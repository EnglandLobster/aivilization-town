import {
  createLocalRuntimeTownPaperMarketDatasetCliHelp,
  hasLocalRuntimeTownPaperMarketDatasetHelpFlag,
  resolveLocalRuntimeTownPaperMarketDatasetCliConfig,
  runLocalRuntimeTownPaperMarketDatasetExtraction,
} from './localRuntimeTownPaperMarketDatasetCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownPaperMarketDatasetHelpFlag(argv)) {
    console.log(createLocalRuntimeTownPaperMarketDatasetCliHelp());
    return;
  }
  const config = resolveLocalRuntimeTownPaperMarketDatasetCliConfig({ argv });
  const result = await runLocalRuntimeTownPaperMarketDatasetExtraction(config);
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-market-dataset-extracted',
      datasetId: result.artifact.datasetId,
      sourcePartitionCount: result.artifact.source.partitionCount,
      sourceTradeCount: result.artifact.source.tradeCount,
      selectedTradeCount: result.artifact.selection.tradeCount,
      stableWindowStartedAt: result.artifact.maturity.stableWindowStartedAt,
      stableWindowEndedAt: result.artifact.maturity.stableWindowEndedAt,
      artifactRootDir: result.artifactRootDir,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
