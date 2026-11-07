import { expect, test } from 'vitest';
import { asAgentId } from '@aivilization/sim-core';
import { normalizeEnterpriseState } from './model';
import {
  authorizeEnterpriseResourceControl,
  assertEnterpriseResourceControlSource,
} from './resourcePrincipal';
import { applyEnterpriseDomainEvent } from './aggregate';
import { decideEnterpriseControl } from './control';
import type { PrincipalControlRequest } from '@aivilization/authority';
const request: PrincipalControlRequest = {
  resourceKind: 'premises',
  resourceId: 'home',
  resourceRevision: 3,
  controlVersion: 2,
  command: { type: 'accept' },
};
function fixture() {
  return normalizeEnterpriseState({
    enterpriseId: 'firm',
    name: 'Owner, manager and workers differ',
    ownerAgentId: asAgentId('founder'),
    occupationName: 'Building',
    balance: 100,
    inventory: { Wood: 2 },
    maxEmployees: 3,
    employeeAgentIds: [asAgentId('worker')],
    ownershipShares: { founder: 0.5, worker: 0.5 },
    status: 'active',
    foundedAt: 0,
    cumulativeSales: 0,
    cumulativePurchases: 0,
    cumulativeWages: 0,
  });
}
test('a worker or shareholder cannot accept assets as the company; actual management changes invalidate old authority without reallocating capital', () => {
  const initial = fixture(),
    proof = authorizeEnterpriseResourceControl({
      enterprise: initial,
      actorId: 'founder',
      request,
    })!;
  expect(proof).toMatchObject({
    principal: { kind: 'enterprise', id: 'firm' },
    actorId: 'founder',
    source: { kind: 'enterprise', managementVersion: 1 },
  });
  expect(
    authorizeEnterpriseResourceControl({ enterprise: initial, actorId: 'worker', request }),
  ).toBeUndefined();
  const offer = decideEnterpriseControl({
    enterprise: initial,
    actorId: 'founder',
    at: 1,
    command: {
      type: 'offer',
      expectedVersion: 1,
      target: { kind: 'resident', id: 'manager' },
      terms: 'Management only',
      expiresAt: 100,
    },
    available: () => true,
    authorize: () => undefined,
  });
  if (!offer.accepted) throw Error(offer.reason);
  const pending = applyEnterpriseDomainEvent(initial, offer.event),
    accept = decideEnterpriseControl({
      enterprise: pending,
      actorId: 'manager',
      at: 2,
      command: { type: 'accept', expectedVersion: 2 },
      available: () => true,
      authorize: () => undefined,
    });
  if (!accept.accepted) throw Error(accept.reason);
  const managed = applyEnterpriseDomainEvent(pending, accept.event);
  expect(managed.ownershipShares).toEqual(initial.ownershipShares);
  expect(managed.balance).toBe(initial.balance);
  expect(
    authorizeEnterpriseResourceControl({ enterprise: managed, actorId: 'founder', request }),
  ).toBeUndefined();
  expect(
    authorizeEnterpriseResourceControl({ enterprise: managed, actorId: 'manager', request }),
  ).toMatchObject({
    principal: { kind: 'enterprise', id: 'firm' },
    actorId: 'manager',
    source: { managementVersion: 3 },
  });
  expect(() => assertEnterpriseResourceControlSource(managed, proof, request, 'founder')).toThrow(
    'enterprise-resource-control-source-mismatch',
  );
  expect(() =>
    assertEnterpriseResourceControlSource(
      initial,
      proof,
      { ...request, resourceRevision: 4 },
      'founder',
    ),
  ).toThrow('principal-authority-scope-mismatch');
  for (const status of ['insolvent', 'bankrupt', 'closed'] as const)
    expect(
      authorizeEnterpriseResourceControl({
        enterprise: { ...initial, status },
        actorId: 'founder',
        request,
      }),
    ).toBeUndefined();
});
test('collective company management requires its independent scoped decision; the executor is not the company or its capital holder', () => {
  const e = {
    ...fixture(),
    control: {
      policyVersion: 'resource-control-v1' as const,
      controller: { kind: 'collective' as const, id: 'board' },
      version: 4,
      at: 0,
      changedBy: 'founder',
      decisionId: 'handover',
    },
  };
  expect(
    authorizeEnterpriseResourceControl({ enterprise: e, actorId: 'member', request }),
  ).toBeUndefined();
  const a = authorizeEnterpriseResourceControl({
    enterprise: e,
    actorId: 'member',
    request,
    authorize: (c) =>
      c.kind === 'collective' && c.id === 'board'
        ? { actorId: 'member', decisionId: 'approved-specific-home' }
        : undefined,
  });
  expect(a).toMatchObject({
    principal: { kind: 'enterprise', id: 'firm' },
    source: {
      kind: 'enterprise',
      managementVersion: 4,
      managementDecisionId: 'approved-specific-home',
    },
  });
  expect(() =>
    assertEnterpriseResourceControlSource(
      e,
      { ...a!, source: { kind: 'enterprise', managementVersion: 4, managementDecisionId: null } },
      request,
      'member',
    ),
  ).toThrow('enterprise-resource-control-source-mismatch');
});
