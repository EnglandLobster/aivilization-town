import { expect, test } from 'vitest';
import {
  assertOpenAgentPolicy,
  DEFAULT_OPEN_AGENT_POLICY,
  validateOpenToolArguments,
  type OpenToolDefinition,
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

test('array cardinality is enforced at the authority boundary without changing unconstrained empty lists', () => {
  const definition: OpenToolDefinition = {
    name: 'production.gather',
    category: 'production',
    description: '',
    mutates: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['workers', 'readers'],
      properties: {
        workers: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
        readers: { type: 'array', items: { type: 'string' } },
      },
    },
  };
  expect(validateOpenToolArguments(definition, { readers: [] })).toBe('missing-argument:workers');
  expect(validateOpenToolArguments(definition, { workers: [], readers: [] })).toBe(
    'array-too-short:workers',
  );
  expect(validateOpenToolArguments(definition, { workers: ['a'], readers: [] })).toBeUndefined();
  expect(
    validateOpenToolArguments(definition, { workers: ['a', 'b'], readers: [] }),
  ).toBeUndefined();
  expect(validateOpenToolArguments(definition, { workers: ['a', 'b', 'c'], readers: [] })).toBe(
    'array-too-long:workers',
  );
  expect(validateOpenToolArguments(definition, { workers: [1], readers: [] })).toBe(
    'invalid-array:workers',
  );
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
