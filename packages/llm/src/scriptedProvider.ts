import type {
  LlmProviderCompletionRequest,
  LlmProviderCompletionResponse,
  LlmStructuredProvider,
} from './structuredGateway';

export type ScriptedLlmProviderResponse =
  | LlmProviderCompletionResponse
  | Error
  | ((
      request: LlmProviderCompletionRequest,
    ) => LlmProviderCompletionResponse | Promise<LlmProviderCompletionResponse>);

export type ScriptedLlmProvider = {
  readonly provider: LlmStructuredProvider;
  readonly getRequests: () => readonly LlmProviderCompletionRequest[];
  readonly remainingResponseCount: () => number;
};

export function createScriptedLlmProvider(input: {
  readonly providerId: string;
  readonly responses: readonly ScriptedLlmProviderResponse[];
}): ScriptedLlmProvider {
  assertNonEmpty(input.providerId, 'providerId');
  const responses = [...input.responses];
  const requests: LlmProviderCompletionRequest[] = [];

  return {
    provider: {
      providerId: input.providerId,
      complete: async (request) => {
        requests.push(cloneRequest(request));
        const response = responses.shift();
        if (response === undefined) {
          throw new Error(`scripted LLM provider ${input.providerId} has no remaining responses`);
        }
        if (response instanceof Error) {
          throw response;
        }
        return typeof response === 'function' ? response(request) : cloneResponse(response);
      },
    },
    getRequests: () => requests.map(cloneRequest),
    remainingResponseCount: () => responses.length,
  };
}

function cloneRequest(request: LlmProviderCompletionRequest): LlmProviderCompletionRequest {
  return {
    requestId: request.requestId,
    model: request.model,
    schemaName: request.schemaName,
    messages: request.messages.map((message) => ({ ...message })),
    tools: request.tools.map((tool) => ({
      ...tool,
      inputSchema: cloneJsonLike(tool.inputSchema),
    })),
    signal: request.signal,
  };
}

function cloneResponse(response: LlmProviderCompletionResponse): LlmProviderCompletionResponse {
  return {
    providerId: response.providerId,
    model: response.model,
    content: response.content,
    finishReason: response.finishReason,
    ...(response.usage === undefined ? {} : { usage: { ...response.usage } }),
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function cloneJsonLike(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}
