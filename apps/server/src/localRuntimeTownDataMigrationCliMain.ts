import {
  createLocalRuntimeTownDataMigrationCliHelp,
  resolveLocalRuntimeTownDataMigrationCliConfig,
  runLocalRuntimeTownDataMigrationCli,
} from './localRuntimeTownDataMigrationCli';

const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`${createLocalRuntimeTownDataMigrationCliHelp()}\n`);
} else {
  try {
    const artifact = runLocalRuntimeTownDataMigrationCli(
      resolveLocalRuntimeTownDataMigrationCliConfig({ argv }),
    );
    process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
