import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest, OpenSocietyRuntime } from '@aivilization/worker';
import { startResidentSocietyDaemon } from './daemon';
import { townRequest } from './townConnection';
import { loadResidentCredentials } from './credentials';
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.reverse()) await f();
  cleanup.length = 0;
});
function seed(count = 2) {
  const root = mkdtempSync(join(tmpdir(), 'society-daemon-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({ count });
  const r = new OpenSocietyRuntime(root, manifest);
  r.close();
  const bytes = readFileSync(join(root, 'manifest.json'));
  return { root, manifest, bytes };
}
test('daemon runs independent authenticated actors over one complete authority and preserves information, money and replay', async () => {
  const t = seed();
  const actors: string[] = [];
  const d = await startResidentSocietyDaemon({
    root: t.root,
    model: 'test',
    maxOpportunities: 2,
    createDriver: ({ actorId, connection }) => ({
      id: 'test-http-driver',
      run: async () => {
        actors.push(actorId);
        expect(await townRequest(connection, '/context')).toMatchObject({
          identity: { id: actorId },
        });
        for (const request of [
          { name: 'world.deposit', arguments: { amount: 9 }, requestId: 'deposit' },
          {
            name: 'spaces.create',
            arguments: { id: actorId, title: '本人空间', visibility: 'private', posting: 'owner' },
            requestId: 'space',
          },
          {
            name: 'files.create',
            arguments: { spaceId: actorId, path: 'original.md', content: actorId },
            requestId: 'file',
          },
        ])
          expect(await townRequest(connection, '/invoke', request)).toMatchObject({ ok: true });
        expect(
          await fetch(connection.endpoint + '/admin/advance', {
            method: 'POST',
            headers: { authorization: 'Bearer ' + connection.token },
          }),
        ).toMatchObject({ status: 403 });
        return {
          status: 'completed',
          sessionId: 'fixture-session-' + actorId,
          summary: 'Actual test calls',
        };
      },
    }),
  });
  cleanup.push(d.stop);
  expect(await d.done).toEqual({ status: 'limit-reached', opportunities: 2 });
  expect(actors).toEqual(t.manifest.residents.map((r) => r.id));
  await d.stop();
  const r = new OpenSocietyRuntime(t.root);
  const state = structuredClone(r.state);
  expect(state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 18);
  expect(state.world.moneySupply).toBe(t.manifest.initialWorld.moneySupply);
  expect(Object.keys(state.information.spaces)).toEqual(expect.arrayContaining(actors));
  expect(Object.values(state.turns).map((t) => t.sessionId)).toEqual(
    actors.map((a) => 'fixture-session-' + a),
  );
  r.close();
  const replay = new OpenSocietyRuntime(t.root);
  try {
    expect(replay.state).toEqual(state);
    expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(t.bytes);
  } finally {
    replay.close();
  }
});
test('scheduler ownership excludes administrator clock/turn races; stop aborts provider before releasing writer', async () => {
  const t = seed(1);
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const d = await startResidentSocietyDaemon({
    root: t.root,
    model: 'test',
    createDriver: () => ({
      id: 'waiting',
      run: async ({ signal }) => {
        started();
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { status: 'provider-error', summary: 'Stopped by operator' };
      },
    }),
  });
  cleanup.push(d.stop);
  await entered;
  expect(() => new OpenSocietyRuntime(t.root)).toThrow('writer-already-running');
  const credentials = loadResidentCredentials(
    t.root,
    t.manifest.residents.map((r) => r.id),
  );
  for (const action of ['advance', 'start', 'finish']) {
    const response = await fetch(d.url + '/admin/' + action, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + credentials.admin },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'daemon-owns-scheduling' });
  }
  await d.stop();
  await d.stop();
  expect(await d.done).toEqual({ status: 'stopped', opportunities: 1 });
  const r = new OpenSocietyRuntime(t.root);
  try {
    expect(Object.values(r.state.turns)[0]?.status).not.toBe('running');
    expect(r.state.world.clock.now).toBe(0);
  } finally {
    r.close();
  }
});
test('a provider failure is recorded and stops without hidden retry or simulation clock advancement', async () => {
  const t = seed();
  let calls = 0;
  const d = await startResidentSocietyDaemon({
    root: t.root,
    model: 'test',
    createDriver: () => ({
      id: 'fails',
      run: () => {
        calls++;
        throw Error('provider-unavailable');
      },
    }),
  });
  cleanup.push(d.stop);
  expect(await d.done).toEqual({ status: 'provider-error', opportunities: 1 });
  await d.stop();
  expect(calls).toBe(1);
  const r = new OpenSocietyRuntime(t.root);
  try {
    expect(Object.values(r.state.turns)[0]?.summary).toBe('provider-unavailable');
    expect(r.state.world.clock.now).toBe(0);
  } finally {
    r.close();
  }
});
test('restart resumes the original interrupted turn and same request receipt without paying again', async () => {
  const t = seed(1),
    a = t.manifest.residents[0]!.id;
  const r = new OpenSocietyRuntime(t.root),
    turn = r.beginTurn(a);
  const request = { name: 'world.deposit', arguments: { amount: 9 }, requestId: 'deposit' };
  const receipt = r.invoke(a, request);
  expect(receipt.ok).toBe(true);
  r.close();
  const d = await startResidentSocietyDaemon({
    root: t.root,
    model: 'test',
    maxOpportunities: 1,
    createDriver: ({ connection }) => ({
      id: 'resuming',
      run: async (input) => {
        expect(input.turnId).toBe(turn.id);
        expect(await townRequest(connection, '/invoke', request)).toEqual(receipt);
        return { status: 'completed', summary: 'Recovered receipt' };
      },
    }),
  });
  cleanup.push(d.stop);
  expect((await d.done).opportunities).toBe(1);
  await d.stop();
  const recovered = new OpenSocietyRuntime(t.root);
  try {
    expect(recovered.state.world.bank!.balance).toBe(t.manifest.initialWorld.bank!.balance + 9);
    expect(Object.keys(recovered.state.turns)).toEqual([turn.id]);
  } finally {
    recovered.close();
  }
});

test('resident wait stays authoritative and daemon advances to its actual wake boundary before the next opportunity', async () => {
  const t = seed(1);
  let ordinal = 0;
  const d = await startResidentSocietyDaemon({
    root: t.root,
    model: 'test',
    maxOpportunities: 2,
    createDriver: () => ({
      id: 'waiting-resident',
      run: async ({ invoke }) => {
        const current = ordinal++;
        const observed = await invoke({
          name: 'world.observe',
          arguments: { view: 'self' },
          requestId: 'observe-' + current,
        });
        expect(observed.simulationTime).toBe(current === 0 ? 0 : 9000);
        if (current === 0)
          expect(
            await invoke({
              name: 'schedule.wait',
              arguments: { until: 9000, summary: '本人选择等待' },
              requestId: 'wait',
            }),
          ).toMatchObject({ ok: true });
        return {
          status: 'completed',
          summary: current === 0 ? '本人选择等待' : 'Woken at requested time',
        };
      },
    }),
  });
  cleanup.push(d.stop);
  expect(await d.done).toEqual({ status: 'limit-reached', opportunities: 2 });
  await d.stop();
  const r = new OpenSocietyRuntime(t.root);
  try {
    expect(Object.values(r.state.turns)[0]).toMatchObject({
      status: 'waiting',
      nextWakeAt: 9000,
      summary: '本人选择等待',
    });
    expect(r.state.world.clock.now).toBe(9000 + (t.manifest.policy.opportunityCadenceMs ?? 1000));
  } finally {
    r.close();
  }
});
