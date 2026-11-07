import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
/** Infrastructure checkpoint; never writes domain state. Atomic replacement preserves the last complete value. */
export function writeDurableComputeRecord(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  const fd = openSync(temporary, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
