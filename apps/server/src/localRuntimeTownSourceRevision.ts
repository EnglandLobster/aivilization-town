import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION,
  assertSourceWorkspaceFingerprint,
  cloneSourceRevision,
  type SourceRevision,
  type SourceWorkspaceFingerprint,
} from '@aivilization/sim-core';

const GIT_COMMAND_TIMEOUT_MS = 30_000;
const SHA256_PREFIX = 'sha256:';

export type LocalRuntimeTownSourceRevision = SourceRevision;

export function resolveLocalRuntimeTownSourceRevision(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
}): LocalRuntimeTownSourceRevision {
  if (input.env.AIVILIZATION_COMMIT !== undefined) {
    return normalizeLocalRuntimeTownSourceRevision({
      commit: input.env.AIVILIZATION_COMMIT,
      dirty: parseOptionalBoolean(input.env.AIVILIZATION_SOURCE_DIRTY, false),
      ...resolvePackagedWorkspaceFingerprint(input.env),
    });
  }
  try {
    const gitRoot = runGitText(input.cwd, ['rev-parse', '--show-toplevel']);
    const commit = runGitText(gitRoot, ['rev-parse', 'HEAD']);
    const dirty =
      runGitText(gitRoot, ['status', '--porcelain=v1', '--untracked-files=normal']).length > 0;
    return normalizeLocalRuntimeTownSourceRevision({
      commit,
      dirty,
      ...(dirty ? { workspaceFingerprint: createGitWorkspaceFingerprint(gitRoot) } : {}),
    });
  } catch (error) {
    throw new Error(
      'source revision unavailable; run inside a Git worktree or set AIVILIZATION_COMMIT',
      { cause: error },
    );
  }
}

export function normalizeLocalRuntimeTownSourceRevision(
  sourceRevision: LocalRuntimeTownSourceRevision,
): LocalRuntimeTownSourceRevision {
  const commit = requireNonEmpty(sourceRevision.commit, 'sourceRevision.commit').toLowerCase();
  if (!/^[a-f0-9]{40}([a-f0-9]{24})?$/u.test(commit)) {
    throw new Error('sourceRevision.commit must be a 40- or 64-character hexadecimal commit ID');
  }
  if (typeof sourceRevision.dirty !== 'boolean') {
    throw new Error('sourceRevision.dirty must be a boolean');
  }
  if (sourceRevision.workspaceFingerprint !== undefined) {
    assertSourceWorkspaceFingerprint(
      sourceRevision.workspaceFingerprint,
      'sourceRevision.workspaceFingerprint',
    );
  }
  if (sourceRevision.dirty && sourceRevision.workspaceFingerprint === undefined) {
    throw new Error('dirty sourceRevision requires a content-addressed workspaceFingerprint');
  }
  return cloneSourceRevision({
    commit,
    dirty: sourceRevision.dirty,
    ...(sourceRevision.workspaceFingerprint === undefined
      ? {}
      : { workspaceFingerprint: sourceRevision.workspaceFingerprint }),
  });
}

export function createGitWorkspaceFingerprint(gitRoot: string): SourceWorkspaceFingerprint {
  const root = runGitText(gitRoot, ['rev-parse', '--show-toplevel']);
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    gitOptions(root, 'buffer'),
  );
  const paths = splitNullTerminated(listed).sort((left, right) => Buffer.compare(left, right));
  const aggregate = createHash('sha256');
  aggregate.update(`${GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION}\0`, 'utf8');
  for (const pathBytes of paths) {
    const relativePath = decodeGitPath(pathBytes);
    const absolutePath = resolve(root, relativePath);
    const entryHash = createHash('sha256');
    let kind: 'deleted' | 'file' | 'symlink';
    let executable = false;
    try {
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        kind = 'symlink';
        entryHash.update(readlinkSync(absolutePath), 'utf8');
      } else if (stats.isFile()) {
        kind = 'file';
        executable = (stats.mode & 0o111) !== 0;
        entryHash.update(readFileSync(absolutePath));
      } else {
        throw new Error(`workspace fingerprint only supports files and symlinks: ${relativePath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        kind = 'deleted';
        entryHash.update('deleted', 'utf8');
      } else {
        throw error;
      }
    }
    updateLengthPrefixed(aggregate, pathBytes);
    updateLengthPrefixed(aggregate, Buffer.from(kind, 'utf8'));
    updateLengthPrefixed(aggregate, Buffer.from(executable ? 'executable' : 'non-executable'));
    updateLengthPrefixed(aggregate, entryHash.digest());
  }
  return {
    policyVersion: GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION,
    sha256: `${SHA256_PREFIX}${aggregate.digest('hex')}`,
    pathCount: paths.length,
  };
}

function resolvePackagedWorkspaceFingerprint(
  env: Readonly<Record<string, string | undefined>>,
): Pick<LocalRuntimeTownSourceRevision, 'workspaceFingerprint'> | Record<string, never> {
  const digest = env.AIVILIZATION_SOURCE_WORKSPACE_SHA256;
  const pathCount = env.AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT;
  if (digest === undefined && pathCount === undefined) {
    return {};
  }
  if (digest === undefined || pathCount === undefined) {
    throw new Error(
      'AIVILIZATION_SOURCE_WORKSPACE_SHA256 and AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT must be provided together',
    );
  }
  const normalizedDigest = digest.startsWith(SHA256_PREFIX) ? digest : `${SHA256_PREFIX}${digest}`;
  const parsedPathCount = Number(pathCount);
  const workspaceFingerprint = {
    policyVersion: GIT_WORKSPACE_FINGERPRINT_POLICY_VERSION,
    sha256: normalizedDigest,
    pathCount: parsedPathCount,
  };
  assertSourceWorkspaceFingerprint(workspaceFingerprint);
  return { workspaceFingerprint };
}

function splitNullTerminated(value: Buffer): Buffer[] {
  const paths: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) {
      continue;
    }
    if (index > start) {
      paths.push(value.subarray(start, index));
    }
    start = index + 1;
  }
  if (start !== value.length) {
    throw new Error('git ls-files output must be NUL terminated');
  }
  return paths;
}

function decodeGitPath(pathBytes: Buffer): string {
  const value = pathBytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(pathBytes)) {
    throw new Error('workspace fingerprint requires UTF-8 Git paths');
  }
  return value;
}

function updateLengthPrefixed(hash: ReturnType<typeof createHash>, value: Buffer): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.length));
  hash.update(length);
  hash.update(value);
}

function runGitText(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], gitOptions(cwd, 'utf8')).trim();
}

function gitOptions(cwd: string, encoding: 'utf8'): {
  readonly cwd: string;
  readonly encoding: 'utf8';
  readonly stdio: ['ignore', 'pipe', 'ignore'];
  readonly timeout: number;
};
function gitOptions(cwd: string, encoding: 'buffer'): {
  readonly cwd: string;
  readonly encoding: 'buffer';
  readonly stdio: ['ignore', 'pipe', 'ignore'];
  readonly timeout: number;
};
function gitOptions(cwd: string, encoding: 'utf8' | 'buffer') {
  return {
    cwd,
    encoding,
    stdio: ['ignore', 'pipe', 'ignore'] as const,
    timeout: GIT_COMMAND_TIMEOUT_MS,
  };
}

function parseOptionalBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error('AIVILIZATION_SOURCE_DIRTY must be true or false');
}

function requireNonEmpty(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  return value.trim();
}

function isMissingPathError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}
