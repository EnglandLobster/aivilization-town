import { describe, expect, test } from 'vitest';
import { createLocalSimulationRuntimeRecoveryApiService } from './index';
import type {
  LocalSimulationRuntimeRecoveryHost,
  LocalSimulationRuntimeRecoveryHostStatus,
  LocalSimulationRuntimeRecoveryReport,
} from './localSimulationRuntimeRecovery';

describe('local simulation runtime recovery API adapter', () => {
  test('maps API recovery controls onto the local recovery host', async () => {
    const calls: unknown[] = [];
    let running = false;
    let attemptedRecoveryCount = 0;
    const service = createLocalSimulationRuntimeRecoveryApiService({
      host: createHost({
        getStatus: () => ({
          running,
          inFlight: false,
          recoveryIntervalMs: 1000,
          attemptedRecoveryCount,
          recoveredCount: attemptedRecoveryCount,
          idleCount: 0,
        }),
        start: () => {
          calls.push({ method: 'start' });
          running = true;
        },
        stop: () => {
          calls.push({ method: 'stop' });
          running = false;
        },
        runOnce: () => {
          calls.push({ method: 'runOnce' });
          attemptedRecoveryCount += 1;
          return Promise.resolve(createReport(100));
        },
      }),
    });

    await expect(service.startRuntimeRecovery()).resolves.toMatchObject({
      running: true,
      attemptedRecoveryCount: 0,
    });
    await expect(service.runRuntimeRecoveryOnce()).resolves.toMatchObject({
      status: 'recovered',
      observedAt: 100,
    });
    await expect(service.stopRuntimeRecovery()).resolves.toMatchObject({
      running: false,
      attemptedRecoveryCount: 1,
    });
    await expect(service.getRuntimeRecoveryStatus()).resolves.toMatchObject({
      running: false,
      attemptedRecoveryCount: 1,
      recoveredCount: 1,
    });
    expect(calls).toEqual([{ method: 'start' }, { method: 'runOnce' }, { method: 'stop' }]);
  });
});

function createHost(input: {
  readonly getStatus: () => LocalSimulationRuntimeRecoveryHostStatus;
  readonly start: () => void;
  readonly stop: () => void;
  readonly runOnce: () => Promise<LocalSimulationRuntimeRecoveryReport>;
}): LocalSimulationRuntimeRecoveryHost {
  return {
    runOnce: input.runOnce,
    start: input.start,
    stop: input.stop,
    getStatus: input.getStatus,
  };
}

function createReport(observedAt: number): LocalSimulationRuntimeRecoveryReport {
  const stats = {
    observedAt,
    manifestId: 'town-runtime',
    totalJobCount: 0,
    statusCounts: {
      queued: 0,
      leased: 0,
      completed: 0,
      failed: 0,
      'dead-lettered': 0,
    },
    readyQueueCount: 0,
    delayedQueueCount: 0,
    activeLeaseCount: 0,
    expiredLeaseCount: 0,
    failedAttemptCount: 0,
    replayCount: 0,
  };
  return {
    status: 'recovered',
    observedAt,
    statsBeforeRecovery: stats,
    replayedDeadLetterJobs: [],
    skippedDeadLetterJobs: [],
    statsAfterRecovery: stats,
  };
}
