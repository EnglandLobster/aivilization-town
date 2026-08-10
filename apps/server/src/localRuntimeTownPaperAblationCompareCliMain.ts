import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FilePaperPlannerAblationArtifactRepository,
  createPaperPlannerAblationComparisonArtifact,
  type PaperPlannerAblationRunArtifact,
} from '@aivilization/observability';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(createHelp());
    return;
  }
  const options = parseOptions(argv);
  const runs = options.runArtifactPaths.map(
    (path) => JSON.parse(readFileSync(path, 'utf8')) as PaperPlannerAblationRunArtifact,
  );
  const artifact = createPaperPlannerAblationComparisonArtifact({
    comparisonId: options.comparisonId,
    generatedAt: Date.now(),
    runs,
  });
  const repository = new FilePaperPlannerAblationArtifactRepository({
    rootDir: options.outputRoot,
  });
  await repository.saveComparison(artifact);
  console.log(
    JSON.stringify({
      event: 'aivilization-paper-ablation-comparison-completed',
      comparisonId: artifact.comparisonId,
      outputRoot: options.outputRoot,
      sourceRunIds: artifact.sourceRunIds,
      tables: artifact.tables.map((table) => ({
        taskId: table.taskId,
        paperTable: table.paperTable,
        rows: table.rows,
      })),
      figures: artifact.figures.map((figure) => ({
        taskId: figure.taskId,
        paperFigure: figure.paperFigure,
        filename: figure.filename,
      })),
      limitations: artifact.limitations,
    }),
  );
}

function parseOptions(argv: readonly string[]): {
  readonly comparisonId: string;
  readonly outputRoot: string;
  readonly runArtifactPaths: readonly string[];
} {
  let comparisonId: string | undefined;
  let outputRoot: string | undefined;
  const runArtifactPaths: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === '--') {
      continue;
    }
    const equalsIndex = token.indexOf('=');
    const name = equalsIndex < 0 ? token : token.slice(0, equalsIndex);
    const inlineValue = equalsIndex < 0 ? undefined : token.slice(equalsIndex + 1);
    const value = inlineValue ?? argv[index + 1];
    if (!['--comparison-id', '--output-root', '--run-artifact'].includes(name)) {
      throw new Error(`unknown option ${token}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${name} requires a value`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    if (name === '--comparison-id') {
      if (comparisonId !== undefined) {
        throw new Error('--comparison-id cannot be repeated');
      }
      comparisonId = requireNonEmpty(value, '--comparison-id');
    } else if (name === '--output-root') {
      if (outputRoot !== undefined) {
        throw new Error('--output-root cannot be repeated');
      }
      outputRoot = resolve(requireNonEmpty(value, '--output-root'));
    } else {
      runArtifactPaths.push(resolve(requireNonEmpty(value, '--run-artifact')));
    }
  }
  if (comparisonId === undefined) {
    throw new Error('--comparison-id is required');
  }
  if (outputRoot === undefined) {
    throw new Error('--output-root is required');
  }
  if (runArtifactPaths.length !== 12) {
    throw new Error('--run-artifact must be provided exactly 12 times for the 4x3 matrix');
  }
  return { comparisonId, outputRoot, runArtifactPaths };
}

function createHelp(): string {
  return [
    'Usage: pnpm --filter @aivilization/server paper-ablation-compare -- [options]',
    '',
    '  --comparison-id <id>    Immutable comparison artifact ID',
    '  --output-root <path>     Artifact repository root',
    '  --run-artifact <path>    Run artifact.json; repeat exactly 12 times',
    '',
    'The command rejects missing, duplicate, or confounded task/variant runs.',
  ].join('\n');
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  return normalized;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
