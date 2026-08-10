import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { deleteLocalRuntimeTownParticipantData } from './localRuntimeTownParticipantDataDeletion';
import {
  createLocalRuntimeTownParticipantDataLifecycleRequest,
  readLocalRuntimeTownParticipantDataLifecycleState,
  recordLocalRuntimeTownParticipantDataAnonymizedCopyActivated,
  recordLocalRuntimeTownParticipantDataAnonymizedCopyPrepared,
  retireDueLocalRuntimeTownParticipantDataCopies,
} from './localRuntimeTownParticipantDataLifecycle';
import { resolveLocalRuntimeTownParticipantDataLifecycleCliConfig } from './localRuntimeTownParticipantDataLifecycleCli';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('local runtime participant data lifecycle', () => {
  test('audits a deletion request and irreversibly retires due source and backup copies', () => {
    const parent = mkdtempSync(join(tmpdir(), 'participant-data-lifecycle-'));
    roots.push(parent);
    const sourceRootDir = join(parent, 'identity-source');
    const backupRootDir = join(parent, 'identity-backup');
    const targetRootDir = join(parent, 'anonymous-target');
    const auditRootDir = join(parent, 'audit-ledger');
    mkdirSync(sourceRootDir, { recursive: true });
    writeFileSync(join(sourceRootDir, 'participant.json'), '{"subject":"participant-11"}\n');
    cpSync(sourceRootDir, backupRootDir, { recursive: true, preserveTimestamps: true });

    const requested = createLocalRuntimeTownParticipantDataLifecycleRequest({
      auditRootDir,
      participantSubjectId: 'participant-11',
      auditHmacKey: Buffer.alloc(32, 7),
      sourceRootDir,
      backupRootDirs: [backupRootDir],
      directIdentityRetentionMs: 100,
      backupRetentionMs: 200,
      sourceWritersConfirmedStopped: true,
      requestedAt: 1_000,
    });

    expect(requested).toMatchObject({
      requestedAt: 1_000,
      status: 'requested',
      policy: {
        policyVersion: 'participant-data-lifecycle-v1',
        directIdentityRetentionMs: 100,
        backupRetentionMs: 200,
      },
    });
    expect(requested.subjectReference).toMatch(/^hmac-sha256:[0-9a-f]{64}$/u);
    expect(readFileSync(join(auditRootDir, readdirSync(auditRootDir)[0]!), 'utf8')).not.toContain(
      'participant-11',
    );

    deleteLocalRuntimeTownParticipantData({
      sourceRootDir,
      targetRootDir,
      participantSubjectId: 'participant-11',
      tombstoneSubjectId: 'deleted-participant:lifecycle-test',
      createdAt: 1_010,
    });
    expect(
      recordLocalRuntimeTownParticipantDataAnonymizedCopyPrepared({
        auditRootDir,
        requestId: requested.requestId,
        targetRootDir,
        occurredAt: 1_020,
      }).status,
    ).toBe('anonymized-copy-prepared');
    expect(
      recordLocalRuntimeTownParticipantDataAnonymizedCopyActivated({
        auditRootDir,
        requestId: requested.requestId,
        targetRootDir,
        resolvedRunManifestId: 'resolved-run-manifest:test',
        healthVerifiedAt: 1_030,
        activationConfirmed: true,
        occurredAt: 1_030,
      }).status,
    ).toBe('anonymized-copy-activated');

    const beforeDeadline = retireDueLocalRuntimeTownParticipantDataCopies({
      auditRootDir,
      requestId: requested.requestId,
      now: 1_099,
      sourceWritersConfirmedStopped: true,
      irreversibleRetirementConfirmed: true,
    });
    expect(beforeDeadline.retiredCopyIds).toEqual([]);
    expect(existsSync(sourceRootDir)).toBe(true);
    expect(existsSync(backupRootDir)).toBe(true);

    const sourceRetired = retireDueLocalRuntimeTownParticipantDataCopies({
      auditRootDir,
      requestId: requested.requestId,
      now: 1_100,
      sourceWritersConfirmedStopped: true,
      irreversibleRetirementConfirmed: true,
    });
    expect(sourceRetired.status).toBe('retiring-identity-bearing-copies');
    expect(sourceRetired.retiredCopyIds).toHaveLength(1);
    expect(existsSync(sourceRootDir)).toBe(false);
    expect(existsSync(backupRootDir)).toBe(true);

    const completed = retireDueLocalRuntimeTownParticipantDataCopies({
      auditRootDir,
      requestId: requested.requestId,
      now: 1_200,
      sourceWritersConfirmedStopped: true,
      irreversibleRetirementConfirmed: true,
    });
    expect(completed.status).toBe('completed');
    expect(completed.retiredCopyIds).toHaveLength(2);
    expect(existsSync(backupRootDir)).toBe(false);
    expect(existsSync(targetRootDir)).toBe(true);
    expect(
      readLocalRuntimeTownParticipantDataLifecycleState({
        auditRootDir,
        requestId: requested.requestId,
      }),
    ).toEqual(completed);
  });

  test('fails closed when the append-only audit chain is modified', () => {
    const parent = mkdtempSync(join(tmpdir(), 'participant-data-lifecycle-tamper-'));
    roots.push(parent);
    const sourceRootDir = join(parent, 'identity-source');
    const auditRootDir = join(parent, 'audit-ledger');
    mkdirSync(sourceRootDir, { recursive: true });
    writeFileSync(join(sourceRootDir, 'runtime.json'), '{}\n');
    const state = createLocalRuntimeTownParticipantDataLifecycleRequest({
      auditRootDir,
      participantSubjectId: 'participant-12',
      auditHmacKey: Buffer.alloc(32, 8),
      sourceRootDir,
      directIdentityRetentionMs: 100,
      backupRetentionMs: 200,
      sourceWritersConfirmedStopped: true,
      requestedAt: 2_000,
    });
    const auditPath = join(auditRootDir, readdirSync(auditRootDir)[0]!);
    writeFileSync(auditPath, readFileSync(auditPath, 'utf8').replace('200', '201'), 'utf8');

    expect(() =>
      readLocalRuntimeTownParticipantDataLifecycleState({
        auditRootDir,
        requestId: state.requestId,
      }),
    ).toThrow('audit integrity failed');
  });

  test('keeps subject and audit key material out of command-line arguments', () => {
    const parent = mkdtempSync(join(tmpdir(), 'participant-data-lifecycle-cli-'));
    roots.push(parent);
    writeFileSync(join(parent, 'subject-id'), 'participant-13\n', { mode: 0o600 });
    writeFileSync(join(parent, 'audit-key'), `${Buffer.alloc(32, 9).toString('base64')}\n`, {
      mode: 0o600,
    });

    expect(
      resolveLocalRuntimeTownParticipantDataLifecycleCliConfig({
        cwd: parent,
        argv: [
          'request',
          '--audit-root-dir',
          'audit',
          '--subject-id-file',
          'subject-id',
          '--audit-key-file',
          'audit-key',
          '--source-root-dir',
          'source',
          '--backup-root-dir',
          'backup-a',
          '--backup-root-dir=backup-b',
          '--direct-retention-days',
          '7',
          '--backup-retention-days',
          '30',
          '--confirm-copy-writers-stopped',
        ],
      }),
    ).toMatchObject({
      operation: 'request',
      participantSubjectId: 'participant-13',
      sourceRootDir: join(parent, 'source'),
      backupRootDirs: [join(parent, 'backup-a'), join(parent, 'backup-b')],
      directIdentityRetentionMs: 7 * 24 * 60 * 60 * 1_000,
      backupRetentionMs: 30 * 24 * 60 * 60 * 1_000,
      sourceWritersConfirmedStopped: true,
    });
  });
});
