import { describe, expect, test } from 'vitest';
import { createRuntimeSchedulerApiService } from './index';

type TestSchedulerStatus = {
  readonly running: boolean;
  readonly attemptedScheduleCount: number;
};

type TestSchedulerDecision =
  | {
      readonly status: 'enqueued';
      readonly jobId: string;
    }
  | {
      readonly status: 'skipped';
      readonly reason: 'pending-job-limit-reached';
    };

describe('runtime scheduler API service', () => {
  test('delegates scheduler status, lifecycle, and run-once operations to the control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeSchedulerApiService<TestSchedulerStatus, TestSchedulerDecision>({
      control: {
        getStatus: () => {
          calls.push({ method: 'getStatus' });
          return Promise.resolve({ running: false, attemptedScheduleCount: 0 });
        },
        start: () => {
          calls.push({ method: 'start' });
          return Promise.resolve({ running: true, attemptedScheduleCount: 0 });
        },
        stop: () => {
          calls.push({ method: 'stop' });
          return Promise.resolve({ running: false, attemptedScheduleCount: 1 });
        },
        runOnce: () => {
          calls.push({ method: 'runOnce' });
          return Promise.resolve({
            status: 'skipped',
            reason: 'pending-job-limit-reached',
          });
        },
      },
    });

    await expect(service.getRuntimeSchedulerStatus()).resolves.toEqual({
      running: false,
      attemptedScheduleCount: 0,
    });
    await expect(service.startRuntimeScheduler()).resolves.toEqual({
      running: true,
      attemptedScheduleCount: 0,
    });
    await expect(service.runRuntimeSchedulerOnce()).resolves.toEqual({
      status: 'skipped',
      reason: 'pending-job-limit-reached',
    });
    await expect(service.stopRuntimeScheduler()).resolves.toEqual({
      running: false,
      attemptedScheduleCount: 1,
    });
    expect(calls).toEqual([
      { method: 'getStatus' },
      { method: 'start' },
      { method: 'runOnce' },
      { method: 'stop' },
    ]);
  });
});
