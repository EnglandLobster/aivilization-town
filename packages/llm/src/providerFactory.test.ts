import { describe, expect, test } from 'vitest';
import type { OpenAiCompatibleFetch } from './openAiCompatibleProvider';
import {
  createLlmStructuredProviderFromConfig,
  type LlmStructuredProviderConfig,
} from './providerFactory';
import type { LlmProviderCompletionRequest } from './structuredGateway';

describe('LLM structured provider factory', () => {
  test('creates OpenAI-compatible providers from config', async () => {
    const calls: FetchCall[] = [];
    const fetch: OpenAiCompatibleFetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        jsonResponse({
          model: 'planner-model',
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"route":"ok"}' },
            },
          ],
        }),
      );
    };

    const provider = createLlmStructuredProviderFromConfig({
      kind: 'openai-compatible',
      providerId: 'profile-openai',
      endpoint: 'https://llm.example.test/v1/chat/completions',
      fetch,
    });

    await expect(provider.complete(createRequest())).resolves.toEqual({
      providerId: 'profile-openai',
      model: 'planner-model',
      content: '{"route":"ok"}',
      finishReason: 'stop',
    });
    expect(calls[0]?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(parseJsonObject(readBody(calls[0]?.init?.body))).toMatchObject({
      model: 'planning-model',
      response_format: {
        type: 'json_schema',
      },
    });
  });

  test('creates scripted providers for deterministic profiles', async () => {
    const provider = createLlmStructuredProviderFromConfig({
      kind: 'scripted',
      providerId: 'scripted-planner',
      responses: [
        {
          providerId: 'scripted-planner',
          model: 'planning-model',
          content: '{"scripted":true}',
          finishReason: 'stop',
          usage: {
            inputTokens: 3,
            outputTokens: 5,
          },
        },
      ],
    });

    await expect(provider.complete(createRequest())).resolves.toEqual({
      providerId: 'scripted-planner',
      model: 'planning-model',
      content: '{"scripted":true}',
      finishReason: 'stop',
      usage: {
        inputTokens: 3,
        outputTokens: 5,
      },
    });
  });

  test('rejects unknown provider kinds and invalid provider ids before runtime use', () => {
    expect(() =>
      createLlmStructuredProviderFromConfig({
        kind: 'unknown',
      } as unknown as LlmStructuredProviderConfig),
    ).toThrow('unsupported LLM provider kind unknown');

    expect(() =>
      createLlmStructuredProviderFromConfig({
        kind: 'openai-compatible',
        providerId: ' ',
        endpoint: 'https://llm.example.test/v1/chat/completions',
      }),
    ).toThrow('providerId must not be empty');

    expect(() =>
      createLlmStructuredProviderFromConfig({
        kind: 'scripted',
        providerId: ' ',
        responses: [],
      }),
    ).toThrow('providerId must not be empty');
  });
});

type FetchCall = {
  readonly url: RequestInfo | URL;
  readonly init: RequestInit | undefined;
};

function createRequest(): LlmProviderCompletionRequest {
  return {
    requestId: 'request-1',
    model: 'planning-model',
    schemaName: 'aivilization_branch_plan',
    messages: [
      { role: 'system', content: 'Return JSON.' },
      { role: 'user', content: 'Plan a study route.' },
    ],
    tools: [
      {
        name: 'submit_branch_plan',
        description: 'Submit the branch plan.',
        inputSchema: {
          type: 'object',
          required: ['route'],
          properties: {
            route: { type: 'string' },
          },
        },
      },
    ],
    signal: new AbortController().signal,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function readBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') {
    throw new Error('expected fetch body to be a string');
  }
  return body;
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('expected JSON object');
  }
  return parsed as Readonly<Record<string, unknown>>;
}
