import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import type { PublicAction, PublicCommand } from '@aivilization/governance';
import { expect, test } from 'vitest';
import {
  createWorldProjection,
  applyWorldEvent,
  enableResidentPublicGovernanceEvent,
  residentPublicGovernanceCommand,
  dispatchWorldCommand,
  type WorldEvent,
  type WorldCommandPolicies,
} from './index';
const policy = {
  policyVersion: 'test-public-bound-v1',
  allowedBudgetServices: ['healthcare'],
  maximumAllocationPerCadence: 100,
  maximumTreasuryReserve: 1000,
  maximumSubsidyBalanceFloor: 100,
  maximumSubsidyPerCadence: 10,
};
const tax = (rate = 0.2): PublicAction => ({
  kind: 'set-tax',
  expectedRevision: 0,
  terms: { neutralRate: 0.1, tradeTaxRate: rate, incomeTaxBrackets: [{ upToAmount: null, rate }] },
});
const base: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 100,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
};
function fixture() {
  const initial = createWorldProjection({
    agents: ['a', 'b', 'c'].map((id) => ({
      agentId: asAgentId(id),
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      balance: 100,
      residentialTier: 1,
      job: 'Cleaner',
      inventory: {},
    })),
    treasury: 1000,
    moneySupply: 1300,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(w.moneySupply).toBe(1300);
    expect(Object.values(w.agents).reduce((n, a) => n + a.balance, 0) + w.treasury!).toBeCloseTo(
      1300,
    );
  };
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    requestId: `public-${++n}`,
    simulationId: 'test',
    nextSequence: events.length + 1,
  });
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: policy,
      grant: {
        id: 'town',
        source: {
          kind: 'explicit-scenario-grant',
          version: 'fixture-v1',
          description: 'Explicit public scope',
        },
        residents: ['a', 'b', 'c'],
        actions: ['set-tax', 'set-budget', 'set-subsidy', 'set-procedure', 'invalidate-decision'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  const act = (
    command: PublicCommand | { type: 'execute'; id: string; expectedRevision: number },
    actor = 'a',
  ) => residentPublicGovernanceCommand({ ...ctx(actor), command });
  const ok = (command: Parameters<typeof act>[0], actor = 'a') => {
    const d = act(command, actor);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
    return d;
  };
  const rev = (id: string) => w.publicGovernance!.authority.proposals[id]!.revision;
  const propose = (id = 'p', action = tax()) => {
    ok({
      type: 'propose',
      id,
      text: '居民提出具体政策',
      action,
      expectedProcedureRevision: 1,
      closesAt: w.clock.now + 100,
    });
    for (const a of ['a', 'b'])
      ok({ type: 'vote', id, expectedRevision: rev(id), choice: 'yes' }, a);
  };
  const time = (deltaMs: number) =>
    commit(
      dispatchWorldCommand({
        projection: w,
        policies: base,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time-${++n}`,
          simulationId: 'test',
          source: 'system',
          type: 'AdvanceSimulationTime',
          payload: { deltaMs },
          issuedAt: w.clock.now,
        }),
      }),
    );
  const close = (id = 'p') => ok({ type: 'close', id, expectedRevision: rev(id) });
  return {
    get w() {
      return w;
    },
    initial,
    events,
    ctx,
    commit,
    act,
    ok,
    rev,
    propose,
    time,
    close,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('precise public consent enacts the existing tax state atomically and real wages use balanced tax transfers', () => {
  const t = fixture();
  t.propose();
  t.time(100);
  t.close();
  const d = t.ok({ type: 'execute', id: 'p', expectedRevision: t.rev('p') });
  expect(d.accepted && d.events.length).toBe(1);
  expect(t.w.governance).toMatchObject({
    revision: 1,
    tax: { tradeTaxRate: 0.2 },
    lastChangedBy: {
      kind: 'public-procedure',
      jurisdictionId: 'town',
      proposalId: 'p',
      procedureRevision: 1,
      agentId: 'a',
    },
  });
  expect(t.w.publicGovernance!.authority.proposals.p!.status).toBe('executed');
  const work = dispatchWorldCommand({
    projection: t.w,
    policies: { ...base, tax: t.w.governance!.tax! },
    nextSequence: t.events.length + 1,
    command: createCommandEnvelope({
      id: 'work',
      simulationId: 'test',
      actorId: 'c',
      source: 'agent-runtime',
      type: 'AgentWork',
      payload: { occupationName: 'Cleaner', laborSeconds: 1 },
      issuedAt: t.w.clock.now,
    }),
  });
  t.commit(work);
  expect(t.w.agents.c!.balance).toBe(180);
  expect(t.w.treasury).toBe(920);
  expect(work.some((e) => e.type === 'IncomeTaxCharged')).toBe(true);
  t.replay();
});
test('stale targets and policy limits refuse without consuming a vote-approved decision or partially changing policy', () => {
  const t = fixture();
  t.propose('first');
  t.propose('stale', tax(0.3));
  t.propose('over', {
    kind: 'set-budget',
    expectedRevision: 1,
    terms: {
      cadenceMs: 60000,
      minimumTreasuryReserve: 0,
      allocations: [{ service: 'healthcare', amountPerCadence: 101 }],
    },
  });
  t.time(100);
  for (const id of ['first', 'stale', 'over']) t.close(id);
  t.ok({ type: 'execute', id: 'first', expectedRevision: t.rev('first') });
  const before = t.w;
  expect(t.act({ type: 'execute', id: 'stale', expectedRevision: t.rev('stale') })).toMatchObject({
    accepted: false,
    reason: 'governance-revision-conflict',
  });
  expect(t.act({ type: 'execute', id: 'over', expectedRevision: t.rev('over') })).toMatchObject({
    accepted: false,
    reason: 'invalid-policy',
  });
  expect(t.w).toBe(before);
  expect(t.w.publicGovernance!.authority.proposals.stale!.status).toBe('approved');
  t.replay();
});
test('composite replay rejects missing or substituted fiscal effects and topic petitions cannot bypass public approval', () => {
  const t = fixture();
  t.propose();
  t.time(100);
  t.close();
  const d = t.act({ type: 'execute', id: 'p', expectedRevision: t.rev('p') });
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error('fixture');
  const e = d.events[0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted') throw Error('fixture');
  const { policyChange, ...rest } = e.payload;
  expect(policyChange).toBeDefined();
  expect(() => applyWorldEvent(t.w, { ...e, payload: rest })).toThrow(
    'public-policy-terms-do-not-match-approved-proposal',
  );
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        policyChange: {
          ...policyChange!,
          taxPolicy: { ...policyChange!.taxPolicy!, tradeTaxRate: 0.9 },
        },
      },
    }),
  ).toThrow('public-policy-terms-do-not-match-approved-proposal');
  const denied = dispatchWorldCommand({
    projection: t.w,
    policies: { ...base, governance: policy },
    nextSequence: t.events.length + 1,
    command: createCommandEnvelope({
      id: 'bypass',
      simulationId: 'test',
      actorId: 'a',
      source: 'agent-runtime',
      type: 'SetTaxPolicy',
      payload: {
        reason: 'topic is insufficient',
        expectedGovernanceRevision: 0,
        neutralRate: 0.1,
        tradeTaxRate: 0.9,
        incomeTaxBrackets: [{ upToAmount: null, rate: 0.9 }],
        petitionId: 'old-topic',
      },
      issuedAt: t.w.clock.now,
    }),
  });
  expect(denied[0]).toMatchObject({
    type: 'GovernanceChangeRejected',
    payload: { reason: 'governance-authorization-rejected' },
  });
  expect(t.w.governance).toBeUndefined();
  t.commit(d.events);
  t.replay();
});
