import {
  runCanonicalSocietyCutoverCli,
  CANONICAL_SOCIETY_CUTOVER_HELP,
} from './canonicalSocietyCutoverCli';
import {
  runCanonicalSocietyArchiveCli,
  CANONICAL_SOCIETY_ARCHIVE_HELP,
} from './canonicalSocietyArchiveCli';
import { runResidentSocietyCli, RESIDENT_SOCIETY_CLI_HELP } from './residentSocietyCli';
import {
  createLocalRuntimeTownCliHelp,
  hasLocalRuntimeTownCliHelpFlag,
  installLocalRuntimeTownShutdownHandlers,
  resolveLocalRuntimeTownCliConfig,
  startLocalRuntimeTownCli,
} from './localRuntimeTownCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'migrate-society') {
    await runCanonicalSocietyCutoverCli(argv.slice(1));
    return;
  }
  if (argv[0] === 'export-society-source') {
    runCanonicalSocietyArchiveCli(argv.slice(1));
    return;
  }
  if (argv[0] === 'resident-society') {
    await runResidentSocietyCli(argv.slice(1));
    return;
  }
  if (hasLocalRuntimeTownCliHelpFlag(argv)) {
    console.log(createLocalRuntimeTownCliHelp());
    console.log(RESIDENT_SOCIETY_CLI_HELP);
    console.log(CANONICAL_SOCIETY_ARCHIVE_HELP);
    console.log(CANONICAL_SOCIETY_CUTOVER_HELP);
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
