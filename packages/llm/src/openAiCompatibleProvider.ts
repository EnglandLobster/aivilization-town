import type {
  LlmProviderCompletionRequest,
  LlmProviderCompletionResponse,
  LlmProviderFinishReason,
  LlmStructuredProvider,
} from './structuredGateway';

export type OpenAiCompatibleFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OpenAiCompatibleResponseFormatMode = 'json-schema' | 'json-object' | 'none';

export type OpenAiCompatibleProviderConfig = {
  readonly providerId: string;
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly responseFormat?: OpenAiCompatibleResponseFormatMode;
  readonly fetch?: OpenAiCompatibleFetch;
};

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleProviderConfig,
): LlmStructuredProvider {
  assertNonEmpty(config.providerId, 'providerId');
  assertNonEmpty(config.endpoint, 'endpoint');
  if (config.apiKey !== undefined) {
    assertNonEmpty(config.apiKey, 'apiKey');
  }

  const responseFormat = config.responseFormat ?? 'json-schema';
  const fetchImplementation = config.fetch ?? fetch;

  return {
    providerId: config.providerId,
    complete: async (request) => {
      const httpResponse = await fetchImplementation(config.endpoint, {
        method: 'POST',
        headers: createHeaders(config),
        body: JSON.stringify(createChatCompletionBody(request, responseFormat)),
        signal: request.signal,
      });

      if (!httpResponse.ok) {
        const body = await httpResponse.text();
        throw new Error(
          `OpenAI-compatible provider ${config.providerId} failed with HTTP ${httpResponse.status}: ${body}`,
        );
      }

      return parseCompletionResponse({
        providerId: config.providerId,
        fallbackModel: request.model,
        rawResponse: await parseJsonResponse(config.providerId, httpResponse),
      });
    },
  };
}

function createHeaders(
  config: Pick<OpenAiCompatibleProviderConfig, 'apiKey' | 'defaultHeaders'>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  if (config.apiKey !== undefined) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }
  headers['content-type'] = 'application/json';

  for (const [name, value] of Object.entries(config.defaultHeaders ?? {})) {
    headers[name.toLowerCase()] = value;
  }

  return headers;
}

function createChatCompletionBody(
  request: LlmProviderCompletionRequest,
  responseFormat: OpenAiCompatibleResponseFormatMode,
): Readonly<Record<string, unknown>> {
  return {
    model: request.model,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...createResponseFormatBody(request, responseFormat),
  };
}

function createResponseFormatBody(
  request: LlmProviderCompletionRequest,
  responseFormat: OpenAiCompatibleResponseFormatMode,
): Readonly<Record<string, unknown>> {
  if (responseFormat === 'none') {
    return {};
  }
  if (responseFormat === 'json-object') {
    return {
      response_format: {
        type: 'json_object',
      },
    };
  }

  const tool = request.tools[0];
  if (tool === undefined) {
    throw new Error(
      `OpenAI-compatible provider requires at least one tool contract for json-schema response format`,
    );
  }

  return {
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: request.schemaName,
        strict: true,
        schema: cloneJsonLike(tool.inputSchema),
      },
    },
  };
}

async function parseJsonResponse(providerId: string, response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new Error(
      `OpenAI-compatible provider ${providerId} returned invalid JSON: ${describeError(error)}`,
    );
  }
}

function parseCompletionResponse(input: {
  readonly providerId: string;
  readonly fallbackModel: string;
  readonly rawResponse: unknown;
}): LlmProviderCompletionResponse {
  const response = requireObject(input.rawResponse, 'chat completion response');
  const choice = readFirstChoice(response, input.providerId);
  const message = requireObject(choice.message, 'chat completion choice message');
  const content = requireString(message.content, 'chat completion message content');
  const finishReason = parseFinishReason(choice.finish_reason, input.providerId);
  const model = readOptionalString(response.model) ?? input.fallbackModel;
  const usage = parseUsage(response.usage);

  return {
    providerId: input.providerId,
    model,
    content,
    finishReason,
    ...(usage === undefined ? {} : { usage }),
  };
}

function readFirstChoice(
  response: Readonly<Record<string, unknown>>,
  providerId: string,
): Readonly<Record<string, unknown>> {
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error(`OpenAI-compatible provider ${providerId} returned no choices`);
  }
  return requireObject(choices[0], 'chat completion choice');
}

function parseFinishReason(value: unknown, providerId: string): LlmProviderFinishReason {
  if (value === 'stop' || value === 'length') {
    return value;
  }
  if (value === 'content_filter' || value === 'content-filtered') {
    return 'content-filtered';
  }
  throw new Error(
    `OpenAI-compatible provider ${providerId} returned unsupported finish_reason ${JSON.stringify(value)}`,
  );
}

function parseUsage(value: unknown): LlmProviderCompletionResponse['usage'] {
  if (value === undefined) {
    return undefined;
  }

  const usage = requireObject(value, 'chat completion usage');
  const inputTokens = readFiniteNumber(usage.prompt_tokens);
  const outputTokens = readFiniteNumber(usage.completion_tokens);
  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
  };
}

function requireObject(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
