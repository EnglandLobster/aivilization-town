import { resolve } from 'node:path';
import {
  resolveLocalRuntimeTownCliConfig,
  type LocalRuntimeTownSourceRevision,
} from './localRuntimeTownCli';
import {
  migrateLocalRuntimeTownDataV1ToV2,
  type LocalRuntimeTownDataMigrationArtifact,
} from './localRuntimeTownDataMigration';

export type LocalRuntimeTownDataMigrationCliConfig = {
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly sourceWriterConfirmedStopped: true;
};

export function resolveLocalRuntimeTownDataMigrationCliConfig(input: {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly sourceRevision?: LocalRuntimeTownSourceRevision;
} = {}): LocalRuntimeTownDataMigrationCliConfig {
  const argv = input.argv ?? [];
  const cwd = input.cwd ?? process.cwd();
  let sourceRootDir: string | undefined;
  let targetRootDir: string | undefined;
  let sourceWriterConfirmedStopped = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === '--') {
      continue;
    }
    if (token === '--confirm-source-stopped') {
      if (sourceWriterConfirmedStopped) {
        throw new Error('--confirm-source-stopped cannot be repeated');
      }
      sourceWriterConfirmedStopped = true;
      continue;
    }
    const option = token.split('=', 1)[0];
    if (option !== '--source-root-dir' && option !== '--target-root-dir') {
      throw new Error(`unknown data migration option ${token}`);
    }
    const inlineValue = token.includes('=') ? token.slice(token.indexOf('=') + 1) : undefined;
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
      throw new Error(`${option} requires a non-empty value`);
    }
    if (option === '--source-root-dir') {
      if (sourceRootDir !== undefined) {
        throw new Error('--source-root-dir cannot be repeated');
      }
      sourceRootDir = resolve(cwd, value);
    } else {
      if (targetRootDir !== undefined) {
        throw new Error('--target-root-dir cannot be repeated');
      }
      targetRootDir = resolve(cwd, value);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
  }
  if (sourceRootDir === undefined || targetRootDir === undefined) {
    throw new Error('--source-root-dir and --target-root-dir are required');
  }
  if (!sourceWriterConfirmedStopped) {
    throw new Error('--confirm-source-stopped is required for offline copy-on-write migration');
  }
  const sourceRevision =
    input.sourceRevision ??
    resolveLocalRuntimeTownCliConfig({
      argv: ['--llm-mode', 'deterministic', '--port', '0'],
      cwd,
    }).sourceRevision;
  return {
    sourceRootDir,
    targetRootDir,
    sourceRevision,
    sourceWriterConfirmedStopped: true,
  };
}

export function runLocalRuntimeTownDataMigrationCli(
  config: LocalRuntimeTownDataMigrationCliConfig,
): LocalRuntimeTownDataMigrationArtifact {
  return migrateLocalRuntimeTownDataV1ToV2(config);
}

export function createLocalRuntimeTownDataMigrationCliHelp(): string {
  return [
    'Migrate an offline layout-v1 runtime root into a new layout-v2 copy.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server migrate-data-v1-to-v2 -- \\',
    '    --source-root-dir /path/to/stopped-v1 \\',
    '    --target-root-dir /path/to/new-v2 \\',
    '    --confirm-source-stopped',
    '',
    'The source is hashed before and after copying and is never modified.',
    'The target must be separate and non-nested; it is published only after validation.',
  ].join('\n');
}
