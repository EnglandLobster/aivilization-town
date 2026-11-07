import { canonicalHistoricalRequestIds } from '../canonicalRequestHistory';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { assertOpenAgentPolicy, type OpenToolResult } from '@aivilization/agent-runtime';
import { assertInformationPolicy } from '@aivilization/information';
import { applyOpenSocietyCommit, initialOpenSocietyState } from './state';
import {
  OPEN_SOCIETY_SCHEMA_VERSION,
  type OpenSocietyCommit,
  type OpenSocietyEffects,
  type OpenSocietyManifest,
  type OpenSocietyState,
} from './types';

export { stableJson, digest } from './jsonCommitments';
import { stableJson, digest } from './jsonCommitments';
import { preserveAndReplaceJournal, type JournalRecoveryReport } from './journalRecovery';

function acquireWriterLock(path: string): void {
  const ownLock = () =>
    writeFileSync(path, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  if (!existsSync(path)) {
    ownLock();
    return;
  }
  // Serialize recovery so two starters cannot unlink each other's replacement lock.
  const recoveryPath = `${path}.recovery`;
  writeFileSync(recoveryPath, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
  try {
    if (existsSync(path)) {
      const lock: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (
        lock === null ||
        typeof lock !== 'object' ||
        !('pid' in lock) ||
        typeof lock.pid !== 'number' ||
        !Number.isSafeInteger(lock.pid) ||
        lock.pid < 1
      )
        throw new Error('invalid-writer-lock');
      let alive = true;
      try {
        process.kill(lock.pid, 0);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH') alive = false;
        else throw error;
      }
      if (alive) throw new Error('open-society-writer-already-running');
      rmSync(path);
    }
    ownLock();
  } finally {
    rmSync(recoveryPath);
  }
}

/** What an idempotent retry needs from an earlier commit with the same request ID. */
export type JournalRequestRecord = Pick<OpenSocietyCommit, 'fingerprint' | 'result'>;

/**
 * One authoritative writer; commits contain the complete cross-domain effect before publication.
 * Only the current state, the request index and each commit's hash and byte offset stay in memory;
 * full commits are read back from the journal file on demand, so memory does not grow with every
 * historical effect.
 */
export class OpenSocietyJournal {
  readonly manifest: OpenSocietyManifest;
  readonly recoveryReport?: JournalRecoveryReport;
  private current: OpenSocietyState;
  private readonly lockPath: string;
  private readonly journalPath: string;
  private readonly byRequest = new Map<string, JournalRequestRecord>();
  /** Hash and byte offset of commit `sequence` at index `sequence - 1`. */
  private readonly hashes: string[] = [];
  private readonly offsets: number[] = [];
  /** Bytes of complete records in the journal file. */
  private size = 0;
  private lastHash: string;
  private closed = false;
  private readonly replica: boolean;
  private lockReleased = false;
  private historicalRequests: ReadonlySet<string> = new Set();
  constructor(
    readonly rootDir: string,
    seed?: OpenSocietyManifest,
    recovery?: { readonly incompleteTail?: 'preserve-and-recover'; readonly replica?: true },
  ) {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    this.lockPath = join(rootDir, 'writer.lock');
    this.journalPath = join(rootDir, 'journal.jsonl');
    acquireWriterLock(this.lockPath);
    this.replica = recovery?.replica === true;
    try {
      const rolePath = join(rootDir, 'replica-role.json');
      if (existsSync(rolePath)) {
        if (!this.replica) throw new Error('replica-cannot-own-authority');
        if (readFileSync(rolePath, 'utf8') !== 'society-commit-replica-v1\n')
          throw new Error('invalid-replica-role');
      } else if (this.replica) {
        if (existsSync(join(rootDir, 'manifest.json')))
          throw new Error('authority-cannot-become-replica');
        writeFileSync(rolePath, 'society-commit-replica-v1\n', { flag: 'wx', mode: 0o600 });
        const fd = openSync(rolePath, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const dir = openSync(rootDir, 'r');
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      }
      const manifestPath = join(rootDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        if (seed === undefined) throw new Error('open-society-not-initialized');
        writeFileSync(manifestPath, stableJson(seed), { flag: 'wx', mode: 0o600 });
        const fd = openSync(manifestPath, 'r');
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        const dir = openSync(rootDir, 'r');
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      }
      // The schema/version and hash chain below guard this persisted JSON envelope boundary.
      this.manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OpenSocietyManifest;
      if (this.manifest.schemaVersion !== OPEN_SOCIETY_SCHEMA_VERSION)
        throw new Error('unsupported-open-society-schema');
      this.historicalRequests = canonicalHistoricalRequestIds(
        this.manifest.canonicalRequestHistory,
        this.manifest.simulationId,
      );
      assertOpenAgentPolicy(this.manifest.policy);
      assertInformationPolicy(this.manifest.informationPolicy);
      if (seed !== undefined && digest(seed) !== digest(this.manifest))
        throw new Error('manifest-seed-mismatch');
      this.current = initialOpenSocietyState(this.manifest);
      this.lastHash = digest(this.manifest);
      if (existsSync(this.journalPath)) {
        const bytes = readFileSync(this.journalPath);
        const end = bytes.lastIndexOf(10) + 1;
        const tail = bytes.subarray(end);
        if (tail.length && !recovery?.incompleteTail)
          throw new Error('truncated-open-society-journal');
        const replay = (line: string, offset: number) => {
          // Persisted envelope boundary: hash, schema, sequence, duplicate ID and domain replay validate it.
          const commit = JSON.parse(line) as OpenSocietyCommit;
          const { hash, ...body } = commit;
          if (
            commit.schemaVersion !== OPEN_SOCIETY_SCHEMA_VERSION ||
            commit.previousHash !== this.lastHash ||
            hash !== digest(body)
          )
            throw new Error('invalid-open-society-journal-hash');
          this.assertCurrentRequest(commit.requestId);
          this.current = applyOpenSocietyCommit(this.current, commit);
          this.remember(commit, offset);
        };
        // Decode one record at a time; a whole-file string and line array doubled peak memory.
        for (let start = 0; start < end; ) {
          const newline = bytes.indexOf(10, start);
          if (newline > start) replay(bytes.toString('utf8', start, newline), start);
          start = newline + 1;
        }
        this.size = end;
        if (recovery?.incompleteTail) {
          let recovered = bytes;
          let action: JournalRecoveryReport['action'] = 'unchanged';
          if (tail.length) {
            // A whole record lacking only the delimiter is kept, never silently discarded.
            let complete = true;
            try {
              JSON.parse(tail.toString('utf8'));
            } catch (error) {
              if (error instanceof SyntaxError) complete = false;
              else throw error;
            }
            if (complete) {
              replay(tail.toString('utf8'), end);
              recovered = Buffer.concat([bytes, Buffer.from('\n')]);
              action = 'completed-record-newline';
            } else {
              recovered = bytes.subarray(0, end);
              action = 'removed-incomplete-tail';
            }
          }
          this.recoveryReport = preserveAndReplaceJournal(
            rootDir,
            bytes,
            recovered,
            this.current.revision,
            action,
          );
          this.size = recovered.length;
        }
      } else if (recovery?.incompleteTail) {
        this.recoveryReport = preserveAndReplaceJournal(
          rootDir,
          Buffer.alloc(0),
          Buffer.alloc(0),
          0,
          'unchanged',
        );
      }
    } catch (error) {
      rmSync(this.lockPath);
      throw error;
    }
  }
  get state(): OpenSocietyState {
    return this.current;
  }
  /** Number of commits; equals `state.revision`. */
  get commitCount(): number {
    return this.hashes.length;
  }
  /** Hash of commit `sequence` (1-based). */
  hashAt(sequence: number): string {
    const hash = this.hashes[sequence - 1];
    if (hash === undefined) throw new Error('journal-sequence-out-of-range');
    return hash;
  }
  /** Commit `sequence` (1-based), read back from the journal file. */
  commitAt(sequence: number): OpenSocietyCommit {
    return this.readCommits(sequence, 1)[0]!;
  }
  /** Up to `count` commits starting at `sequence` (1-based), read back from the journal file. */
  readCommits(sequence: number, count: number): OpenSocietyCommit[] {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > this.hashes.length + 1)
      throw new Error('journal-sequence-out-of-range');
    const last = Math.min(this.hashes.length, sequence + Math.max(0, count) - 1);
    if (last < sequence) return [];
    const from = this.offsets[sequence - 1]!;
    const to = last < this.hashes.length ? this.offsets[last]! : this.size;
    const bytes = Buffer.alloc(to - from);
    const fd = openSync(this.journalPath, 'r');
    try {
      let read = 0;
      while (read < bytes.length) {
        const n = readSync(fd, bytes, read, bytes.length - read, from + read);
        if (n === 0) throw new Error('journal-read-truncated');
        read += n;
      }
    } finally {
      closeSync(fd);
    }
    const commits: OpenSocietyCommit[] = [];
    for (let start = 0; start < bytes.length; ) {
      const newline = bytes.indexOf(10, start);
      const stop = newline === -1 ? bytes.length : newline;
      if (stop > start) {
        const commit = JSON.parse(bytes.toString('utf8', start, stop)) as OpenSocietyCommit;
        const expected = sequence + commits.length;
        // The file is append-only under our lock; a mismatch means it changed underneath us.
        if (commit.sequence !== expected || commit.hash !== this.hashes[expected - 1])
          throw new Error('journal-read-mismatch');
        commits.push(commit);
      }
      start = stop + 1;
    }
    if (commits.length !== last - sequence + 1) throw new Error('journal-read-mismatch');
    return commits;
  }
  /**
   * Every commit, read from the journal file on each call. For reports, verification and tests;
   * runtime paths read bounded ranges with `readCommits`.
   */
  get commits(): readonly OpenSocietyCommit[] {
    return this.readCommits(1, this.hashes.length);
  }
  isHistoricalRequest(requestId: string): boolean {
    return this.historicalRequests.has(requestId);
  }
  private assertCurrentRequest(requestId: string): void {
    if (this.isHistoricalRequest(requestId)) throw new Error('historical-request-id');
  }
  lookup(actorId: string, requestId: string): JournalRequestRecord | undefined {
    return this.byRequest.get(`${actorId}:${requestId}`);
  }
  commit(input: {
    actorId: string;
    requestId: string;
    fingerprint: string;
    capability: string;
    result: OpenToolResult;
    effects: OpenSocietyEffects;
  }): OpenToolResult {
    if (this.closed) throw new Error('journal-closed');
    if (this.replica) throw new Error('replica-cannot-decide');
    this.assertCurrentRequest(input.requestId);
    const previous = this.lookup(input.actorId, input.requestId);
    if (previous !== undefined) {
      if (previous.fingerprint !== input.fingerprint) throw new Error('request-id-conflict');
      return previous.result;
    }
    const body: Omit<OpenSocietyCommit, 'hash'> = {
      schemaVersion: OPEN_SOCIETY_SCHEMA_VERSION,
      sequence: this.current.revision + 1,
      actorId: input.actorId,
      requestId: input.requestId,
      fingerprint: input.fingerprint,
      capability: input.capability,
      at: this.current.world.clock.now,
      result: { ...input.result, revision: this.current.revision + 1 },
      ...input.effects,
      previousHash: this.lastHash,
    };
    const record: OpenSocietyCommit = { ...body, hash: digest(body) };
    return this.appendRecord(record);
  }
  /** Trusted authority delivery only; never accepts resident-authored effects. */
  receive(input: OpenSocietyCommit): void {
    const record = structuredClone(input);
    this.assertCurrentRequest(record.requestId);
    if (this.closed) throw new Error('journal-closed');
    if (!this.replica) throw new Error('authority-cannot-receive-replica-record');
    const { hash, ...body } = record;
    if (record.schemaVersion !== OPEN_SOCIETY_SCHEMA_VERSION || hash !== digest(body))
      throw new Error('invalid-open-society-journal-hash');
    const prior = this.hashes[record.sequence - 1];
    if (prior !== undefined) {
      if (prior !== hash) throw new Error('replica-history-conflict');
      return;
    }
    if (record.previousHash !== this.lastHash) throw new Error('replica-cursor-conflict');
    if (this.lookup(record.actorId, record.requestId)) throw new Error('duplicate-journal-request');
    this.appendRecord(record);
  }
  private appendRecord(record: OpenSocietyCommit): OpenToolResult {
    const next = applyOpenSocietyCommit(this.current, record);
    const fd = openSync(this.journalPath, 'a', 0o600);
    const start = this.size;
    const bytes = Buffer.from(`${stableJson(record)}\n`);
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } catch (error) {
      this.closed = true;
      throw error;
    } finally {
      closeSync(fd);
    }
    this.size += bytes.length;
    this.current = next;
    this.remember(record, start);
    return record.result;
  }
  close(): void {
    this.closed = true;
    if (this.lockReleased) return;
    if (existsSync(this.lockPath)) rmSync(this.lockPath);
    this.lockReleased = true;
  }
  private remember(commit: OpenSocietyCommit, offset: number): void {
    const key = `${commit.actorId}:${commit.requestId}`;
    if (this.byRequest.has(key)) throw new Error('duplicate-journal-request');
    this.byRequest.set(key, { fingerprint: commit.fingerprint, result: commit.result });
    this.hashes.push(commit.hash);
    this.offsets.push(offset);
    this.lastHash = commit.hash;
  }
}

/** Explicit operator recovery; never called by normal startup or a resident tool. */
export function recoverOpenSocietyJournal(rootDir: string): JournalRecoveryReport {
  const journal = new OpenSocietyJournal(rootDir, undefined, {
    incompleteTail: 'preserve-and-recover',
    ...(existsSync(join(rootDir, 'replica-role.json')) ? { replica: true as const } : {}),
  });
  try {
    if (!journal.recoveryReport) throw Error('journal-recovery-no-journal');
    return journal.recoveryReport;
  } finally {
    journal.close();
  }
}
