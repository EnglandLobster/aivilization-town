import { expect, test } from 'vitest';
import {
  assertPrincipalAuthorization,
  assertPrincipalOperationRequest,
  principalOperationKey,
  type PrincipalOperationRequest,
} from './index';
const request: PrincipalOperationRequest = {
  resourceKind: 'stock',
  resourceId: 's',
  resourceRevision: 2,
  controlVersion: 3,
  operation: {
    capability: 'materials.withdraw',
    arguments: { type: 'withdraw', items: { Wood: 1 }, recipientId: 'manager' },
  },
};
test('operation authority binds every domain input independently of JSON object key order', () => {
  const p = { kind: 'enterprise' as const, id: 'firm' },
    proof = {
      actorId: 'manager',
      principal: p,
      request,
      source: { kind: 'enterprise' as const, managementVersion: 4, managementDecisionId: null },
    };
  expect(() =>
    assertPrincipalAuthorization(
      proof,
      p,
      {
        ...request,
        operation: {
          capability: 'materials.withdraw',
          arguments: { recipientId: 'manager', items: { Wood: 1 }, type: 'withdraw' },
        },
      },
      'manager',
    ),
  ).not.toThrow();
  for (const changed of [
    { ...request, resourceRevision: 3 },
    { ...request, operation: { ...request.operation, capability: 'materials.configure-stock' } },
    {
      ...request,
      operation: {
        ...request.operation,
        arguments: { ...request.operation.arguments, items: { Wood: 2 } },
      },
    },
    {
      ...request,
      operation: {
        ...request.operation,
        arguments: { ...request.operation.arguments, recipientId: 'someone' },
      },
    },
  ])
    expect(() => assertPrincipalAuthorization(proof, p, changed, 'manager')).toThrow(
      'principal-authority-scope-mismatch',
    );
});
test('operation envelopes reject non-data values, oversized structures and ambiguous extra fields', () => {
  expect(() =>
    assertPrincipalOperationRequest({
      ...request,
      operation: { ...request.operation, arguments: { amount: Infinity } },
    }),
  ).toThrow('invalid-principal-operation-value');
  expect(() => principalOperationKey({ text: 'x'.repeat(33000) })).toThrow(
    'principal-operation-size-limit',
  );
  expect(() => principalOperationKey(Array.from({ length: 257 }, () => 1))).toThrow(
    'principal-operation-array-limit',
  );
  expect(() => assertPrincipalOperationRequest({ ...request, resourceRevision: 0 })).toThrow(
    'invalid-principal-operation-request',
  );
  const extra = { ...request, unexpected: true };
  expect(() => assertPrincipalOperationRequest(extra)).toThrow(
    'invalid-principal-operation-request',
  );
});
