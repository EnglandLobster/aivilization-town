import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createIntegratedSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import { startResidentServer } from './server';
import { loadResidentCredentials } from './credentials';
import {
  PARTITION_SCHEDULER_VERSION,
  type ResidentPartitionConfiguration,
} from './partitionExecution';
import { runResidentPartitionWorker } from './partitionWorker';
import { runResidentPartitionOpportunity } from './partitionRunner';
import { townRequest } from './townConnection';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of cleanup.splice(0).reverse()) await f();
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'partition-worker-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createIntegratedSocietyManifest({ count: 2 });
  const runtime = new OpenSocietyRuntime(join(root, 'world'), manifest);
  cleanup.push(() => runtime.close());
  const config: ResidentPartitionConfiguration = {
    version: PARTITION_SCHEDULER_VERSION,
    leaseMs: 60000,
    partitions: manifest.residents.map((r, i) => ({
      id: `p${i}`,
      token: String(i).repeat(64),
      actors: [r.id],
    })),
  };
  const credentials = loadResidentCredentials(
    join(root, 'world'),
    manifest.residents.map((r) => r.id),
  );
  const server = await startResidentServer(runtime, credentials, 0, { partitions: config });
  let closed = false;
  const closeServer = async () => {
    if (!closed) {
      await server.close();
      closed = true;
    }
  };
  cleanup.push(closeServer);
  return { root, manifest, runtime, config, credentials, server, closeServer };
}
test('persistent independent workers cross a real clock barrier and preserve one authoritative settlement', async () => {
  const t = await fixture();
  const results = await Promise.all(
    t.config.partitions.map((p) =>
      runResidentPartitionWorker({
        connection: { endpoint: t.server.url, token: p.token },
        directory: join(t.root, p.id),
        model: 'test',
        pollMs: 100,
        maxOpportunities: 2,
        createDriver: ({ connection, actorId }) => ({
          id: 'http-test',
          run: async ({ turnId }) => {
            expect(
              await townRequest(connection, '/invoke', {
                name: 'world.deposit',
                arguments: { amount: 1 },
                requestId: `deposit-${turnId}`,
              }),
            ).toMatchObject({ ok: true });
            expect(
              await townRequest(connection, '/invoke', {
                name: 'schedule.wait',
                arguments: {
                  until: t.runtime.state.world.clock.now + 1000,
                  summary: '本人选择等待',
                },
                requestId: `wait-${turnId}`,
              }),
            ).toMatchObject({ ok: true });
            return { status: 'completed', sessionId: `session-${actorId}`, summary: '完成' };
          },
        }),
      }),
    ),
  );
  expect(results).toEqual([
    { status: 'limit-reached', opportunities: 2, completed: 2 },
    { status: 'limit-reached', opportunities: 2, completed: 2 },
  ]);
  expect(t.runtime.state.world.clock.now).toBe(1000);
  expect(t.runtime.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 4);
  expect(t.runtime.state.world.moneySupply).toBe(t.manifest.initialWorld.moneySupply);
});
test('lost finish transport and authority restart replay the saved handoff without a second model or payment', async () => {
  const t = await fixture();
  const p = t.config.partitions[0]!;
  const directory = join(t.root, 'compute');
  let calls = 0;
  const driver = ({ connection }: { connection: { endpoint: string; token: string } }) => ({
    id: 'test',
    run: async () => {
      calls++;
      expect(
        await townRequest(connection, '/invoke', {
          name: 'world.deposit',
          arguments: { amount: 7 },
          requestId: 'once',
        }),
      ).toMatchObject({ ok: true });
      return {
        status: 'completed' as const,
        sessionId: 'observed-session',
        summary: 'Exact original result',
      };
    },
  });
  const original = globalThis.fetch;
  const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (
      (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith(
        '/partition/finish',
      )
    )
      throw Error('test-response-lost');
    return original(input, init);
  });
  await expect(
    runResidentPartitionOpportunity({
      connection: { endpoint: t.server.url, token: p.token },
      directory,
      claimId: 'first',
      model: 'test',
      createDriver: driver,
    }),
  ).rejects.toThrow('test-response-lost');
  mock.mockRestore();
  await t.closeServer();
  t.runtime.close();
  const resumed = new OpenSocietyRuntime(join(t.root, 'world'));
  cleanup.push(() => resumed.close());
  const server = await startResidentServer(resumed, t.credentials, 0, { partitions: t.config });
  cleanup.push(server.close);
  const result = await runResidentPartitionOpportunity({
    connection: { endpoint: server.url, token: p.token },
    directory,
    claimId: 'resume',
    model: 'test',
    createDriver: driver,
  });
  expect(result.status).toBe('completed');
  expect(calls).toBe(1);
  expect(resumed.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 7);
  expect(Object.values(resumed.state.turns)).toMatchObject([
    { summary: 'Exact original result', sessionId: 'observed-session', status: 'completed' },
  ]);
});
test('provider failure stops rather than silently retrying; waiting is abortable', async () => {
  const t = await fixture();
  const p = t.config.partitions[0]!;
  let calls = 0;
  const result = await runResidentPartitionWorker({
    connection: { endpoint: t.server.url, token: p.token },
    directory: join(t.root, 'failed'),
    model: 'test',
    createDriver: () => ({
      id: 'failure',
      run: () => {
        calls++;
        return Promise.resolve({ status: 'provider-error' as const, summary: 'test failure' });
      },
    }),
  });
  expect(result).toEqual({ status: 'provider-error', opportunities: 1, completed: 0 });
  expect(calls).toBe(1);
  const controller = new AbortController();
  const stopped = runResidentPartitionWorker({
    connection: { endpoint: t.server.url, token: p.token },
    directory: join(t.root, 'idle'),
    model: 'test',
    signal: controller.signal,
    pollMs: 1000,
  });
  setTimeout(() => controller.abort(), 20);
  expect(await stopped).toMatchObject({ status: 'stopped', opportunities: 0 });
});
test('a compute directory cannot adopt another authority with identical scenario and actor IDs', async () => {
  const t = await fixture();
  const p = t.config.partitions[0]!,
    directory = join(t.root, 'bound');
  const input = {
    directory,
    model: 'test',
    claimId: 'bind',
    createDriver: () => ({
      id: 'noop',
      run: () => Promise.resolve({ status: 'completed' as const, summary: 'done' }),
    }),
  };
  await runResidentPartitionOpportunity({
    ...input,
    connection: { endpoint: t.server.url, token: p.token },
  });
  const other = new OpenSocietyRuntime(join(t.root, 'other-world'), t.manifest);
  cleanup.push(() => other.close());
  const credentials = loadResidentCredentials(
    join(t.root, 'other-world'),
    t.manifest.residents.map((r) => r.id),
  );
  const server = await startResidentServer(other, credentials, 0, { partitions: t.config });
  cleanup.push(server.close);
  const revision = other.state.revision;
  await expect(
    runResidentPartitionOpportunity({
      ...input,
      connection: { endpoint: server.url, token: p.token },
    }),
  ).rejects.toThrow('partition-compute-directory-mismatch');
  expect(other.state.revision).toBe(revision);
  expect(Object.values(other.state.turns)).toHaveLength(0);
});
