import {
  createOpenAiCompatibleProvider,
  type OpenAiCompatibleProviderConfig,
} from './openAiCompatibleProvider';
import { createScriptedLlmProvider, type ScriptedLlmProviderResponse } from './scriptedProvider';
import type { LlmStructuredProvider } from './structuredGateway';

export type OpenAiCompatibleLlmProviderConfig = OpenAiCompatibleProviderConfig & {
  readonly kind: 'openai-compatible';
};

export type ScriptedLlmProviderConfig = {
  readonly kind: 'scripted';
  readonly providerId: string;
  readonly responses: readonly ScriptedLlmProviderResponse[];
};

export type LlmStructuredProviderConfig =
  | OpenAiCompatibleLlmProviderConfig
  | ScriptedLlmProviderConfig;

export function createLlmStructuredProviderFromConfig(
  config: LlmStructuredProviderConfig,
): LlmStructuredProvider {
  switch (config.kind) {
    case 'openai-compatible':
      return createOpenAiCompatibleProvider({
        providerId: config.providerId,
        endpoint: config.endpoint,
        ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        ...(config.defaultHeaders === undefined ? {} : { defaultHeaders: config.defaultHeaders }),
        ...(config.responseFormat === undefined ? {} : { responseFormat: config.responseFormat }),
        ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
      });
    case 'scripted':
      return createScriptedLlmProvider({
        providerId: config.providerId,
        responses: config.responses,
      }).provider;
    default:
      throw new Error(`unsupported LLM provider kind ${describeProviderKind(config)}`);
  }
}

function describeProviderKind(config: never): string {
  const kind = (config as { readonly kind?: unknown }).kind;
  return typeof kind === 'string' && kind.length > 0 ? kind : String(kind);
}
