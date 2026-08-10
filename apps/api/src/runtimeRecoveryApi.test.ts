import { describe, expect, test } from 'vitest';
import { createRuntimeRecoveryApiService } from './index';

type TestRecoveryStatus = {
  readonly running: boolean;
  readonly attemptedRecoveryCount: number;
};

type TestRecoveryReport = {
  readonly status: 'idle' | 'recovered';
  readonly observedAt: number;
};

describe('runtime recovery API service', () => {
  test('delegates recovery status, lifecycle, and run-once operations to the control port', async () => {
    const calls: unknown[] = [];
    const service = createRuntimeRecoveryApiService<TestRecoveryStatus, TestRecoveryReport>({
      control: {
        getStatus: () => {
          calls.push({ method: 'getStatus' });
          return Promise.resolve({ running: false, attemptedRecoveryCount: 0 });
        },
        start: () => {
          calls.push({ method: 'start' });
          return Promise.resolve({ running: true, attemptedRecoveryCount: 0 });
        },
        stop: () => {
          calls.push({ method: 'stop' });
          return Promise.resolve({ running: false, attemptedRecoveryCount: 1 });
        },
        runOnce: () => {
          calls.push({ method: 'runOnce' });
          return Promise.resolve({ status: 'recovered', observedAt: 200 });
        },
      },
    });

    await expect(service.getRuntimeRecoveryStatus()).resolves.toEqual({
      running: false,
      attemptedRecoveryCount: 0,
    });
    await expect(service.startRuntimeRecovery()).resolves.toEqual({
      running: true,
      attemptedRecoveryCount: 0,
    });
    await expect(service.runRuntimeRecoveryOnce()).resolves.toEqual({
      status: 'recovered',
      observedAt: 200,
    });
    await expect(service.stopRuntimeRecovery()).resolves.toEqual({
      running: false,
      attemptedRecoveryCount: 1,
    });
    expect(calls).toEqual([
      { method: 'getStatus' },
      { method: 'start' },
      { method: 'runOnce' },
      { method: 'stop' },
    ]);
  });
});
