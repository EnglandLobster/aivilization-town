import {
  createLocalRuntimeTownCliHelp,
  hasLocalRuntimeTownCliHelpFlag,
  installLocalRuntimeTownShutdownHandlers,
  resolveLocalRuntimeTownCliConfig,
  startLocalRuntimeTownCli,
} from './localRuntimeTownCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownCliHelpFlag(argv)) {
    console.log(createLocalRuntimeTownCliHelp());
    return;
  }

  const config = resolveLocalRuntimeTownCliConfig({ argv });
  const application = await startLocalRuntimeTownCli(config);
  installLocalRuntimeTownShutdownHandlers({ application });
  console.log(
    JSON.stringify({
      event: 'aivilization-runtime-started',
      compositionVersion: config.compositionVersion,
      profileId: config.profileId,
      rootDir: config.rootDir,
      address: application.address.address,
      port: application.address.port,
      seed: config.seed,
      plannerVariant: config.plannerVariant,
      paperAblationTaskId: config.paperAblationTaskId ?? null,
      sourceRevision: config.sourceRevision,
      runManifestId: application.runManifestId,
      llmMode: config.llmMode,
      accessMode: config.participantAccess?.mode ?? 'open',
      maxAgentsPerParticipant:
        config.participantAccess?.mode === 'authenticated'
          ? config.participantAccess.maxAgentsPerParticipant
          : null,
      accessCredentialCount:
        config.participantAccess?.mode === 'authenticated'
          ? (config.participantAccess.credentials?.length ?? null)
          : 0,
      identityProvider:
        config.participantAccess?.mode === 'authenticated'
          ? config.participantAccess.oidc === undefined
            ? 'static-bearer'
            : 'oidc-jwks'
          : 'none',
      ...(config.llm?.providerConfig === undefined
        ? {}
        : {
            llmProviderId: config.llm.providerConfig.providerId,
            llmModel: config.llm.model,
          }),
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
