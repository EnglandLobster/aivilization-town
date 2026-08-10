import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createLocalRuntimeTownParticipantDataLifecycleRequest,
  readLocalRuntimeTownParticipantDataLifecycleState,
  recordLocalRuntimeTownParticipantDataAnonymizedCopyActivated,
  recordLocalRuntimeTownParticipantDataAnonymizedCopyPrepared,
  retireDueLocalRuntimeTownParticipantDataCopies,
  type LocalRuntimeTownParticipantDataLifecycleState,
} from './localRuntimeTownParticipantDataLifecycle';

const DAY_MS = 24 * 60 * 60 * 1_000;

export type LocalRuntimeTownParticipantDataLifecycleCliConfig =
  | {
      readonly operation: 'request';
      readonly auditRootDir: string;
      readonly participantSubjectId: string;
      readonly auditHmacKey: Uint8Array;
      readonly sourceRootDir: string;
      readonly backupRootDirs: readonly string[];
      readonly directIdentityRetentionMs: number;
      readonly backupRetentionMs: number;
      readonly sourceWritersConfirmedStopped: true;
    }
  | {
      readonly operation: 'prepare';
      readonly auditRootDir: string;
      readonly requestId: string;
      readonly targetRootDir: string;
    }
  | {
      readonly operation: 'activate';
      readonly auditRootDir: string;
      readonly requestId: string;
      readonly targetRootDir: string;
      readonly resolvedRunManifestId: string;
      readonly activationConfirmed: true;
    }
  | {
      readonly operation: 'retire-due';
      readonly auditRootDir: string;
      readonly requestId: string;
      readonly sourceWritersConfirmedStopped: true;
      readonly irreversibleRetirementConfirmed: true;
    }
  | {
      readonly operation: 'status';
      readonly auditRootDir: string;
      readonly requestId: string;
    };

export function resolveLocalRuntimeTownParticipantDataLifecycleCliConfig(
  input: { readonly argv?: readonly string[]; readonly cwd?: string } = {},
): LocalRuntimeTownParticipantDataLifecycleCliConfig {
  const argv = (input.argv ?? []).filter((token) => token !== '--');
  const cwd = input.cwd ?? process.cwd();
  const operation = argv[0];
  if (
    operation !== 'request' &&
    operation !== 'prepare' &&
    operation !== 'activate' &&
    operation !== 'retire-due' &&
    operation !== 'status'
  ) {
    throw new Error(
      'participant data lifecycle operation must be request, prepare, activate, retire-due, or status',
    );
  }
  const options = parseOptions(argv.slice(1));
  const auditRootDir = resolve(cwd, takeOne(options, '--audit-root-dir'));
  if (operation === 'request') {
    const participantSubjectId = readNonEmptyFile(
      resolve(cwd, takeOne(options, '--subject-id-file')),
      '--subject-id-file',
    );
    const auditHmacKey = readBase64AuditKey(resolve(cwd, takeOne(options, '--audit-key-file')));
    const sourceRootDir = resolve(cwd, takeOne(options, '--source-root-dir'));
    const backupRootDirs = takeMany(options, '--backup-root-dir').map((path) => resolve(cwd, path));
    const directIdentityRetentionMs = parseRetentionDays(
      takeOne(options, '--direct-retention-days'),
      '--direct-retention-days',
    );
    const backupRetentionMs = parseRetentionDays(
      takeOne(options, '--backup-retention-days'),
      '--backup-retention-days',
    );
    takeFlag(options, '--confirm-copy-writers-stopped');
    assertNoOptions(options);
    return {
      operation,
      auditRootDir,
      participantSubjectId,
      auditHmacKey,
      sourceRootDir,
      backupRootDirs,
      directIdentityRetentionMs,
      backupRetentionMs,
      sourceWritersConfirmedStopped: true,
    };
  }
  const requestId = takeOne(options, '--request-id');
  if (operation === 'prepare') {
    const targetRootDir = resolve(cwd, takeOne(options, '--target-root-dir'));
    assertNoOptions(options);
    return { operation, auditRootDir, requestId, targetRootDir };
  }
  if (operation === 'activate') {
    const targetRootDir = resolve(cwd, takeOne(options, '--target-root-dir'));
    const resolvedRunManifestId = takeOne(options, '--resolved-run-manifest-id');
    takeFlag(options, '--confirm-activated-and-healthy');
    assertNoOptions(options);
    return {
      operation,
      auditRootDir,
      requestId,
      targetRootDir,
      resolvedRunManifestId,
      activationConfirmed: true,
    };
  }
  if (operation === 'retire-due') {
    takeFlag(options, '--confirm-copy-writers-stopped');
    takeFlag(options, '--confirm-irreversible-retirement');
    assertNoOptions(options);
    return {
      operation,
      auditRootDir,
      requestId,
      sourceWritersConfirmedStopped: true,
      irreversibleRetirementConfirmed: true,
    };
  }
  assertNoOptions(options);
  return { operation, auditRootDir, requestId };
}

export function runLocalRuntimeTownParticipantDataLifecycleCli(
  config: LocalRuntimeTownParticipantDataLifecycleCliConfig,
): LocalRuntimeTownParticipantDataLifecycleState {
  if (config.operation === 'request') {
    return createLocalRuntimeTownParticipantDataLifecycleRequest(config);
  }
  if (config.operation === 'prepare') {
    return recordLocalRuntimeTownParticipantDataAnonymizedCopyPrepared(config);
  }
  if (config.operation === 'activate') {
    return recordLocalRuntimeTownParticipantDataAnonymizedCopyActivated({
      ...config,
      healthVerifiedAt: Date.now(),
    });
  }
  if (config.operation === 'retire-due') {
    return retireDueLocalRuntimeTownParticipantDataCopies(config);
  }
  return readLocalRuntimeTownParticipantDataLifecycleState(config);
}

export function createLocalRuntimeTownParticipantDataLifecycleCliHelp(): string {
  return [
    'Audit and enforce the participant deletion lifecycle and retention deadlines.',
    '',
    'Operations:',
    '  request --audit-root-dir DIR --subject-id-file FILE --audit-key-file FILE',
    '          --source-root-dir DIR [--backup-root-dir DIR ...]',
    '          --direct-retention-days N --backup-retention-days N',
    '          --confirm-copy-writers-stopped',
    '  prepare --audit-root-dir DIR --request-id ID --target-root-dir DIR',
    '  activate --audit-root-dir DIR --request-id ID --target-root-dir DIR',
    '           --resolved-run-manifest-id ID --confirm-activated-and-healthy',
    '  retire-due --audit-root-dir DIR --request-id ID',
    '             --confirm-copy-writers-stopped --confirm-irreversible-retirement',
    '  status --audit-root-dir DIR --request-id ID',
    '',
    'The audit key file must contain at least 32 random bytes encoded as base64.',
    'request records only a keyed subject reference; retire-due deletes only registered,',
    'unchanged, deadline-expired copies after an anonymized target was activated.',
  ].join('\n');
}

type ParsedOptions = Map<string, string[]>;

function parseOptions(argv: readonly string[]): ParsedOptions {
  const options: ParsedOptions = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--'))
      throw new Error(`unexpected participant lifecycle argument ${token}`);
    const separator = token.indexOf('=');
    const name = separator < 0 ? token : token.slice(0, separator);
    const inline = separator < 0 ? undefined : token.slice(separator + 1);
    const flag =
      name === '--confirm-activated-and-healthy' ||
      name === '--confirm-copy-writers-stopped' ||
      name === '--confirm-irreversible-retirement';
    const value = flag ? 'true' : (inline ?? argv[index + 1]);
    if (value === undefined || (!flag && value.startsWith('--')) || value.length === 0) {
      throw new Error(`${name} requires a non-empty value`);
    }
    if (!flag && inline === undefined) index += 1;
    options.set(name, [...(options.get(name) ?? []), value]);
  }
  return options;
}

function takeOne(options: ParsedOptions, name: string): string {
  const values = options.get(name);
  options.delete(name);
  if (values === undefined || values.length !== 1)
    throw new Error(`${name} is required exactly once`);
  return values[0]!;
}

function takeMany(options: ParsedOptions, name: string): readonly string[] {
  const values = options.get(name) ?? [];
  options.delete(name);
  return values;
}

function takeFlag(options: ParsedOptions, name: string): void {
  const values = options.get(name);
  options.delete(name);
  if (values === undefined || values.length !== 1)
    throw new Error(`${name} is required exactly once`);
}

function assertNoOptions(options: ParsedOptions): void {
  const names = [...options.keys()];
  if (names.length > 0) throw new Error(`unknown participant lifecycle option ${names[0]}`);
}

function readNonEmptyFile(path: string, optionName: string): string {
  const stats = statSync(path);
  if (!stats.isFile()) throw new Error(`${optionName} must reference a regular file`);
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(`${optionName} must not grant group or other filesystem permissions`);
  }
  const value = readFileSync(path, 'utf8').trim();
  if (value.length === 0) throw new Error(`${optionName} must contain a non-empty value`);
  return value;
}

function readBase64AuditKey(path: string): Uint8Array {
  const encoded = readNonEmptyFile(path, '--audit-key-file');
  const key = Buffer.from(encoded, 'base64');
  if (
    key.length < 32 ||
    key.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '')
  ) {
    throw new Error('--audit-key-file must contain at least 32 valid base64-encoded bytes');
  }
  return key;
}

function parseRetentionDays(value: string, optionName: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new Error(`${optionName} must be a positive integer`);
  const duration = Number(value) * DAY_MS;
  if (!Number.isSafeInteger(duration)) throw new Error(`${optionName} is too large`);
  return duration;
}
