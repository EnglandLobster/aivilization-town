import {
  createLocalRuntimeTownParticipantDataLifecycleCliHelp,
  resolveLocalRuntimeTownParticipantDataLifecycleCliConfig,
  runLocalRuntimeTownParticipantDataLifecycleCli,
} from './localRuntimeTownParticipantDataLifecycleCli';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`${createLocalRuntimeTownParticipantDataLifecycleCliHelp()}\n`);
} else {
  try {
    const state = runLocalRuntimeTownParticipantDataLifecycleCli(
      resolveLocalRuntimeTownParticipantDataLifecycleCliConfig({ argv }),
    );
    process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
