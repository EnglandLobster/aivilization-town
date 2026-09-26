import { expect, test } from 'vitest';
import {
  assertOpenAgentPolicy,
  DEFAULT_OPEN_AGENT_POLICY,
  validateOpenToolArguments,
} from './openAgent';
test('policy rejects missing or invalid budgets and accepts legacy cadence defaults', () => {
  const { opportunityCadenceMs: _cadence, ...legacy } = DEFAULT_OPEN_AGENT_POLICY;
  expect(_cadence).toBe(1000);
  expect(() => assertOpenAgentPolicy(legacy)).not.toThrow();
  expect(() => assertOpenAgentPolicy({ ...legacy, maxCallsPerTurn: 0 })).toThrow(
    'invalid-open-agent-policy',
  );
  const corrupted = { ...legacy };
  Reflect.deleteProperty(corrupted, 'maxCallsPerTurn');
  expect(() => assertOpenAgentPolicy(corrupted)).toThrow('invalid-open-agent-policy');
});
test('the capability boundary rejects identity injection, nonfinite values, and extra fields', () => {
  const tool = {
    name: 'transfer',
    category: 'world',
    description: '',
    mutates: true,
    inputSchema: {
      type: 'object' as const,
      properties: { amount: { type: 'number' as const, minimum: 1 } },
      required: ['amount'],
      additionalProperties: false as const,
    },
  };
  expect(validateOpenToolArguments(tool, { amount: 10 })).toBeUndefined();
  expect(validateOpenToolArguments(tool, { amount: Infinity })).toBe('invalid-number:amount');
  expect(validateOpenToolArguments(tool, { amount: 10, actorId: 'other' })).toBe(
    'unknown-argument:actorId',
  );
});
