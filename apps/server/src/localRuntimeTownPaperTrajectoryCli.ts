import { isAbsolute, join, resolve } from 'node:path';
import { occupations } from '@aivilization/content';
import {
  FilePaperAgentTrajectoryArtifactRepository,
  FileSteeringTraceRepository,
  createPaperAgentTrajectoryArtifact,
  type PaperAgentTrajectoryArtifact,
  type PaperAgentTrajectoryRun,
  type SteeringTrace,
} from '@aivilization/observability';
import {
  createEducationInvestmentObservations,
  createGuidanceObservations,
  createOccupationTransitionObservations,
  createResidentialTransitionObservations,
  createTrajectorySnapshot,
} from '@aivilization/worker';
import { loadLocalRuntimeTownPaperEvidenceSource } from './localRuntimeTownPaperEvidenceSource';

export type LocalRuntimeTownPaperTrajectoryCliConfig = {
  readonly rootDir: string;
  readonly simulationId: string;
  readonly runManifestId: string;
  readonly analysisRunId: string;
  readonly generatedAt: number;
  readonly confirmedQuiescentSource: true;
};

export function resolveLocalRuntimeTownPaperTrajectoryCliConfig(input: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly now?: number;
} = {}): LocalRuntimeTownPaperTrajectoryCliConfig {
  const options = parseOptions(input.argv ?? []);
  if (!options.confirmQuiescentSource) {
    throw new Error('paper trajectory analysis requires --confirm-quiescent-source');
  }
  const cwd = input.cwd ?? process.cwd();
  return {
    rootDir: resolveRequiredPath(options.rootDir, cwd, 'root-dir'),
    simulationId: requireOption(options.simulationId, 'simulation-id'),
    runManifestId: requireOption(options.runManifestId, 'run-manifest-id'),
    analysisRunId: requireOption(options.analysisRunId, 'analysis-run-id'),
    generatedAt:
      options.generatedAt === undefined
        ? (input.now ?? Date.now())
        : parseNonNegativeFinite(options.generatedAt, 'generated-at'),
    confirmedQuiescentSource: true,
  };
}

export async function runLocalRuntimeTownPaperTrajectory(
  config: LocalRuntimeTownPaperTrajectoryCliConfig,
): Promise<{ readonly artifact: PaperAgentTrajectoryArtifact; readonly artifactRootDir: string }> {
  if (config.confirmedQuiescentSource !== true) {
    throw new Error('paper trajectory source must be explicitly confirmed quiescent');
  }
  const source = await loadLocalRuntimeTownPaperEvidenceSource({
    rootDir: config.rootDir,
    simulationId: config.simulationId,
    runManifestId: config.runManifestId,
  });
  const experimentStartedAt = requireSharedClock(
    source.partitions.map((partition) => partition.initialProjection.clock.now),
    'initial',
  );
  const experimentEndedAt = requireSharedClock(
    source.partitions.map((partition) => partition.finalProjection.clock.now),
    'final',
  );
  if (experimentEndedAt <= experimentStartedAt) {
    throw new Error('paper trajectory experiment must advance simulated time');
  }
  const run: PaperAgentTrajectoryRun = {
    runId: config.analysisRunId,
    simulationId: config.simulationId,
    runManifestId: source.runManifest.runManifestId,
    sourceRevision: { ...source.runManifest.payload.sourceRevision },
    seed: source.runManifest.payload.seed,
    experimentStartedAt,
    experimentEndedAt,
    generatedAt: config.generatedAt,
  };
  const occupationTierById = new Map(
    occupations.map((occupation) => [occupation.name, occupation.jobTier] as const),
  );
  const initialSnapshot = source.partitions.flatMap((partition) =>
    createTrajectorySnapshot(partition.initialProjection, experimentStartedAt, occupationTierById),
  );
  const finalSnapshot = source.partitions.flatMap((partition) =>
    createTrajectorySnapshot(partition.finalProjection, experimentEndedAt, occupationTierById),
  );
  const events = source.partitions.flatMap((partition) => partition.events);
  const steeringTraces = (
    await Promise.all(
      source.partitions.map(async (partition) => {
        const traces = await new FileSteeringTraceRepository({
          rootDir: partition.observabilityDir,
        }).query({
          simulationId: config.simulationId,
          partitionKey: partition.partitionKey,
          limit: Number.MAX_SAFE_INTEGER,
        });
        const simulatedTimeByCommandId = new Map<string, number>(
          partition.events.flatMap((event) =>
            event.commandId === undefined ? [] : [[event.commandId, event.occurredAt] as const],
          ),
        );
        return traces.map((trace) => ({
          ...trace,
          issuedAt:
            simulatedTimeByCommandId.get(trace.commandId) ??
            partition.toSimulatedTime(trace.issuedAt),
          recordedAt: partition.toSimulatedTime(trace.recordedAt),
        }));
      }),
    )
  ).flat() as SteeringTrace[];
  const artifact = createPaperAgentTrajectoryArtifact({
    run,
    initialSnapshot,
    finalSnapshot,
    guidance: createGuidanceObservations(steeringTraces, run),
    educationInvestments: createEducationInvestmentObservations(events),
    occupationTransitions: createOccupationTransitionObservations(events, occupationTierById),
    residentialTransitions: createResidentialTransitionObservations(events),
  });
  const artifactRootDir = join(config.rootDir, 'artifacts');
  const repository = new FilePaperAgentTrajectoryArtifactRepository({ rootDir: artifactRootDir });
  return { artifact: await repository.save(artifact), artifactRootDir };
}

export function hasLocalRuntimeTownPaperTrajectoryHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function createLocalRuntimeTownPaperTrajectoryCliHelp(): string {
  return [
    'Generate the paper planning-horizon trajectory analysis from a stopped runtime root.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server paper-trajectory -- [options]',
    '',
    'Required:',
    '  --root-dir <path>              Durable runtime root',
    '  --simulation-id <id>           Source simulation ID',
    '  --run-manifest-id <id>         Persisted resolved run manifest ID',
    '  --analysis-run-id <id>         Immutable output run ID',
    '  --confirm-quiescent-source     Confirm no process is mutating the runtime root',
    '',
    'Optional:',
    '  --generated-at <ms>            Artifact generation timestamp (default: now)',
    '  -h, --help                     Show this help',
    '',
    'The command reconstructs every partition, joins steering and transition evidence, and',
    'persists a manifest/source/seed-bound observational report. It never permits causal claims.',
  ].join('\n');
}

type ParsedOptions = {
  readonly rootDir?: string;
  readonly simulationId?: string;
  readonly runManifestId?: string;
  readonly analysisRunId?: string;
  readonly generatedAt?: string;
  readonly confirmQuiescentSource: boolean;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values: Record<string, string | undefined> = {};
  let confirmQuiescentSource = false;
  const names: Readonly<Record<string, string>> = {
    '--root-dir': 'rootDir',
    '--simulation-id': 'simulationId',
    '--run-manifest-id': 'runManifestId',
    '--analysis-run-id': 'analysisRunId',
    '--generated-at': 'generatedAt',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--confirm-quiescent-source') {
      confirmQuiescentSource = true;
      continue;
    }
    if (argument === '--' || argument === '--help' || argument === '-h') {
      continue;
    }
    const name = names[argument];
    if (name === undefined) {
      throw new Error(`unknown paper trajectory option ${argument}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`);
    }
    if (values[name] !== undefined) {
      throw new Error(`${argument} must not be repeated`);
    }
    values[name] = value;
    index += 1;
  }
  return { ...values, confirmQuiescentSource };
}

function requireSharedClock(values: readonly number[], label: string): number {
  const first = values[0];
  if (first === undefined || !values.every((value) => value === first)) {
    throw new Error(`paper trajectory requires one shared ${label} simulated clock`);
  }
  return first;
}

function resolveRequiredPath(value: string | undefined, cwd: string, name: string): string {
  const path = requireOption(value, name);
  return isAbsolute(path) ? resolve(path) : resolve(cwd, path);
}

function requireOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parseNonNegativeFinite(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}
