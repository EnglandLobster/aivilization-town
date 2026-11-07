import { OpenSocietyJournal, digest } from './journal';
import type { OpenSocietyCommit, OpenSocietyManifest } from './types';

export const SOCIETY_COMMIT_DELIVERY_VERSION = 'society-commit-delivery-v1';
export type SocietyCommitCursor = { readonly sequence: number; readonly hash: string };
export type SocietyCommitPage = {
  readonly version: typeof SOCIETY_COMMIT_DELIVERY_VERSION;
  readonly manifestHash: string;
  readonly after: SocietyCommitCursor;
  readonly next: SocietyCommitCursor;
  readonly records: readonly OpenSocietyCommit[];
};
function cursor(journal: OpenSocietyJournal, sequence: number): SocietyCommitCursor {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > journal.state.revision)
    throw Error('invalid-society-commit-cursor');
  return {
    sequence,
    hash: sequence === 0 ? digest(journal.manifest) : journal.hashAt(sequence),
  };
}
/** Trusted infrastructure feed contains private original texts; never expose with resident credentials. */
export function readSocietyCommitPage(
  journal: OpenSocietyJournal,
  after: SocietyCommitCursor,
  limit = 32,
): SocietyCommitPage {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw Error('invalid-delivery-limit');
  const expected = cursor(journal, after.sequence);
  if (expected.hash !== after.hash) throw Error('society-commit-cursor-conflict');
  const records = journal.readCommits(after.sequence + 1, limit);
  return structuredClone({
    version: SOCIETY_COMMIT_DELIVERY_VERSION,
    manifestHash: digest(journal.manifest),
    after: expected,
    next: cursor(journal, after.sequence + records.length),
    records,
  });
}

/** Read replica; durable cursor follows fsynced complete commits, never decisions or side effects. */
export class SocietyCommitReplica {
  private readonly journal: OpenSocietyJournal;
  constructor(root: string, manifest?: OpenSocietyManifest) {
    this.journal = new OpenSocietyJournal(root, manifest, { replica: true });
  }
  get state() {
    return this.journal.state;
  }
  get cursor(): SocietyCommitCursor {
    return cursor(this.journal, this.journal.state.revision);
  }
  receive(page: SocietyCommitPage): SocietyCommitCursor {
    if (
      page.version !== SOCIETY_COMMIT_DELIVERY_VERSION ||
      page.manifestHash !== digest(this.journal.manifest)
    )
      throw Error('society-delivery-world-mismatch');
    const records: readonly OpenSocietyCommit[] = page.records;
    if (!Array.isArray(page.records) || page.records.length > 64)
      throw Error('invalid-delivery-page');
    const expected = cursor(this.journal, page.after.sequence);
    if (expected.hash !== page.after.hash) throw Error('society-commit-cursor-conflict');
    let previous = page.after;
    // Validate page framing before publication; domain validation remains per atomic commit.
    for (const record of records) {
      if (record.sequence !== previous.sequence + 1 || record.previousHash !== previous.hash)
        throw Error('invalid-delivery-chain');
      const { hash, ...body } = record;
      if (hash !== digest(body)) throw Error('invalid-open-society-journal-hash');
      previous = { sequence: record.sequence, hash };
    }
    if (page.next.sequence !== previous.sequence || page.next.hash !== previous.hash)
      throw Error('invalid-delivery-next-cursor');
    for (const record of records) this.journal.receive(record);
    return this.cursor;
  }
  close() {
    this.journal.close();
  }
}
