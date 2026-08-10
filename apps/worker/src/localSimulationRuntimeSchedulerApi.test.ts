import { describe, expect, test } from 'vitest';
import { createLocalSimulationRuntimeSchedulerApiService } from './index';
import type {
  LocalSimulationRuntimeSchedulerDecision,
  LocalSimulationRuntimeSchedulerHost,
  LocalSimulationRuntimeSchedulerHostStatus,
} from './localSimulationRuntimeScheduler';

describe('local simulation runtime scheduler API adapter', () => {
  test('maps API scheduler controls onto the local scheduler host', async () => {
    const calls: unknown[] = [];
    let running = false;
    let attemptedScheduleCount = 0;
    const service = createLocalSimulationRuntimeSchedulerApiService({
      host: createHost({
        getStatus: () => ({
          running,
          inFlight: false,
          scheduleIntervalMs: 1000,
          attemptedScheduleCount,
          enqueuedScheduleCount: attemptedScheduleCount,
          skippedScheduleCount: 0,
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
          attemptedScheduleCount += 1;
          return Promise.resolve({
            status: 'enqueued',
            job: {
              jobId: 'job-scheduled-1',
              manifestId: 'town-runtime',
              enqueuedAt: 100,
              runRequest: { operationId: 'op-scheduled-1', requestedAt: 100, cycleCount: 1 },
              status: 'queued',
              updatedAt: 100,
            },
            statsBeforeSchedule: {
              observedAt: 100,
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
            },
          });
        },
      }),
    });

    await expect(service.startRuntimeScheduler()).resolves.toMatchObject({
      running: true,
      attemptedScheduleCount: 0,
    });
    await expect(service.runRuntimeSchedulerOnce()).resolves.toMatchObject({
      status: 'enqueued',
      job: { jobId: 'job-scheduled-1', status: 'queued' },
    });
    await expect(service.stopRuntimeScheduler()).resolves.toMatchObject({
      running: false,
      attemptedScheduleCount: 1,
    });
    await expect(service.getRuntimeSchedulerStatus()).resolves.toMatchObject({
      running: false,
      attemptedScheduleCount: 1,
      enqueuedScheduleCount: 1,
    });
    expect(calls).toEqual([{ method: 'start' }, { method: 'runOnce' }, { method: 'stop' }]);
  });
});

function createHost(input: {
  readonly getStatus: () => LocalSimulationRuntimeSchedulerHostStatus;
  readonly start: () => void;
  readonly stop: () => void;
  readonly runOnce: () => Promise<LocalSimulationRuntimeSchedulerDecision>;
}): LocalSimulationRuntimeSchedulerHost {
  return {
    runOnce: input.runOnce,
    start: input.start,
    stop: input.stop,
    getStatus: input.getStatus,
  };
}
