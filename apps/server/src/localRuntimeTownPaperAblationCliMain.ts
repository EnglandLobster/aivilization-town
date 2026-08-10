import {
  createLocalRuntimeTownCliHelp,
  hasLocalRuntimeTownCliHelpFlag,
  resolveLocalRuntimeTownCliConfig,
} from './localRuntimeTownCli';
import { runLocalRuntimeTownPaperAblationExperiment } from './localRuntimeTownPaperAblationExperiment';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasLocalRuntimeTownCliHelpFlag(argv)) {
    console.log(createPaperAblationCliHelp());
    return;
  }
  const extracted = extractCycles(argv);
  const config = resolveLocalRuntimeTownCliConfig({ argv: extracted.argv });
  const result = await runLocalRuntimeTownPaperAblationExperiment({
    config,
    cycleCount: extracted.cycleCount,
  });
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-ablation-run-completed',
      runId: result.artifact.run.runId,
      runManifestId: result.artifact.run.runManifestId,
      taskId: result.artifact.run.taskId,
      plannerVariant: result.artifact.run.variant,
      seed: result.artifact.run.seed,
      completedCycleCount: result.artifact.run.completedCycleCount,
      experimentStartedAt: result.artifact.run.experimentStartedAt,
      experimentEndedAt: result.artifact.run.experimentEndedAt,
      artifactRootDir: result.artifactRootDir,
      metrics: result.artifact.metrics,
    }),
  );
}

function createPaperAblationCliHelp(): string {
  return [
    'Bounded paper ablation runner:',
    '  pnpm --filter @aivilization/server paper-ablation -- --llm-mode <mode> --profile ablation-80 --paper-ablation-task <task> --planner-variant <variant> --cycles <count>',
    '',
    '  --cycles <count>     Required positive number of complete simulation cycles',
    '',
    createLocalRuntimeTownCliHelp(),
  ].join('\n');
}

function extractCycles(argv: readonly string[]): {
  readonly cycleCount: number;
  readonly argv: readonly string[];
} {
  let rawValue: string | undefined;
  const remaining: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token.startsWith('--cycles=')) {
      if (rawValue !== undefined) {
        throw new Error('--cycles cannot be repeated');
      }
      rawValue = token.slice('--cycles='.length);
      continue;
    }
    if (token === '--cycles') {
      if (rawValue !== undefined) {
        throw new Error('--cycles cannot be repeated');
      }
      rawValue = argv[index + 1];
      if (rawValue === undefined || rawValue.startsWith('--')) {
        throw new Error('--cycles requires a value');
      }
      index += 1;
      continue;
    }
    remaining.push(token);
  }
  if (rawValue === undefined) {
    throw new Error('--cycles is required');
  }
  const cycleCount = Number(rawValue);
  if (!Number.isInteger(cycleCount) || cycleCount < 1) {
    throw new Error('--cycles must be a positive integer');
  }
  return { cycleCount, argv: remaining };
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
