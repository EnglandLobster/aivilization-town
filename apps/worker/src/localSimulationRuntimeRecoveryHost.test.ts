import { describe, expect, test } from 'vitest';
import { createLocalSimulationRuntimeRecoveryHost } from './index';
import type {
  LocalSimulationRuntimeRecovery,
  LocalSimulationRuntimeRecoveryReport,
  LocalSimulationRuntimeRecoveryRequest,
} from './localSimulationRuntimeRecovery';
import type { LocalSimulationRuntimeRunQueueStats } from './localSimulationRuntimeRunQueue';

describe('local simulation runtime recovery host', () => {
  test('runs recovery with injected time and reports counters', async () => {
    const calls: number[] = [];
    const host = createLocalSimulationRuntimeRecoveryHost({
      recovery: createRecovery([createReport('recovered', 100), createReport('idle', 200)], calls),
      recoveryIntervalMs: 25,
      clock: createClock([100, 150, 200, 250]),
    });

    await expect(host.runOnce()).resolves.toMatchObject({ status: 'recovered' });
    await expect(host.runOnce()).resolves.toMatchObject({ status: 'idle' });
    expect(calls).toEqual([100, 200]);
    expect(host.getStatus()).toMatchObject({
      running: false,
      inFlight: false,
      recoveryIntervalMs: 25,
      attemptedRecoveryCount: 2,
      recoveredCount: 1,
      idleCount: 1,
      lastRecoveryStartedAt: 200,
      lastRecoveryCompletedAt: 250,
      lastReport: { status: 'idle', observedAt: 200 },
    });
  });

  test('starts and stops a single timer loop', () => {
    const scheduled: { readonly delayMs: number; readonly callback: () => void }[] = [];
    const cleared: unknown[] = [];
    const host = createLocalSimulationRuntimeRecoveryHost({
      recovery: createRecovery([createReport('idle', 100)], []),
      recoveryIntervalMs: 40,
      clock: createClock([100, 150]),
      timer: {
        setTimeout: (callback, delayMs) => {
          const handle = { delayMs };
          scheduled.push({ callback, delayMs });
          return handle;
        },
        clearTimeout: (handle) => {
          cleared.push(handle);
        },
      },
    });

    host.start();
    host.start();
    expect(host.getStatus()).toMatchObject({ running: true, inFlight: false });
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([0]);

    host.stop();
    expect(host.getStatus()).toMatchObject({ running: false, inFlight: false });
    expect(cleared).toEqual([{ delayMs: 0 }]);
  });
});

function createRecovery(
  reports: LocalSimulationRuntimeRecoveryReport[],
  calls: number[],
): LocalSimulationRuntimeRecovery {
  return {
    recover: (request: LocalSimulationRuntimeRecoveryRequest) => {
      calls.push(request.observedAt);
      const report = reports.shift();
      if (report === undefined) {
        throw new Error('recovery exhausted');
      }
      return Promise.resolve(report);
    },
  };
}

function createReport(
  status: 'idle' | 'recovered',
  observedAt: number,
): LocalSimulationRuntimeRecoveryReport {
  const stats = createStats(observedAt);
  return {
    status,
    observedAt,
    statsBeforeRecovery: stats,
    replayedDeadLetterJobs: [],
    skippedDeadLetterJobs: [],
    statsAfterRecovery: stats,
  };
}

function createStats(observedAt: number): LocalSimulationRuntimeRunQueueStats {
  return {
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
}

function createClock(times: number[]): { readonly now: () => number } {
  return {
    now: () => {
      const next = times.shift();
      if (next === undefined) {
        throw new Error('clock exhausted');
      }
      return next;
    },
  };
}
