import { randomUUID } from 'node:crypto';
import { writeDurableComputeRecord } from './durableComputeRecord';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResidentPartitionConfiguration } from './partitionExecution';
/** Static infrastructure ownership, never social authority. Tokens may rotate without moving residents. */
export function bindResidentPartitions(
  root: string,
  configuration: ResidentPartitionConfiguration,
) {
  const value = JSON.stringify({
    version: configuration.version,
    partitions: configuration.partitions
      .map((p) => ({ id: p.id, actors: [...p.actors].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
  const path = join(root, 'partition-bindings.json');
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== value) throw Error('partition-bindings-conflict');
    return;
  }
  writeFileSync(path, value, { flag: 'wx', mode: 0o600 });
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directory = openSync(root, 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function residentPartitionAuthorityId(root: string): string {
  const path = join(root, 'partition-authority-id.json');
  if (!existsSync(path))
    writeDurableComputeRecord(path, { version: 'partition-authority-id-v1', id: randomUUID() });
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    value === null ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 'partition-authority-id-v1' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(value.id)
  )
    throw Error('invalid-partition-authority-id');
  return value.id;
}
