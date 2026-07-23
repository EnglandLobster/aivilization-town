import {
  createLocalRuntimeTownPaperTrajectoryCliHelp,
  hasLocalRuntimeTownPaperTrajectoryHelpFlag,
  resolveLocalRuntimeTownPaperTrajectoryCliConfig,
  runLocalRuntimeTownPaperTrajectory,
} from './localRuntimeTownPaperTrajectoryCli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownPaperTrajectoryHelpFlag(argv)) {
    console.log(createLocalRuntimeTownPaperTrajectoryCliHelp());
    return;
  }
  const result = await runLocalRuntimeTownPaperTrajectory(
    resolveLocalRuntimeTownPaperTrajectoryCliConfig({ argv }),
  );
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-trajectory-completed',
      runId: result.artifact.run.runId,
      agentCount: result.artifact.trajectories.length,
      guidedAgentCount: result.artifact.cohorts.earlyEducationGuided.agentCount,
      unguidedAgentCount: result.artifact.cohorts.notEarlyEducationGuided.agentCount,
      artifactRootDir: result.artifactRootDir,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
