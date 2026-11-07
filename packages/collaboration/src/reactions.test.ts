import { expect, test } from 'vitest';
import {
  emptyCoordinationState,
  COORDINATION_POLICY,
  type CoordinationState,
} from './programModel';
import { PROGRAM_CONDITIONS_POLICY } from './conditionModel';
import {
  PROGRAM_REACTIONS_POLICY,
  type ProgramReactionsState,
  type ProgramReactionsPolicy,
} from './reactionModel';
import {
  registerProgramWatch,
  enqueueProgramReaction,
  finishProgramReaction,
  cancelProgramWatch,
  applyProgramReactionEvent,
  pendingProgramReactions,
} from './reactions';
import { applyCoordinationEvent, decideCoordination } from './programs';
const token = 'a'.repeat(64),
  changed = 'b'.repeat(64);
function fixture(policy: ProgramReactionsPolicy = PROGRAM_REACTIONS_POLICY) {
  let c = emptyCoordinationState(COORDINATION_POLICY, PROGRAM_CONDITIONS_POLICY, policy);
  for (const command of [
    {
      type: 'programs.publish' as const,
      id: 'p',
      title: 'condition',
      purpose: 'chosen by resident',
      runners: ['a'],
      definition: {
        conditions: [
          {
            source: {
              kind: 'record',
              registerId: 'r',
              key: 'k',
              revision: 'latest',
              field: 'ready',
            },
            op: 'eq',
            value: true,
          },
        ],
        steps: [
          {
            principalId: 'a',
            capability: 'messages.send',
            arguments: { recipientId: 'b', content: 'ready' },
          },
        ],
      },
    },
    {
      type: 'mandates.grant' as const,
      id: 'm',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      maxRuns: 10,
      expiresAt: 10000,
    },
  ]) {
    const d = decideCoordination({ state: c, actorId: 'a', at: 0, command, exists: () => true });
    if (!d.accepted) throw new Error(d.reason);
    c = d.events.reduce(applyCoordinationEvent, c);
  }
  const args = {
    coordination: c,
    actorId: 'a',
    id: 'w',
    programId: 'p',
    programRevision: 1,
    maxReactions: 3,
    expiresAt: 1000,
    sourceToken: token,
    at: 0,
    exists: () => true,
  };
  const d = registerProgramWatch(args);
  if (!d.accepted) throw new Error(d.reason);
  return { c, args, s: d.events.reduce(applyProgramReactionEvent, c.reactions!) };
}
test('watch admission binds exact program and current authority; old coordination stays unchanged', () => {
  const { c, args } = fixture();
  for (const extra of [
    { programRevision: 2 },
    { maxReactions: 0 },
    { maxReactions: 101 },
    { expiresAt: 0 },
    { sourceToken: 'forged' },
    { actorId: 'b' },
  ])
    expect(registerProgramWatch({ ...args, ...extra }).accepted).toBe(false);
  expect(emptyCoordinationState()).not.toHaveProperty('reactions');
  expect(() =>
    emptyCoordinationState(COORDINATION_POLICY, undefined, PROGRAM_REACTIONS_POLICY),
  ).toThrow('reaction-conditions-required');
  const noSource: CoordinationState = {
    ...c,
    programs: {
      p: { ...c.programs.p!, conditions: [{ source: { kind: 'clock' }, op: 'gte', value: 0 }] },
    },
  };
  expect(registerProgramWatch({ ...args, coordination: noSource })).toMatchObject({
    accepted: false,
    reason: 'watch-requires-event-source',
  });
  const d = registerProgramWatch({
    ...args,
    coordination: {
      ...c,
      reactions: {
        ...c.reactions!,
        policy: { ...PROGRAM_REACTIONS_POLICY, maxWatches: 1 },
        watches: { old: fixture().s.watches.w! },
      },
    },
  });
  expect(d).toMatchObject({ accepted: false, reason: 'watch-quota' });
});
test('each committed dependency change is queued once, finite successes and skipped checks replay exactly', () => {
  let { s } = fixture();
  const original = s;
  const events = [];
  expect(enqueueProgramReaction(s, 'w', token, 1, 10)).toEqual([]);
  for (let i = 1; i <= 3; i++) {
    const es = enqueueProgramReaction(s, 'w', i % 2 ? changed : token, i, 10 * i);
    events.push(...es);
    s = es.reduce(applyProgramReactionEvent, s);
    expect(enqueueProgramReaction(s, 'w', i % 2 ? changed : token, i, 10 * i)).toEqual([]);
  }
  expect(pendingProgramReactions(s).map((r) => r.sourceSequence)).toEqual([1, 2, 3]);
  expect(enqueueProgramReaction(s, 'w', token, 4, 40)).toEqual([]);
  for (const [i, r] of pendingProgramReactions(s).entries()) {
    const es = finishProgramReaction(s, r.id, i === 0 ? 'skipped' : 'succeeded', 50, `run${i}`);
    events.push(...es);
    s = es.reduce(applyProgramReactionEvent, s);
  }
  expect(s.watches.w).toMatchObject({
    status: 'completed',
    enqueued: 3,
    completed: 3,
    succeeded: 2,
  });
  expect(events.reduce(applyProgramReactionEvent, original)).toEqual(s);
  expect(() => finishProgramReaction(s, 'w:1', 'succeeded', 60, 'repeat')).toThrow(
    'reaction-not-pending',
  );
});
test('cancel, execution failure and expiry settle every pending entry without successful counts', () => {
  for (const kind of ['cancel', 'fail', 'expire']) {
    let { s } = fixture();
    s = enqueueProgramReaction(s, 'w', changed, 1, 10).reduce(applyProgramReactionEvent, s);
    s = enqueueProgramReaction(s, 'w', token, 2, 20).reduce(applyProgramReactionEvent, s);
    let events;
    if (kind === 'cancel') {
      expect(cancelProgramWatch(s, 'b', 'w', 3, 30)).toMatchObject({ accepted: false });
      expect(cancelProgramWatch(s, 'a', 'w', 1, 30)).toMatchObject({
        accepted: false,
        reason: 'revision-conflict',
      });
      const d = cancelProgramWatch(s, 'a', 'w', 3, 30);
      if (!d.accepted) throw Error(d.reason);
      events = d.events;
    } else if (kind === 'fail')
      events = finishProgramReaction(s, 'w:1', 'failed', 30, 'failed-run', 'mandate-revoked');
    else events = enqueueProgramReaction(s, 'w', token, 3, 1000);
    s = events.reduce(applyProgramReactionEvent, s);
    expect(s.watches.w).toMatchObject({
      completed: 2,
      succeeded: 0,
      status: kind === 'cancel' ? 'cancelled' : kind === 'fail' ? 'failed' : 'expired',
    });
    expect(pendingProgramReactions(s)).toHaveLength(0);
    expect(enqueueProgramReaction(s, 'w', changed, 5, 1010)).toEqual([]);
  }
});
test('global queue overload is an explicit stopped watch, never a silent dropped input', () => {
  let { s } = fixture({ ...PROGRAM_REACTIONS_POLICY, maxPending: 1 });
  s = enqueueProgramReaction(s, 'w', changed, 1, 10).reduce(applyProgramReactionEvent, s);
  s = enqueueProgramReaction(s, 'w', token, 2, 20).reduce(applyProgramReactionEvent, s);
  expect(s.watches.w).toMatchObject({
    status: 'failed',
    reason: 'reaction-queue-overloaded',
    stoppedAtSequence: 2,
    completed: 1,
  });
  expect(s.reactions['w:1']?.status).toBe('cancelled');
});
test('reducer refuses revision gaps and repeated terminal effects', () => {
  let { s } = fixture();
  expect(() =>
    applyProgramReactionEvent(s, {
      type: 'ProgramWatchChanged',
      watch: { ...s.watches.w!, revision: 7 },
    }),
  ).toThrow('invalid-watch-event');
  s = enqueueProgramReaction(s, 'w', changed, 1, 10).reduce(applyProgramReactionEvent, s);
  const events = finishProgramReaction(s, 'w:1', 'failed', 20, 'run', 'failure');
  const next: ProgramReactionsState = events.reduce(applyProgramReactionEvent, s);
  expect(() => applyProgramReactionEvent(next, events[0]!)).toThrow('invalid-reaction-event');
});
