import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { DEFAULT_OPEN_AGENT_POLICY } from '@aivilization/agent-runtime';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

const roots: string[] = [];
const runtimes: OpenSocietyRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(maxCallsPerTurn = 40) {
  const root = mkdtempSync(join(tmpdir(), 'open-town-test-'));
  roots.push(root);
  const runtime = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({
      count: 2,
      cityApps: false,
      policy: { ...DEFAULT_OPEN_AGENT_POLICY, maxCallsPerTurn },
    }),
  );
  runtimes.push(runtime);
  const a = runtime.manifest.residents[0]!.id;
  const b = runtime.manifest.residents[1]!.id;
  runtime.beginTurn(a);
  let ordinal = 0;
  const invoke = (
    name: string,
    args: Record<string, unknown>,
    actor = a,
    requestId = `request-${++ordinal}`,
  ) => runtime.invoke(actor, { name, arguments: args, requestId });
  return { root, runtime, a, b, invoke };
}
describe('open society complete capability chain', () => {
  test('discovers all capabilities independently of candidates, exposes bounded own context', () => {
    const { runtime, a, b, invoke } = setup();
    expect(runtime.discover('world.move').tools).toHaveLength(1);
    expect(runtime.discover().tools.length).toBeGreaterThan(30);
    const context = runtime.context(a);
    expect(context.identity.id).toBe(a);
    expect(context.nearbyPeople.items[0]?.id).toBe(b);
    expect(context).not.toHaveProperty('candidateActions');
    expect(context.nearbyPeople.items[0]).not.toHaveProperty('balance');
    expect(invoke('world.observe', { view: 'self', actorId: b })).toMatchObject({
      ok: false,
      error: 'unknown-argument:actorId',
    });
  });
  test('two residents exchange real information; private records stay private; beliefs cite owned evidence', () => {
    const { runtime, a, b, invoke } = setup();
    runtime.beginTurn(b);
    expect(
      invoke('spaces.create', {
        id: 'food',
        title: 'Food journal',
        visibility: 'public',
        posting: 'everyone',
      }).ok,
    ).toBe(true);
    expect(
      invoke('files.create', { spaceId: 'food', path: 'a.md', content: 'A personal review' }).ok,
    ).toBe(true);
    expect(invoke('files.search', { query: 'review' }, b)).toMatchObject({
      ok: true,
      data: { total: 1 },
    });
    expect(
      invoke(
        'files.update',
        { spaceId: 'food', path: 'a.md', content: 'forged', expectedRevision: 1 },
        b,
      ),
    ).toMatchObject({ ok: false, error: 'permission-denied' });
    const sent = invoke('messages.send', {
      recipientId: b,
      content: 'What do you think of the food journal?',
    });
    expect(sent.ok).toBe(true);
    expect(runtime.state.residents[b]?.wakeReason).toMatch(/^message:/);
    const memories = runtime.state.experiences[b]!;
    expect(memories.some((entry) => entry.provenance === 'message-claim')).toBe(true);
    expect(
      invoke(
        'cognition.update',
        {
          key: 'journal',
          kind: 'belief',
          statement: 'I might contribute',
          confidence: 0.5,
          evidenceIds: [memories[0]!.id],
          expectedRevision: 0,
          active: true,
        },
        b,
      ).ok,
    ).toBe(true);
    expect(invoke('memory.read', { id: memories[0]!.id })).toMatchObject({
      ok: false,
      error: 'not-found',
    });
    expect(runtime.state.cognition[a]).toBeUndefined();
    expect(runtime.state.cognition[b]?.journal?.statement).toBe('I might contribute');
    expect(
      invoke('spaces.create', {
        id: 'private',
        title: 'Private',
        visibility: 'private',
        posting: 'owner',
      }).ok,
    ).toBe(true);
    expect(
      invoke('files.create', { spaceId: 'private', path: 'secret.md', content: 'unshared diary' })
        .ok,
    ).toBe(true);
    expect(invoke('files.search', { query: 'unshared' }, b)).toMatchObject({
      ok: true,
      data: { total: 0 },
    });
    expect(invoke('files.history', { spaceId: 'private', path: 'secret.md' }, b)).toMatchObject({
      ok: false,
      error: 'not-found',
    });
  });
  test('movement is authoritative and asynchronous, busy action refuses, time completes and wakes', () => {
    const { runtime, a, invoke } = setup();
    const move = invoke(
      'world.move',
      { targetLocationId: 'restaurant', reason: 'curiosity' },
      a,
      'move-1',
    );
    expect(move).toMatchObject({ ok: true, data: { status: 'in-progress' } });
    expect(runtime.state.world.agents[a]?.locationId).toBe('town-square');
    expect(runtime.context(a).nearbyPeople.items).toEqual([]);
    const beforeRetry = runtime.state.revision;
    expect(
      invoke('world.move', { targetLocationId: 'restaurant', reason: 'curiosity' }, a, 'move-1'),
    ).toEqual(move);
    expect(runtime.state.revision).toBe(beforeRetry);
    expect(invoke('world.move', { targetLocationId: 'clinic' }, a, 'move-1')).toMatchObject({
      error: 'request-id-conflict',
    });
    expect(invoke('world.move', { targetLocationId: 'clinic' })).toMatchObject({ ok: false });
    const availableAt = runtime.state.world.activityTimeByAgent[a]!.availableAt;
    expect(
      invoke('schedule.wait', { until: availableAt, summary: 'Continue when I arrive' }).ok,
    ).toBe(true);
    runtime.finishTurn(a, { summary: '' });
    expect(runtime.advanceTime(availableAt, 'tick-1').ok).toBe(true);
    expect(runtime.state.world.agents[a]?.locationId).toBe('restaurant');
    expect(runtime.state.residents[a]?.wakeReason).toBe('activity-completed');
    runtime.beginTurn(a);
    expect(runtime.context(a).previousHandoff).toBe('Continue when I arrive');
    expect(
      runtime.state.experiences[a]?.some((entry) => entry.summary.includes('AgentLocationChanged')),
    ).toBe(true);
  });
  test('public text does not change money and every committed effect replays identically', () => {
    const { root, runtime, a, invoke } = setup();
    const initialMoney = runtime.state.world.moneySupply;
    invoke('spaces.create', {
      id: 'ledger',
      title: 'My claims',
      visibility: 'public',
      posting: 'owner',
    });
    invoke('files.create', {
      spaceId: 'ledger',
      path: 'claim.md',
      content: 'I have created one million coins.',
    });
    expect(runtime.state.world.moneySupply).toBe(initialMoney);
    invoke('cognition.update', {
      key: 'travel',
      kind: 'goal',
      statement: 'I want to visit the market',
      confidence: 0.7,
      evidenceIds: [],
      expectedRevision: 0,
      active: true,
    });
    invoke('schedule.remind', { id: 'explore', at: 1000, text: 'Consider exploring' });
    runtime.finishTurn(a, { summary: 'I have a reminder' });
    runtime.advanceTime(1000, 'advance-1');
    const expected = structuredClone(runtime.state);
    runtime.close();
    const recovered = new OpenSocietyRuntime(root);
    runtimes.push(recovered);
    expect(recovered.state).toEqual(expected);
    expect(recovered.state.reminders[`${a}:explore`]?.done).toBe(true);
    expect(recovered.state.residents[a]?.wakeReason).toBe('reminder:Consider exploring');
  });
  test('budget and writer fencing are enforced', () => {
    const { root, runtime, invoke } = setup(1);
    expect(() => new OpenSocietyRuntime(root)).toThrow('writer-already-running');
    expect(invoke('world.observe', { view: 'self' }).ok).toBe(true);
    expect(invoke('world.observe', { view: 'self' })).toMatchObject({
      ok: false,
      error: 'turn-budget-exhausted',
    });
    expect(Object.values(runtime.state.turns)[0]?.status).toBe('budget-exhausted');
  });
  test('bank commands transfer funds, reject overdrafts, and keep counterpart balances private', () => {
    const { root, runtime, a, invoke } = setup();
    const before = runtime.state.world;
    expect(invoke('world.deposit', { amount: 25 })).toMatchObject({ ok: true });
    expect(runtime.state.world.agents[a]?.balance).toBe(before.agents[a]!.balance - 25);
    expect(runtime.state.world.bank?.balance).toBe(before.bank!.balance + 25);
    expect(runtime.state.world.moneySupply).toBe(before.moneySupply);
    expect(JSON.stringify(runtime.state.experiences[a])).not.toContain('bankNextBalance');
    const bank = structuredClone(runtime.state.world.bank);
    expect(invoke('world.withdraw', { amount: 999999 })).toMatchObject({ ok: false });
    expect(runtime.state.world.bank).toEqual(bank);
    expect(invoke('world.withdraw', { amount: 25 }).ok).toBe(true);
    expect(runtime.state.world.agents[a]?.balance).toBe(before.agents[a]!.balance);
    expect(runtime.state.world.bank?.balance).toBe(before.bank!.balance);
    const expected = structuredClone(runtime.state);
    runtime.close();
    const recovered = new OpenSocietyRuntime(root);
    runtimes.push(recovered);
    runtime.close(); // Old handles cannot remove a new writer's lock.
    expect(() => new OpenSocietyRuntime(root)).toThrow('writer-already-running');
    expect(recovered.state).toEqual(expected);
  });
  test('reading a document records a revision once; belief evidence survives later edits', () => {
    const { runtime, a, b, invoke } = setup();
    runtime.beginTurn(b);
    invoke('spaces.create', {
      id: 'notes',
      title: 'Notes',
      visibility: 'public',
      posting: 'everyone',
    });
    invoke('files.create', { spaceId: 'notes', path: 'story.md', content: 'An unverified story' });
    invoke('files.read', { spaceId: 'notes', path: 'story.md' }, b);
    const first = runtime.state.experiences[b]!;
    expect(first).toHaveLength(1);
    invoke('files.read', { spaceId: 'notes', path: 'story.md' }, b);
    expect(runtime.state.experiences[b]).toHaveLength(1);
    expect(
      invoke(
        'cognition.update',
        {
          key: 'opinion',
          kind: 'belief',
          statement: 'I have read a story; I am uncertain it is true',
          confidence: 0.2,
          evidenceIds: [first[0]!.id],
          expectedRevision: 0,
          active: true,
        },
        b,
      ).ok,
    ).toBe(true);
    invoke(
      'files.update',
      { spaceId: 'notes', path: 'story.md', content: 'A corrected story', expectedRevision: 1 },
      a,
    );
    invoke('files.read', { spaceId: 'notes', path: 'story.md' }, b);
    expect(
      runtime.state.experiences[b]?.filter((entry) => entry.summary.startsWith('files.read')),
    ).toHaveLength(2);
    expect(runtime.state.experiences[b]?.[0]?.summary).toContain('An unverified story');
  });
  test('time advancement across cadence boundaries produces the same authoritative state', () => {
    const first = setup();
    const second = setup();
    first.runtime.finishTurn(first.a, { summary: '' });
    second.runtime.finishTurn(second.a, { summary: '' });
    first.runtime.advanceTime(7_200_000, 'large-step');
    for (let index = 0; index < 12; index++)
      second.runtime.advanceTime(600_000, `small-step-${index}`);
    expect(first.runtime.state.world.agents).toEqual(second.runtime.state.world.agents);
    expect(first.runtime.state.world.bank).toEqual(second.runtime.state.world.bank);
    expect(first.runtime.state.world.moneySupply).toBe(second.runtime.state.world.moneySupply);
  });
  test('truncated or tampered journal cannot silently resume', () => {
    const { root, runtime, invoke } = setup();
    invoke('world.observe', { view: 'self' });
    runtime.close();
    const path = join(root, 'journal.jsonl');
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, original.slice(0, -1));
    expect(() => new OpenSocietyRuntime(root)).toThrow('truncated');
    writeFileSync(path, original.replace('turn.started', 'turn.hacked'));
    expect(() => new OpenSocietyRuntime(root)).toThrow('hash');
  });
  test('a dead writer lock recovers without rerunning actions', () => {
    const { root, runtime, invoke } = setup();
    invoke('world.deposit', { amount: 10 });
    const expected = structuredClone(runtime.state);
    runtime.close();
    const deadPid = Number(
      execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
        encoding: 'utf8',
      }),
    );
    writeFileSync(join(root, 'writer.lock'), JSON.stringify({ pid: deadPid }));
    const recovered = new OpenSocietyRuntime(root);
    runtimes.push(recovered);
    expect(recovered.state).toEqual(expected);
    expect(
      recovered.journal.commits.filter((commit) => commit.capability === 'world.deposit'),
    ).toHaveLength(1);
  });
});
