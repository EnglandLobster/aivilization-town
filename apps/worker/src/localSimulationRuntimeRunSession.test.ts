import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileLocalSimulationRuntimeRunSessionRepository,
  InMemoryLocalSimulationRuntimeRunSessionRepository,
  type LocalSimulationRuntimeRunSessionState,
} from './index';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local simulation runtime run session repository', () => {
  test('in-memory repository stores defensive clones of run session state', async () => {
    const repository = new InMemoryLocalSimulationRuntimeRunSessionRepository();
    const session = createRunningSession();

    await repository.save(session);

    (session.cycles as unknown as ReturnType<typeof createCycle>[]).push(createCycle(2, 150));
    const firstRead = await repository.get('op-run-session');
    expect(firstRead).toMatchObject({
      traceId: 'op-run-session',
      status: 'running',
      completedCycleCount: 1,
      cycles: [{ cycleIndex: 1 }],
    });
    expect(firstRead?.cycles).toHaveLength(1);

    (firstRead?.cycles as unknown as ReturnType<typeof createCycle>[] | undefined)?.push(
      createCycle(3, 200),
    );
    await expect(repository.get('op-run-session')).resolves.toMatchObject({
      cycles: [{ cycleIndex: 1 }],
    });
  });

  test('file repository returns the latest run session after restart', async () => {
    const rootDir = createRootDir();
    const firstRepository = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    await firstRepository.save(createRunningSession());

    const restartedRepository = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    await expect(restartedRepository.get('op-run-session')).resolves.toMatchObject({
      traceId: 'op-run-session',
      status: 'running',
      completedCycleCount: 1,
      cycles: [{ cycleIndex: 1 }],
    });

    await restartedRepository.save({
      ...createRunningSession(),
      status: 'completed',
      outcome: 'succeeded',
      stopReason: 'cycle-count-completed',
      completedCycleCount: 2,
      cycles: [createCycle(1, 100), createCycle(2, 150)],
      updatedAt: 150,
    });

    const finalRepository = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    await expect(finalRepository.get('op-run-session')).resolves.toMatchObject({
      traceId: 'op-run-session',
      status: 'completed',
      outcome: 'succeeded',
      stopReason: 'cycle-count-completed',
      completedCycleCount: 2,
      cycles: [{ cycleIndex: 1 }, { cycleIndex: 2 }],
      updatedAt: 150,
    });
  });

  test('file repository records the first stop request and recovers it after restart', async () => {
    const rootDir = createRootDir();
    const firstRepository = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    await firstRepository.save(createRunningSession());

    await expect(
      firstRepository.requestStop({ traceId: 'op-run-session', requestedAt: 125 }),
    ).resolves.toMatchObject({
      traceId: 'op-run-session',
      status: 'running',
      stopRequestedAt: 125,
      updatedAt: 125,
    });

    const restartedRepository = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    await expect(restartedRepository.get('op-run-session')).resolves.toMatchObject({
      traceId: 'op-run-session',
      stopRequestedAt: 125,
      updatedAt: 125,
    });
    await expect(
      restartedRepository.requestStop({ traceId: 'op-run-session', requestedAt: 175 }),
    ).resolves.toMatchObject({
      traceId: 'op-run-session',
      stopRequestedAt: 125,
      updatedAt: 125,
    });
    await expect(
      restartedRepository.requestStop({ traceId: 'missing-run-session', requestedAt: 200 }),
    ).resolves.toBeUndefined();
  });

  test('persists cycle progress with linear-size delta records', async () => {
    const rootDir = createRootDir();
    const repository = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    const cycles: ReturnType<typeof createCycle>[] = [];
    await repository.save({
      ...createRunningSession(),
      requestedCycleCount: 200,
      completedCycleCount: 0,
      cycles: [],
    });
    for (let cycleIndex = 1; cycleIndex <= 200; cycleIndex += 1) {
      const cycle = createCycle(cycleIndex, 100 + cycleIndex * 50);
      cycles.push(cycle);
      await repository.appendCycle({
        traceId: 'op-run-session',
        cycle,
        statusSnapshot: createStatus(cycleIndex),
        updatedAt: 100 + cycleIndex * 50,
      });
    }

    const ledgerPath = join(rootDir, 'supervisor-run-sessions.jsonl');
    expect(statSync(ledgerPath).size).toBeLessThan(500_000);
    const records = readFileSync(ledgerPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { appendedCycles: unknown[] });
    expect(records).toHaveLength(201);
    expect(records[0]?.appendedCycles).toHaveLength(0);
    expect(records.slice(1).every((record) => record.appendedCycles.length === 1)).toBe(true);

    const restarted = new FileLocalSimulationRuntimeRunSessionRepository({ rootDir });
    const recovered = await restarted.get('op-run-session');
    expect(recovered).toMatchObject({ completedCycleCount: 200 });
    expect(recovered?.cycles).toHaveLength(200);
    expect(recovered?.cycles[0]).toMatchObject({ cycleIndex: 1 });
    expect(recovered?.cycles.at(-1)).toMatchObject({ cycleIndex: 200 });
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-run-session-'));
  tmpRoots.push(root);
  return root;
}

function createRunningSession(): LocalSimulationRuntimeRunSessionState {
  return {
    traceId: 'op-run-session',
    manifestId: 'town-runtime',
    requestedAt: 100,
    requestedCycleCount: 2,
    cycleIntervalMs: 50,
    stopOnAttention: true,
    status: 'running',
    completedCycleCount: 1,
    cycles: [createCycle(1, 100)],
    statusSnapshot: createStatus(1),
    updatedAt: 100,
  };
}

function createCycle(cycleIndex: number, requestedAt: number) {
  return {
    cycleIndex,
    traceId: `op-run-session:cycle:${cycleIndex}`,
    requestedAt,
    outcome: 'succeeded' as const,
    succeededPartitionCount: 2,
    failedPartitionCount: 0,
    attentionPartitionCount: 0,
  };
}

function createStatus(nextTickIndex: number) {
  return {
    manifestId: 'town-runtime',
    partitionCount: 1,
    healthyPartitionCount: 1,
    attentionPartitionCount: 0,
    partitions: [
      {
        simulationId: 'sim-1',
        partitionKey: 'world-main',
        scenarioPresetId: 'scenario-main',
        status: 'completed' as const,
        health: 'healthy' as const,
        initializedCheckpoint: true,
        seededAgentCount: 1,
        skippedAgentCount: 0,
        lastAppliedSequence: nextTickIndex - 1,
        nextTickIndex,
        updatedAt: 100,
      },
    ],
  };
}
