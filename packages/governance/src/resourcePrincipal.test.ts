import { expect, test } from 'vitest';
import type { PrincipalControlRequest } from '@aivilization/authority';
import {
  createPublicGovernanceState,
  decidePublicCommand,
  completePublicExecution,
} from './decisions';
import { applyPublicGovernanceEvent } from './events';
import {
  enablePublicResourceCustodyAuthority,
  authorizePublicResourceControl,
  enablePublicConstructionPrincipalsAuthority,
} from './resourcePrincipal';
import type { PublicCommand, PublicGovernanceEvent } from './model';
const request: PrincipalControlRequest = {
  resourceKind: 'premises',
  resourceId: 'home',
  resourceRevision: 7,
  controlVersion: 2,
  command: { type: 'accept' },
};
function fixture() {
  const legacy = createPublicGovernanceState(
    {
      id: 'town',
      source: {
        kind: 'explicit-scenario-grant',
        version: 'test',
        description: 'Explicit institution',
      },
      residents: ['a', 'b', 'c'],
      actions: ['set-procedure'],
    },
    {
      electorate: ['a', 'b', 'c'],
      minimumTurnout: 2,
      minimumYes: 2,
      allowVoteChanges: true,
      minimumVotingMs: 100,
      maximumVotingMs: 1000,
      executionWindowMs: 1000,
      executors: 'electorate',
    },
  );
  const initial = enablePublicResourceCustodyAuthority(legacy);
  let s = initial,
    at = 0;
  const events: PublicGovernanceEvent[] = [];
  const ok = (command: PublicCommand, actor = 'a') => {
    const d = decidePublicCommand(s, actor, at, command);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) {
      s = d.events.reduce(applyPublicGovernanceEvent, s);
      events.push(...d.events);
    }
  };
  const rev = () => s.proposals.p!.revision;
  const authorize = (r = request, actorId = 'c') =>
    authorizePublicResourceControl({
      state: s,
      actorId,
      at,
      proposalId: 'p',
      expectedProposalRevision: rev(),
      request: r,
    });
  const propose = () =>
    ok({
      type: 'propose',
      id: 'p',
      text: 'Exact public acceptance; no personal title',
      action: { kind: 'control-resource', expectedRevision: 7, request },
      closesAt: 100,
      expectedProcedureRevision: 1,
    });
  return {
    legacy,
    initial,
    events,
    ok,
    rev,
    authorize,
    propose,
    get s() {
      return s;
    },
    set at(t: number) {
      at = t;
    },
    get at() {
      return at;
    },
    consume() {
      const d = completePublicExecution(s, 'c', at, 'p', rev(), ['actual-asset-event']);
      if (!d.accepted) throw Error(d.reason);
      s = d.events.reduce(applyPublicGovernanceEvent, s);
      events.push(...d.events);
    },
  };
}
test('public custody approval comes from real independent ballots and exact scope, not treasury spending or the executor personal authority', () => {
  const t = fixture();
  expect(t.legacy.grant).not.toHaveProperty('resourceCustody');
  t.propose();
  expect(t.authorize().accepted).toBe(false);
  t.ok({ type: 'vote', id: 'p', expectedRevision: t.rev(), choice: 'yes' });
  t.ok({ type: 'vote', id: 'p', expectedRevision: t.rev(), choice: 'yes' }, 'b');
  t.at = 100;
  t.ok({ type: 'close', id: 'p', expectedRevision: t.rev() });
  const before = structuredClone(t.s),
    a = t.authorize();
  expect(a).toMatchObject({
    accepted: true,
    authorization: {
      principal: { kind: 'public', id: 'town' },
      actorId: 'c',
      request,
      source: { kind: 'public', proposalId: 'p', procedureRevision: 1 },
    },
  });
  expect(t.s).toEqual(before);
  expect(t.s.proposals.p!.status).toBe('approved');
  expect(t.authorize({ ...request, resourceId: 'other' })).toMatchObject({
    accepted: false,
    reason: 'public-resource-operation-mismatch',
  });
  expect(
    t.authorize({
      ...request,
      command: {
        type: 'offer',
        target: { kind: 'resident', id: 'c' },
        terms: 'Substituted beneficiary',
        expiresAt: 500,
      },
    }).accepted,
  ).toBe(false);
  expect(t.authorize(request, 'outsider').accepted).toBe(false);
  t.consume();
  expect(t.authorize().accepted).toBe(false);
  expect(t.events.reduce(applyPublicGovernanceEvent, t.initial)).toEqual(t.s);
});
test('legacy scope, unregistered resource kinds, altered revision and expired public decisions refuse custody authority', () => {
  const t = fixture();
  expect(
    authorizePublicResourceControl({
      state: t.legacy,
      actorId: 'a',
      at: 0,
      proposalId: 'p',
      expectedProposalRevision: 1,
      request,
    }),
  ).toMatchObject({ accepted: false, reason: 'public-resource-custody-not-enabled' });
  for (const r of [
    { ...request, resourceKind: 'body' },
    { ...request, resourceRevision: 8 },
    { ...request, controlVersion: 0 },
  ]) {
    const d = decidePublicCommand(t.s, 'a', 0, {
      type: 'propose',
      id: 'bad',
      text: 'Invalid scope',
      action: { kind: 'control-resource', expectedRevision: 7, request: r },
      closesAt: 100,
      expectedProcedureRevision: 1,
    });
    expect(d.accepted).toBe(false);
  }
  t.propose();
  t.ok({ type: 'vote', id: 'p', expectedRevision: t.rev(), choice: 'yes' });
  t.ok({ type: 'vote', id: 'p', expectedRevision: t.rev(), choice: 'yes' }, 'b');
  t.at = 100;
  t.ok({ type: 'close', id: 'p', expectedRevision: t.rev() });
  t.at = 1100;
  expect(t.authorize().accepted).toBe(false);
});

test('construction scope is an explicit extension, preserves fiscal procedure, and cannot grant authority over bodies or unrelated resources', () => {
  const t = fixture();
  expect(() => enablePublicConstructionPrincipalsAuthority(t.legacy)).toThrow(
    'invalid-public-construction-activation',
  );
  const expanded = enablePublicConstructionPrincipalsAuthority(t.initial);
  expect(expanded.procedure).toEqual(t.initial.procedure);
  expect(expanded.proposals).toEqual(t.initial.proposals);
  expect(expanded.grant.construction).toMatchObject({
    source: 'explicit-scenario-extension',
    scope: 'exact-project-authority-not-personal-labor',
  });
  const command: PublicCommand = {
    type: 'propose',
    id: 'project',
    text: '精确项目',
    action: {
      kind: 'manage-resource',
      expectedRevision: 1,
      request: {
        resourceKind: 'construction-site',
        resourceId: 'site',
        resourceRevision: 1,
        controlVersion: 1,
        operation: {
          capability: 'premises.create-construction',
          arguments: { type: 'create-construction', construction: { id: 'p' } },
        },
      },
    },
    closesAt: 100,
    expectedProcedureRevision: 1,
  };
  expect(decidePublicCommand(t.initial, 'a', 0, command).accepted).toBe(false);
  expect(decidePublicCommand(expanded, 'a', 0, command).accepted).toBe(true);
  if (command.action.kind !== 'manage-resource') throw Error('fixture');
  expect(
    decidePublicCommand(expanded, 'a', 0, {
      ...command,
      action: { ...command.action, request: { ...command.action.request, resourceKind: 'body' } },
    }).accepted,
  ).toBe(false);
  expect(() => enablePublicConstructionPrincipalsAuthority(expanded)).toThrow();
});
