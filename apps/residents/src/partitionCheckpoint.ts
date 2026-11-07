import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import { join } from 'node:path';
import type { OpenAgentDriver } from '@aivilization/agent-runtime';
import { RESIDENT_CLI_VERSION } from './cliCatalog';
import { writeDurableComputeRecord } from './durableComputeRecord';
type Result = Awaited<ReturnType<OpenAgentDriver['run']>>;
export function bindPartitionComputeDirectory(
  root: string,
  authorityId: string,
  partitionId: string,
) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const path = join(root, 'partition-worker-binding.json');
  const value = JSON.stringify({
    version: 'partition-worker-binding-v1',
    authorityId,
    partitionId,
  });
  if (!existsSync(path)) {
    try {
      writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
  if (readFileSync(path, 'utf8') !== value) throw Error('partition-compute-directory-mismatch');
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dir = openSync(root, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function readPartitionResult(
  directory: string,
  actorId: string,
  turnId: string,
  authorityId: string,
): Result | undefined {
  const path = join(directory, 'partition-result.json');
  if (!existsSync(path)) return;
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 'partition-result-v1' ||
    !('actorId' in value) ||
    !('turnId' in value) ||
    !('result' in value)
  )
    throw Error('invalid-partition-result-checkpoint');
  if (!('authorityId' in value) || value.authorityId !== authorityId)
    throw Error('partition-result-authority-mismatch');
  if (value.actorId !== actorId || value.turnId !== turnId) return;
  const result = value.result;
  if (
    !result ||
    typeof result !== 'object' ||
    !('status' in result) ||
    !['completed', 'provider-error'].includes(String(result.status)) ||
    !('summary' in result) ||
    typeof result.summary !== 'string' ||
    ('sessionId' in result && typeof result.sessionId !== 'string')
  )
    throw Error('invalid-partition-result-checkpoint');
  return result as Result;
}
export function writePartitionResult(
  directory: string,
  actorId: string,
  turnId: string,
  result: Result,
  authorityId: string,
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeDurableComputeRecord(join(directory, 'partition-result.json'), {
    version: 'partition-result-v1',
    authorityId,
    actorId,
    turnId,
    result,
  });
}
export function observedPartitionSession(
  directory: string,
  actorId: string,
  turnId: string,
  authorityId: string,
): string | undefined {
  const path = join(directory, 'observed-session.json');
  if (!existsSync(path)) return;
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version === RESIDENT_CLI_VERSION &&
    'scope' in value &&
    value.scope === authorityId &&
    'actorId' in value &&
    value.actorId === actorId &&
    'turnId' in value &&
    value.turnId === turnId &&
    'sessionId' in value &&
    typeof value.sessionId === 'string'
  )
    return value.sessionId;
}
