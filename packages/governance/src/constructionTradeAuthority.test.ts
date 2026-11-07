import { expect, test } from 'vitest';
import type { PrincipalOperationRequest } from '@aivilization/authority';
import {
  createPublicGovernanceState,
  decidePublicCommand,
  completePublicExecution,
} from './decisions';
import { applyPublicGovernanceEvent } from './events';
import {
  enablePublicConstructionTradeAuthority,
  enablePublicResourceCustodyAuthority,
  enablePublicConstructionPrincipalsAuthority,
  authorizePublicResourceOperation,
} from './resourcePrincipal';
import type { PublicCommand, PublicGovernanceState, PublicGovernanceEvent } from './model';
function fixture() {
  const initial = createPublicGovernanceState(
    {
      id: 'town',
      source: {
        kind: 'explicit-scenario-grant',
        version: 'fixture',
        description: 'Initial public procedure only',
      },
      residents: ['a', 'b', 'c'],
      actions: ['set-procedure'],
    },
    {
      electorate: ['a', 'b', 'c'],
      minimumTurnout: 2,
      minimumYes: 2,
      minimumVotingMs: 100,
      maximumVotingMs: 1000,
      executionWindowMs: 1000,
      allowVoteChanges: true,
      executors: 'electorate',
    },
  );
  const construction = enablePublicConstructionPrincipalsAuthority(
    enablePublicResourceCustodyAuthority(initial),
  );
  const request: PrincipalOperationRequest = {
    resourceKind: 'construction-order',
    resourceId: 'promise',
    resourceRevision: 1,
    controlVersion: 1,
    operation: {
      capability: 'construction-trades.accept',
      arguments: {
        type: 'accept',
        id: 'promise',
        expectedRevision: 1,
        side: 'buyer',
      },
    },
  };
  const propose: PublicCommand = {
    type: 'propose',
    id: 'p',
    text: 'Independent exact finite commitment',
    action: { kind: 'manage-resource', expectedRevision: 1, request },
    closesAt: 100,
    expectedProcedureRevision: 1,
  };
  return { initial: construction, legacy: initial, request, propose };
}
test('explicit procurement extension adds no physical asset authority and still needs independent procedure, exact request and one consumption', () => {
  const t = fixture();
  expect(decidePublicCommand(t.initial, 'a', 0, t.propose).accepted).toBe(false);
  const enabled = enablePublicConstructionTradeAuthority(t.initial);
  expect(enabled.grant.actions).toEqual(t.initial.grant.actions);
  expect(enabled.grant.resourceSales).toBeUndefined();
  expect(enabled.grant.resourceCustody).toEqual(t.initial.grant.resourceCustody);
  expect(enabled.proposals).toEqual(t.initial.proposals);
  let s = enabled;
  const events: PublicGovernanceEvent[] = [];
  const ok = (actor: string, at: number, c: PublicCommand) => {
    const d = decidePublicCommand(s, actor, at, c);
    if (!d.accepted) throw Error(d.reason);
    events.push(...d.events);
    s = d.events.reduce(applyPublicGovernanceEvent, s);
  };
  const authorization = (state: PublicGovernanceState = s, request = t.request) =>
    authorizePublicResourceOperation({
      state,
      actorId: 'c',
      at: 100,
      proposalId: 'p',
      expectedProposalRevision: state.proposals.p!.revision,
      request,
    });
  ok('a', 0, t.propose);
  expect(s.proposals.p!.constructionTradeScopeVersion).toBe('public-construction-trade-v1');
  expect(authorization().accepted).toBe(false);
  ok('a', 1, { type: 'vote', id: 'p', choice: 'yes', expectedRevision: s.proposals.p!.revision });
  ok('b', 2, { type: 'vote', id: 'p', choice: 'yes', expectedRevision: s.proposals.p!.revision });
  ok('c', 100, { type: 'close', id: 'p', expectedRevision: s.proposals.p!.revision });
  expect(authorization()).toMatchObject({
    accepted: true,
    authorization: { principal: { kind: 'public', id: 'town' }, actorId: 'c' },
  });
  expect(
    authorization(s, {
      ...t.request,
      operation: {
        ...t.request.operation,
        arguments: { ...t.request.operation.arguments, id: 'other-order' },
      },
    }).accepted,
  ).toBe(false);
  const { constructionTradeScopeVersion: removedScope, ...legacyProposal } = s.proposals.p!;
  void removedScope;
  const absent = { ...s, proposals: { ...s.proposals, p: legacyProposal } };
  expect(authorization(absent)).toMatchObject({
    accepted: false,
    reason: 'public-construction-trade-current-scope-consent-required',
  });
  expect(events.reduce(applyPublicGovernanceEvent, enabled)).toEqual(s);
  const executed = completePublicExecution(s, 'c', 100, 'p', s.proposals.p!.revision, [
    'actual-financial-packet',
  ]);
  if (!executed.accepted) throw Error(executed.reason);
  s = executed.events.reduce(applyPublicGovernanceEvent, s);
  expect(authorization().accepted).toBe(false);
});
test('physical construction grant never implies procurement and malformed scope cannot grant labor or arbitrary debits', () => {
  const t = fixture(),
    enabled = enablePublicConstructionTradeAuthority(t.initial);
  expect(() => enablePublicConstructionTradeAuthority(t.legacy)).toThrow();
  expect(() => enablePublicConstructionTradeAuthority(enabled)).toThrow();
  if (t.propose.type !== 'propose') throw Error('fixture');
  for (const request of [
    {
      ...t.request,
      operation: { ...t.request.operation, capability: 'construction-trades.arbitrary-debit' },
    },
    {
      ...t.request,
      operation: { ...t.request.operation, capability: 'construction-trades.start-labor' },
    },
    {
      ...t.request,
      operation: { ...t.request.operation, capability: 'construction-trades.offer' },
    },
    { ...t.request, resourceKind: 'vehicle' },
    { ...t.request, resourceKind: 'construction-project' },
  ])
    expect(
      decidePublicCommand(enabled, 'a', 0, {
        ...t.propose,
        action: { kind: 'manage-resource', expectedRevision: 1, request },
      }).accepted,
    ).toBe(false);
  const offer = {
    ...t.request,
    resourceKind: 'construction-project',
    operation: { ...t.request.operation, capability: 'construction-trades.offer' },
  };
  expect(
    decidePublicCommand(t.initial, 'a', 0, {
      ...t.propose,
      action: { kind: 'manage-resource', expectedRevision: 1, request: offer },
    }).accepted,
  ).toBe(false);
  const d = decidePublicCommand(enabled, 'a', 0, t.propose);
  if (!d.accepted || d.events[0]?.type !== 'PublicProposalOpened') throw Error('fixture');
  expect(() => applyPublicGovernanceEvent(t.initial, d.events[0]!)).toThrow();
});
