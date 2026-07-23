import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { FileParticipantMutationRateLimitPort } from './localRuntimeTownParticipantAccess';

describe('durable participant mutation rate limits', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preserves the active rate window across process-level repository recreation', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-participant-rate-limit-'));
    roots.push(rootDir);
    const request = {
      principalSubjectId: 'participant-7',
      category: 'steering' as const,
      occurredAt: 1_000,
      limit: 2,
      windowMs: 10_000,
    };
    const firstProcess = new FileParticipantMutationRateLimitPort({ rootDir });

    await expect(firstProcess.consume(request)).resolves.toEqual({
      status: 'accepted',
      remaining: 1,
    });
    await expect(firstProcess.consume({ ...request, occurredAt: 2_000 })).resolves.toEqual({
      status: 'accepted',
      remaining: 0,
    });

    const restartedProcess = new FileParticipantMutationRateLimitPort({ rootDir });
    await expect(restartedProcess.consume({ ...request, occurredAt: 3_000 })).resolves.toEqual({
      status: 'rejected',
      retryAfterMs: 8_000,
    });
    await expect(restartedProcess.consume({ ...request, occurredAt: 12_000 })).resolves.toEqual({
      status: 'accepted',
      remaining: 1,
    });
  });
});
