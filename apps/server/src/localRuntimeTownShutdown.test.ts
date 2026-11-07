import { expect, test } from 'vitest';
import {
  createLocalSimulationRuntimeRecoveryHost,
  type LocalSimulationRuntimeRecoveryReport,
} from '@aivilization/worker';
import { createLocalSimulationRuntimeRunQueueWorkerHost } from '@aivilization/worker';
import {
  createLocalSimulationRuntimeSchedulerHost,
  type LocalSimulationRuntimeSchedulerDecision,
} from '@aivilization/worker';
import { shutdownLocalRuntimeTownOrchestration } from './localRuntimeTownOrchestration';
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const stats = {
  observedAt: 0,
  manifestId: 'test',
  totalJobCount: 0,
  statusCounts: { queued: 0, leased: 0, completed: 0, failed: 0, 'dead-lettered': 0 },
  readyQueueCount: 0,
  delayedQueueCount: 0,
  activeLeaseCount: 0,
  expiredLeaseCount: 0,
  failedAttemptCount: 0,
  replayCount: 0,
};
test('shutdown drains producers before consumer so admitted recovery can finish a queue operation', async () => {
  const release = gate<void>();
  let calls = 0;
  const worker = createLocalSimulationRuntimeRunQueueWorkerHost({
    worker: {
      runNext: () => {
        calls++;
        return Promise.resolve({ status: 'idle' as const });
      },
    },
    pollIntervalMs: 100,
  });
  const recovery = createLocalSimulationRuntimeRecoveryHost({
    recovery: {
      recover: async () => {
        await release.promise;
        await worker.runOnce();
        return {
          status: 'idle',
          observedAt: 0,
          statsBeforeRecovery: stats,
          statsAfterRecovery: stats,
          replayedDeadLetterJobs: [],
          skippedDeadLetterJobs: [],
        };
      },
    },
    recoveryIntervalMs: 100,
  });
  const admitted = recovery.runOnce();
  const closing = shutdownLocalRuntimeTownOrchestration({
    runQueueWorkerHost: worker,
    runQueueRecoveryHost: recovery,
  });
  let done = false;
  void closing.then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  await expect(recovery.runOnce()).rejects.toThrow('runtime-host-shutdown');
  release.resolve();
  await admitted;
  await closing;
  expect(calls).toBe(1);
  await expect(worker.runOnce()).rejects.toThrow('runtime-host-shutdown');
});
test('producer failure still drains consumer and does not report successful shutdown', async () => {
  const pending = gate<LocalSimulationRuntimeRecoveryReport>();
  const worker = createLocalSimulationRuntimeRunQueueWorkerHost({
    worker: { runNext: () => Promise.resolve({ status: 'idle' as const }) },
    pollIntervalMs: 100,
  });
  const recovery = createLocalSimulationRuntimeRecoveryHost({
    recovery: { recover: () => pending.promise },
    recoveryIntervalMs: 100,
  });
  const run = recovery.runOnce();
  const failure = expect(run).rejects.toThrow('failure');
  const close = shutdownLocalRuntimeTownOrchestration({
    runQueueWorkerHost: worker,
    runQueueRecoveryHost: recovery,
  });
  const closedFailure = expect(close).rejects.toThrow('runtime-orchestration-shutdown-failed');
  pending.reject(Error('failure'));
  await failure;
  await closedFailure;
  await expect(worker.runOnce()).rejects.toThrow('runtime-host-shutdown');
});
test('scheduler concurrent manual calls remain in flight until both actually settle', async () => {
  const a = gate<LocalSimulationRuntimeSchedulerDecision>(),
    b = gate<LocalSimulationRuntimeSchedulerDecision>();
  let calls = 0;
  const host = createLocalSimulationRuntimeSchedulerHost({
    scheduler: { schedule: () => (calls++ === 0 ? a.promise : b.promise) },
    scheduleIntervalMs: 100,
  });
  const first = host.runOnce(),
    second = host.runOnce(),
    closing = host.shutdown();
  const decision = {
    status: 'skipped' as const,
    reason: 'pending-job-limit-reached' as const,
    statsBeforeSchedule: stats,
  };
  a.resolve(decision);
  await first;
  expect(host.getStatus().inFlight).toBe(true);
  b.resolve(decision);
  await second;
  await closing;
  expect(host.getStatus().inFlight).toBe(false);
  expect(() => host.start()).toThrow('runtime-host-shutdown');
});
