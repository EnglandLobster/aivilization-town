import { describe, expect, test } from 'vitest';
import {
  runStructuredLlmRequest,
  type LlmProviderCompletionRequest,
  type LlmStructuredOutputSchema,
  type LlmStructuredProvider,
} from './structuredGateway';

type PlannerProposal = {
  readonly branchId: string;
  readonly subtaskIds: readonly string[];
};

const plannerProposalSchema: LlmStructuredOutputSchema<PlannerProposal> = {
  name: 'PlannerProposal',
  parse: (value) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      'branchId' in value &&
      typeof value.branchId === 'string' &&
      'subtaskIds' in value &&
      Array.isArray(value.subtaskIds) &&
      value.subtaskIds.every((subtaskId) => typeof subtaskId === 'string')
    ) {
      return {
        status: 'valid',
        value: {
          branchId: value.branchId,
          subtaskIds: value.subtaskIds,
        },
      };
    }
    return { status: 'invalid', reason: 'proposal must include branchId and subtaskIds' };
  },
};

describe('structured LLM gateway', () => {
  test('parses schema-valid JSON, passes tool contracts to the provider, and accounts for usage cost', async () => {
    const providerRequests: LlmProviderCompletionRequest[] = [];
    const provider: LlmStructuredProvider = {
      providerId: 'scripted-openai-compatible',
      complete: (request) => {
        providerRequests.push(request);
        return Promise.resolve({
          providerId: 'scripted-openai-compatible',
          model: request.model,
          content: '{"branchId":"development","subtaskIds":["study","sleep"]}',
          finishReason: 'stop',
          usage: {
            inputTokens: 10,
            outputTokens: 5,
          },
        });
      },
    };

    const result = await runStructuredLlmRequest({
      provider,
      schema: plannerProposalSchema,
      request: {
        requestId: 'llm-plan-1',
        model: 'planning-model',
        messages: [{ role: 'user', content: 'Plan a balanced day.' }],
        tools: [
          {
            name: 'world_action_catalog',
            description: 'Available executable world actions.',
            inputSchema: {
              type: 'object',
              properties: { actionType: { type: 'string' } },
            },
          },
        ],
      },
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 6,
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      requestId: 'llm-plan-1',
      value: {
        branchId: 'development',
        subtaskIds: ['study', 'sleep'],
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        estimatedCostMicros: 50,
      },
    });
    expect(result.attempts).toEqual([
      expect.objectContaining({
        attemptIndex: 1,
        status: 'succeeded',
        providerId: 'scripted-openai-compatible',
        model: 'planning-model',
      }),
    ]);
    expect(providerRequests).toEqual([
      expect.objectContaining({
        requestId: 'llm-plan-1',
        model: 'planning-model',
        schemaName: 'PlannerProposal',
        messages: [{ role: 'user', content: 'Plan a balanced day.' }],
        tools: [
          {
            name: 'world_action_catalog',
            description: 'Available executable world actions.',
            inputSchema: {
              type: 'object',
              properties: { actionType: { type: 'string' } },
            },
          },
        ],
      }),
    ]);
  });

  test('retries invalid JSON and schema-invalid output before returning a validated value', async () => {
    let callCount = 0;
    const provider: LlmStructuredProvider = {
      providerId: 'retry-provider',
      complete: (request) => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            providerId: 'retry-provider',
            model: request.model,
            content: 'not-json',
            finishReason: 'stop',
            usage: { inputTokens: 1, outputTokens: 1 },
          });
        }
        if (callCount === 2) {
          return Promise.resolve({
            providerId: 'retry-provider',
            model: request.model,
            content: '{"branchId":"development","subtaskIds":[1]}',
            finishReason: 'stop',
            usage: { inputTokens: 2, outputTokens: 2 },
          });
        }
        return Promise.resolve({
          providerId: 'retry-provider',
          model: request.model,
          content: '{"branchId":"development","subtaskIds":["study"]}',
          finishReason: 'stop',
          usage: { inputTokens: 3, outputTokens: 4 },
        });
      },
    };

    const result = await runStructuredLlmRequest({
      provider,
      schema: plannerProposalSchema,
      request: {
        requestId: 'llm-plan-retry',
        model: 'planning-model',
        messages: [{ role: 'user', content: 'Plan.' }],
        maxAttempts: 3,
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      value: {
        branchId: 'development',
        subtaskIds: ['study'],
      },
      usage: {
        inputTokens: 6,
        outputTokens: 7,
        totalTokens: 13,
      },
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      'schema-invalid',
      'schema-invalid',
      'succeeded',
    ]);
  });

  test('returns a failed result when every attempt remains schema-invalid', async () => {
    const provider: LlmStructuredProvider = {
      providerId: 'invalid-provider',
      complete: (request) =>
        Promise.resolve({
          providerId: 'invalid-provider',
          model: request.model,
          content: '{"branchId":"development","subtaskIds":[1]}',
          finishReason: 'stop',
          usage: { inputTokens: 2, outputTokens: 2 },
        }),
    };

    const result = await runStructuredLlmRequest({
      provider,
      schema: plannerProposalSchema,
      request: {
        requestId: 'llm-plan-invalid',
        model: 'planning-model',
        messages: [{ role: 'user', content: 'Plan.' }],
        maxAttempts: 2,
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      requestId: 'llm-plan-invalid',
      reason: 'schema-invalid',
      message: 'proposal must include branchId and subtaskIds',
      usage: {
        inputTokens: 4,
        outputTokens: 4,
        totalTokens: 8,
      },
    });
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      'schema-invalid',
      'schema-invalid',
    ]);
  });

  test('returns a timeout failure and aborts the provider signal', async () => {
    let signalAborted = false;
    const provider: LlmStructuredProvider = {
      providerId: 'slow-provider',
      complete: (request) =>
        new Promise((resolve) => {
          request.signal.addEventListener('abort', () => {
            signalAborted = true;
            resolve({
              providerId: 'slow-provider',
              model: request.model,
              content: '{"branchId":"too-late","subtaskIds":["study"]}',
              finishReason: 'stop',
              usage: { inputTokens: 10, outputTokens: 10 },
            });
          });
        }),
    };

    const result = await runStructuredLlmRequest({
      provider,
      schema: plannerProposalSchema,
      request: {
        requestId: 'llm-timeout',
        model: 'planning-model',
        messages: [{ role: 'user', content: 'Plan.' }],
        timeoutMs: 1,
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      requestId: 'llm-timeout',
      reason: 'timeout',
      message: 'LLM provider timed out after 1ms',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });
    expect(signalAborted).toBe(true);
    expect(result.attempts).toEqual([
      expect.objectContaining({
        attemptIndex: 1,
        status: 'timeout',
      }),
    ]);
  });
});
