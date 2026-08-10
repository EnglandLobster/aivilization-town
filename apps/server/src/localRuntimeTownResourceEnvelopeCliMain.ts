import {
  createLocalRuntimeTownResourceEnvelopeCliHelp,
  hasLocalRuntimeTownResourceEnvelopeHelpFlag,
  resolveLocalRuntimeTownResourceEnvelopeCliConfig,
  runLocalRuntimeTownResourceEnvelopeCli,
} from './localRuntimeTownResourceEnvelopeCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownResourceEnvelopeHelpFlag(argv)) {
    console.log(createLocalRuntimeTownResourceEnvelopeCliHelp());
    return;
  }
  const config = resolveLocalRuntimeTownResourceEnvelopeCliConfig({ argv });
  const artifact = await runLocalRuntimeTownResourceEnvelopeCli(config);
  console.log(
    JSON.stringify({
      event: 'aivilization-runtime-resource-envelope-assessed',
      artifactId: artifact.artifactId,
      sourceArtifactIds: artifact.sourceArtifactIds,
      status: artifact.status,
      withinReferenceResourceEnvelope:
        artifact.evidenceClassification.withinReferenceResourceEnvelope,
      artifactRootDir: config.artifactRootDir,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
