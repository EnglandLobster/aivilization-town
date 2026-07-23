import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deleteLocalRuntimeTownParticipantData,
  type LocalRuntimeTownParticipantDataDeletionArtifact,
} from './localRuntimeTownParticipantDataDeletion';

export type LocalRuntimeTownParticipantDataDeletionCliConfig = {
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
  readonly participantSubjectId: string;
  readonly sourceWriterConfirmedStopped: true;
};

export function resolveLocalRuntimeTownParticipantDataDeletionCliConfig(
  input: {
    readonly argv?: readonly string[];
    readonly cwd?: string;
  } = {},
): LocalRuntimeTownParticipantDataDeletionCliConfig {
  const argv = input.argv ?? [];
  const cwd = input.cwd ?? process.cwd();
  let sourceRootDir: string | undefined;
  let targetRootDir: string | undefined;
  let subjectIdFile: string | undefined;
  let sourceWriterConfirmedStopped = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || token === '--') continue;
    if (token === '--confirm-source-stopped') {
      if (sourceWriterConfirmedStopped) {
        throw new Error('--confirm-source-stopped cannot be repeated');
      }
      sourceWriterConfirmedStopped = true;
      continue;
    }
    const option = token.split('=', 1)[0];
    if (
      option !== '--source-root-dir' &&
      option !== '--target-root-dir' &&
      option !== '--subject-id-file'
    ) {
      throw new Error(`unknown participant data deletion option ${token}`);
    }
    const inlineValue = token.includes('=') ? token.slice(token.indexOf('=') + 1) : undefined;
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
      throw new Error(`${option} requires a non-empty value`);
    }
    if (option === '--source-root-dir') {
      if (sourceRootDir !== undefined) throw new Error('--source-root-dir cannot be repeated');
      sourceRootDir = resolve(cwd, value);
    } else if (option === '--target-root-dir') {
      if (targetRootDir !== undefined) throw new Error('--target-root-dir cannot be repeated');
      targetRootDir = resolve(cwd, value);
    } else {
      if (subjectIdFile !== undefined) throw new Error('--subject-id-file cannot be repeated');
      subjectIdFile = resolve(cwd, value);
    }
    if (inlineValue === undefined) index += 1;
  }
  if (sourceRootDir === undefined || targetRootDir === undefined || subjectIdFile === undefined) {
    throw new Error('--source-root-dir, --target-root-dir and --subject-id-file are required');
  }
  if (!sourceWriterConfirmedStopped) {
    throw new Error('--confirm-source-stopped is required for offline participant data deletion');
  }
  const participantSubjectId = readFileSync(subjectIdFile, 'utf8').trim();
  if (participantSubjectId.length === 0) {
    throw new Error('--subject-id-file must contain a non-empty participant subject ID');
  }
  return {
    sourceRootDir,
    targetRootDir,
    participantSubjectId,
    sourceWriterConfirmedStopped: true,
  };
}

export function runLocalRuntimeTownParticipantDataDeletionCli(
  config: LocalRuntimeTownParticipantDataDeletionCliConfig,
): LocalRuntimeTownParticipantDataDeletionArtifact {
  return deleteLocalRuntimeTownParticipantData(config);
}

export function createLocalRuntimeTownParticipantDataDeletionCliHelp(): string {
  return [
    'Create a replay-safe anonymized copy of an offline runtime root for one participant.',
    '',
    'Usage:',
    '  pnpm --filter @aivilization/server delete-participant-data -- \\',
    '    --source-root-dir /path/to/stopped-root \\',
    '    --target-root-dir /path/to/anonymized-root \\',
    '    --subject-id-file /secure/path/subject-id.txt \\',
    '    --confirm-source-stopped',
    '',
    'The subject ID is read from a file so it is not exposed in the process list.',
    'The source remains untouched; activation of the validated target is a separate deployment step.',
  ].join('\n');
}
