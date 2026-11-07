import { expect, test } from 'vitest';
import { RuntimeOperationDrain } from './runtimeOperationDrain';
import { createLocalSimulationRuntimeRunQueueWorkerHost } from './localSimulationRuntimeRunQueueWorkerHost';
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
test('close waits for all admitted operations, rejects new work and is idempotent', async () => {
  const scope = new RuntimeOperationDrain();
  const a = gate<number>(),
    b = gate<number>();
  const first = scope.run(() => a.promise),
    second = scope.run(() => b.promise);
  const closed = scope.close();
  expect(scope.close()).toBe(closed);
  let done = false;
  void closed.then(() => {
    done = true;
  });
  a.resolve(1);
  await first;
  await Promise.resolve();
  expect(scope.inFlight).toBe(true);
  expect(done).toBe(false);
  await expect(scope.run(() => Promise.resolve(99))).rejects.toThrow('runtime-host-shutdown');
  b.resolve(2);
  await second;
  await closed;
  expect(scope.inFlight).toBe(false);
  expect(done).toBe(true);
});
test('failure during closing is reported after remaining work drains, not swallowed', async () => {
  const scope = new RuntimeOperationDrain(),
    a = gate<number>(),
    b = gate<number>();
  const first = scope.run(() => a.promise),
    second = scope.run(() => b.promise);
  const firstError = expect(first).rejects.toThrow('write failed');
  const close = scope.close();
  const closeError = expect(close).rejects.toThrow('runtime-host-shutdown-failed');
  a.reject(new Error('write failed'));
  await firstError;
  expect(scope.inFlight).toBe(true);
  b.resolve(2);
  await second;
  await closeError;
});
test('synchronous errors and reentrant close cannot escape admission tracking', async () => {
  const scope = new RuntimeOperationDrain();
  let closing: Promise<void> | undefined;
  const operation = scope.run(() => {
    closing = scope.close();
    throw Error('synchronous failure');
  });
  await expect(operation).rejects.toThrow('synchronous failure');
  await expect(closing).rejects.toThrow('runtime-host-shutdown-failed');
  expect(scope.inFlight).toBe(false);
});
test('worker shutdown waits for actual work, preserves stop/start behavior, and permanently rejects restart', async () => {
  const pending = gate<{ status: 'idle' }>();
  let calls = 0;
  const host = createLocalSimulationRuntimeRunQueueWorkerHost({
    worker: {
      runNext: () => {
        calls++;
        return pending.promise;
      },
    },
    pollIntervalMs: 100,
  });
  host.start();
  host.stop();
  host.start();
  host.stop();
  const run = host.runOnce();
  const closed = host.shutdown();
  expect(calls).toBe(1);
  expect(host.getStatus().inFlight).toBe(true);
  await expect(host.runOnce()).rejects.toThrow('runtime-host-shutdown');
  await expect(host.drain()).rejects.toThrow('runtime-host-shutdown');
  expect(() => host.start()).toThrow('runtime-host-shutdown');
  pending.resolve({ status: 'idle' });
  await run;
  await closed;
  expect(host.getStatus()).toMatchObject({ running: false, inFlight: false });
  expect(calls).toBe(1);
});
