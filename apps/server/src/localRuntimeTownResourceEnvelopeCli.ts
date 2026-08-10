import { isAbsolute, resolve } from 'node:path';
import {
  FileRuntimeResourceEnvelopeAssessmentRepository,
  FileRuntimeSoakEvidenceRepository,
  createRuntimeResourceEnvelopeAssessmentArtifact,
  type RuntimeResourceEnvelopeAssessmentArtifact,
} from '@aivilization/observability';

export type LocalRuntimeTownResourceEnvelopeCliConfig = {
  readonly artifactRootDir: string;
  readonly sourceArtifactIds: readonly string[];
};

export function resolveLocalRuntimeTownResourceEnvelopeCliConfig(
  input: { readonly argv?: readonly string[]; readonly cwd?: string } = {},
): LocalRuntimeTownResourceEnvelopeCliConfig {
  const argv = input.argv ?? [];
  const cwd = input.cwd ?? process.cwd();
  let artifactRootDir = '.aivilization/soak-artifacts';
  const sourceArtifactIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--' || argument === '--help' || argument === '-h') {
      continue;
    }
    const equalsIndex = argument.indexOf('=');
    const optionName = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex);
    if (optionName !== '--artifact-root-dir' && optionName !== '--source-artifact-id') {
      throw new Error(`unknown runtime resource envelope option ${argument}`);
    }
    const inlineValue = equalsIndex < 0 ? undefined : argument.slice(equalsIndex + 1);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
      throw new Error(`${optionName} requires a non-empty value`);
    }
    if (optionName === '--artifact-root-dir') {
      if (artifactRootDir !== '.aivilization/soak-artifacts') {
        throw new Error('--artifact-root-dir must not be repeated');
      }
      artifactRootDir = value;
    } else {
      assertRuntimeSoakArtifactId(value);
      sourceArtifactIds.push(value);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  if (sourceArtifactIds.length !== 3) {
    throw new Error('--source-artifact-id must be supplied exactly three times');
  }
  if (new Set(sourceArtifactIds).size !== sourceArtifactIds.length) {
    throw new Error('--source-artifact-id values must be unique');
  }
  return {
    artifactRootDir: resolvePath(artifactRootDir, cwd),
    sourceArtifactIds,
  };
}

export async function runLocalRuntimeTownResourceEnvelopeCli(
  config: LocalRuntimeTownResourceEnvelopeCliConfig,
): Promise<RuntimeResourceEnvelopeAssessmentArtifact> {
  const sourceRepository = new FileRuntimeSoakEvidenceRepository({
    rootDir: config.artifactRootDir,
  });
  const sourceArtifacts = await Promise.all(
    config.sourceArtifactIds.map(async (artifactId) => {
      const artifact = await sourceRepository.get(artifactId);
      if (artifact === undefined) {
        throw new Error(`runtime soak evidence artifact not found: ${artifactId}`);
      }
      return artifact;
    }),
  );
  const assessment = createRuntimeResourceEnvelopeAssessmentArtifact(sourceArtifacts);
  return new FileRuntimeResourceEnvelopeAssessmentRepository({
    rootDir: config.artifactRootDir,
  }).save(assessment);
}

export function hasLocalRuntimeTownResourceEnvelopeHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

export function createLocalRuntimeTownResourceEnvelopeCliHelp(): string {
  return [
    'Regrade an immutable SCALE-001 profile matrix against the versioned resource envelope.',
    '',
    'Usage:',
    '  pnpm regrade:runtime-resource-envelope -- [options]',
    '',
    'Required:',
    '  --source-artifact-id <id>  Repeat exactly three times, once per canonical profile',
    '',
    'Optional:',
    '  --artifact-root-dir <path> Source and derived evidence repository root',
    '  -h, --help                 Show this help',
    '',
    'The policy is a repository design decision for a 4-vCPU/4-GiB/25-GiB reference class.',
    'It assesses observed single-process backend usage only; it does not establish resource-limit',
    'enforcement, full-provider capacity, the paper deployment, or the proposed million-agent scale.',
  ].join('\n');
}

function assertRuntimeSoakArtifactId(value: string): void {
  if (!/^runtime-soak-evidence:sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error('--source-artifact-id must be a content-addressed runtime soak evidence ID');
  }
}

function resolvePath(value: string, cwd: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}
