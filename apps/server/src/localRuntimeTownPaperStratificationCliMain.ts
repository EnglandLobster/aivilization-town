import {
  createLocalRuntimeTownPaperStratificationCliHelp,
  hasLocalRuntimeTownPaperStratificationHelpFlag,
  resolveLocalRuntimeTownPaperStratificationCliConfig,
  runLocalRuntimeTownPaperStratification,
} from './localRuntimeTownPaperStratificationCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownPaperStratificationHelpFlag(argv)) {
    console.log(createLocalRuntimeTownPaperStratificationCliHelp());
    return;
  }
  const result = await runLocalRuntimeTownPaperStratification(
    resolveLocalRuntimeTownPaperStratificationCliConfig({ argv }),
  );
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-stratification-completed',
      runId: result.artifact.run.runId,
      agentCount: result.artifact.sourceAgentIds.length,
      educationBinCount: result.artifact.educationWealth.bins.length,
      occupationCount: result.artifact.occupationWealth.rows.length,
      artifactRootDir: result.artifactRootDir,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
