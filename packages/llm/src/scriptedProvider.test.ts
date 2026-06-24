import { describe, expect, test } from 'vitest';
import { createScriptedLlmProvider } from './scriptedProvider';
import type { LlmProviderCompletionRequest } from './structuredGateway';

describe('scripted LLM provider', () => {
  test('returns scripted responses in order and records immutable request snapshots', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-provider',
      responses: [
        {
          providerId: 'scripted-provider',
          model: 'model-a',
          content: '{"ok":true}',
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 2 },
        },
        (request: LlmProviderCompletionRequest) => ({
          providerId: 'scripted-provider',
          model: request.model,
          content: `{"requestId":"${request.requestId}"}`,
          finishReason: 'stop',
          usage: { inputTokens: 3, outputTokens: 4 },
        }),
      ],
    });
    const request = createRequest('request-1');

    await expect(scripted.provider.complete(request)).resolves.toMatchObject({
      content: '{"ok":true}',
      usage: { inputTokens: 1, outputTokens: 2 },
    });
    await expect(scripted.provider.complete(createRequest('request-2'))).resolves.toMatchObject({
      content: '{"requestId":"request-2"}',
      usage: { inputTokens: 3, outputTokens: 4 },
    });

    const mutatedRequest = {
      ...request,
      messages: [{ role: 'user' as const, content: 'mutated after call' }],
    };
    await expect(scripted.provider.complete(mutatedRequest)).rejects.toThrow(
      'scripted LLM provider scripted-provider has no remaining responses',
    );
    expect(scripted.getRequests()).toEqual([
      expect.objectContaining({
        requestId: 'request-1',
        messages: [{ role: 'user', content: 'Plan safely.' }],
      }),
      expect.objectContaining({
        requestId: 'request-2',
        messages: [{ role: 'user', content: 'Plan safely.' }],
      }),
      expect.objectContaining({
        requestId: 'request-1',
        messages: [{ role: 'user', content: 'mutated after call' }],
      }),
    ]);
    expect(scripted.remainingResponseCount()).toBe(0);
  });

  test('throws scripted errors in order and then reports exhausted scripts clearly', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-provider',
      responses: [new Error('scripted provider failure')],
    });

    await expect(scripted.provider.complete(createRequest('request-1'))).rejects.toThrow(
      'scripted provider failure',
    );
    await expect(scripted.provider.complete(createRequest('request-2'))).rejects.toThrow(
      'scripted LLM provider scripted-provider has no remaining responses',
    );
    expect(scripted.getRequests().map((request) => request.requestId)).toEqual([
      'request-1',
      'request-2',
    ]);
  });
});

function createRequest(requestId: string): LlmProviderCompletionRequest {
  return {
    requestId,
    model: 'planning-model',
    schemaName: 'PlannerProposal',
    messages: [{ role: 'user', content: 'Plan safely.' }],
    tools: [
      {
        name: 'world_action_catalog',
        description: 'Available world actions.',
        inputSchema: { type: 'object' },
      },
    ],
    signal: new AbortController().signal,
  };
}
