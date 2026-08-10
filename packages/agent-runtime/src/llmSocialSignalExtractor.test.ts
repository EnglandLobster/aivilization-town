import { createScriptedLlmProvider } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createTraceableLlmSocialSignalExtractor,
  proposeSocialSignalsWithLlm,
} from './llmSocialSignalExtractor';
import {
  SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION,
  validateSocialSignalTurnExtractions,
  type SocialSignalExtractionInput,
} from './socialSignalExtraction';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');

const paraphrasedBetrayalInput: SocialSignalExtractionInput = {
  agentId,
  issuedAt: 500,
  targetAgentId,
  topic: 'the broken delivery promise',
  turns: [
    {
      speakerAgentId: agentId,
      utterance: 'Did you bring the grain you promised last week?',
      intent: 'ask-about-promise',
    },
    {
      speakerAgentId: targetAgentId,
      utterance: "I just can't keep my word to you, sorry.",
      intent: 'confess-failure',
    },
    {
      speakerAgentId: agentId,
      utterance: 'That leaves me without seed for the season.',
      intent: 'explain-impact',
    },
    {
      speakerAgentId: targetAgentId,
      utterance: 'I know, and I have no excuse to offer.',
      intent: 'accept-blame',
    },
  ],
};

describe('LLM social signal extraction seam', () => {
  test('accepts LLM-proposed signals with severities for a paraphrased utterance', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          usage: { inputTokens: 55, outputTokens: 12 },
          content: JSON.stringify({
            turnSignals: [{ turnIndex: 1, signals: [{ signal: 'betrayal', severity: 0.6 }] }],
          }),
        },
      ],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-agent-1-500',
      pricing: { inputTokenCostMicros: 2, outputTokenCostMicros: 5 },
    });

    expect(result.turnSignals).toEqual([
      { turnIndex: 1, signals: [{ signal: 'betrayal', severity: 0.6 }] },
    ]);
    expect(result.trace).toMatchObject({
      status: 'accepted',
      source: 'llm',
      policyVersion: SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION,
      agentId,
      targetAgentId,
      topic: 'the broken delivery promise',
      turnCount: 4,
      extractedSignalCount: 1,
      requestId: 'social-signals-agent-1-500',
      providerId: 'scripted-social-signals',
      model: 'signal-model',
    });

    const request = scripted.getRequests()[0];
    expect(request).toMatchObject({
      requestId: 'social-signals-agent-1-500',
      model: 'signal-model',
      schemaName: 'aivilization_social_signal_extraction',
    });
    const requestContent = request?.messages[1]?.content ?? '';
    expect(requestContent).toContain("I just can't keep my word to you, sorry.");
    expect(requestContent).toContain('"betrayal"');
    expect(requestContent).toContain('"signalTaxonomy"');
    expect(requestContent).toContain('severity');
  });

  test('defaults a missing severity to full strength', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          content: JSON.stringify({
            turnSignals: [{ turnIndex: 1, signals: [{ signal: 'betrayal' }] }],
          }),
        },
      ],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-default-severity',
    });

    expect(result.turnSignals).toEqual([
      { turnIndex: 1, signals: [{ signal: 'betrayal', severity: 1 }] },
    ]);
    expect(result.trace).toMatchObject({ status: 'accepted', extractedSignalCount: 1 });
  });

  test('returns no proposal when a severity is out of range', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          content: JSON.stringify({
            turnSignals: [{ turnIndex: 1, signals: [{ signal: 'betrayal', severity: 1.7 }] }],
          }),
        },
      ],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-severity-out-of-range',
    });

    expect(result.turnSignals).toBeUndefined();
    expect(result.trace).toMatchObject({
      status: 'no-proposal',
      source: 'deterministic-fallback',
      failureReason: 'proposal-invalid',
    });
  });

  test('returns no proposal when the provider fails', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [new Error('signal provider offline')],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-provider-failure',
    });

    expect(result.turnSignals).toBeUndefined();
    expect(result.trace).toMatchObject({
      status: 'no-proposal',
      source: 'deterministic-fallback',
      requestId: 'social-signals-provider-failure',
      failureReason: 'provider-error',
      message: 'signal provider offline',
    });
  });

  test('returns no proposal when the LLM proposes a signal outside the taxonomy', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          content: JSON.stringify({
            turnSignals: [
              { turnIndex: 1, signals: [{ signal: 'mild-disappointment', severity: 0.4 }] },
            ],
          }),
        },
      ],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-unknown-signal',
    });

    expect(result.turnSignals).toBeUndefined();
    expect(result.trace).toMatchObject({
      status: 'no-proposal',
      source: 'deterministic-fallback',
      failureReason: 'proposal-invalid',
    });
  });

  test('drops out-of-range turn entries while keeping in-range proposals', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          content: JSON.stringify({
            turnSignals: [
              { turnIndex: 9, signals: [{ signal: 'hostility', severity: 0.9 }] },
              { turnIndex: 3, signals: [{ signal: 'repair', severity: 0.5 }] },
            ],
          }),
        },
      ],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-out-of-range',
    });

    expect(result.turnSignals).toEqual([
      { turnIndex: 3, signals: [{ signal: 'repair', severity: 0.5 }] },
    ]);
    expect(result.trace).toMatchObject({ status: 'accepted', extractedSignalCount: 1 });
  });

  test('returns no proposal when only out-of-range entries remain', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          content: JSON.stringify({
            turnSignals: [{ turnIndex: 12, signals: [{ signal: 'betrayal', severity: 1 }] }],
          }),
        },
      ],
    });

    const result = await proposeSocialSignalsWithLlm({
      ...paraphrasedBetrayalInput,
      provider: scripted.provider,
      model: 'signal-model',
      requestId: 'social-signals-only-out-of-range',
    });

    expect(result.turnSignals).toBeUndefined();
    expect(result.trace).toMatchObject({
      status: 'no-proposal',
      failureReason: 'proposal-invalid',
    });
  });

  test('creates a traceable extractor that composes request ids', async () => {
    const scripted = createScriptedLlmProvider({
      providerId: 'scripted-social-signals',
      responses: [
        {
          providerId: 'scripted-social-signals',
          model: 'signal-model',
          finishReason: 'stop',
          content: JSON.stringify({
            turnSignals: [
              {
                turnIndex: 1,
                signals: [
                  { signal: 'betrayal', severity: 0.8 },
                  { signal: 'repair', severity: 0.3 },
                ],
              },
            ],
          }),
        },
      ],
    });
    const extractor = createTraceableLlmSocialSignalExtractor({
      provider: scripted.provider,
      model: 'signal-model',
      requestId: ({ agentId: actor, targetAgentId: target, issuedAt }) =>
        `${actor}:${target}:${issuedAt}:social-signals`,
    });

    const result = await extractor(paraphrasedBetrayalInput);

    expect(result.turnSignals).toEqual([
      {
        turnIndex: 1,
        signals: [
          { signal: 'betrayal', severity: 0.8 },
          { signal: 'repair', severity: 0.3 },
        ],
      },
    ]);
    expect(result.trace).toMatchObject({
      status: 'accepted',
      requestId: 'agent-1:agent-2:500:social-signals',
      extractedSignalCount: 2,
    });
  });
});

describe('validateSocialSignalTurnExtractions', () => {
  test('rejects the whole proposal when any signal name is unknown', () => {
    expect(
      validateSocialSignalTurnExtractions({
        turnCount: 4,
        entries: [
          { turnIndex: 1, signals: [{ signal: 'betrayal' }, { signal: 'not-a-signal' }] },
        ],
      }),
    ).toBeUndefined();
  });

  test('rejects the whole proposal when any severity is non-finite or out of range', () => {
    expect(
      validateSocialSignalTurnExtractions({
        turnCount: 4,
        entries: [{ turnIndex: 1, signals: [{ signal: 'betrayal', severity: Number.NaN }] }],
      }),
    ).toBeUndefined();
    expect(
      validateSocialSignalTurnExtractions({
        turnCount: 4,
        entries: [{ turnIndex: 1, signals: [{ signal: 'betrayal', severity: -0.1 }] }],
      }),
    ).toBeUndefined();
  });

  test('deduplicates repeated signals within a turn, keeping the first severity', () => {
    expect(
      validateSocialSignalTurnExtractions({
        turnCount: 4,
        entries: [
          {
            turnIndex: 1,
            signals: [
              { signal: 'repair', severity: 0.4 },
              { signal: 'repair', severity: 0.9 },
            ],
          },
        ],
      }),
    ).toEqual([{ turnIndex: 1, signals: [{ signal: 'repair', severity: 0.4 }] }]);
  });
});
