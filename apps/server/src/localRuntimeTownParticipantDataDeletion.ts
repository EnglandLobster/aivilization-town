import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import {
  FILE_EVENT_STORE_EXACT_STRING_REDACTION_POLICY_VERSION,
  appendDeflatedJsonLinesFrame,
  redactFileEventStoreExactString,
  scanDeflatedJsonLinesFrames,
} from '@aivilization/sim-core';
import { agentCycleTraceCompressedStorageContainsUtf8 } from '@aivilization/observability';

export const LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_POLICY_VERSION =
  'participant-data-deletion-v1';
export const LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME =
  'participant-data-deletion.json';

export type LocalRuntimeTownParticipantDataDeletionPolicy = {
  readonly policyVersion: typeof LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_POLICY_VERSION;
  readonly executionMode: 'offline-copy-on-write';
  readonly deletionSemantics: 'irreversible-subject-pseudonymization';
  readonly preservedResearchBoundary: 'anonymous-world-history-and-sequence-integrity';
  readonly sourceMutation: 'never';
  readonly eventIntegrity: typeof FILE_EVENT_STORE_EXACT_STRING_REDACTION_POLICY_VERSION;
  readonly activationRule: 'validate-target-then-explicitly-replace-deployment-root';
  readonly concurrencyRule: 'source-tree-must-remain-byte-and-metadata-stable-during-copy';
  readonly unsupportedPayloadRule: 'fail-closed-before-activation';
};

export type LocalRuntimeTownParticipantDataDeletionArtifact = {
  readonly schemaVersion: typeof LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_POLICY_VERSION;
  readonly deletionId: string;
  readonly createdAt: number;
  readonly tombstoneSubjectId: string;
  readonly sourceTreeFingerprint: string;
  readonly targetTreeFingerprint: string;
  readonly eventStoreCount: number;
  readonly eventReplacementCount: number;
  readonly otherReplacementCount: number;
  readonly verifiedResidualReferenceCount: 0;
  readonly status: 'anonymized-copy-ready-for-explicit-activation';
  readonly policy: LocalRuntimeTownParticipantDataDeletionPolicy;
};

export function createLocalRuntimeTownParticipantDataDeletionPolicy(): LocalRuntimeTownParticipantDataDeletionPolicy {
  return {
    policyVersion: LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_POLICY_VERSION,
    executionMode: 'offline-copy-on-write',
    deletionSemantics: 'irreversible-subject-pseudonymization',
    preservedResearchBoundary: 'anonymous-world-history-and-sequence-integrity',
    sourceMutation: 'never',
    eventIntegrity: FILE_EVENT_STORE_EXACT_STRING_REDACTION_POLICY_VERSION,
    activationRule: 'validate-target-then-explicitly-replace-deployment-root',
    concurrencyRule: 'source-tree-must-remain-byte-and-metadata-stable-during-copy',
    unsupportedPayloadRule: 'fail-closed-before-activation',
  };
}

export function deleteLocalRuntimeTownParticipantData(input: {
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
  readonly participantSubjectId: string;
  readonly createdAt?: number;
  readonly tombstoneSubjectId?: string;
}): LocalRuntimeTownParticipantDataDeletionArtifact {
  const sourceRootDir = resolveNonEmpty(input.sourceRootDir, 'sourceRootDir');
  const targetRootDir = resolveNonEmpty(input.targetRootDir, 'targetRootDir');
  const participantSubjectId = requireNonEmpty(input.participantSubjectId, 'participantSubjectId');
  if (participantSubjectId.includes(sep)) {
    throw new Error('participantSubjectId must not contain a path separator');
  }
  if (
    sourceRootDir === targetRootDir ||
    targetRootDir.startsWith(`${sourceRootDir}${sep}`) ||
    sourceRootDir.startsWith(`${targetRootDir}${sep}`)
  ) {
    throw new Error('participant deletion source and target roots must be disjoint');
  }
  if (
    sourceRootDir.includes(participantSubjectId) ||
    targetRootDir.includes(participantSubjectId)
  ) {
    throw new Error('participantSubjectId must not appear in a runtime root path');
  }
  if (!existsSync(sourceRootDir) || !statSync(sourceRootDir).isDirectory()) {
    throw new Error(`participant deletion source root is not a directory: ${sourceRootDir}`);
  }
  if (existsSync(targetRootDir)) {
    throw new Error(`participant deletion target root already exists: ${targetRootDir}`);
  }
  const createdAt = input.createdAt ?? Date.now();
  assertTimestamp(createdAt, 'createdAt');
  const tombstoneSubjectId = requireNonEmpty(
    input.tombstoneSubjectId ?? `deleted-participant:${randomUUID()}`,
    'tombstoneSubjectId',
  );
  if (tombstoneSubjectId === participantSubjectId) {
    throw new Error('tombstoneSubjectId must differ from participantSubjectId');
  }

  const sourceBefore = fingerprintLocalRuntimeTownTree(sourceRootDir);
  mkdirSync(dirname(targetRootDir), { recursive: true });
  try {
    cpSync(sourceRootDir, targetRootDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
    });
    const sourceAfter = fingerprintLocalRuntimeTownTree(sourceRootDir);
    if (sourceBefore.fingerprint !== sourceAfter.fingerprint) {
      throw new Error('participant deletion source changed while the offline copy was running');
    }

    const eventRoots = findFileEventStoreRoots(targetRootDir);
    let eventReplacementCount = 0;
    for (const eventRoot of eventRoots) {
      const result = redactFileEventStoreExactString({
        rootDir: eventRoot,
        target: participantSubjectId,
        replacement: tombstoneSubjectId,
      });
      eventReplacementCount += result.replacementCount;
    }
    const otherReplacementCount = redactOtherRuntimeData({
      rootDir: targetRootDir,
      eventRoots: new Set(eventRoots),
      participantSubjectId,
      tombstoneSubjectId,
      sourceRootDir,
      targetRootDir,
    });
    const residualReferences = findResidualReferences(targetRootDir, participantSubjectId);
    if (residualReferences.length > 0) {
      throw new Error(
        `participant deletion left unsupported identity references: ${residualReferences.join(', ')}`,
      );
    }
    const targetInventory = fingerprintLocalRuntimeTownTree(targetRootDir);
    const artifact: LocalRuntimeTownParticipantDataDeletionArtifact = {
      schemaVersion: LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_POLICY_VERSION,
      deletionId: `participant-data-deletion:${randomUUID()}`,
      createdAt,
      tombstoneSubjectId,
      sourceTreeFingerprint: sourceBefore.fingerprint,
      targetTreeFingerprint: targetInventory.fingerprint,
      eventStoreCount: eventRoots.length,
      eventReplacementCount,
      otherReplacementCount,
      verifiedResidualReferenceCount: 0,
      status: 'anonymized-copy-ready-for-explicit-activation',
      policy: createLocalRuntimeTownParticipantDataDeletionPolicy(),
    };
    writeJsonAtomically(
      join(targetRootDir, LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME),
      artifact,
    );
    return artifact;
  } catch (error) {
    rmSync(targetRootDir, { recursive: true, force: true });
    throw error;
  }
}

function redactOtherRuntimeData(input: {
  readonly rootDir: string;
  readonly eventRoots: ReadonlySet<string>;
  readonly participantSubjectId: string;
  readonly tombstoneSubjectId: string;
  readonly sourceRootDir: string;
  readonly targetRootDir: string;
}): number {
  let replacementCount = 0;
  for (const path of listRegularFiles(input.rootDir)) {
    if (isInsideAny(path, input.eventRoots)) continue;
    const extension = extname(path);
    if (extension === '.deflate') {
      replacementCount += rewriteRuntimeDeflateFrames(path, input);
      continue;
    }
    if (extension !== '.json' && extension !== '.jsonl') continue;
    const serialized = readFileSync(path, 'utf8');
    const preservesImmutableRunManifest = relative(input.rootDir, path).startsWith(
      `operations${sep}resolved-run-manifests${sep}`,
    );
    if (
      !serialized.includes(input.participantSubjectId) &&
      (!serialized.includes(input.sourceRootDir) || preservesImmutableRunManifest)
    ) {
      continue;
    }
    const values =
      extension === '.jsonl' ? parseJsonLines(serialized, path) : [parseJson(serialized, path)];
    const redacted = values.map((value) => {
      const result = redactRuntimeValue(
        value,
        preservesImmutableRunManifest
          ? { ...input, sourceRootDir: '\u0000immutable-run-manifest-root' }
          : input,
      );
      replacementCount += result.replacementCount;
      return result.value;
    });
    writeFileSync(
      path,
      extension === '.jsonl'
        ? redacted.length === 0
          ? ''
          : `${redacted.map((value) => JSON.stringify(value)).join('\n')}\n`
        : `${JSON.stringify(redacted[0], null, 2)}\n`,
      'utf8',
    );
  }
  return replacementCount;
}

function rewriteRuntimeDeflateFrames(
  path: string,
  input: {
    readonly participantSubjectId: string;
    readonly tombstoneSubjectId: string;
    readonly sourceRootDir: string;
    readonly targetRootDir: string;
  },
): number {
  const temporaryPath = `${path}.redacting`;
  if (existsSync(temporaryPath)) {
    throw new Error(`runtime deflate redaction staging file already exists: ${temporaryPath}`);
  }
  writeFileSync(temporaryPath, '', { flag: 'wx' });
  const size = statSync(path).size;
  let replacementCount = 0;
  try {
    const scan = scanDeflatedJsonLinesFrames<unknown>({
      path,
      fromByte: 0,
      toByte: size,
      onFrame: (values) => {
        const redacted = values.map((value) => {
          const result = redactRuntimeValue(value, input);
          replacementCount += result.replacementCount;
          return result.value;
        });
        appendDeflatedJsonLinesFrame(temporaryPath, redacted);
      },
    });
    if (scan.consumedBytes !== size) {
      throw new Error(`runtime deflate redaction encountered an incomplete frame: ${path}`);
    }
    renameSync(temporaryPath, path);
    return replacementCount;
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function redactRuntimeValue(
  value: unknown,
  input: {
    readonly participantSubjectId: string;
    readonly tombstoneSubjectId: string;
    readonly sourceRootDir: string;
    readonly targetRootDir: string;
  },
): { readonly value: unknown; readonly replacementCount: number } {
  if (typeof value === 'string') {
    let next = value;
    let replacementCount = 0;
    if (next.includes(input.participantSubjectId)) {
      const parts = next.split(input.participantSubjectId);
      replacementCount += parts.length - 1;
      next = parts.join(input.tombstoneSubjectId);
    }
    if (next.includes(input.sourceRootDir)) {
      next = next.split(input.sourceRootDir).join(input.targetRootDir);
    }
    return { value: next, replacementCount };
  }
  if (Array.isArray(value)) {
    let replacementCount = 0;
    const redacted = value.map((entry) => {
      const result = redactRuntimeValue(entry, input);
      replacementCount += result.replacementCount;
      return result.value;
    });
    return { value: redacted, replacementCount };
  }
  if (value !== null && typeof value === 'object') {
    let replacementCount = 0;
    const redacted = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const result = redactRuntimeValue(entry, input);
        replacementCount += result.replacementCount;
        return [key, result.value];
      }),
    );
    return { value: redacted, replacementCount };
  }
  return { value, replacementCount: 0 };
}

function findResidualReferences(rootDir: string, subjectId: string): readonly string[] {
  const target = Buffer.from(subjectId, 'utf8');
  const residual: string[] = [];
  for (const path of listRegularFiles(rootDir)) {
    const extension = extname(path);
    const content = readFileSync(path);
    if (basename(path) === 'agent-cycle-traces.jsonl.gz') {
      if (
        agentCycleTraceCompressedStorageContainsUtf8({
          rootDir: dirname(path),
          target: subjectId,
        })
      ) {
        residual.push(relative(rootDir, path));
      }
      continue;
    }
    if (extension === '.gz') {
      if (gunzipSync(content).includes(target)) residual.push(relative(rootDir, path));
      continue;
    }
    if (extension === '.deflate') {
      if (deflateFramesContain(content, target)) residual.push(relative(rootDir, path));
      continue;
    }
    if (content.includes(target)) residual.push(relative(rootDir, path));
  }
  return residual.sort();
}

function deflateFramesContain(content: Buffer, target: Buffer): boolean {
  let offset = 0;
  while (offset < content.length) {
    if (content.length - offset < 4) {
      throw new Error('compact deflate file has an incomplete frame header');
    }
    const length = content.readUInt32BE(offset);
    offset += 4;
    if (length === 0 || length > content.length - offset) {
      throw new Error('compact deflate file has an incomplete frame payload');
    }
    if (inflateRawSync(content.subarray(offset, offset + length)).includes(target)) return true;
    offset += length;
  }
  return false;
}

function findFileEventStoreRoots(rootDir: string): readonly string[] {
  return listDirectories(rootDir)
    .filter(
      (path) =>
        basename(path) === 'events' &&
        existsSync(join(path, 'streams')) &&
        existsSync(join(path, 'idempotency.jsonl')) &&
        existsSync(join(path, 'idempotency.deflate')),
    )
    .sort();
}

export function fingerprintLocalRuntimeTownTree(rootDir: string): {
  readonly fingerprint: string;
  readonly fileCount: number;
} {
  const entries = listRegularFiles(rootDir).map((path) => {
    const stats = statSync(path);
    return `${relative(rootDir, path)}\0${stats.size}\0${stats.mtimeMs}`;
  });
  return {
    fingerprint: `sha256:${createHash('sha256').update(entries.join('\n')).digest('hex')}`,
    fileCount: entries.length,
  };
}

function listRegularFiles(rootDir: string): readonly string[] {
  const files: string[] = [];
  walkRuntimeTree(rootDir, (path, type) => {
    if (type === 'file') files.push(path);
  });
  return files.sort();
}

function listDirectories(rootDir: string): readonly string[] {
  const directories: string[] = [];
  walkRuntimeTree(rootDir, (path, type) => {
    if (type === 'directory') directories.push(path);
  });
  return directories.sort();
}

function walkRuntimeTree(
  rootDir: string,
  visit: (path: string, type: 'file' | 'directory') => void,
): void {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      throw new Error(`participant deletion refuses symbolic links: ${current}`);
    }
    if (stats.isFile()) {
      visit(current, 'file');
      continue;
    }
    if (!stats.isDirectory()) {
      throw new Error(`participant deletion refuses unsupported filesystem entry: ${current}`);
    }
    visit(current, 'directory');
    const children = readdirSync(current)
      .sort()
      .reverse()
      .map((name) => join(current, name));
    stack.push(...children);
  }
}

function isInsideAny(path: string, roots: ReadonlySet<string>): boolean {
  for (const root of roots) {
    if (path === root || path.startsWith(`${root}${sep}`)) return true;
  }
  return false;
}

function parseJson(serialized: string, path: string): unknown {
  try {
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new Error(`participant deletion encountered invalid JSON: ${path}`, { cause: error });
  }
}

function parseJsonLines(serialized: string, path: string): readonly unknown[] {
  const normalized = serialized.trim();
  if (normalized.length === 0) return [];
  return normalized.split('\n').map((line) => parseJson(line, path));
}

function writeJsonAtomically(path: string, value: unknown): void {
  const temporaryPath = `${path}.writing`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  renameSync(temporaryPath, path);
}

function resolveNonEmpty(value: string, name: string): string {
  return resolve(requireNonEmpty(value, name));
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must be non-empty`);
  return normalized;
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
