import { expect, test } from 'vitest';
import {
  createPublicGovernanceState,
  decidePublicCommand,
  preparePublicExecution,
  completePublicExecution,
  applyPublicGovernanceEvent,
  type PublicAction,
  type PublicCommand,
  type PublicDecision,
  type PublicGovernanceEvent,
  type PublicProcedure,
  type PublicJurisdictionGrant,
} from './index';
const grant: PublicJurisdictionGrant = {
  id: 'town',
  source: {
    kind: 'explicit-scenario-grant',
    version: 'fixture-v1',
    description: 'Explicit scenario public authority, not resident consent.',
  },
  residents: ['a', 'b', 'c'],
  actions: ['set-tax', 'set-budget', 'set-subsidy', 'set-procedure', 'invalidate-decision'],
};
const procedure: PublicProcedure = {
  electorate: ['a', 'b', 'c'],
  minimumTurnout: 2,
  minimumYes: 2,
  allowVoteChanges: true,
  minimumVotingMs: 100,
  maximumVotingMs: 1000,
  executionWindowMs: 1000,
  executors: 'electorate',
};
const tax: PublicAction = {
  kind: 'set-tax',
  expectedRevision: 0,
  terms: {
    neutralRate: 0.1,
    tradeTaxRate: 0.1,
    incomeTaxBrackets: [{ upToAmount: null, rate: 0.1 }],
  },
};
function fixture(p = procedure) {
  const initial = createPublicGovernanceState(grant, p),
    events: PublicGovernanceEvent[] = [];
  let s = initial,
    at = 0;
  const commit = (d: PublicDecision) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted)
      for (const e of d.events) {
        s = applyPublicGovernanceEvent(s, e);
        events.push(e);
      }
  };
  const act = (a: string, c: PublicCommand) => decidePublicCommand(s, a, at, c);
  const ok = (a: string, c: PublicCommand) => commit(act(a, c));
  const propose = (id = 'p', action = tax) =>
    ok('a', {
      type: 'propose',
      id,
      text: '居民自己写的具体公共提案',
      action,
      closesAt: at + 100,
      expectedProcedureRevision: s.procedureRevision,
    });
  const vote = (a: string, choice: 'yes' | 'no' | 'abstain' = 'yes', id = 'p') =>
    ok(a, { type: 'vote', id, choice, expectedRevision: s.proposals[id]!.revision });
  const close = (id = 'p') =>
    ok('c', { type: 'close', id, expectedRevision: s.proposals[id]!.revision });
  const execute = (id = 'p', actor = 'a') =>
    completePublicExecution(s, actor, at, id, s.proposals[id]!.revision, [
      `effect-${events.length}`,
    ]);
  return {
    get s() {
      return s;
    },
    events,
    act,
    ok,
    commit,
    propose,
    vote,
    close,
    execute,
    time: (n: number) => {
      at = n;
    },
    replay: () => expect(events.reduce(applyPublicGovernanceEvent, initial)).toEqual(s),
  };
}
test('exact proposal freezes parameters, requires independent votes and closure, and produces single-use execution authority', () => {
  const t = fixture();
  const terms = {
    neutralRate: 0.1,
    tradeTaxRate: 0.15,
    incomeTaxBrackets: [{ upToAmount: null, rate: 0.1 }],
  };
  t.propose('p', { kind: 'set-tax', expectedRevision: 0, terms });
  terms.tradeTaxRate = 0.9;
  expect(t.s.proposals.p!.action).toMatchObject({ terms: { tradeTaxRate: 0.15 } });
  expect(t.execute().accepted).toBe(false);
  t.vote('a');
  expect(
    t.act('outsider', { type: 'vote', id: 'p', choice: 'yes', expectedRevision: 2 }).accepted,
  ).toBe(false);
  expect(t.act('b', { type: 'vote', id: 'p', choice: 'yes', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  t.vote('b');
  expect(t.act('c', { type: 'close', id: 'p', expectedRevision: 3 }).accepted).toBe(false);
  t.time(100);
  t.close();
  expect(t.s.proposals.p!.status).toBe('approved');
  expect(preparePublicExecution(t.s, 'outsider', 100, 'p', 4).accepted).toBe(false);
  expect(t.s.proposals.p!.status).toBe('approved'); // Preparing authority never spends it.
  t.commit(t.execute());
  expect(t.s.proposals.p!.status).toBe('executed');
  expect(t.execute().accepted).toBe(false);
  t.replay();
});
test('a minority or abstention cannot be narrated into approval; vote changes preserve the original events', () => {
  const t = fixture();
  t.propose();
  t.vote('a');
  t.vote('b', 'yes');
  t.time(50);
  t.vote('b', 'no');
  t.vote('c', 'abstain');
  t.time(100);
  t.close();
  expect(t.s.proposals.p).toMatchObject({
    status: 'rejected',
    result: { yes: 1, no: 1, abstain: 1 },
  });
  expect(t.events.filter((e) => e.type === 'PublicVoteRecorded')).toHaveLength(4);
  expect(t.execute().accepted).toBe(false);
  t.replay();
});
test('the same primitives support no-change ballots and a designated executor without prescribing a government form', () => {
  const t = fixture({
    ...procedure,
    allowVoteChanges: false,
    minimumTurnout: 3,
    minimumYes: 1,
    executors: ['c'],
  });
  t.propose();
  t.vote('a');
  expect(t.act('a', { type: 'vote', id: 'p', expectedRevision: 2, choice: 'no' })).toMatchObject({
    accepted: false,
    reason: 'public-vote-change-disabled',
  });
  t.vote('b', 'abstain');
  t.vote('c', 'abstain');
  t.time(100);
  t.close();
  expect(t.execute().accepted).toBe(false);
  t.commit(t.execute('p', 'c'));
  t.replay();
});
test('changing the procedure requires the old threshold and cannot enfranchise outsiders or retroactively lower old votes', () => {
  const t = fixture();
  t.propose('other');
  const changed = { ...procedure, minimumYes: 1, electorate: ['a', 'b'], minimumTurnout: 1 };
  t.propose('change', { kind: 'set-procedure', expectedRevision: 1, terms: changed });
  t.vote('a', 'yes', 'change');
  t.vote('b', 'yes', 'change');
  t.vote('a', 'yes', 'other');
  t.vote('b', 'yes', 'other');
  t.time(100);
  t.close('change');
  t.close('other');
  t.commit(t.execute('change'));
  expect(t.s.procedureRevision).toBe(2);
  expect(t.s.proposals.other!.procedure.minimumYes).toBe(2);
  expect(t.execute('other')).toMatchObject({
    accepted: false,
    reason: 'public-decision-procedure-superseded',
  });
  expect(
    t.act('a', {
      type: 'propose',
      id: 'bad',
      text: '扩权',
      action: {
        kind: 'set-procedure',
        expectedRevision: 2,
        terms: { ...changed, electorate: ['a', 'outsider'] },
      },
      expectedProcedureRevision: 2,
      closesAt: 200,
    }).accepted,
  ).toBe(false);
  t.replay();
});
test('an objection is attributed speech; invalidating an unused decision needs its own exact approved procedure', () => {
  const t = fixture();
  t.propose();
  t.vote('a');
  t.vote('b');
  t.time(100);
  t.close();
  t.ok('b', {
    type: 'object',
    id: 'concern',
    proposalId: 'p',
    text: '我认为这个决定有问题，不代表系统已裁决。',
  });
  expect(t.s.proposals.p!.status).toBe('approved');
  t.propose('remedy', {
    kind: 'invalidate-decision',
    proposalId: 'p',
    expectedRevision: t.s.proposals.p!.revision,
    reason: '共同决定撤销尚未使用的授权',
  });
  t.vote('a', 'yes', 'remedy');
  t.vote('c', 'yes', 'remedy');
  t.time(200);
  t.close('remedy');
  t.commit(t.execute('remedy'));
  expect(t.s.proposals.p!.status).toBe('invalidated');
  expect(t.execute().accepted).toBe(false);
  t.replay();
});
test('target execution before a remedy prevents retroactive erasure and does not consume the remedy', () => {
  const t = fixture();
  t.propose();
  t.vote('a');
  t.vote('b');
  t.time(100);
  t.close();
  t.propose('remedy', {
    kind: 'invalidate-decision',
    proposalId: 'p',
    expectedRevision: 4,
    reason: '撤销未来权限',
  });
  t.commit(t.execute());
  t.vote('a', 'yes', 'remedy');
  t.vote('b', 'yes', 'remedy');
  t.time(200);
  t.close('remedy');
  expect(t.execute('remedy')).toMatchObject({
    accepted: false,
    reason: 'public-invalidation-target-not-current',
  });
  expect(t.s.proposals.remedy!.status).toBe('approved');
  expect(t.s.proposals.p!.status).toBe('executed');
  t.replay();
});
test('deadline, grant, payload and replay version boundaries reject without fabricating authorization', () => {
  const t = fixture();
  t.propose();
  expect(
    t.act('a', {
      type: 'propose',
      id: 'bad',
      text: '坏政策',
      action: { kind: 'set-tax', expectedRevision: 0, terms: { ...tax.terms, tradeTaxRate: NaN } },
      closesAt: 100,
      expectedProcedureRevision: 1,
    }).accepted,
  ).toBe(false);
  t.vote('a');
  t.vote('b');
  t.time(100);
  expect(t.act('c', { type: 'vote', id: 'p', choice: 'yes', expectedRevision: 3 }).accepted).toBe(
    false,
  );
  t.close();
  t.time(1100);
  expect(t.execute().accepted).toBe(false);
  const first = t.events[0]!;
  expect(() => applyPublicGovernanceEvent(t.s, first)).toThrow('invalid-public-governance-event');
  expect(() =>
    createPublicGovernanceState(
      {
        ...grant,
        source: { ...grant.source, kind: 'resident-claim' as 'explicit-scenario-grant' },
      },
      procedure,
    ),
  ).toThrow();
  t.replay();
});

test('unbounded fiscal cadence and backward personal statements cannot produce durable public events', () => {
  const t = fixture();
  expect(
    t.act('a', {
      type: 'propose',
      id: 'too-fast',
      text: 'arbitrary tiny cadence',
      action: {
        kind: 'set-budget',
        expectedRevision: 0,
        terms: { cadenceMs: 1, minimumTreasuryReserve: 0, allocations: [] },
      },
      expectedProcedureRevision: 1,
      closesAt: 100,
    }),
  ).toMatchObject({ accepted: false, reason: 'public-action-outside-grant-or-invalid' });
  t.propose();
  t.time(50);
  t.vote('a');
  t.time(25);
  expect(t.act('a', { type: 'vote', id: 'p', expectedRevision: 2, choice: 'no' })).toMatchObject({
    accepted: false,
    reason: 'invalid-public-time',
  });
  expect(
    t.act('b', { type: 'object', id: 'bad-ref', proposalId: 'constructor', text: 'not a proposal' })
      .accepted,
  ).toBe(false);
  t.replay();
});

test('public procurement scope is an explicit versioned grant, not a private proposal or an expansion of old votes', async () => {
  const { enablePublicProcurementAuthority, assertPublicAction, PUBLIC_PROCUREMENT_GRANT } =
    await import('./index');
  const t = fixture();
  t.propose();
  t.vote('a');
  const action: PublicAction = {
    kind: 'fund-service',
    engagementId: 'svc',
    expectedRevision: 2,
    maximumCharge: 36,
  };
  expect(() => assertPublicAction(action, t.s.grant)).toThrow();
  const next = enablePublicProcurementAuthority(t.s);
  expect(next.proposals).toEqual(t.s.proposals);
  expect(next.procedureRevision).toBe(t.s.procedureRevision);
  expect(next.grant.source).toEqual(t.s.grant.source);
  expect(next.grant.procurement).toEqual(PUBLIC_PROCUREMENT_GRANT);
  expect(() => assertPublicAction(action, next.grant)).not.toThrow();
  expect(() => assertPublicAction({ ...action, maximumCharge: NaN }, next.grant)).toThrow();
  expect(() => assertPublicAction({ ...action, expectedRevision: 0 }, next.grant)).toThrow();
  expect(() => enablePublicProcurementAuthority(next)).toThrow(
    'public-procurement-already-enabled',
  );
  t.replay();
});

test('goods funding requires its own finite exact grant and preserves prior decisions and procedure', async () => {
  const {
    enablePublicProcurementAuthority,
    enablePublicGoodsProcurementAuthority,
    assertPublicAction,
  } = await import('./index');
  const t = fixture();
  t.propose();
  t.vote('a');
  expect(() => enablePublicGoodsProcurementAuthority(t.s)).toThrow();
  const service = enablePublicProcurementAuthority(t.s);
  const action: PublicAction = {
    kind: 'fund-goods',
    orderId: 'goods',
    expectedRevision: 2,
    amount: 30,
  };
  expect(() => assertPublicAction(action, service.grant)).toThrow();
  const next = enablePublicGoodsProcurementAuthority(service);
  expect(next.proposals).toEqual(t.s.proposals);
  expect(next.procedure).toEqual(t.s.procedure);
  expect(next.grant.source).toEqual(t.s.grant.source);
  expect(() => assertPublicAction(action, next.grant)).not.toThrow();
  for (const amount of [NaN, Infinity, -1, 0, 0.0000001])
    expect(() => assertPublicAction({ ...action, amount }, next.grant)).toThrow();
  expect(() => enablePublicGoodsProcurementAuthority(next)).toThrow();
  t.replay();
});
