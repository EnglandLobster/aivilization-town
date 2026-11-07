import { asAgentId } from '@aivilization/sim-core';
import { expect, test } from 'vitest';
import {
  applyEnterpriseDomainEvent,
  decideAssignProductionEmployment,
  decideEnableEarnedPayroll,
  normalizeEnterpriseState,
  productionEmploymentWage,
  type EnterpriseState,
} from './index';
const owner = asAgentId('owner'),
  worker = asAgentId('worker');
function fixture(): EnterpriseState {
  const e = normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Resident business',
    ownerAgentId: owner,
    occupationName: 'Resident invented job',
    balance: 100,
    inventory: {},
    maxEmployees: 3,
    employeeAgentIds: [worker],
    employeeWageOffers: { [worker]: 123 },
    status: 'active',
    foundedAt: 10,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
  const d = decideEnableEarnedPayroll(e);
  if (!d.accepted) throw Error(d.reason);
  return applyEnterpriseDomainEvent(e, d.event);
}
function assign(e = fixture(), actorId = owner, productionId = 'job', authorizedWorkMs = 60000) {
  return decideAssignProductionEmployment({
    enterprise: e,
    actorId,
    productionId,
    at: 10,
    authorizedWorkMs,
    workers: [worker],
  });
}
test('employer authorizes a real task and wages without spending, reserving a body or inventing output', () => {
  const e = fixture(),
    d = assign(e);
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  const next = applyEnterpriseDomainEvent(e, d.event);
  expect(next.balance).toBe(100);
  expect(next.inventory).toEqual({});
  expect(next.earnedPayroll?.claims).toEqual({});
  expect(productionEmploymentWage(next, 'job', worker)).toBe(123);
  expect(applyEnterpriseDomainEvent(e, structuredClone(d.event))).toEqual(next);
  expect(assign(next).accepted).toBe(false);
  expect(() => applyEnterpriseDomainEvent(next, d.event)).toThrow(
    'production-employment-authorization-mismatch',
  );
  expect(e.productionEmployment).toBeUndefined();
});
test('authority, membership, limits, forged source wages and old tasks after a changed bargain are rejected', () => {
  const e = fixture();
  expect(assign(e, worker)).toMatchObject({
    accepted: false,
    reason: 'production-employer-authority-required',
  });
  for (const value of [0, -1, NaN, Infinity, 1.5, 1_000_000_001])
    expect(assign(e, owner, 'job', value).accepted).toBe(false);
  for (const id of ['__proto__', 'constructor', '', 'a'.repeat(201)])
    expect(assign(e, owner, id).accepted).toBe(false);
  expect(assign({ ...e, employeeWageOffers: {} }).accepted).toBe(false);
  const d = assign(e);
  if (!d.accepted) throw Error(d.reason);
  expect(() =>
    applyEnterpriseDomainEvent(e, {
      ...d.event,
      assignment: { ...d.event.assignment, wageOffers: { [worker]: 999 } },
    }),
  ).toThrow('production-employment-authorization-mismatch');
  const next = applyEnterpriseDomainEvent(e, d.event);
  const left = applyEnterpriseDomainEvent(next, {
    type: 'EnterpriseEmployeeLeft',
    agentId: worker,
  });
  expect(productionEmploymentWage(left, 'job', worker)).toBeUndefined();
  expect(left.productionEmployment).toEqual(next.productionEmployment);
  expect(
    productionEmploymentWage({ ...next, employeeWageOffers: { [worker]: 124 } }, 'job', worker),
  ).toBeUndefined();
  expect(productionEmploymentWage({ ...next, status: 'bankrupt' }, 'job', worker)).toBeUndefined();
});
