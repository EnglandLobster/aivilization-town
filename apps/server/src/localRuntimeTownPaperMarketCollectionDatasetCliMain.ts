import {
  createLocalRuntimeTownPaperMarketCollectionDatasetCliHelp,
  resolveLocalRuntimeTownPaperMarketCollectionDatasetCliConfig,
  runLocalRuntimeTownPaperMarketCollectionDatasetCli,
} from './localRuntimeTownPaperMarketCollectionDatasetCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(createLocalRuntimeTownPaperMarketCollectionDatasetCliHelp());
    return;
  }
  const artifact = await runLocalRuntimeTownPaperMarketCollectionDatasetCli(
    resolveLocalRuntimeTownPaperMarketCollectionDatasetCliConfig({ argv }),
  );
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-market-collection-dataset-extracted',
      datasetId: artifact.datasetId,
      runManifestId: artifact.run.runManifestId,
      sourcePartitionCount: artifact.source.partitionCount,
      sourceTradeCount: artifact.source.tradeCount,
      selectedTradeCount: artifact.selection.tradeCount,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
