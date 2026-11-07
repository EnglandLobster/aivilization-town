import type { PrincipalOperationRequest } from '@aivilization/authority';
import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  applyEnterpriseDomainEvent,
  decideCloseEnterprise,
  normalizeEnterpriseState,
  type EnterpriseState,
} from './index';
import {
  decideRecordEnterpriseTradeAccounting,
  type EnterpriseTradePosition,
} from './tradeAccounting';
function initial(): EnterpriseState {
  return normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'real business',
    ownerAgentId: asAgentId('manager'),
    occupationName: 'arbitrary purpose',
    balance: 100,
    inventory: {},
    maxEmployees: 3,
    employeeAgentIds: [],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
}
function position(side: 'payer' | 'revenue'): EnterpriseTradePosition {
  const request: PrincipalOperationRequest =
    side === 'payer'
      ? {
          resourceKind: 'evidence-order',
          resourceId: 'order',
          resourceRevision: 1,
          controlVersion: 1,
          operation: {
            capability: 'trades.accept',
            arguments: { type: 'accept', id: 'order', expectedRevision: 1 },
          },
        }
      : {
          resourceKind: 'premises-permit',
          resourceId: 'permit',
          resourceRevision: 1,
          controlVersion: 1,
          operation: { capability: 'trades.offer', arguments: { type: 'offer', id: 'order' } },
        };
  return {
    orderId: 'order',
    sourceId: 'permit',
    side,
    authorization: {
      actorId: 'manager',
      principal: { kind: 'enterprise', id: 'firm' },
      request,
      source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
    },
    revision: 1,
    sourceRevision: 2,
    at: 1,
    phase: 'funded',
    fundedMicros: side === 'payer' ? 10000000 : 0,
    costMicros: 0,
    refundedMicros: 0,
    revenueMicros: 0,
  };
}
test('enterprise funding reserves real cash without recognizing future cost; objective consumed price is expense and unused funds return', () => {
  const before = initial(),
    p = position('payer'),
    events: Parameters<typeof applyEnterpriseDomainEvent>[1][] = [];
  let s = before;
  const apply = (t: EnterpriseTradePosition) => {
    const d = decideRecordEnterpriseTradeAccounting(s, t);
    if (!d.accepted) throw Error(d.reason);
    events.push(d.event);
    s = applyEnterpriseDomainEvent(s, d.event);
  };
  apply(p);
  expect(s.balance).toBe(90);
  expect(s.retainedEarnings).toBe(0);
  expect(s.cumulativePurchases).toBe(0);
  expect(
    decideCloseEnterprise({ enterprise: s, actorAgentId: asAgentId('manager'), closedAt: 2 })
      .status,
  ).toBe('rejected');
  apply({ ...p, revision: 2, sourceRevision: 3, at: 2, costMicros: 4000000 });
  expect(s.balance).toBe(90);
  expect(s.retainedEarnings).toBe(-4);
  expect(s.cumulativePurchases).toBe(4);
  apply({
    ...p,
    revision: 3,
    sourceRevision: 4,
    at: 3,
    phase: 'settled',
    costMicros: 4000000,
    refundedMicros: 6000000,
  });
  expect(s.balance).toBe(96);
  expect(s.retainedEarnings).toBe(-4);
  expect(
    decideCloseEnterprise({ enterprise: s, actorAgentId: asAgentId('manager'), closedAt: 4 })
      .status,
  ).toBe('accepted');
  const stored = JSON.parse(JSON.stringify(events)) as typeof events;
  expect(stored.reduce(applyEnterpriseDomainEvent, before)).toEqual(s);
});
test('seller income is the enterprise cash and realized earnings, not manager money; previous original authority survives management changes', () => {
  let s = initial();
  const p = position('revenue');
  const d = decideRecordEnterpriseTradeAccounting(s, p);
  if (!d.accepted) throw Error(d.reason);
  s = applyEnterpriseDomainEvent(s, d.event);
  expect(s.balance).toBe(100);
  expect(
    decideCloseEnterprise({ enterprise: s, actorAgentId: asAgentId('manager'), closedAt: 2 })
      .status,
  ).toBe('rejected');
  const earned = decideRecordEnterpriseTradeAccounting(s, {
    ...p,
    revision: 2,
    sourceRevision: 3,
    at: 2,
    phase: 'settled',
    revenueMicros: 4000000,
  });
  if (!earned.accepted) throw Error(earned.reason);
  s = applyEnterpriseDomainEvent(s, earned.event);
  expect(s.balance).toBe(104);
  expect(s.cumulativeSales).toBe(4);
  expect(s.retainedEarnings).toBe(4);
  expect(s.ownerAgentId).toBe(asAgentId('manager'));
});
test('revision, fixed funding, exact original order proof, conservation and insufficient cash reject without partial effects', () => {
  const original = initial(),
    p = position('payer');
  expect(decideRecordEnterpriseTradeAccounting({ ...original, balance: 1 }, p).accepted).toBe(
    false,
  );
  expect(
    decideRecordEnterpriseTradeAccounting(original, { ...p, phase: 'settled', refundedMicros: 1 })
      .accepted,
  ).toBe(false);
  expect(
    decideRecordEnterpriseTradeAccounting(original, { ...p, costMicros: Infinity }).accepted,
  ).toBe(false);
  const d = decideRecordEnterpriseTradeAccounting(original, p);
  if (!d.accepted) throw Error(d.reason);
  const s = applyEnterpriseDomainEvent(original, d.event);
  expect(() => applyEnterpriseDomainEvent(s, d.event)).toThrow(
    'enterprise-trade-revision-or-time-conflict',
  );
  expect(
    decideRecordEnterpriseTradeAccounting(s, {
      ...p,
      revision: 2,
      sourceRevision: 3,
      at: 2,
      fundedMicros: 11000000,
    }).accepted,
  ).toBe(false);
  expect(
    decideRecordEnterpriseTradeAccounting(s, {
      ...p,
      revision: 2,
      sourceRevision: 3,
      at: 2,
      costMicros: 6000000,
      refundedMicros: 6000000,
    }).accepted,
  ).toBe(false);
  const proof = {
    ...p.authorization,
    request: { ...p.authorization.request, resourceId: 'other-order' },
  };
  expect(
    decideRecordEnterpriseTradeAccounting(original, { ...p, authorization: proof }).accepted,
  ).toBe(false);
  expect(s.balance).toBe(90);
});

test('construction accounting records real original scope under v2 and cannot reinterpret v1 authority', () => {
  const e = initial(),
    base = position('payer');
  const construction: EnterpriseTradePosition = {
    ...base,
    sourceKind: 'construction',
    sourceId: 'project',
    authorization: {
      ...base.authorization,
      request: {
        ...base.authorization.request,
        resourceKind: 'construction-order',
        operation: {
          capability: 'construction-trades.accept',
          arguments: { type: 'accept', id: 'order', expectedRevision: 1, side: 'buyer' },
        },
      },
    },
  };
  const funded = decideRecordEnterpriseTradeAccounting(e, construction);
  expect(funded.accepted).toBe(true);
  if (!funded.accepted) throw Error(funded.reason);
  expect(funded.event.policyVersion).toBe('enterprise-principal-trade-accounting-v2');
  const after = applyEnterpriseDomainEvent(e, funded.event);
  expect(after.balance).toBe(90);
  expect(after.cumulativePurchases).toBe(0);
  const settled = decideRecordEnterpriseTradeAccounting(after, {
    ...construction,
    revision: 2,
    sourceRevision: 3,
    at: 2,
    phase: 'settled',
    costMicros: 7000000,
    refundedMicros: 3000000,
  });
  if (!settled.accepted) throw Error(settled.reason);
  const result = applyEnterpriseDomainEvent(after, settled.event);
  expect(result.balance).toBe(93);
  expect(result.cumulativePurchases).toBe(7);
  expect(result.retainedEarnings).toBe(-7);
  expect(() =>
    applyEnterpriseDomainEvent(e, {
      ...funded.event,
      policyVersion: 'enterprise-principal-trade-accounting-v1',
    }),
  ).toThrow('construction-original-authority');
  expect(normalizeEnterpriseState(result)).toEqual(result);
});

test('construction revenue needs its exact offering authority; old permit accounting retains v1 semantics', () => {
  const e = initial(),
    base = position('revenue');
  expect(
    decideRecordEnterpriseTradeAccounting(e, { ...base, sourceKind: 'construction' }).accepted,
  ).toBe(false);
  const construction: EnterpriseTradePosition = {
    ...base,
    sourceKind: 'construction',
    sourceId: 'project',
    authorization: {
      ...base.authorization,
      request: {
        ...base.authorization.request,
        resourceKind: 'construction-project',
        resourceId: 'project',
        operation: {
          capability: 'construction-trades.offer',
          arguments: { type: 'offer', terms: { id: 'order' } },
        },
      },
    },
  };
  const decision = decideRecordEnterpriseTradeAccounting(e, construction);
  if (!decision.accepted) throw Error(decision.reason);
  const after = applyEnterpriseDomainEvent(e, decision.event);
  const legacy = position('payer');
  const other = {
    ...legacy,
    orderId: 'legacy',
    authorization: {
      ...legacy.authorization,
      request: {
        ...legacy.authorization.request,
        resourceId: 'legacy',
        operation: {
          ...legacy.authorization.request.operation,
          arguments: { type: 'accept', id: 'legacy', expectedRevision: 1 },
        },
      },
    },
  };
  const old = decideRecordEnterpriseTradeAccounting(after, other);
  if (!old.accepted) throw Error(old.reason);
  expect(old.event.policyVersion).toBe('enterprise-principal-trade-accounting-v1');
  expect(applyEnterpriseDomainEvent(after, old.event).tradeAccounting!.policyVersion).toBe(
    'enterprise-principal-trade-accounting-v2',
  );
});
