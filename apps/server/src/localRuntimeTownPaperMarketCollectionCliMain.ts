import {
  createLocalRuntimeTownPaperMarketCollectionCliHelp,
  resolveLocalRuntimeTownPaperMarketCollectionCliConfig,
  runLocalRuntimeTownPaperMarketCollection,
} from './localRuntimeTownPaperMarketCollectionCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(createLocalRuntimeTownPaperMarketCollectionCliHelp());
    return;
  }
  const result = await runLocalRuntimeTownPaperMarketCollection(
    resolveLocalRuntimeTownPaperMarketCollectionCliConfig({ argv }),
  );
  console.log(
    JSON.stringify({
      event: 'paper-market-collection-completed',
      collectionId: result.plan.collectionId,
      shardCount: result.plan.shards.length,
      completedEpochCount: result.projection.completedEpochCount,
      totalEpochCount: result.projection.totalEpochCount,
      sourceManifestId: result.sourceManifest.sourceManifestId,
      aggregationRule: result.sourceManifest.aggregationRule,
      ...(result.resourceEvidence === undefined
        ? {}
        : { resourceEvidenceArtifactId: result.resourceEvidence.artifactId }),
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
