import { expect, test } from 'vitest';
import {
  COLLECTIVES_POLICY,
  parseCollectiveAction,
  emptyCollectivesState,
  collectiveOperable,
  type CollectiveCommand,
  type CollectiveConfiguration,
  type CollectiveEvent,
  type CollectivesPolicy,
  type CollectiveResourceAction,
} from './collectiveModel';
import {
  applyCollectiveEvent,
  authorizeCollectiveResourceExecution,
  collectiveTally,
  decideCollective,
} from './collectives';
import { advanceCollectives, nextCollectiveBoundary } from './collectiveLifecycle';
const exists = (id: string) => ['a', 'b', 'c', 'd'].includes(id);
const config = (extra: Partial<CollectiveConfiguration> = {}): CollectiveConfiguration => ({
  title: '自行组织',
  terms: '成员定义规则与意义',
  members: ['a', 'b'],
  voters: ['a', 'b'],
  threshold: 2,
  quorum: 2,
  timing: 'early',
  revote: true,
  ...extra,
});
function fixture(
  policy: CollectivesPolicy = COLLECTIVES_POLICY,
  validateResource?: (id: string, action: CollectiveResourceAction) => string | undefined,
) {
  let s = emptyCollectivesState(policy);
  const events: CollectiveEvent[] = [];
  const act = (actorId: string, command: CollectiveCommand, at = 0) =>
    decideCollective({
      state: s,
      actorId,
      at,
      command,
      exists,
      ...(validateResource ? { validateResource } : {}),
    });
  const commit = (es: readonly CollectiveEvent[]) => {
    for (const e of es) {
      s = applyCollectiveEvent(s, e);
      events.push(e);
    }
  };
  const ok = (actorId: string, command: CollectiveCommand, at = 0) => {
    const r = act(actorId, command, at);
    expect(r.accepted, JSON.stringify(r)).toBe(true);
    if (r.accepted) commit(r.events);
    return r;
  };
  const create = (configuration = config()) => {
    ok('a', { type: 'create', id: 'club', configuration, expiresAt: 500 });
    for (const id of configuration.members.filter((id) => id !== 'a'))
      ok(id, {
        type: 'respond',
        id: 'club',
        expectedRevision: s.charters.club!.revision,
        accept: true,
      });
  };
  const propose = (id = 'p', action: unknown = { kind: 'statement' }) =>
    ok('a', {
      type: 'propose',
      id,
      collectiveId: 'club',
      expectedVersion: s.charters.club!.version,
      terms: '原文',
      action,
      closesAt: 100,
      executeBefore: 200,
    });
  const vote = (id: string, a: string, vote: 'yes' | 'no' | 'abstain' = 'yes') =>
    ok(a, { type: 'vote', id, expectedRevision: s.decisions[id]!.revision, vote });
  const decide = (id = 'p', at = 0) =>
    ok('a', { type: 'decide', id, expectedRevision: s.decisions[id]!.revision }, at);
  const execute = (id = 'p', actor = 'a') =>
    ok(actor, { type: 'execute', id, expectedRevision: s.decisions[id]!.revision });
  const replay = () =>
    expect(events.reduce(applyCollectiveEvent, emptyCollectivesState(policy))).toEqual(s);
  return {
    get s() {
      return s;
    },
    act,
    ok,
    commit,
    create,
    propose,
    vote,
    decide,
    execute,
    replay,
  };
}
test('founders consent independently to one exact configuration; rejection and expiry never fabricate membership', () => {
  const t = fixture();
  const c = config();
  t.ok('a', { type: 'create', id: 'club', configuration: c, expiresAt: 100 });
  expect(t.s.charters.club).toMatchObject({
    status: 'pending',
    consents: { a: { version: 1, accepted: true } },
  });
  expect(
    t.act('c', { type: 'respond', id: 'club', expectedRevision: 1, accept: true }),
  ).toMatchObject({ accepted: false, reason: 'collective-not-found' });
  expect(
    t.act('b', { type: 'respond', id: 'club', expectedRevision: 2, accept: true }),
  ).toMatchObject({ accepted: false, reason: 'revision-conflict' });
  t.ok('b', { type: 'respond', id: 'club', expectedRevision: 1, accept: false });
  expect(t.s.charters.club!.status).toBe('rejected');
  t.ok('a', { type: 'create', id: 'late', configuration: c, expiresAt: 100 });
  expect(nextCollectiveBoundary(t.s)).toBe(100);
  t.commit(advanceCollectives(t.s, 100));
  expect(t.s.charters.late!.status).toBe('expired');
  expect(
    t.act('b', { type: 'respond', id: 'late', expectedRevision: 2, accept: true }, 100),
  ).toMatchObject({ accepted: false, reason: 'collective-not-pending' });
  t.replay();
});
test('closed configuration validates identities, thresholds, quotas, time and immutable input', () => {
  const t = fixture({ ...COLLECTIVES_POLICY, maxCollectivesPerFounder: 1 });
  for (const configuration of [
    config({ quorum: 1 }),
    config({ voters: ['c'] }),
    config({ members: ['a', 'a'] }),
    { ...config(), quorum: '2' },
    { ...config(), hidden: 'privilege' },
  ])
    expect(t.act('a', { type: 'create', id: 'club', configuration, expiresAt: 100 }).accepted).toBe(
      false,
    );
  const c = { ...config(), members: ['a', 'b'], voters: ['a', 'b'] };
  t.create(c);
  c.members.push('c');
  expect(t.s.charters.club!.members).toEqual(['a', 'b']);
  expect(
    t.act('a', { type: 'create', id: 'second', configuration: config(), expiresAt: 100 }),
  ).toMatchObject({ accepted: false, reason: 'collective-quota-exceeded' });
  expect(
    t.act('a', {
      type: 'propose',
      id: 'p',
      collectiveId: 'club',
      expectedVersion: 1,
      terms: 'x',
      action: { kind: 'statement' },
      closesAt: 100,
      executeBefore: 100,
    }),
  ).toMatchObject({ accepted: false, reason: 'invalid-decision-terms-or-time' });
  t.replay();
});
test('a proposer does not vote by implication; threshold and quorum include abstention separately', () => {
  const t = fixture();
  t.create(config({ members: ['a', 'b', 'c'], voters: ['a', 'b', 'c'], threshold: 1, quorum: 3 }));
  t.propose();
  expect(t.s.decisions.p!.votes).toEqual({});
  t.vote('p', 'a');
  t.vote('p', 'b', 'abstain');
  expect(t.act('a', { type: 'decide', id: 'p', expectedRevision: 3 })).toMatchObject({
    accepted: false,
    reason: 'decision-not-ready',
  });
  t.vote('p', 'c', 'no');
  t.decide();
  expect(collectiveTally(t.s.decisions.p!)).toEqual({
    yes: 1,
    no: 1,
    abstain: 1,
    responses: 3,
    passed: true,
  });
  expect(t.act('a', { type: 'execute', id: 'p', expectedRevision: 5 })).toMatchObject({
    accepted: false,
    reason: 'statement-has-no-resource-effect',
  });
  t.replay();
});
test('deadline decisions wait, allow configured vote changes, then record final facts only once', () => {
  const t = fixture();
  t.create(config({ timing: 'deadline' }));
  t.propose();
  t.vote('p', 'a');
  t.vote('p', 'b');
  expect(t.act('a', { type: 'decide', id: 'p', expectedRevision: 3 })).toMatchObject({
    accepted: false,
    reason: 'decision-not-ready',
  });
  t.vote('p', 'b', 'no');
  t.commit(advanceCollectives(t.s, 100));
  expect(t.s.decisions.p).toMatchObject({ status: 'rejected', decidedAt: 100 });
  expect(advanceCollectives(t.s, 1000)).toEqual([]);
  expect(
    t.act('a', { type: 'vote', id: 'p', expectedRevision: 5, vote: 'yes' }, 100),
  ).toMatchObject({ accepted: false, reason: 'decision-not-open' });
  t.replay();
});
test('immutable votes and individual eligibility are enforced', () => {
  const t = fixture();
  t.create(config({ members: ['a', 'b', 'c'], revote: false }));
  t.propose();
  t.vote('p', 'a');
  expect(t.act('a', { type: 'vote', id: 'p', expectedRevision: 2, vote: 'no' })).toMatchObject({
    accepted: false,
    reason: 'vote-change-not-permitted',
  });
  expect(t.act('c', { type: 'vote', id: 'p', expectedRevision: 2, vote: 'yes' })).toMatchObject({
    accepted: false,
    reason: 'eligible-voter-required',
  });
  t.vote('p', 'b', 'no');
  t.decide();
  expect(t.s.decisions.p!.status).toBe('rejected');
  t.replay();
});
test('amendment uses old rules, independent joining consent, exact versions and atomic consumption', () => {
  const t = fixture();
  t.create();
  t.propose('change', {
    kind: 'amend',
    configuration: config({
      title: '新名称',
      members: ['a', 'b', 'c'],
      voters: ['c'],
      threshold: 1,
      quorum: 1,
    }),
  });
  expect(
    t.act('c', { type: 'vote', id: 'change', expectedRevision: 1, vote: 'yes' }),
  ).toMatchObject({ accepted: false, reason: 'eligible-voter-required' });
  t.vote('change', 'a');
  t.vote('change', 'b');
  t.decide('change');
  expect(t.act('a', { type: 'execute', id: 'change', expectedRevision: 4 })).toMatchObject({
    accepted: false,
    reason: 'new-member-consent-required',
  });
  expect(t.s.charters.club!.version).toBe(1);
  t.ok('c', { type: 'join', id: 'change', expectedRevision: 4, accept: true });
  t.execute('change');
  expect(t.s.charters.club).toMatchObject({
    title: '新名称',
    version: 2,
    voters: ['c'],
    consents: {
      a: { version: 1, accepted: true },
      c: { version: 2, accepted: true, decisionId: 'change' },
    },
  });
  expect(t.s.decisions.change).toMatchObject({ status: 'executed', executedBy: 'a', revision: 6 });
  expect(t.act('a', { type: 'execute', id: 'change', expectedRevision: 6 })).toMatchObject({
    accepted: false,
    reason: 'passed-decision-required',
  });
  t.replay();
});
test('new members can reject joining and concurrent passed amendments cannot borrow old authority', () => {
  const t = fixture();
  t.create();
  t.propose('join', { kind: 'amend', configuration: config({ members: ['a', 'b', 'c'] }) });
  t.vote('join', 'a');
  t.vote('join', 'b');
  t.decide('join');
  t.ok('c', { type: 'join', id: 'join', expectedRevision: 4, accept: false });
  expect(t.s.decisions.join!.status).toBe('rejected');
  for (const id of ['one', 'two']) {
    t.propose(id, { kind: 'amend', configuration: config({ title: id }) });
    t.vote(id, 'a');
    t.vote(id, 'b');
    t.decide(id);
  }
  t.execute('one');
  expect(t.act('a', { type: 'execute', id: 'two', expectedRevision: 4 })).toMatchObject({
    accepted: false,
    reason: 'collective-authority-version-changed',
  });
  t.replay();
});
test('exit changes future authority while frozen ballots survive; no automatic quorum reduction', () => {
  const t = fixture();
  t.create();
  t.propose('old', { kind: 'amend', configuration: config({ title: '旧提案' }) });
  t.vote('old', 'a');
  t.ok('b', { type: 'leave', id: 'club', expectedRevision: 2 });
  expect(collectiveOperable(t.s.charters.club!)).toBe(false);
  expect(t.s.charters.club!.threshold).toBe(2);
  t.vote('old', 'b');
  t.decide('old');
  expect(t.act('a', { type: 'execute', id: 'old', expectedRevision: 4 })).toMatchObject({
    accepted: false,
    reason: 'collective-authority-version-changed',
  });
  expect(
    t.act('a', {
      type: 'propose',
      id: 'new',
      collectiveId: 'club',
      expectedVersion: 2,
      terms: 'x',
      action: { kind: 'statement' },
      closesAt: 100,
      executeBefore: 200,
    }),
  ).toMatchObject({ accepted: false, reason: 'collective-procedure-suspended' });
  t.replay();
});
test('resource authority is finite and unconsumed until an application atomically commits its effect', () => {
  const action = {
    kind: 'resource',
    capability: 'funds.transfer',
    resourceId: 'account',
    arguments: { amount: 5, targetId: 'b' },
  };
  const unsupported = fixture();
  unsupported.create();
  expect(
    unsupported.act('a', {
      type: 'propose',
      id: 'x',
      collectiveId: 'club',
      expectedVersion: 1,
      terms: 'x',
      action,
      closesAt: 100,
      executeBefore: 200,
    }),
  ).toMatchObject({ accepted: false, reason: 'unsupported-collective-resource-action' });
  const t = fixture(COLLECTIVES_POLICY, (_id, a) =>
    a.capability === 'funds.transfer' ? undefined : 'unsupported-resource',
  );
  t.create();
  t.propose('pay', action);
  t.vote('pay', 'a');
  t.vote('pay', 'b');
  t.decide('pay');
  const request = { state: t.s, actorId: 'a', id: 'pay', expectedRevision: 4, at: 0 };
  const proof = authorizeCollectiveResourceExecution(request);
  expect(proof).toMatchObject({ accepted: true, action, collectiveId: 'club' });
  expect(t.s.decisions.pay!.status).toBe('passed');
  if (proof.accepted) t.commit([proof.event]);
  expect(
    authorizeCollectiveResourceExecution({ ...request, state: t.s, expectedRevision: 5 }),
  ).toMatchObject({ accepted: false, reason: 'passed-decision-required' });
  t.replay();
});
test('long and segmented lifecycle advances agree without executing a passed action', () => {
  const t = fixture();
  t.create(config({ timing: 'deadline' }));
  t.propose('change', { kind: 'amend', configuration: config({ title: '以后' }) });
  t.vote('change', 'a');
  t.vote('change', 'b');
  const initial = t.s;
  const whole = advanceCollectives(initial, 250).reduce(applyCollectiveEvent, initial);
  let split = advanceCollectives(initial, 100).reduce(applyCollectiveEvent, initial);
  expect(split.decisions.change!.status).toBe('passed');
  split = advanceCollectives(split, 250).reduce(applyCollectiveEvent, split);
  expect(split).toEqual(whole);
  expect(whole.decisions.change!.status).toBe('expired');
  expect(whole.charters.club!.version).toBe(1);
  expect(() =>
    applyCollectiveEvent(whole, {
      type: 'CollectiveDecisionChanged',
      decision: whole.decisions.change!,
    }),
  ).toThrow('collective-decision-revision-gap');
});

test('resource names admit real hyphenated CLI routes without granting authority or accepting malformed names', () => {
  const action = {
    kind: 'resource',
    capability: 'trades.respond-settlement',
    resourceId: 'order',
    arguments: { expectedRevision: 2, accept: true },
  };
  expect(parseCollectiveAction(action, COLLECTIVES_POLICY, exists)).toEqual(action);
  for (const capability of [
    'trades..respond',
    'trades.-respond',
    'trades.respond--settlement',
    'trades.respond;rm',
    'trades.respond settlement',
    'a.'.repeat(100),
  ])
    expect(
      parseCollectiveAction({ ...action, capability }, COLLECTIVES_POLICY, exists),
    ).toBeUndefined();
  const unsupported = fixture();
  unsupported.create();
  expect(
    unsupported.act('a', {
      type: 'propose',
      id: 'x',
      collectiveId: 'club',
      expectedVersion: 1,
      terms: 'x',
      action,
      closesAt: 100,
      executeBefore: 200,
    }),
  ).toMatchObject({ accepted: false, reason: 'unsupported-collective-resource-action' });
});
