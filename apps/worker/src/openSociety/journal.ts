import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
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

export function stableJson(value: unknown): string {
  if (value === undefined) throw new Error('undefined-journal-value');
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
}
export function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

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

/** One authoritative writer; commits contain the complete cross-domain effect before publication. */
export class OpenSocietyJournal {
  readonly manifest: OpenSocietyManifest;
  private current: OpenSocietyState;
  private readonly lockPath: string;
  private readonly journalPath: string;
  private readonly byRequest = new Map<string, OpenSocietyCommit>();
  private readonly records: OpenSocietyCommit[] = [];
  private lastHash: string;
  private closed = false;
  private lockReleased = false;
  constructor(
    readonly rootDir: string,
    seed?: OpenSocietyManifest,
  ) {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    this.lockPath = join(rootDir, 'writer.lock');
    this.journalPath = join(rootDir, 'journal.jsonl');
    acquireWriterLock(this.lockPath);
    try {
      const manifestPath = join(rootDir, 'manifest.json');
      if (!existsSync(manifestPath)) {
        if (seed === undefined) throw new Error('open-society-not-initialized');
        writeFileSync(manifestPath, stableJson(seed), { flag: 'wx', mode: 0o600 });
      }
      // The schema/version and hash chain below guard this persisted JSON envelope boundary.
      this.manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as OpenSocietyManifest;
      if (this.manifest.schemaVersion !== OPEN_SOCIETY_SCHEMA_VERSION)
        throw new Error('unsupported-open-society-schema');
      assertOpenAgentPolicy(this.manifest.policy);
      assertInformationPolicy(this.manifest.informationPolicy);
      if (seed !== undefined && digest(seed) !== digest(this.manifest))
        throw new Error('manifest-seed-mismatch');
      this.current = initialOpenSocietyState(this.manifest);
      this.lastHash = digest(this.manifest);
      if (existsSync(this.journalPath)) {
        const content = readFileSync(this.journalPath, 'utf8');
        if (content.length > 0 && !content.endsWith('\n'))
          throw new Error('truncated-open-society-journal');
        for (const line of content.split('\n').filter(Boolean)) {
          const commit = JSON.parse(line) as OpenSocietyCommit;
          const { hash, ...body } = commit;
          if (
            commit.schemaVersion !== OPEN_SOCIETY_SCHEMA_VERSION ||
            commit.previousHash !== this.lastHash ||
            hash !== digest(body)
          )
            throw new Error('invalid-open-society-journal-hash');
          this.current = applyOpenSocietyCommit(this.current, commit);
          this.remember(commit);
        }
      }
    } catch (error) {
      rmSync(this.lockPath);
      throw error;
    }
  }
  get state(): OpenSocietyState {
    return this.current;
  }
  get commits(): readonly OpenSocietyCommit[] {
    return this.records;
  }
  lookup(actorId: string, requestId: string): OpenSocietyCommit | undefined {
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
    const next = applyOpenSocietyCommit(this.current, record);
    const fd = openSync(this.journalPath, 'a', 0o600);
    try {
      const bytes = Buffer.from(`${stableJson(record)}\n`);
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
      fsyncSync(fd);
    } catch (error) {
      this.closed = true;
      throw error;
    } finally {
      closeSync(fd);
    }
    this.current = next;
    this.remember(record);
    return record.result;
  }
  close(): void {
    this.closed = true;
    if (this.lockReleased) return;
    if (existsSync(this.lockPath)) rmSync(this.lockPath);
    this.lockReleased = true;
  }
  private remember(commit: OpenSocietyCommit): void {
    const key = `${commit.actorId}:${commit.requestId}`;
    if (this.byRequest.has(key)) throw new Error('duplicate-journal-request');
    this.byRequest.set(key, commit);
    this.records.push(commit);
    this.lastHash = commit.hash;
  }
}
