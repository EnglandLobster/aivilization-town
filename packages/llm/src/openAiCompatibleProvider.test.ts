import { describe, expect, test } from 'vitest';
import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleFetch,
} from './openAiCompatibleProvider';
import type { LlmProviderCompletionRequest } from './structuredGateway';

describe('OpenAI-compatible LLM provider', () => {
  test('posts chat completion requests with json-schema response format and maps responses', async () => {
    const calls: FetchCall[] = [];
    const fetch: OpenAiCompatibleFetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        jsonResponse({
          model: 'planner-model-2026',
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"plan":"ok"}' },
            },
          ],
          usage: {
            prompt_tokens: 17,
            completion_tokens: 23,
            total_tokens: 40,
          },
        }),
      );
    };
    const controller = new AbortController();
    const provider = createOpenAiCompatibleProvider({
      providerId: 'openai-compatible-main',
      endpoint: 'https://llm.example.test/v1/chat/completions',
      apiKey: 'secret-key',
      defaultHeaders: {
        'X-Town-Trace': 'trace-1',
      },
      fetch,
    });

    await expect(provider.complete(createRequest(controller.signal))).resolves.toEqual({
      providerId: 'openai-compatible-main',
      model: 'planner-model-2026',
      content: '{"plan":"ok"}',
      finishReason: 'stop',
      usage: {
        inputTokens: 17,
        outputTokens: 23,
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://llm.example.test/v1/chat/completions');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.signal).toBe(controller.signal);
    expect(calls[0]?.init?.headers).toEqual({
      authorization: 'Bearer secret-key',
      'content-type': 'application/json',
      'x-town-trace': 'trace-1',
    });
    expect(parseJsonObject(readBody(calls[0]?.init?.body))).toEqual({
      model: 'planning-model',
      messages: [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Plan a study route.' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'aivilization_branch_plan',
          strict: true,
          schema: {
            type: 'object',
            required: ['objective'],
            properties: {
              objective: { type: 'string' },
            },
          },
        },
      },
    });
  });

  test('supports JSON mode and content-filter finish reasons', async () => {
    const calls: FetchCall[] = [];
    const provider = createOpenAiCompatibleProvider({
      providerId: 'local-openai-compatible',
      endpoint: 'http://localhost:11434/v1/chat/completions',
      responseFormat: 'json-object',
      fetch: (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(
          jsonResponse({
            model: 'local-planner',
            choices: [
              {
                finish_reason: 'content_filter',
                message: { content: '{"blocked":true}' },
              },
            ],
          }),
        );
      },
    });

    await expect(provider.complete(createRequest(new AbortController().signal))).resolves.toEqual({
      providerId: 'local-openai-compatible',
      model: 'local-planner',
      content: '{"blocked":true}',
      finishReason: 'content-filtered',
    });
    expect(parseJsonObject(readBody(calls[0]?.init?.body))).toMatchObject({
      response_format: { type: 'json_object' },
    });
  });

  test('throws clear errors for provider HTTP failures', async () => {
    const provider = createOpenAiCompatibleProvider({
      providerId: 'failing-provider',
      endpoint: 'https://llm.example.test/v1/chat/completions',
      fetch: () => Promise.resolve(new Response('upstream unavailable', { status: 503 })),
    });

    await expect(provider.complete(createRequest(new AbortController().signal))).rejects.toThrow(
      'OpenAI-compatible provider failing-provider failed with HTTP 503: upstream unavailable',
    );
  });
});

type FetchCall = {
  readonly url: RequestInfo | URL;
  readonly init: RequestInit | undefined;
};

function createRequest(signal: AbortSignal): LlmProviderCompletionRequest {
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
          required: ['objective'],
          properties: {
            objective: { type: 'string' },
          },
        },
      },
    ],
    signal,
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
