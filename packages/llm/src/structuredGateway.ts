export type LlmChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type LlmChatMessage = {
  readonly role: LlmChatRole;
  readonly content: string;
};

export type LlmToolContract = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
};

export type LlmProviderTokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
};

export type LlmGatewayUsage = LlmProviderTokenUsage & {
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type LlmProviderCompletionRequest = {
  readonly requestId: string;
  readonly model: string;
  readonly schemaName: string;
  readonly messages: readonly LlmChatMessage[];
  readonly tools: readonly LlmToolContract[];
  readonly signal: AbortSignal;
};

export type LlmProviderFinishReason = 'stop' | 'length' | 'content-filtered';

export type LlmProviderCompletionResponse = {
  readonly providerId: string;
  readonly model: string;
  readonly content: string;
  readonly finishReason: LlmProviderFinishReason;
  readonly usage?: LlmProviderTokenUsage;
};

export type LlmStructuredProvider = {
  readonly providerId: string;
  readonly complete: (
    request: LlmProviderCompletionRequest,
  ) => Promise<LlmProviderCompletionResponse>;
};

export type LlmSchemaParseResult<TValue> =
  | {
      readonly status: 'valid';
      readonly value: TValue;
    }
  | {
      readonly status: 'invalid';
      readonly reason: string;
    };

export type LlmStructuredOutputSchema<TValue> = {
  readonly name: string;
  readonly parse: (value: unknown) => LlmSchemaParseResult<TValue>;
};

export type LlmStructuredRequest = {
  readonly requestId: string;
  readonly model: string;
  readonly messages: readonly LlmChatMessage[];
  readonly tools?: readonly LlmToolContract[];
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
};

export type LlmGatewayPricing = {
  readonly inputTokenCostMicros: number;
  readonly outputTokenCostMicros: number;
};

export type LlmGatewayAttemptStatus =
  | 'succeeded'
  | 'provider-error'
  | 'schema-invalid'
  | 'timeout'
  | 'content-filtered';

export type LlmGatewayAttempt = {
  readonly attemptIndex: number;
  readonly status: LlmGatewayAttemptStatus;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: LlmGatewayUsage;
};

export type LlmStructuredSuccess<TValue> = {
  readonly status: 'succeeded';
  readonly requestId: string;
  readonly value: TValue;
  readonly rawContent: string;
  readonly attempts: readonly LlmGatewayAttempt[];
  readonly usage: LlmGatewayUsage;
};

export type LlmStructuredFailureReason =
  | 'provider-error'
  | 'schema-invalid'
  | 'timeout'
  | 'content-filtered';

export type LlmStructuredFailure = {
  readonly status: 'failed';
  readonly requestId: string;
  readonly reason: LlmStructuredFailureReason;
  readonly message: string;
  readonly attempts: readonly LlmGatewayAttempt[];
  readonly usage: LlmGatewayUsage;
};

export type LlmStructuredResult<TValue> = LlmStructuredSuccess<TValue> | LlmStructuredFailure;

export async function runStructuredLlmRequest<TValue>(input: {
  readonly provider: LlmStructuredProvider;
  readonly schema: LlmStructuredOutputSchema<TValue>;
  readonly request: LlmStructuredRequest;
  readonly pricing?: LlmGatewayPricing;
}): Promise<LlmStructuredResult<TValue>> {
  validateRequest(input.request);
  validateSchema(input.schema);
  if (input.pricing !== undefined) {
    validatePricing(input.pricing);
  }

  const maxAttempts = input.request.maxAttempts ?? 1;
  const attempts: LlmGatewayAttempt[] = [];

  for (let attemptIndex = 1; attemptIndex <= maxAttempts; attemptIndex += 1) {
    const attempt = await runProviderAttempt({
      provider: input.provider,
      schema: input.schema,
      request: input.request,
      attemptIndex,
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });
    attempts.push(attempt.trace);
    if (attempt.status === 'succeeded') {
      return {
        status: 'succeeded',
        requestId: input.request.requestId,
        value: attempt.value,
        rawContent: attempt.rawContent,
        attempts,
        usage: sumUsage(attempts),
      };
    }
  }

  const lastAttempt = attempts.at(-1);
  return {
    status: 'failed',
    requestId: input.request.requestId,
    reason: toFailureReason(lastAttempt?.status ?? 'provider-error'),
    message: lastAttempt?.message ?? 'LLM provider failed before producing an attempt',
    attempts,
    usage: sumUsage(attempts),
  };
}

async function runProviderAttempt<TValue>(input: {
  readonly provider: LlmStructuredProvider;
  readonly schema: LlmStructuredOutputSchema<TValue>;
  readonly request: LlmStructuredRequest;
  readonly attemptIndex: number;
  readonly pricing?: LlmGatewayPricing;
}): Promise<
  | {
      readonly status: 'succeeded';
      readonly value: TValue;
      readonly rawContent: string;
      readonly trace: LlmGatewayAttempt;
    }
  | {
      readonly status: 'failed';
      readonly trace: LlmGatewayAttempt;
    }
> {
  const controller = new AbortController();
  const providerRequest = createProviderRequest(input.request, input.schema, controller.signal);

  try {
    const response = await completeWithTimeout({
      provider: input.provider,
      request: providerRequest,
      controller,
      ...(input.request.timeoutMs === undefined ? {} : { timeoutMs: input.request.timeoutMs }),
    });
    const usage = createGatewayUsage(response.usage, input.pricing);
    if (response.finishReason === 'content-filtered') {
      return {
        status: 'failed',
        trace: createAttempt({
          attemptIndex: input.attemptIndex,
          status: 'content-filtered',
          providerId: response.providerId,
          model: response.model,
          message: 'LLM provider content filter blocked the response',
          usage,
        }),
      };
    }

    const parsedJson = parseJson(response.content);
    if (parsedJson.status === 'invalid') {
      return {
        status: 'failed',
        trace: createAttempt({
          attemptIndex: input.attemptIndex,
          status: 'schema-invalid',
          providerId: response.providerId,
          model: response.model,
          message: parsedJson.reason,
          usage,
        }),
      };
    }

    const parsedSchema = input.schema.parse(parsedJson.value);
    if (parsedSchema.status === 'invalid') {
      return {
        status: 'failed',
        trace: createAttempt({
          attemptIndex: input.attemptIndex,
          status: 'schema-invalid',
          providerId: response.providerId,
          model: response.model,
          message: parsedSchema.reason,
          usage,
        }),
      };
    }

    return {
      status: 'succeeded',
      value: parsedSchema.value,
      rawContent: response.content,
      trace: createAttempt({
        attemptIndex: input.attemptIndex,
        status: 'succeeded',
        providerId: response.providerId,
        model: response.model,
        message: 'LLM structured response validated',
        usage,
      }),
    };
  } catch (error) {
    const status = error instanceof LlmGatewayTimeoutError ? 'timeout' : 'provider-error';
    return {
      status: 'failed',
      trace: createAttempt({
        attemptIndex: input.attemptIndex,
        status,
        providerId: input.provider.providerId,
        model: input.request.model,
        message: error instanceof Error ? error.message : String(error),
        usage: emptyUsage(),
      }),
    };
  }
}

function createProviderRequest(
  request: LlmStructuredRequest,
  schema: LlmStructuredOutputSchema<unknown>,
  signal: AbortSignal,
): LlmProviderCompletionRequest {
  return {
    requestId: request.requestId,
    model: request.model,
    schemaName: schema.name,
    messages: request.messages.map((message) => ({ ...message })),
    tools: (request.tools ?? []).map((tool) => ({
      ...tool,
      inputSchema: cloneJsonLike(tool.inputSchema),
    })),
    signal,
  };
}

async function completeWithTimeout(input: {
  readonly provider: LlmStructuredProvider;
  readonly request: LlmProviderCompletionRequest;
  readonly timeoutMs?: number;
  readonly controller: AbortController;
}): Promise<LlmProviderCompletionResponse> {
  if (input.timeoutMs === undefined) {
    return input.provider.complete(input.request);
  }
  assertNonNegativeFinite(input.timeoutMs, 'timeoutMs');

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new LlmGatewayTimeoutError(input.timeoutMs ?? 0));
      input.controller.abort();
    }, input.timeoutMs);

    input.provider.complete(input.request).then(
      (response) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(response);
      },
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        reject(toError(error));
      },
    );
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class LlmGatewayTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`LLM provider timed out after ${timeoutMs}ms`);
  }
}

function parseJson(content: string):
  | {
      readonly status: 'valid';
      readonly value: unknown;
    }
  | {
      readonly status: 'invalid';
      readonly reason: string;
    } {
  try {
    return {
      status: 'valid',
      value: JSON.parse(content) as unknown,
    };
  } catch {
    return {
      status: 'invalid',
      reason: 'model output must be valid JSON',
    };
  }
}

function createAttempt(input: {
  readonly attemptIndex: number;
  readonly status: LlmGatewayAttemptStatus;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: LlmGatewayUsage;
}): LlmGatewayAttempt {
  return { ...input };
}

function createGatewayUsage(
  usage: LlmProviderTokenUsage | undefined,
  pricing: LlmGatewayPricing | undefined,
): LlmGatewayUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostMicros:
      pricing === undefined
        ? 0
        : inputTokens * pricing.inputTokenCostMicros + outputTokens * pricing.outputTokenCostMicros,
  };
}

function sumUsage(attempts: readonly LlmGatewayAttempt[]): LlmGatewayUsage {
  return attempts.reduce(
    (total, attempt) => ({
      inputTokens: total.inputTokens + attempt.usage.inputTokens,
      outputTokens: total.outputTokens + attempt.usage.outputTokens,
      totalTokens: total.totalTokens + attempt.usage.totalTokens,
      estimatedCostMicros: total.estimatedCostMicros + attempt.usage.estimatedCostMicros,
    }),
    emptyUsage(),
  );
}

function emptyUsage(): LlmGatewayUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostMicros: 0,
  };
}

function toFailureReason(status: LlmGatewayAttemptStatus): LlmStructuredFailureReason {
  if (status === 'succeeded') {
    return 'provider-error';
  }
  return status;
}

function validateRequest(request: LlmStructuredRequest): void {
  assertNonEmpty(request.requestId, 'requestId');
  assertNonEmpty(request.model, 'model');
  if (request.messages.length === 0) {
    throw new Error('messages must not be empty');
  }
  for (const [index, message] of request.messages.entries()) {
    assertNonEmpty(message.content, `message ${index} content`);
  }
  for (const tool of request.tools ?? []) {
    assertNonEmpty(tool.name, 'tool name');
    assertNonEmpty(tool.description, `tool ${tool.name} description`);
  }
  if (request.maxAttempts !== undefined) {
    assertPositiveInteger(request.maxAttempts, 'maxAttempts');
  }
  if (request.timeoutMs !== undefined) {
    assertNonNegativeFinite(request.timeoutMs, 'timeoutMs');
  }
}

function validateSchema(schema: LlmStructuredOutputSchema<unknown>): void {
  assertNonEmpty(schema.name, 'schema name');
}

function validatePricing(pricing: LlmGatewayPricing): void {
  assertNonNegativeFinite(pricing.inputTokenCostMicros, 'inputTokenCostMicros');
  assertNonNegativeFinite(pricing.outputTokenCostMicros, 'outputTokenCostMicros');
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function cloneJsonLike(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as unknown;
}
