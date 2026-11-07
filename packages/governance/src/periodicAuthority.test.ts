import { expect, test } from 'vitest';
import type { PrincipalOperationRequest } from '@aivilization/authority';
import {
  createPublicGovernanceState,
  decidePublicCommand,
  completePublicExecution,
} from './decisions';
import { applyPublicGovernanceEvent } from './events';
import {
  enablePublicPeriodicObligationsAuthority,
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
  const request: PrincipalOperationRequest = {
    resourceKind: 'periodic-obligation',
    resourceId: 'promise',
    resourceRevision: 1,
    controlVersion: 1,
    operation: {
      capability: 'obligations.offer',
      arguments: {
        command: { type: 'offer', id: 'promise' },
        terms: { periods: 3 },
        maximumTotalMicros: 75000000,
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
  return { initial, request, propose };
}
test('standalone explicit fiscal scope adds no physical asset authority and still needs independent procedure, exact request and one consumption', () => {
  const t = fixture();
  expect(decidePublicCommand(t.initial, 'a', 0, t.propose).accepted).toBe(false);
  const enabled = enablePublicPeriodicObligationsAuthority(t.initial);
  expect(enabled.grant.actions).toEqual(['set-procedure', 'manage-resource']);
  expect(enabled.grant.resourceSales).toBeUndefined();
  expect(enabled.grant.resourceCustody).toBeUndefined();
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
  expect(s.proposals.p!.periodicObligationsScopeVersion).toBe(
    'public-finite-periodic-commitments-v1',
  );
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
        arguments: { ...t.request.operation.arguments, maximumTotalMicros: 80000000 },
      },
    }).accepted,
  ).toBe(false);
  const { periodicObligationsScopeVersion: removedScope, ...legacyProposal } = s.proposals.p!;
  void removedScope;
  const absent = { ...s, proposals: { ...s.proposals, p: legacyProposal } };
  expect(authorization(absent)).toMatchObject({
    accepted: false,
    reason: 'public-periodic-current-scope-consent-required',
  });
  expect(events.reduce(applyPublicGovernanceEvent, enabled)).toEqual(s);
  const executed = completePublicExecution(s, 'c', 100, 'p', s.proposals.p!.revision, [
    'actual-financial-packet',
  ]);
  if (!executed.accepted) throw Error(executed.reason);
  s = executed.events.reduce(applyPublicGovernanceEvent, s);
  expect(authorization().accepted).toBe(false);
});
test('original grant refuses arbitrary debits, infinite or oversized commitments and forged opened scope', () => {
  const t = fixture(),
    enabled = enablePublicPeriodicObligationsAuthority(t.initial);
  for (const request of [
    {
      ...t.request,
      operation: { ...t.request.operation, capability: 'obligations.arbitrary-debit' },
    },
    { ...t.request, resourceKind: 'vehicle' },
    ...[0, -1, Infinity, 1000000000001].map((maximumTotalMicros) => ({
      ...t.request,
      operation: {
        ...t.request.operation,
        arguments: { ...t.request.operation.arguments, maximumTotalMicros },
      },
    })),
    {
      ...t.request,
      operation: {
        ...t.request.operation,
        arguments: { ...t.request.operation.arguments, terms: { periods: 129 } },
      },
    },
  ]) {
    if (t.propose.type !== 'propose') throw Error('fixture');
    expect(
      decidePublicCommand(enabled, 'a', 0, {
        ...t.propose,
        action: { kind: 'manage-resource', expectedRevision: 1, request },
      }).accepted,
    ).toBe(false);
  }
  const d = decidePublicCommand(enabled, 'a', 0, t.propose);
  if (!d.accepted || d.events[0]?.type !== 'PublicProposalOpened') throw Error('fixture');
  expect(() => applyPublicGovernanceEvent(t.initial, d.events[0]!)).toThrow();
  expect(() => enablePublicPeriodicObligationsAuthority(enabled)).toThrow(
    'public-periodic-obligations-already-enabled',
  );
});
