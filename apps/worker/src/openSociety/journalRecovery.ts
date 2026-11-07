import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

export type JournalRecoveryReport = {
  readonly version: 'open-society-tail-recovery-v1';
  readonly action: 'unchanged' | 'removed-incomplete-tail' | 'completed-record-newline';
  readonly throughRevision: number;
  readonly originalBytes: number;
  readonly recoveredBytes: number;
  readonly originalSha256: string;
  readonly recoveredSha256: string;
  readonly backupPath?: string;
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function syncFile(path: string) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Caller holds the journal writer lock and has replayed every retained commit before entering. */
export function preserveAndReplaceJournal(
  root: string,
  original: Buffer,
  recovered: Buffer,
  throughRevision: number,
  action: JournalRecoveryReport['action'],
): JournalRecoveryReport {
  const originalSha256 = hash(original),
    recoveredSha256 = hash(recovered);
  const report = {
    version: 'open-society-tail-recovery-v1' as const,
    action,
    throughRevision,
    originalBytes: original.length,
    recoveredBytes: recovered.length,
    originalSha256,
    recoveredSha256,
  };
  if (action === 'unchanged') return report;
  const backupPath = join(root, `journal-recovery-${originalSha256}.original`);
  if (existsSync(backupPath)) {
    if (!readFileSync(backupPath).equals(original)) throw Error('journal-recovery-backup-conflict');
  } else writeFileSync(backupPath, original, { flag: 'wx', mode: 0o600 });
  syncFile(backupPath);
  // Durable evidence precedes replacement. This is an intent, not a claim that the rename happened.
  const intentPath = `${backupPath}.intent.json`;
  const intent = Buffer.from(
    JSON.stringify({ ...report, backupPath, status: 'replacement-prepared' }),
  );
  if (existsSync(intentPath)) {
    if (!readFileSync(intentPath).equals(intent)) throw Error('journal-recovery-intent-conflict');
  } else writeFileSync(intentPath, intent, { flag: 'wx', mode: 0o600 });
  syncFile(intentPath);
  syncFile(root);
  const temporary = join(root, `.journal-recovery-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, recovered, { flag: 'wx', mode: 0o600 });
    syncFile(temporary);
    renameSync(temporary, join(root, 'journal.jsonl'));
    syncFile(root);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { ...report, backupPath };
}
