import {
  createLocalRuntimeTownParticipantDataDeletionCliHelp,
  resolveLocalRuntimeTownParticipantDataDeletionCliConfig,
  runLocalRuntimeTownParticipantDataDeletionCli,
} from './localRuntimeTownParticipantDataDeletionCli';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`${createLocalRuntimeTownParticipantDataDeletionCliHelp()}\n`);
} else {
  try {
    const artifact = runLocalRuntimeTownParticipantDataDeletionCli(
      resolveLocalRuntimeTownParticipantDataDeletionCliConfig({ argv }),
    );
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
