import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createTownManifest, OpenSocietyRuntime } from '@aivilization/worker';
import {
  ResidentPartitionExecution,
  PARTITION_SCHEDULER_VERSION,
  type ResidentPartitionConfiguration,
} from './partitionExecution';
import { startResidentServer } from './server';
import { loadResidentCredentials } from './credentials';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup.length = 0;
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'partition-execution-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createTownManifest({ count: 2 });
  const runtime = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => runtime.close());
  const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
  const config: ResidentPartitionConfiguration = {
    version: PARTITION_SCHEDULER_VERSION,
    leaseMs: 1000,
    partitions: [
      { id: 'p1', token: 'a'.repeat(64), actors: [a] },
      { id: 'p2', token: 'b'.repeat(64), actors: [b] },
    ],
  };
  let now = 0;
  const coordinator = new ResidentPartitionExecution(runtime, config, () => now);
  return {
    root,
    manifest,
    runtime,
    a,
    b,
    config,
    coordinator,
    expire: () => {
      now += 1001;
    },
  };
}
test('partition grants fence actors, expiry and competing claimants without changing committed money or time', () => {
  const t = fixture();
  const one = t.coordinator.claim('p1', 'request-one');
  expect(one.status).toBe('claimed');
  if (one.status !== 'claimed') throw Error('missing grant');
  expect(one.actorId).toBe(t.a);
  expect(t.coordinator.claim('p1', 'competing').status).toBe('waiting');
  expect(t.coordinator.claim('p1', 'request-one')).toEqual(one);
  const request = { name: 'world.deposit', arguments: { amount: 9 }, requestId: 'deposit' };
  expect(t.runtime.invoke(t.coordinator.actor(one.token)!, request).ok).toBe(true);
  expect(() =>
    t.coordinator.finish('p2', one.token, { status: 'completed', summary: 'fake' }),
  ).toThrow('partition-grant');
  t.expire();
  expect(t.coordinator.actor(one.token)).toBeUndefined();
  const replacement = t.coordinator.claim('p1', 'replacement');
  if (replacement.status !== 'claimed') throw Error('missing replacement');
  expect(replacement.turnId).toBe(one.turnId);
  expect(replacement.token).not.toBe(one.token);
  expect(t.runtime.invoke(replacement.actorId, request).ok).toBe(true);
  expect(t.runtime.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 9);
  expect(t.runtime.state.world.clock.now).toBe(0);
});
test('concurrent resident turns hold a clock barrier, finish retry is exact, ready absent partitions are not skipped', () => {
  const t = fixture();
  const x = t.coordinator.claim('p1', 'one'),
    y = t.coordinator.claim('p2', 'two');
  if (x.status !== 'claimed' || y.status !== 'claimed') throw Error('missing');
  const input = { status: 'completed' as const, summary: 'finished' };
  const receipt = t.coordinator.finish('p1', x.token, input);
  expect(t.coordinator.finish('p1', x.token, input)).toEqual(receipt);
  expect(() => t.coordinator.finish('p1', x.token, { ...input, summary: 'changed' })).toThrow(
    'finish-conflict',
  );
  expect(t.coordinator.actor(x.token)).toBeUndefined();
  expect(t.coordinator.claim('p1', 'later').status).toBe('waiting');
  expect(t.runtime.state.world.clock.now).toBe(0);
  t.coordinator.finish('p2', y.token, input);
  expect(t.coordinator.claim('p1', 'later').status).toBe('claimed');
  expect(t.runtime.state.world.clock.now).toBeGreaterThan(0);
});
test('restart rejects old grants and preserves committed wait and independent ownership', () => {
  const t = fixture();
  const grant = t.coordinator.claim('p1', 'first');
  if (grant.status !== 'claimed') throw Error('missing');
  const result = t.runtime.invoke(t.a, {
    name: 'schedule.wait',
    arguments: { until: 90000, summary: '真实等待' },
    requestId: 'wait',
  });
  expect(result.ok, result.error).toBe(true);
  t.runtime.close();
  const resumed = new OpenSocietyRuntime(t.root);
  cleanup.push(() => resumed.close());
  const coordinator = new ResidentPartitionExecution(resumed, t.config, () => 0);
  expect(coordinator.actor(grant.token)).toBeUndefined();
  const next = coordinator.claim('p1', 'restart');
  if (next.status !== 'claimed') throw Error('missing');
  expect(next.turnId).toBe(grant.turnId);
  expect(next.turn.status).toBe('waiting');
  expect(next.turn.summary).toBe('真实等待');
  coordinator.finish('p1', next.token, { status: 'completed', summary: next.turn.summary });
  expect(resumed.state.residents[t.a]!.nextWakeAt).toBe(90000);
  expect(coordinator.claim('p1', 'not-yet').status).toBe('waiting');
  expect(resumed.state.world.clock.now).toBe(0);
  expect(
    () =>
      new ResidentPartitionExecution(resumed, {
        ...t.config,
        partitions: [t.config.partitions[0]!],
      }),
  ).toThrow('incomplete-partition-ownership');
  expect(
    () =>
      new ResidentPartitionExecution(resumed, {
        ...t.config,
        partitions: [t.config.partitions[0]!, { ...t.config.partitions[1]!, actors: [t.a] }],
      }),
  ).toThrow('invalid-partition-ownership');
});
test('HTTP separates partition, turn, resident and administrator credentials and rejects actor injection', async () => {
  const t = fixture();
  const credentials = loadResidentCredentials(t.root, [t.a, t.b]);
  const server = await startResidentServer(t.runtime, credentials, 0, { partitions: t.config });
  cleanup.push(server.close);
  const call = async (token: string, path: string, value?: unknown) => {
    const response = await fetch(server.url + path, {
      method: value === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  };
  const p1 = t.config.partitions[0]!.token,
    p2 = t.config.partitions[1]!.token;
  expect((await call(credentials.residents[t.a]!, '/context')).status).toBe(401);
  expect((await call(p1, '/admin/replication/manifest')).status).toBe(403);
  expect(
    (await call(credentials.admin, '/admin/advance', { deltaMs: 1, requestId: 'bad' })).status,
  ).toBe(409);
  expect((await call(p1, '/partition/claim', { claimId: 'bad', actorId: t.b })).status).toBe(400);
  const grant = (await call(p1, '/partition/claim', { claimId: 'real' })).data;
  expect(grant.actorId).toBe(t.a);
  const token = String(grant.token);
  expect((await call(token, '/context')).data).toMatchObject({ identity: { id: t.a } });
  expect(
    (
      await call(token, '/invoke', {
        name: 'world.deposit',
        arguments: { amount: 5 },
        requestId: 'money',
        actorId: t.b,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await call(token, '/invoke', {
        name: 'world.deposit',
        arguments: { amount: 5 },
        requestId: 'money',
      })
    ).data,
  ).toMatchObject({ ok: true });
  expect(
    (await call(p2, '/partition/finish', { token, status: 'completed', summary: 'forged' })).status,
  ).toBe(400);
  expect(
    (await call(p1, '/partition/finish', { token, status: 'completed', summary: 'done' })).status,
  ).toBe(200);
  expect((await call(token, '/context')).status).toBe(401);
  expect(t.runtime.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 5);
});

test('two compute adapters use only leased actor tokens and leave all settlement in one authority', async () => {
  const t = fixture();
  const credentials = loadResidentCredentials(t.root, [t.a, t.b]);
  const server = await startResidentServer(t.runtime, credentials, 0, {
    partitions: { ...t.config, leaseMs: 60000 },
  });
  cleanup.push(server.close);
  const { runResidentPartitionOpportunity } = await import('./partitionRunner');
  const { townRequest } = await import('./townConnection');
  const results = await Promise.all(
    t.config.partitions.map((p) =>
      runResidentPartitionOpportunity({
        connection: { endpoint: server.url, token: p.token },
        directory: join(t.root, p.id),
        claimId: `claim-${p.id}`,
        model: 'test',
        createDriver: ({ actorId, connection }) => ({
          id: 'test-authenticated-driver',
          run: async () => {
            expect(connection.token).not.toBe(p.token);
            expect(actorId).toBe(p.actors[0]);
            expect(
              await townRequest(connection, '/invoke', {
                name: 'world.deposit',
                arguments: { amount: 4 },
                requestId: 'same-id-different-actors',
              }),
            ).toMatchObject({ ok: true });
            return {
              status: 'completed',
              summary: 'Independent actor',
              sessionId: `session-${actorId}`,
            };
          },
        }),
      }),
    ),
  );
  expect(results.map((r) => r.status)).toEqual(['completed', 'completed']);
  expect(t.runtime.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 8);
  expect(t.runtime.state.world.moneySupply).toBe(t.manifest.initialWorld.moneySupply);
  expect(t.runtime.state.world.clock.now).toBe(0);
});

test('persisted bindings reject silent reassignment or unfenced server restart while allowing token rotation', async () => {
  const t = fixture();
  expect(
    () =>
      new ResidentPartitionExecution(t.runtime, {
        ...t.config,
        partitions: t.config.partitions.map((p) => ({
          ...p,
          actors: p.id === 'p1' ? [t.b] : [t.a],
        })),
      }),
  ).toThrow('partition-bindings-conflict');
  const rotated = new ResidentPartitionExecution(t.runtime, {
    ...t.config,
    partitions: t.config.partitions.map((p) => ({ ...p, token: p.token + 'rotated' })),
  });
  expect(rotated.partition(t.config.partitions[0]!.token)).toBeUndefined();
  const credentials = loadResidentCredentials(t.root, [t.a, t.b]);
  await expect(startResidentServer(t.runtime, credentials)).rejects.toThrow(
    'partition-configuration-required',
  );
});
