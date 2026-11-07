import { createInitialTownGovernanceState } from '@aivilization/society';
import { expect, test } from 'vitest';
import {
  constructionTradeRequest,
  emptyEvidenceTradeState,
  evidenceTradeEscrowBalance,
  type ConstructionTradeCommand,
} from '@aivilization/commerce';
import {
  createPublicGovernanceState,
  enablePublicResourceCustodyAuthority,
  enablePublicConstructionPrincipalsAuthority,
} from '@aivilization/governance';
import { residentConstructionFixture } from './testFixtures/residentConstruction';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  enableResidentConstructionTradeEvent,
  residentConstructionTradeOperation,
} from './residentConstructionTrade';
import { residentPublicGovernanceCommand } from './residentPublicGovernance';
import { handleAdvanceSimulationTimeCommand } from './agentActions';
import { createCommandEnvelope } from '@aivilization/sim-core';
function fixture() {
  const f = residentConstructionFixture();
  // Explicit engineering snapshot: a public beneficiary project, not evidence of resident adoption or project procurement.
  const initial: WorldProjection = {
    ...f.w,
    treasury: 100,
    moneySupply: 400,
    residentTrade: emptyEvidenceTradeState(),
    premises: {
      ...f.w.premises!,
      projects: {
        ...f.w.premises!.projects,
        p: { ...f.w.premises!.projects.p!, controller: { kind: 'public', id: 'town' } },
      },
    },
    publicGovernance: {
      authority: enablePublicConstructionPrincipalsAuthority(
        enablePublicResourceCustodyAuthority(
          createPublicGovernanceState(
            {
              id: 'town',
              source: {
                kind: 'explicit-scenario-grant',
                version: 'test',
                description: 'Engineering authority',
              },
              residents: ['builder', 'worker', 'donor'],
              actions: ['set-procedure'],
            },
            {
              electorate: ['builder', 'worker', 'donor'],
              minimumTurnout: 2,
              minimumYes: 2,
              minimumVotingMs: 1,
              maximumVotingMs: 1000,
              executionWindowMs: 10000,
              allowVoteChanges: false,
              executors: ['builder'],
            },
          ),
        ),
      ),
      institutionPolicy: {
        policyVersion: 'test',
        allowedBudgetServices: [],
        maximumAllocationPerCadence: 100,
        maximumTreasuryReserve: 100,
        maximumSubsidyBalanceFloor: 100,
        maximumSubsidyPerCadence: 10,
      },
    },
  };
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const context = (actorId = 'builder') => ({
    projection: w,
    actorId,
    simulationId: 'sim',
    requestId: `public-order-${++n}`,
    nextSequence: events.length + 1,
  });
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    if (!d.accepted) throw Error(d.reason);
    w = d.events.reduce(applyWorldEvent, w);
    events.push(...d.events);
    expect(w.moneySupply).toBe(400);
    expect(
      Object.values(w.agents).reduce((s, a) => s + a.balance, 0) +
        (w.treasury ?? 0) +
        evidenceTradeEscrowBalance(w.residentTrade),
    ).toBeCloseTo(400, 8);
    return d.events;
  };
  ok(enableResidentConstructionTradeEvent({ ...context('system'), enablePublicAuthority: true }));
  const act = (command: ConstructionTradeCommand, actorId = 'worker') =>
    residentConstructionTradeOperation({ ...context(actorId), command });
  const publicAct = (
    command: Parameters<typeof residentPublicGovernanceCommand>[0]['command'],
    actorId = 'builder',
  ) => residentPublicGovernanceCommand({ ...context(actorId), command });
  const approve = (command: ConstructionTradeCommand) => {
    const request = constructionTradeRequest(command),
      id = `proposal-${++n}`;
    ok(
      publicAct({
        type: 'propose',
        id,
        text: '居民自行选择的工程交易条款',
        action: { kind: 'manage-resource', expectedRevision: request.resourceRevision, request },
        closesAt: w.clock.now + 1,
        expectedProcedureRevision: 1,
      }),
    );
    const rev = () => w.publicGovernance!.authority.proposals[id]!.revision;
    ok(publicAct({ type: 'vote', id, choice: 'yes', expectedRevision: rev() }));
    ok(publicAct({ type: 'vote', id, choice: 'yes', expectedRevision: rev() }, 'donor'));
    const c = context('system');
    ok({
      accepted: true,
      events: handleAdvanceSimulationTimeCommand({
        ...c,
        command: createCommandEnvelope({
          id: c.requestId,
          simulationId: 'sim',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs: 1 },
        }),
      }),
    });
    ok(publicAct({ type: 'close', id, expectedRevision: rev() }));
    return { type: 'execute' as const, id, expectedRevision: rev() };
  };
  const offer: ConstructionTradeCommand = {
    type: 'offer',
    terms: {
      id: 'order',
      projectId: 'p',
      sourceRevision: w.premises!.projects.p!.revision,
      seller: { kind: 'resident', id: 'worker' },
      buyer: { kind: 'public', id: 'town' },
      payer: { sector: 'treasury', id: 'public-treasury' },
      revenue: { sector: 'agent', id: 'worker' },
      amount: 30,
      acceptBy: 10000,
      title: '公共工程',
      terms: '约定完成付款，中止独立分款',
    },
  };
  return {
    initial,
    context,
    ok,
    act,
    publicAct,
    approve,
    offer,
    get w() {
      return w;
    },
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('public construction funding consumes only the exact independent decision atomically; cancellation retains escrow and independent settlement refunds treasury', () => {
  const f = fixture();
  f.ok(f.act(f.offer));
  const accept: ConstructionTradeCommand = {
    type: 'accept',
    id: 'order',
    expectedRevision: 1,
    side: 'buyer',
  };
  expect(f.act(accept, 'builder').accepted).toBe(false);
  const execute = f.approve(accept),
    d = f.publicAct(execute);
  if (!d.accepted || d.events[0]?.type !== 'ResidentPublicGovernanceCommitted')
    throw Error('fixture');
  const e = d.events[0],
    commit = e.payload.constructionTradeCommit!;
  expect(() =>
    applyWorldEvent(f.w, { ...e, type: 'ResidentConstructionTradeCommitted', payload: commit }),
  ).toThrow();
  expect(() =>
    applyWorldEvent(f.w, {
      ...e,
      payload: { ...e.payload, constructionTradeCommit: { ...commit, transactions: [] } },
    }),
  ).toThrow();
  const { constructionTradeCommit: omitted, ...without } = e.payload;
  void omitted;
  expect(() => applyWorldEvent(f.w, { ...e, payload: without })).toThrow();
  const reserveWorld: WorldProjection = {
    ...f.w,
    governance: {
      ...createInitialTownGovernanceState(),
      lastChangedAt: 0,
      lastChangedBy: { kind: 'operator', subjectId: 'fixture' },
      lastChangeReason: 'explicit test reserve',
      publicBudget: {
        policyVersion: 'test-reserve-v1',
        cadenceMs: 60000,
        minimumTreasuryReserve: 71,
        allocations: [],
      },
    },
  };
  expect(() => applyWorldEvent(reserveWorld, e)).toThrow(
    'construction-trade-treasury-reserve-violated',
  );
  expect(
    residentPublicGovernanceCommand({ ...f.context(), projection: reserveWorld, command: execute })
      .accepted,
  ).toBe(false);
  expect(reserveWorld.publicGovernance!.authority.proposals[execute.id]!.status).toBe('approved');
  expect(f.w.treasury).toBe(100);
  f.ok(d);
  expect(f.w.treasury).toBe(70);
  expect(evidenceTradeEscrowBalance(f.w.residentTrade)).toBe(30);
  expect(f.publicAct(execute).accepted).toBe(false);
  f.ok(f.act({ type: 'withdraw', id: 'order', expectedRevision: 2, side: 'seller' }));
  expect(f.w.treasury).toBe(70);
  expect(f.w.premises!.projects.p!.status).toBe('open');
  f.ok(
    f.act({
      type: 'propose-settlement',
      id: 'order',
      expectedRevision: 3,
      side: 'seller',
      proposalId: 'split',
      paySeller: 7,
      text: '双方约定七元，其余退回原国库',
    }),
  );
  f.ok(
    f.publicAct(
      f.approve({
        type: 'accept-settlement',
        id: 'order',
        expectedRevision: 4,
        side: 'buyer',
        proposalId: 'split',
      }),
    ),
  );
  expect(f.w.treasury).toBe(93);
  expect(f.w.agents.worker!.balance).toBe(107);
  expect(f.w.agents.builder!.balance).toBe(100);
  expect(evidenceTradeEscrowBalance(f.w.residentTrade)).toBe(0);
  f.replay();
});
