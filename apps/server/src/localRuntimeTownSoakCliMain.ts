import {
  createLocalRuntimeTownSoakCliHelp,
  hasLocalRuntimeTownSoakHelpFlag,
  resolveLocalRuntimeTownSoakCliConfig,
  runLocalRuntimeTownSoakCli,
} from './localRuntimeTownSoakCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownSoakHelpFlag(argv)) {
    console.log(createLocalRuntimeTownSoakCliHelp());
    return;
  }
  const config = resolveLocalRuntimeTownSoakCliConfig({ argv });
  const result = await runLocalRuntimeTownSoakCli(config);
  console.log(
    JSON.stringify({
      event: 'aivilization-runtime-soak-completed',
      artifactId: result.artifact.artifactId,
      profileId: result.artifact.run.profileId,
      durationMs: result.artifact.summary.durationMs,
      qualityGateStatus: result.artifact.summary.qualityGate.status,
      empiricalScaleClaimEligibility:
        result.artifact.evidenceClassification.empiricalScaleClaimEligibility,
      artifactRootDir: result.artifactRootDir,
      runtimeRootDir: result.artifact.run.runtimeRootDir,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
