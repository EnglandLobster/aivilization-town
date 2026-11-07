import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import {
  applyEnterpriseDomainEvent,
  normalizeEnterpriseState,
  type EnterpriseState,
} from './index';
import {
  decideRecordEnterpriseResourceSaleAccounting,
  type EnterpriseResourceSaleReceipt,
  ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2,
} from './resourceSalesAccounting';
function initial(): EnterpriseState {
  return normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'real firm',
    ownerAgentId: asAgentId('manager'),
    occupationName: 'builder',
    balance: 100,
    inventory: {},
    maxEmployees: 2,
    employeeAgentIds: [],
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
}
function receipt(side: 'payer' | 'revenue'): EnterpriseResourceSaleReceipt {
  const command = {
    type: side === 'payer' ? 'accept' : 'offer',
    id: 'sale',
    amount: 25,
    payer: {
      sector: side === 'payer' ? 'enterprise' : 'agent',
      id: side === 'payer' ? 'firm' : 'buyer',
    },
    revenue: {
      sector: side === 'revenue' ? 'enterprise' : 'agent',
      id: side === 'revenue' ? 'firm' : 'seller',
    },
  };
  const source = {
    id: 'building',
    kind: 'premises',
    seller: {
      kind: side === 'revenue' ? 'enterprise' : 'resident',
      id: side === 'revenue' ? 'firm' : 'seller',
    },
    offer: {
      target: {
        kind: side === 'payer' ? 'enterprise' : 'resident',
        id: side === 'payer' ? 'firm' : 'buyer',
      },
    },
  };
  return {
    saleId: 'sale',
    resourceId: 'building',
    side,
    at: 1,
    amountMicros: 25000000,
    authorization: {
      actorId: 'manager',
      principal: { kind: 'enterprise', id: 'firm' },
      source: { kind: 'enterprise', managementVersion: 1, managementDecisionId: null },
      request: {
        resourceKind: 'resource-sale',
        resourceId: 'sale',
        resourceRevision: 1,
        controlVersion: 2,
        operation: {
          capability: side === 'payer' ? 'resource-sales.accept' : 'resource-sales.offer',
          arguments:
            side === 'payer'
              ? {
                  command,
                  quotedSource: source,
                  payer: command.payer,
                  revenue: command.revenue,
                  amount: 25,
                }
              : { command, source },
        },
      },
    },
  };
}
test('actual enterprise asset payment/receipt uses owning cash accounting and original exact scope; old snapshots gain no invented receipts', () => {
  const before = initial();
  expect(before.resourceSalesAccounting).toBeUndefined();
  for (const side of ['payer', 'revenue'] as const) {
    const r = receipt(side),
      d = decideRecordEnterpriseResourceSaleAccounting(before, r);
    if (!d.accepted) throw Error(d.reason);
    const after = applyEnterpriseDomainEvent(before, d.event);
    expect(after.balance).toBe(side === 'payer' ? 75 : 125);
    expect(after.retainedEarnings).toBe(side === 'payer' ? -25 : 25);
    expect(after.cumulativePurchases).toBe(side === 'payer' ? 25 : 0);
    expect(after.cumulativeSales).toBe(side === 'revenue' ? 25 : 0);
    expect(after.inventory).toEqual(before.inventory);
    expect(after.ownerAgentId).toBe(before.ownerAgentId);
    expect(decideRecordEnterpriseResourceSaleAccounting(after, r)).toMatchObject({
      accepted: false,
      reason: 'enterprise-resource-sale-already-recorded',
    });
    expect(
      applyEnterpriseDomainEvent(before, JSON.parse(JSON.stringify(d.event)) as typeof d.event),
    ).toEqual(after);
    // Historical receipt scope does not retroactively become the current manager's approval.
    expect(
      normalizeEnterpriseState({ ...after, ownerAgentId: asAgentId('new-manager') }),
    ).toMatchObject({ resourceSalesAccounting: after.resourceSalesAccounting });
  }
});
test('v2 admits only the extended actual resource taxonomy, retains v1 receipts and forbids a later accounting downgrade', () => {
  const e = initial(),
    legacy = decideRecordEnterpriseResourceSaleAccounting(e, receipt('payer'));
  if (!legacy.accepted) throw Error(legacy.reason);
  let current = applyEnterpriseDomainEvent(e, legacy.event);
  for (const kind of ['stock', 'vehicle']) {
    const r = receipt('revenue'),
      q = r.authorization.request;
    const next: EnterpriseResourceSaleReceipt = {
      ...r,
      saleId: kind,
      resourceId: kind,
      authorization: {
        ...r.authorization,
        request: {
          ...q,
          resourceId: kind,
          operation: {
            ...q.operation,
            arguments: {
              ...q.operation.arguments,
              command: {
                type: 'offer',
                id: kind,
                amount: 25,
                revenue: { sector: 'enterprise', id: 'firm' },
              },
              source: { kind, id: kind, seller: { kind: 'enterprise', id: 'firm' } },
            },
          },
        },
      },
    };
    expect(decideRecordEnterpriseResourceSaleAccounting(e, next).accepted).toBe(false);
    const d = decideRecordEnterpriseResourceSaleAccounting(
      current,
      next,
      ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version,
    );
    if (!d.accepted) throw Error(d.reason);
    current = applyEnterpriseDomainEvent(current, d.event);
    expect(current.resourceSalesAccounting!.receipts.sale).toEqual(legacy.event.receipt);
    expect(current.inventory).toEqual(e.inventory);
    expect(() =>
      applyEnterpriseDomainEvent(current, {
        ...d.event,
        policyVersion: 'enterprise-resource-sales-cash-accounting-v1',
      }),
    ).toThrow('enterprise-resource-sales-unavailable');
  }
  expect(current.balance).toBe(125);
  expect(current.resourceSalesAccounting?.policyVersion).toBe(
    'enterprise-resource-sales-cash-accounting-v2',
  );
  expect(normalizeEnterpriseState(JSON.parse(JSON.stringify(current)) as EnterpriseState)).toEqual(
    current,
  );
});
test('cash, exact enterprise account, sale/source, price, time and live lifecycle bounds reject atomically', () => {
  const before = initial(),
    r = receipt('payer');
  for (const v of [
    { ...r, amountMicros: 0 },
    { ...r, amountMicros: 25000001 },
    { ...r, amountMicros: Infinity },
    { ...r, at: -1 },
    { ...r, saleId: 'other' },
    { ...r, resourceId: 'other' },
    {
      ...r,
      authorization: {
        ...r.authorization,
        principal: { kind: 'enterprise' as const, id: 'other' },
      },
    },
  ])
    expect(decideRecordEnterpriseResourceSaleAccounting(before, v).accepted).toBe(false);
  expect(decideRecordEnterpriseResourceSaleAccounting({ ...before, balance: 24 }, r)).toMatchObject(
    { accepted: false, reason: 'enterprise-resource-sale-insufficient-cash-or-range' },
  );
  for (const status of ['closed', 'bankrupt', 'insolvent'] as const)
    expect(decideRecordEnterpriseResourceSaleAccounting({ ...before, status }, r).accepted).toBe(
      false,
    );
  expect(before).toEqual(initial());
  const invalid = {
    ...r,
    authorization: {
      ...r.authorization,
      request: {
        ...r.authorization.request,
        operation: { ...r.authorization.request.operation, capability: 'trades.accept' },
      },
    },
  };
  expect(decideRecordEnterpriseResourceSaleAccounting(before, invalid).accepted).toBe(false);
});
