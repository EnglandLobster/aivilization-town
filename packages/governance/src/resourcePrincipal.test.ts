import {
  enablePublicResourceSalesAuthority,
  extendPublicResourceSalesAuthority,
  authorizePublicResourceOperation,
} from './resourcePrincipal';
import { enablePublicVehiclePrincipalsAuthority } from './resourcePrincipal';
import { expect, test } from 'vitest';
import type { PrincipalControlRequest, PrincipalOperationRequest } from '@aivilization/authority';
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
test('extending fiscal asset scope preserves old ballots without making unsupported old approvals executable; fresh exact ballots capture v2', () => {
  const t = fixture();
  let s = enablePublicResourceSalesAuthority(
    enablePublicVehiclePrincipalsAuthority(enablePublicConstructionPrincipalsAuthority(t.initial)),
  );
  const request: PrincipalOperationRequest = {
    resourceKind: 'resource-sale',
    resourceId: 'stock-price',
    resourceRevision: 1,
    controlVersion: 2,
    operation: {
      capability: 'resource-sales.accept',
      arguments: {
        quotedSource: { kind: 'stock', id: 'stock' },
        command: { type: 'accept', id: 'stock-price', expectedRevision: 1 },
      },
    },
  };
  const approve = (id: string, at: number, legacy = false) => {
    const d = decidePublicCommand(s, 'a', at, {
      type: 'propose',
      id,
      text: 'Exact price',
      action: { kind: 'manage-resource', expectedRevision: 1, request },
      expectedProcedureRevision: 1,
      closesAt: at + 100,
    });
    if (!d.accepted) throw Error(d.reason);
    let events = d.events;
    if (legacy)
      events = events.map((e) => {
        if (e.type !== 'PublicProposalOpened') return e;
        const { resourceSalesScopeVersion: omitted, ...proposal } = e.proposal;
        expect(omitted).toBe('public-paid-resource-control-v1');
        return { ...e, proposal };
      });
    s = events.reduce(applyPublicGovernanceEvent, s);
    for (const actor of ['a', 'b']) {
      const v = decidePublicCommand(s, actor, at, {
        type: 'vote',
        id,
        expectedRevision: s.proposals[id]!.revision,
        choice: 'yes',
      });
      if (!v.accepted) throw Error(v.reason);
      s = v.events.reduce(applyPublicGovernanceEvent, s);
    }
    const close = decidePublicCommand(s, 'c', at + 100, {
      type: 'close',
      id,
      expectedRevision: s.proposals[id]!.revision,
    });
    if (!close.accepted) throw Error(close.reason);
    s = close.events.reduce(applyPublicGovernanceEvent, s);
  };
  approve('old', 0);
  approve('legacy', 0, true);
  const old = structuredClone(s.proposals);
  s = extendPublicResourceSalesAuthority(s);
  expect(s.proposals).toEqual(old);
  const authorize = (id: string, at: number) =>
    authorizePublicResourceOperation({
      state: s,
      actorId: 'c',
      at,
      proposalId: id,
      expectedProposalRevision: s.proposals[id]!.revision,
      request,
    });
  for (const id of ['old', 'legacy'])
    expect(authorize(id, 100)).toMatchObject({
      accepted: false,
      reason: 'public-resource-sales-current-scope-consent-required',
    });
  approve('fresh', 100);
  expect(s.proposals.fresh!.resourceSalesScopeVersion).toBe('public-paid-resource-control-v2');
  expect(authorize('fresh', 200).accepted).toBe(true);
  expect(() => extendPublicResourceSalesAuthority(s)).toThrow();
  const opened = decidePublicCommand(s, 'a', 200, {
    type: 'propose',
    id: 'forged',
    text: 'Exact',
    action: { kind: 'manage-resource', expectedRevision: 1, request },
    expectedProcedureRevision: 1,
    closesAt: 300,
  });
  if (!opened.accepted || opened.events[0]?.type !== 'PublicProposalOpened') throw Error('fixture');
  const event = opened.events[0];
  expect(() =>
    applyPublicGovernanceEvent(s, {
      ...event,
      proposal: {
        ...event.proposal,
        resourceSalesScopeVersion: 'public-paid-resource-control-v1',
      },
    }),
  ).toThrow();
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
test('vehicle grant activates independently, keeps exact scope, and composes with material migration in either order', () => {
  const t = fixture(),
    vehicleOnly = enablePublicVehiclePrincipalsAuthority(t.legacy);
  expect(vehicleOnly.grant.resourceCustody).toBeUndefined();
  expect(vehicleOnly.procedure).toEqual(t.legacy.procedure);
  const stockFirst = enablePublicVehiclePrincipalsAuthority(t.initial),
    vehicleFirst = enablePublicResourceCustodyAuthority(vehicleOnly);
  expect(vehicleFirst).toEqual(stockFirst);
  const propose = (resourceKind: string) =>
    decidePublicCommand(vehicleOnly, 'a', 0, {
      type: 'propose',
      id: 'vehicle',
      text: '精确接车',
      action: {
        kind: 'control-resource',
        expectedRevision: 7,
        request: { ...request, resourceKind },
      },
      closesAt: 100,
      expectedProcedureRevision: 1,
    });
  expect(propose('vehicle').accepted).toBe(true);
  expect(propose('stock').accepted).toBe(false);
  expect(propose('premises').accepted).toBe(false);
  expect(propose('body').accepted).toBe(false);
  expect(() => enablePublicVehiclePrincipalsAuthority(vehicleOnly)).toThrow(
    'public-vehicle-principals-already-enabled',
  );
});

test('public paid asset acquisition has its own explicit fiscal-control scope; old management and permit fee scope cannot approve it', () => {
  const t = fixture(),
    base = enablePublicConstructionPrincipalsAuthority(t.initial);
  const r: PrincipalOperationRequest = {
    resourceKind: 'resource-sale',
    resourceId: 'purchase',
    resourceRevision: 1,
    controlVersion: 2,
    operation: {
      capability: 'resource-sales.accept',
      arguments: {
        command: { type: 'accept', id: 'purchase', expectedRevision: 1 },
        amount: 25,
        payer: { sector: 'treasury', id: 'public-treasury' },
        revenue: { sector: 'agent', id: 'seller' },
        quotedSource: { kind: 'premises', id: 'home' },
        controlEffect: {
          resourceKind: 'premises',
          resourceId: 'home',
          resourceRevision: 7,
          controlVersion: 2,
          command: { type: 'accept' },
        },
      },
    },
  };
  const c: PublicCommand = {
    type: 'propose',
    id: 'purchase',
    text: '确切买到房屋，不是仅支出',
    expectedProcedureRevision: base.procedureRevision,
    closesAt: 100,
    action: { kind: 'manage-resource', expectedRevision: 1, request: r },
  };
  expect(decidePublicCommand(base, 'a', 0, c).accepted).toBe(false);
  const enabled = enablePublicResourceSalesAuthority(base);
  expect(decidePublicCommand(enabled, 'a', 0, c).accepted).toBe(true);
  expect(base.grant.resourceSales).toBeUndefined();
  expect(enabled.grant.resourceSales?.version).toBe('public-paid-resource-control-v1');
  expect(() => enablePublicResourceSalesAuthority(enabled)).toThrow(
    'invalid-public-resource-sales-activation',
  );
  expect(
    decidePublicCommand(enabled, 'a', 0, {
      ...c,
      action: {
        kind: 'manage-resource',
        expectedRevision: 1,
        request: {
          ...r,
          operation: { ...r.operation, capability: 'resource-sales.arbitrary-debit' },
        },
      },
    }).accepted,
  ).toBe(false);
});
