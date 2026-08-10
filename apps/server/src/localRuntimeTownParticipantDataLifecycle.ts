import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import {
  fingerprintLocalRuntimeTownTree,
  LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME,
  type LocalRuntimeTownParticipantDataDeletionArtifact,
} from './localRuntimeTownParticipantDataDeletion';

export const LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION =
  'participant-data-lifecycle-v1';

export type LocalRuntimeTownParticipantDataLifecyclePolicy = {
  readonly policyVersion: typeof LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION;
  readonly directIdentityRetentionMs: number;
  readonly backupRetentionMs: number;
  readonly retentionClock: 'deletion-request-received-at';
  readonly subjectReference: 'hmac-sha256-with-deployment-audit-key';
  readonly auditIntegrity: 'append-only-sha256-chain';
  readonly retirementSemantics: 'intent-before-delete-and-idempotent-recovery';
};

export type LocalRuntimeTownParticipantDataCopy = {
  readonly copyId: string;
  readonly kind: 'source' | 'backup';
  readonly rootDir: string;
  readonly treeFingerprint: string;
  readonly retireAfter: number;
};

type ParticipantDataLifecycleEvent =
  | {
      readonly type: 'deletion-request-recorded';
      readonly requestId: string;
      readonly subjectReference: string;
      readonly policy: LocalRuntimeTownParticipantDataLifecyclePolicy;
      readonly copies: readonly LocalRuntimeTownParticipantDataCopy[];
    }
  | {
      readonly type: 'anonymized-copy-prepared';
      readonly deletionId: string;
      readonly targetRootDir: string;
      readonly targetTreeFingerprint: string;
    }
  | {
      readonly type: 'anonymized-copy-activated';
      readonly targetRootDir: string;
      readonly resolvedRunManifestId: string;
      readonly healthVerifiedAt: number;
    }
  | {
      readonly type: 'identity-bearing-copy-retirement-started';
      readonly copyId: string;
      readonly expectedTreeFingerprint: string;
    }
  | {
      readonly type: 'identity-bearing-copy-retired';
      readonly copyId: string;
    }
  | { readonly type: 'deletion-request-completed' };

export type LocalRuntimeTownParticipantDataLifecycleRecord = {
  readonly schemaVersion: typeof LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION;
  readonly sequence: number;
  readonly eventId: string;
  readonly occurredAt: number;
  readonly previousRecordHash: string;
  readonly event: ParticipantDataLifecycleEvent;
  readonly recordHash: string;
};

export type LocalRuntimeTownParticipantDataLifecycleState = {
  readonly requestId: string;
  readonly requestedAt: number;
  readonly subjectReference: string;
  readonly policy: LocalRuntimeTownParticipantDataLifecyclePolicy;
  readonly copies: readonly LocalRuntimeTownParticipantDataCopy[];
  readonly preparedTarget?: {
    readonly deletionId: string;
    readonly rootDir: string;
    readonly treeFingerprint: string;
  };
  readonly activatedTarget?: {
    readonly rootDir: string;
    readonly resolvedRunManifestId: string;
    readonly healthVerifiedAt: number;
  };
  readonly retirementStartedCopyIds: readonly string[];
  readonly retiredCopyIds: readonly string[];
  readonly status:
    | 'requested'
    | 'anonymized-copy-prepared'
    | 'anonymized-copy-activated'
    | 'retiring-identity-bearing-copies'
    | 'completed';
  readonly nextRetentionDeadlineAt?: number;
};

export function createLocalRuntimeTownParticipantDataLifecycleRequest(input: {
  readonly auditRootDir: string;
  readonly participantSubjectId: string;
  readonly auditHmacKey: Uint8Array;
  readonly sourceRootDir: string;
  readonly backupRootDirs?: readonly string[];
  readonly directIdentityRetentionMs: number;
  readonly backupRetentionMs: number;
  readonly sourceWritersConfirmedStopped: true;
  readonly requestedAt?: number;
}): LocalRuntimeTownParticipantDataLifecycleState {
  const auditRootDir = resolveNonEmpty(input.auditRootDir, 'auditRootDir');
  const participantSubjectId = requireNonEmpty(input.participantSubjectId, 'participantSubjectId');
  assertAuditHmacKey(input.auditHmacKey);
  if (input.sourceWritersConfirmedStopped !== true) {
    throw new Error('sourceWritersConfirmedStopped must be true when copy fingerprints are frozen');
  }
  const requestedAt = input.requestedAt ?? Date.now();
  assertTimestamp(requestedAt, 'requestedAt');
  assertPositiveDuration(input.directIdentityRetentionMs, 'directIdentityRetentionMs');
  assertPositiveDuration(input.backupRetentionMs, 'backupRetentionMs');
  const policy: LocalRuntimeTownParticipantDataLifecyclePolicy = {
    policyVersion: LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION,
    directIdentityRetentionMs: input.directIdentityRetentionMs,
    backupRetentionMs: input.backupRetentionMs,
    retentionClock: 'deletion-request-received-at',
    subjectReference: 'hmac-sha256-with-deployment-audit-key',
    auditIntegrity: 'append-only-sha256-chain',
    retirementSemantics: 'intent-before-delete-and-idempotent-recovery',
  };
  const sourceRootDir = validateIdentityBearingCopyRoot({
    value: input.sourceRootDir,
    auditRootDir,
    name: 'sourceRootDir',
  });
  const backupRootDirs = (input.backupRootDirs ?? []).map((value, index) =>
    validateIdentityBearingCopyRoot({
      value,
      auditRootDir,
      name: `backupRootDirs[${index}]`,
    }),
  );
  const allRoots = [sourceRootDir, ...backupRootDirs];
  if (new Set(allRoots).size !== allRoots.length) {
    throw new Error('participant data lifecycle copy roots must be unique');
  }
  assertDisjointRoots(allRoots);
  const copies: readonly LocalRuntimeTownParticipantDataCopy[] = allRoots.map((rootDir, index) => ({
    copyId: `${index === 0 ? 'source' : 'backup'}:${randomUUID()}`,
    kind: index === 0 ? 'source' : 'backup',
    rootDir,
    treeFingerprint: fingerprintLocalRuntimeTownTree(rootDir).fingerprint,
    retireAfter: addDuration(
      requestedAt,
      index === 0 ? input.directIdentityRetentionMs : input.backupRetentionMs,
    ),
  }));
  const requestId = `participant-deletion-request:${randomUUID()}`;
  mkdirSync(auditRootDir, { recursive: true, mode: 0o700 });
  return withRequestLock(auditRootDir, requestId, () => {
    if (existsSync(resolveAuditLogPath(auditRootDir, requestId))) {
      throw new Error(`participant data lifecycle request already exists: ${requestId}`);
    }
    const subjectReference = `hmac-sha256:${createHmac('sha256', input.auditHmacKey)
      .update(participantSubjectId)
      .digest('hex')}`;
    appendRecord(auditRootDir, requestId, requestedAt, {
      type: 'deletion-request-recorded',
      requestId,
      subjectReference,
      policy,
      copies,
    });
    return readState(auditRootDir, requestId);
  });
}

export function recordLocalRuntimeTownParticipantDataAnonymizedCopyPrepared(input: {
  readonly auditRootDir: string;
  readonly requestId: string;
  readonly targetRootDir: string;
  readonly occurredAt?: number;
}): LocalRuntimeTownParticipantDataLifecycleState {
  const auditRootDir = resolveNonEmpty(input.auditRootDir, 'auditRootDir');
  const requestId = requireRequestId(input.requestId);
  const occurredAt = input.occurredAt ?? Date.now();
  assertTimestamp(occurredAt, 'occurredAt');
  return withRequestLock(auditRootDir, requestId, () => {
    const state = readState(auditRootDir, requestId);
    if (state.preparedTarget !== undefined) {
      throw new Error('participant data lifecycle already has a prepared anonymized copy');
    }
    const targetRootDir = validateAnonymizedTargetRoot(
      input.targetRootDir,
      auditRootDir,
      state.copies,
    );
    const artifact = readDeletionArtifact(targetRootDir);
    const sourceCopy = state.copies.find((copy) => copy.kind === 'source');
    if (sourceCopy === undefined || artifact.sourceTreeFingerprint !== sourceCopy.treeFingerprint) {
      throw new Error(
        'anonymized copy deletion artifact does not match the registered source copy',
      );
    }
    appendRecord(auditRootDir, requestId, occurredAt, {
      type: 'anonymized-copy-prepared',
      deletionId: artifact.deletionId,
      targetRootDir,
      targetTreeFingerprint: artifact.targetTreeFingerprint,
    });
    return readState(auditRootDir, requestId);
  });
}

export function recordLocalRuntimeTownParticipantDataAnonymizedCopyActivated(input: {
  readonly auditRootDir: string;
  readonly requestId: string;
  readonly targetRootDir: string;
  readonly resolvedRunManifestId: string;
  readonly healthVerifiedAt: number;
  readonly activationConfirmed: true;
  readonly occurredAt?: number;
}): LocalRuntimeTownParticipantDataLifecycleState {
  const auditRootDir = resolveNonEmpty(input.auditRootDir, 'auditRootDir');
  const requestId = requireRequestId(input.requestId);
  const occurredAt = input.occurredAt ?? Date.now();
  assertTimestamp(occurredAt, 'occurredAt');
  assertTimestamp(input.healthVerifiedAt, 'healthVerifiedAt');
  if (input.healthVerifiedAt > occurredAt) {
    throw new Error('healthVerifiedAt must not be later than the activation record');
  }
  const resolvedRunManifestId = requireNonEmpty(
    input.resolvedRunManifestId,
    'resolvedRunManifestId',
  );
  if (input.activationConfirmed !== true) {
    throw new Error('activationConfirmed must be true after deployment health verification');
  }
  return withRequestLock(auditRootDir, requestId, () => {
    const state = readState(auditRootDir, requestId);
    if (state.preparedTarget === undefined) {
      throw new Error('anonymized copy must be prepared before activation is recorded');
    }
    if (state.activatedTarget !== undefined) {
      throw new Error('participant data lifecycle already has an activated anonymized copy');
    }
    const targetRootDir = resolveNonEmpty(input.targetRootDir, 'targetRootDir');
    if (targetRootDir !== state.preparedTarget.rootDir) {
      throw new Error('activated target must match the prepared anonymized copy');
    }
    const artifact = readDeletionArtifact(targetRootDir);
    if (artifact.deletionId !== state.preparedTarget.deletionId) {
      throw new Error('activated target deletion artifact changed after preparation');
    }
    appendRecord(auditRootDir, requestId, occurredAt, {
      type: 'anonymized-copy-activated',
      targetRootDir,
      resolvedRunManifestId,
      healthVerifiedAt: input.healthVerifiedAt,
    });
    return readState(auditRootDir, requestId);
  });
}

export function retireDueLocalRuntimeTownParticipantDataCopies(input: {
  readonly auditRootDir: string;
  readonly requestId: string;
  readonly now?: number;
  readonly sourceWritersConfirmedStopped: true;
  readonly irreversibleRetirementConfirmed: true;
}): LocalRuntimeTownParticipantDataLifecycleState {
  const auditRootDir = resolveNonEmpty(input.auditRootDir, 'auditRootDir');
  const requestId = requireRequestId(input.requestId);
  const now = input.now ?? Date.now();
  assertTimestamp(now, 'now');
  if (input.sourceWritersConfirmedStopped !== true) {
    throw new Error('sourceWritersConfirmedStopped must be true');
  }
  if (input.irreversibleRetirementConfirmed !== true) {
    throw new Error('irreversibleRetirementConfirmed must be true');
  }
  return withRequestLock(auditRootDir, requestId, () => {
    let state = readState(auditRootDir, requestId);
    if (state.activatedTarget === undefined) {
      throw new Error('anonymized copy must be activated before identity-bearing copies retire');
    }
    for (const copy of state.copies) {
      if (copy.retireAfter > now || state.retiredCopyIds.includes(copy.copyId)) continue;
      if (!state.retirementStartedCopyIds.includes(copy.copyId)) {
        if (!existsSync(copy.rootDir)) {
          throw new Error(
            `identity-bearing copy disappeared before retirement intent: ${copy.copyId}`,
          );
        }
        const fingerprint = fingerprintLocalRuntimeTownTree(copy.rootDir).fingerprint;
        if (fingerprint !== copy.treeFingerprint) {
          throw new Error(`identity-bearing copy changed after request: ${copy.copyId}`);
        }
        appendRecord(auditRootDir, requestId, now, {
          type: 'identity-bearing-copy-retirement-started',
          copyId: copy.copyId,
          expectedTreeFingerprint: copy.treeFingerprint,
        });
        state = readState(auditRootDir, requestId);
      }
      if (existsSync(copy.rootDir)) {
        // The exact tree was verified immediately before the durable intent. A retry after
        // a process or filesystem failure must remove any remaining subtree instead of
        // demanding the pre-delete fingerprint from an intentionally partial deletion.
        rmSync(copy.rootDir, { recursive: true, force: false });
      }
      if (existsSync(copy.rootDir)) {
        throw new Error(`identity-bearing copy still exists after retirement: ${copy.copyId}`);
      }
      appendRecord(auditRootDir, requestId, now, {
        type: 'identity-bearing-copy-retired',
        copyId: copy.copyId,
      });
      state = readState(auditRootDir, requestId);
    }
    if (
      state.status !== 'completed' &&
      state.copies.every((copy) => state.retiredCopyIds.includes(copy.copyId))
    ) {
      appendRecord(auditRootDir, requestId, now, { type: 'deletion-request-completed' });
    }
    return readState(auditRootDir, requestId);
  });
}

export function readLocalRuntimeTownParticipantDataLifecycleState(input: {
  readonly auditRootDir: string;
  readonly requestId: string;
}): LocalRuntimeTownParticipantDataLifecycleState {
  return readState(
    resolveNonEmpty(input.auditRootDir, 'auditRootDir'),
    requireRequestId(input.requestId),
  );
}

function readState(
  auditRootDir: string,
  requestId: string,
): LocalRuntimeTownParticipantDataLifecycleState {
  const records = readAndVerifyRecords(auditRootDir, requestId);
  const first = records[0];
  if (first === undefined || first.event.type !== 'deletion-request-recorded') {
    throw new Error(`participant data lifecycle request does not exist: ${requestId}`);
  }
  let preparedTarget: LocalRuntimeTownParticipantDataLifecycleState['preparedTarget'];
  let activatedTarget: LocalRuntimeTownParticipantDataLifecycleState['activatedTarget'];
  const retirementStartedCopyIds = new Set<string>();
  const retiredCopyIds = new Set<string>();
  let completed = false;
  for (const record of records.slice(1)) {
    const event = record.event;
    if (event.type === 'anonymized-copy-prepared') {
      if (preparedTarget !== undefined) throw new Error('duplicate anonymized-copy-prepared event');
      preparedTarget = {
        deletionId: event.deletionId,
        rootDir: event.targetRootDir,
        treeFingerprint: event.targetTreeFingerprint,
      };
    } else if (event.type === 'anonymized-copy-activated') {
      if (preparedTarget === undefined || activatedTarget !== undefined) {
        throw new Error('invalid anonymized-copy-activated event order');
      }
      activatedTarget = {
        rootDir: event.targetRootDir,
        resolvedRunManifestId: event.resolvedRunManifestId,
        healthVerifiedAt: event.healthVerifiedAt,
      };
    } else if (event.type === 'identity-bearing-copy-retirement-started') {
      if (activatedTarget === undefined || retirementStartedCopyIds.has(event.copyId)) {
        throw new Error('invalid identity-bearing-copy-retirement-started event order');
      }
      const copy = first.event.copies.find((candidate) => candidate.copyId === event.copyId);
      if (copy === undefined || copy.treeFingerprint !== event.expectedTreeFingerprint) {
        throw new Error('retirement intent does not match a registered copy');
      }
      retirementStartedCopyIds.add(event.copyId);
    } else if (event.type === 'identity-bearing-copy-retired') {
      if (!retirementStartedCopyIds.has(event.copyId) || retiredCopyIds.has(event.copyId)) {
        throw new Error('invalid identity-bearing-copy-retired event order');
      }
      retiredCopyIds.add(event.copyId);
    } else if (event.type === 'deletion-request-completed') {
      if (completed || first.event.copies.some((copy) => !retiredCopyIds.has(copy.copyId))) {
        throw new Error('invalid deletion-request-completed event order');
      }
      completed = true;
    } else {
      throw new Error(`duplicate deletion-request-recorded event in ${requestId}`);
    }
  }
  const pendingCopies = first.event.copies.filter((copy) => !retiredCopyIds.has(copy.copyId));
  const status: LocalRuntimeTownParticipantDataLifecycleState['status'] = completed
    ? 'completed'
    : retirementStartedCopyIds.size > 0
      ? 'retiring-identity-bearing-copies'
      : activatedTarget !== undefined
        ? 'anonymized-copy-activated'
        : preparedTarget !== undefined
          ? 'anonymized-copy-prepared'
          : 'requested';
  return {
    requestId: first.event.requestId,
    requestedAt: first.occurredAt,
    subjectReference: first.event.subjectReference,
    policy: first.event.policy,
    copies: first.event.copies,
    ...(preparedTarget === undefined ? {} : { preparedTarget }),
    ...(activatedTarget === undefined ? {} : { activatedTarget }),
    retirementStartedCopyIds: [...retirementStartedCopyIds].sort(),
    retiredCopyIds: [...retiredCopyIds].sort(),
    status,
    ...(pendingCopies.length === 0
      ? {}
      : { nextRetentionDeadlineAt: Math.min(...pendingCopies.map((copy) => copy.retireAfter)) }),
  };
}

function appendRecord(
  auditRootDir: string,
  requestId: string,
  occurredAt: number,
  event: ParticipantDataLifecycleEvent,
): void {
  const records = readAndVerifyRecords(auditRootDir, requestId, true);
  const previous = records.at(-1);
  const unsigned = {
    schemaVersion: LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION,
    sequence: (previous?.sequence ?? 0) + 1,
    eventId: `participant-data-lifecycle-event:${randomUUID()}`,
    occurredAt,
    previousRecordHash: previous?.recordHash ?? 'genesis',
    event,
  } as const;
  const record: LocalRuntimeTownParticipantDataLifecycleRecord = {
    ...unsigned,
    recordHash: hashRecord(unsigned),
  };
  const path = resolveAuditLogPath(auditRootDir, requestId);
  const descriptor = openSync(path, 'a', 0o600);
  try {
    appendFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function readAndVerifyRecords(
  auditRootDir: string,
  requestId: string,
  allowMissing = false,
): readonly LocalRuntimeTownParticipantDataLifecycleRecord[] {
  const path = resolveAuditLogPath(auditRootDir, requestId);
  if (!existsSync(path)) {
    if (allowMissing) return [];
    throw new Error(`participant data lifecycle request does not exist: ${requestId}`);
  }
  const serialized = readFileSync(path, 'utf8');
  if (serialized.length > 0 && !serialized.endsWith('\n')) {
    throw new Error('participant data lifecycle audit log has a partial final record');
  }
  const records = serialized
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as LocalRuntimeTownParticipantDataLifecycleRecord);
  let previousHash = 'genesis';
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const { recordHash, ...unsigned } = record;
    if (
      record.schemaVersion !== LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_LIFECYCLE_POLICY_VERSION ||
      record.sequence !== index + 1 ||
      record.previousRecordHash !== previousHash ||
      recordHash !== hashRecord(unsigned)
    ) {
      throw new Error(`participant data lifecycle audit integrity failed at sequence ${index + 1}`);
    }
    previousHash = recordHash;
  }
  return records;
}

function hashRecord(
  value: Omit<LocalRuntimeTownParticipantDataLifecycleRecord, 'recordHash'>,
): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function withRequestLock<T>(auditRootDir: string, requestId: string, run: () => T): T {
  mkdirSync(auditRootDir, { recursive: true, mode: 0o700 });
  const lockPath = `${resolveAuditLogPath(auditRootDir, requestId)}.lock`;
  let descriptor: number;
  try {
    descriptor = openSync(lockPath, 'wx', 0o600);
  } catch (error) {
    throw new Error(`participant data lifecycle request is locked: ${requestId}`, { cause: error });
  }
  try {
    return run();
  } finally {
    closeSync(descriptor);
    unlinkSync(lockPath);
  }
}

function resolveAuditLogPath(auditRootDir: string, requestId: string): string {
  const encoded = encodeURIComponent(requireRequestId(requestId));
  return join(auditRootDir, `${encoded}.jsonl`);
}

function readDeletionArtifact(
  targetRootDir: string,
): LocalRuntimeTownParticipantDataDeletionArtifact {
  const path = join(targetRootDir, LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME);
  if (!existsSync(path)) {
    throw new Error(
      `anonymized target is missing ${LOCAL_RUNTIME_TOWN_PARTICIPANT_DATA_DELETION_ARTIFACT_FILENAME}`,
    );
  }
  const artifact = JSON.parse(
    readFileSync(path, 'utf8'),
  ) as LocalRuntimeTownParticipantDataDeletionArtifact;
  if (
    artifact.schemaVersion !== 'participant-data-deletion-v1' ||
    artifact.status !== 'anonymized-copy-ready-for-explicit-activation'
  ) {
    throw new Error('anonymized target has an unsupported deletion artifact');
  }
  return artifact;
}

function validateIdentityBearingCopyRoot(input: {
  readonly value: string;
  readonly auditRootDir: string;
  readonly name: string;
}): string {
  const rootDir = resolveNonEmpty(input.value, input.name);
  assertSafeRetirableRoot(rootDir, input.name);
  if (isSameOrNested(rootDir, input.auditRootDir) || isSameOrNested(input.auditRootDir, rootDir)) {
    throw new Error(`${input.name} and auditRootDir must be disjoint`);
  }
  if (!existsSync(rootDir)) throw new Error(`${input.name} does not exist: ${rootDir}`);
  fingerprintLocalRuntimeTownTree(rootDir);
  return rootDir;
}

function validateAnonymizedTargetRoot(
  value: string,
  auditRootDir: string,
  copies: readonly LocalRuntimeTownParticipantDataCopy[],
): string {
  const rootDir = resolveNonEmpty(value, 'targetRootDir');
  if (!existsSync(rootDir)) throw new Error(`targetRootDir does not exist: ${rootDir}`);
  if (
    isSameOrNested(rootDir, auditRootDir) ||
    isSameOrNested(auditRootDir, rootDir) ||
    copies.some(
      (copy) => isSameOrNested(rootDir, copy.rootDir) || isSameOrNested(copy.rootDir, rootDir),
    )
  ) {
    throw new Error('anonymized target, audit root and identity-bearing copies must be disjoint');
  }
  return rootDir;
}

function assertDisjointRoots(roots: readonly string[]): void {
  for (let left = 0; left < roots.length; left += 1) {
    for (let right = left + 1; right < roots.length; right += 1) {
      if (
        isSameOrNested(roots[left]!, roots[right]!) ||
        isSameOrNested(roots[right]!, roots[left]!)
      ) {
        throw new Error('participant data lifecycle copy roots must be disjoint');
      }
    }
  }
}

function isSameOrNested(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function assertSafeRetirableRoot(rootDir: string, name: string): void {
  const filesystemRoot = parse(rootDir).root;
  if (rootDir === filesystemRoot || dirname(rootDir) === filesystemRoot) {
    throw new Error(`${name} is too broad to be an identity-bearing copy root`);
  }
}

function resolveNonEmpty(value: string, name: string): string {
  return resolve(requireNonEmpty(value, name));
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must be non-empty`);
  return normalized;
}

function requireRequestId(value: string): string {
  const requestId = requireNonEmpty(value, 'requestId');
  if (!/^participant-deletion-request:[0-9a-f-]{36}$/u.test(requestId)) {
    throw new Error('requestId has an unsupported format');
  }
  return requestId;
}

function assertAuditHmacKey(value: Uint8Array): void {
  if (value.byteLength < 32) throw new Error('auditHmacKey must contain at least 32 bytes');
}

function assertTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function assertPositiveDuration(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive safe-integer duration in milliseconds`);
  }
}

function addDuration(timestamp: number, duration: number): number {
  const result = timestamp + duration;
  if (!Number.isSafeInteger(result)) {
    throw new Error('participant data lifecycle retention deadline exceeds safe integer range');
  }
  return result;
}
