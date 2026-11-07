import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function town() {
  const root = mkdtempSync(join(tmpdir(), 'turn-requeue-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({ count: 2 });
  const r = new OpenSocietyRuntime(root, m);
  cleanup.push(() => r.close());
  return { root, r, a: m.residents[0]!.id };
}

test('a provider failure before any call hands the opportunity back with its wake intact', () => {
  const { root, r, a } = town();
  const before = r.state.residents[a]!;
  r.beginTurn(a);
  const failed = r.finishTurn(a, {
    status: 'provider-error',
    summary: 'socket closed',
    requeue: true,
  });
  expect(failed).toMatchObject({ status: 'provider-error', requeued: true });
  const after = r.state.residents[a]!;
  expect(after.nextWakeAt).toBe(before.nextWakeAt);
  expect(after.wakeReason).toBe(before.wakeReason);
  // The resident is still due (the scheduler may serve others first) and the retry is ordinary.
  expect(r.nextResident(new Set([a]))).toBe(a);
  r.beginTurn(a);
  expect(r.finishTurn(a, { summary: 'ok' }).requeued).toBeUndefined();
  // Replay reproduces the hand-back.
  const state = structuredClone(r.state);
  r.close();
  const reopened = new OpenSocietyRuntime(root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(state);
});

test('a turn that already acted, or a caller that does not ask, is not handed back', () => {
  const { r, a } = town();
  const interval = r.manifest.policy.freeActivityIntervalMs;
  r.beginTurn(a);
  r.invoke(a, { name: 'world.observe', arguments: {}, requestId: 'look' });
  const acted = r.finishTurn(a, { status: 'provider-error', summary: 'x', requeue: true });
  expect(acted.requeued).toBeUndefined();
  expect(r.state.residents[a]!.nextWakeAt).toBe(r.state.world.clock.now + interval);
  const b = r.manifest.residents[1]!.id;
  r.beginTurn(b);
  expect(r.finishTurn(b, { status: 'provider-error', summary: 'x' }).requeued).toBeUndefined();
  expect(r.state.residents[b]!.nextWakeAt).toBe(r.state.world.clock.now + interval);
});
