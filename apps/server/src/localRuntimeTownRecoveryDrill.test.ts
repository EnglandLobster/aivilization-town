import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { runLocalRuntimeTownRecoveryDrill } from './localRuntimeTownRecoveryDrill';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town recovery drill', () => {
  test('restores a real checkpoint, advances after restart, and replays one dead letter', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'runtime-recovery-drill-'));
    roots.push(rootDir);
    let now = 1_000;
    const artifact = await runLocalRuntimeTownRecoveryDrill({
      rootDir,
      sourceRevision: {
        commit: '0123456789abcdef0123456789abcdef01234567',
        dirty: false,
      },
      clock: { now: () => now++ },
    });

    expect(artifact).toMatchObject({
      schemaVersion: 'local-runtime-recovery-drill-v1',
      status: 'pass',
      profileId: 'recovery-drill-25',
      dataCompatibility: {
        policy: { policyVersion: 'local-runtime-data-compatibility-v2' },
        marker: { dataLayoutVersion: 2, origin: 'initialized-empty-v2' },
      },
      checkpointRestore: {
        sameCheckpointReference: true,
        sameProjectionHash: true,
        advancedAfterRestart: true,
      },
      deadLetterRecovery: {
        injectedStatus: 'dead-lettered',
        recoveryStatus: 'recovered',
        replayedJobCount: 1,
        finalStatus: 'completed',
        replayCount: 1,
        attemptCount: 2,
      },
    });
    expect(artifact.checkpointRestore.restoredBeforeContinuation).toEqual(
      artifact.checkpointRestore.beforeRestart,
    );
    expect(artifact.checkpointRestore.afterContinuation.lastAppliedSequence).toBeGreaterThan(
      artifact.checkpointRestore.beforeRestart.lastAppliedSequence,
    );
    expect(existsSync(artifact.artifactPath)).toBe(true);
    expect(JSON.parse(readFileSync(artifact.artifactPath, 'utf8'))).toEqual(artifact);
  });
});
