import { expect, test } from 'vitest';
import { boundPrincipalControlEffect } from './boundControl';
import {
  assertPrincipalAuthorization,
  type PrincipalAuthorization,
  type PrincipalControlRequest,
} from './principal';
import type { PrincipalOperationRequest } from './principalOperation';
const child: PrincipalControlRequest = {
  resourceKind: 'premises',
  resourceId: 'home',
  resourceRevision: 3,
  controlVersion: 2,
  command: { type: 'accept' },
};
const parent: PrincipalAuthorization<PrincipalOperationRequest> = {
  actorId: 'executor',
  principal: { kind: 'public', id: 'town' },
  request: {
    resourceKind: 'resource-sale',
    resourceId: 'sale',
    resourceRevision: 1,
    controlVersion: 1,
    operation: {
      capability: 'resource-sales.accept',
      arguments: {
        controlEffect: child,
        amount: 20,
        payer: { sector: 'treasury', id: 'public-treasury' },
      },
    },
  },
  source: { kind: 'public', proposalId: 'purchase', procedureRevision: 3 },
};
test('exact parent-approved control effect keeps actual actor, principal and source; it is independent from money and body decisions', () => {
  const proof = boundPrincipalControlEffect(parent, child);
  expect(proof).toEqual({ ...parent, request: child });
  expect(proof.request).not.toBe(child);
  expect(() =>
    assertPrincipalAuthorization(proof, parent.principal, child, 'executor'),
  ).not.toThrow();
  expect(parent.request.operation.arguments.amount).toBe(20);
});
test('undeclared, changed, new-offer or malformed control effects cannot be derived', () => {
  for (const changed of [
    { ...child, resourceId: 'other' },
    { ...child, resourceRevision: 4 },
    { ...child, controlVersion: 3 },
    {
      ...child,
      command: {
        type: 'offer' as const,
        target: { kind: 'resident' as const, id: 'other' },
        expiresAt: 100,
        terms: 'New scope',
      },
    },
  ])
    expect(() => boundPrincipalControlEffect(parent, changed)).toThrow(
      'principal-control-not-bound-to-parent-operation',
    );
  expect(() =>
    boundPrincipalControlEffect(
      {
        ...parent,
        request: {
          ...parent.request,
          operation: { ...parent.request.operation, arguments: { amount: 20 } },
        },
      },
      child,
    ),
  ).toThrow();
  expect(() =>
    boundPrincipalControlEffect(
      {
        ...parent,
        actorId: 'imposter',
        principal: { kind: 'resident', id: 'buyer' },
        source: { kind: 'personal' },
      },
      child,
    ),
  ).toThrow('principal-personal-consent-required');
});
