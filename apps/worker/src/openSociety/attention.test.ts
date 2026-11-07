import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { RESIDENT_MESSAGE_PACING_POLICY } from '@aivilization/agent-runtime';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
const PACE = RESIDENT_MESSAGE_PACING_POLICY.minIntervalMs;

function town(messagePacing: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'message-pacing-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({ count: 2, continuity: true, messagePacing });
  const r = new OpenSocietyRuntime(root, m);
  clean.push(() => r.close());
  const [a, b] = m.residents.map((x) => x.id) as [string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const v = r.invoke(actor, { name, arguments: args, requestId: `p${++n}` });
    expect(v.ok, `${name}: ${v.error}`).toBe(true);
    return v;
  };
  const turn = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    call(actor, name, args);
    r.finishTurn(actor, { summary: 'test' });
  };
  const advance = (ms: number) => expect(r.advanceTime(ms, `t${++n}`).ok).toBe(true);
  return { root, r, a, b, call, turn, advance, wake: (id: string) => r.state.residents[id]! };
}

test('without pacing a direct message still wakes its recipient immediately', () => {
  const t = town(false);
  const t0 = t.r.state.world.clock.now;
  t.turn(t.b, 'schedule.wait', { until: t0 + 4 * 3_600_000, summary: 'later' });
  t.advance(60_000);
  t.turn(t.a, 'messages.send', { recipientId: t.b, content: 'hi' });
  expect(t.wake(t.b).nextWakeAt).toBe(t0 + 60_000);
  expect(t.wake(t.b).wakeReason).toMatch(/^message:/);
});

test('a paced message waits for the interval since the last opportunity but beats a later wait', () => {
  const t = town(true);
  const t0 = t.r.state.world.clock.now;
  t.turn(t.b, 'schedule.wait', { until: t0 + 4 * 3_600_000, summary: 'later' });
  t.advance(60_000);
  t.turn(t.a, 'messages.send', { recipientId: t.b, content: 'hi' });
  expect(t.wake(t.b).nextWakeAt).toBe(t0 + PACE);
  expect(t.wake(t.b).wakeReason).toMatch(/^message:/);
  expect(t.r.context(t.b)).toMatchObject({ messageWake: { minIntervalMs: PACE } });

  // The recipient's own nearer wait is never pushed back by pacing.
  const root = t.root;
  const t1 = t.r.state.world.clock.now;
  t.turn(t.b, 'schedule.wait', { until: t1 + 5 * 60_000, summary: 'expecting a reply' });
  t.turn(t.a, 'messages.send', { recipientId: t.b, content: 'again' });
  expect(t.wake(t.b).nextWakeAt).toBe(t1 + 5 * 60_000);

  const before = structuredClone(t.r.state),
    bytes = readFileSync(join(root, 'journal.jsonl'));
  t.r.close();
  const next = new OpenSocietyRuntime(root);
  clean.push(() => next.close());
  expect(next.state).toEqual(before);
  expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
});

test('a paced message does not interrupt an activity and a message during a turn is paced at its end', () => {
  const t = town(true);
  // Sleeping for longer than the pacing interval: the message waits until b is up.
  t.turn(t.b, 'world.sleep', { durationSeconds: 4 * 3600 });
  const availableAt = t.r.state.world.activityTimeByAgent[t.b]!.availableAt;
  expect(availableAt - t.r.state.world.clock.now).toBeGreaterThan(PACE);
  t.advance(PACE + 60_000);
  t.turn(t.a, 'messages.send', { recipientId: t.b, content: 'are you awake' });
  expect(t.wake(t.b).nextWakeAt).toBe(availableAt);

  t.advance(availableAt - t.r.state.world.clock.now);
  // b is mid-opportunity when a writes: b is not re-woken before the pacing interval.
  const started = t.r.state.world.clock.now;
  t.r.beginTurn(t.b);
  t.turn(t.a, 'messages.send', { recipientId: t.b, content: 'during your turn' });
  t.r.finishTurn(t.b, { summary: 'done' });
  expect(t.wake(t.b).wakeReason).toMatch(/^message:/);
  expect(t.wake(t.b).nextWakeAt).toBeGreaterThan(started);
  expect(t.wake(t.b).nextWakeAt).toBeLessThanOrEqual(started + PACE);
});
