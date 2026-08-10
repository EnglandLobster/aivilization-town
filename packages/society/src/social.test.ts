import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applySocialInteraction,
  classifyRelation,
  createDirectedSocialRelationKey,
  decaySocialRelation,
  evaluateConversationSocialOutcomes,
  evaluateConversationSocialOutcomesFromSignals,
  evaluateConversationSocialOutcomesFromSignalSeverities,
  evaluateResourceTransferSocialOutcome,
} from './index';

describe('social relationships', () => {
  test('applies social deltas to a directed relationship and clamps scores', () => {
    const sourceAgentId = asAgentId('agent-1');
    const targetAgentId = asAgentId('agent-2');

    expect(
      applySocialInteraction({
        sourceAgentId,
        targetAgentId,
        current: {
          sourceAgentId,
          targetAgentId,
          relationScore: 0.8,
          attitudeScore: -0.8,
          relationLabel: 'close-friend',
          interactionCount: 2,
          lastInteractionSummary: null,
        },
        relationDelta: 0.5,
        attitudeDelta: -0.5,
        summary: 'Studied together after work.',
      }),
    ).toEqual({
      sourceAgentId,
      targetAgentId,
      relationScore: 1,
      attitudeScore: -1,
      relationLabel: 'best-friend',
      interactionCount: 3,
      lastInteractionSummary: 'Studied together after work.',
    });
  });

  test('classifies relation labels from the relation score', () => {
    expect(classifyRelation(-0.75)).toBe('hostile');
    expect(classifyRelation(-0.1)).toBe('strained');
    expect(classifyRelation(0.1)).toBe('acquaintance');
    expect(classifyRelation(0.45)).toBe('friend');
    expect(classifyRelation(0.7)).toBe('close-friend');
    expect(classifyRelation(0.95)).toBe('best-friend');
  });

  test('uses directed social relation keys', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');

    expect(
      createDirectedSocialRelationKey({
        sourceAgentId: agent1,
        targetAgentId: agent2,
      }),
    ).toBe('agent-1->agent-2');
    expect(
      createDirectedSocialRelationKey({
        sourceAgentId: agent2,
        targetAgentId: agent1,
      }),
    ).toBe('agent-2->agent-1');
  });

  test('derives asymmetric cooperation, betrayal, and repair outcomes from participant conduct', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomes({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        {
          speakerAgentId: agent1,
          utterance: 'I kept my promise and brought the supplies.',
          intent: 'fulfill-commitment',
        },
        {
          speakerAgentId: agent2,
          utterance: 'I betrayed you, but I apologize and want to make amends.',
          intent: 'betray-and-repair',
        },
      ],
    });

    expect(outcome.targetToInitiator).toMatchObject({
      relationDelta: 0.12,
      attitudeDelta: 0.1,
      signals: ['fulfilled-commitment'],
    });
    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: -0.28,
      attitudeDelta: -0.16,
      signals: ['betrayal', 'repair'],
    });
  });

  test('decays durable relation and faster-moving attitude toward neutral over simulated time', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const decayed = decaySocialRelation(
      {
        sourceAgentId: agent1,
        targetAgentId: agent2,
        relationScore: 0.8,
        attitudeScore: -0.8,
        relationLabel: 'close-friend',
        interactionCount: 3,
        lastInteractionSummary: 'A mixed history.',
      },
      7 * 24 * 60 * 60 * 1_000,
    );

    expect(decayed.relationScore).toBe(0.4);
    expect(decayed.attitudeScore).toBeCloseTo(-0.070710678119);
    expect(decayed.relationLabel).toBe('friend');
    expect(decayed.interactionCount).toBe(3);
  });

  test('derives bounded recipient trust from an actual resource transfer quantity', () => {
    expect(
      evaluateResourceTransferSocialOutcome({
        recipientAgentId: asAgentId('agent-2'),
        providerAgentId: asAgentId('agent-1'),
        quantity: 3,
      }),
    ).toMatchObject({
      policyVersion: 'resource-transfer-social-outcome-v1',
      relationDelta: 0.07,
      attitudeDelta: 0.09,
      signals: ['resource-help-received'],
    });
  });

  test('rejects invalid social deltas and self-targeted relationships', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');

    expect(() =>
      applySocialInteraction({
        sourceAgentId: agent1,
        targetAgentId: agent2,
        relationDelta: 2,
        attitudeDelta: 0,
        summary: 'Invalid oversized relation delta.',
      }),
    ).toThrow(/relationDelta must be within/);

    expect(() =>
      createDirectedSocialRelationKey({
        sourceAgentId: agent1,
        targetAgentId: agent1,
      }),
    ).toThrow(/social relation target must differ/);
  });
});

describe('supplied-signal conversation outcomes', () => {
  test('adjudicates supplied per-turn signals with the same rule table under conversation-outcome-v2', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomesFromSignals({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        { speakerAgentId: agent1, utterance: 'Did you bring the grain?', intent: 'ask' },
        {
          speakerAgentId: agent2,
          utterance: "I just can't keep my word to you, sorry.",
          intent: 'confess-failure',
        },
        { speakerAgentId: agent1, utterance: 'That hurts my season.', intent: 'explain' },
        { speakerAgentId: agent2, utterance: 'I have no excuse.', intent: 'accept-blame' },
      ],
      turnSignals: [
        { turnIndex: 1, signals: ['betrayal'] },
        { turnIndex: 3, signals: ['repair', 'repair'] },
      ],
    });

    expect(outcome.policyVersion).toBe('conversation-outcome-v2');
    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: -0.28,
      attitudeDelta: -0.16,
      signals: ['betrayal', 'repair'],
    });
    expect(outcome.targetToInitiator).toMatchObject({
      relationDelta: 0,
      attitudeDelta: 0,
      signals: [],
    });
  });

  test('ignores unknown signals and out-of-range turn indexes and clamps the total delta', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomesFromSignals({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        { speakerAgentId: agent1, utterance: 'We need to talk.' },
        { speakerAgentId: agent2, utterance: 'Fine.' },
        { speakerAgentId: agent1, utterance: 'This is hard.' },
        { speakerAgentId: agent2, utterance: 'Go on.' },
        { speakerAgentId: agent1, utterance: 'I see.' },
        { speakerAgentId: agent2, utterance: 'That is all.' },
      ],
      turnSignals: [
        { turnIndex: 1, signals: ['betrayal'] },
        { turnIndex: 3, signals: ['deception'] },
        { turnIndex: 5, signals: ['hostility', 'not-a-signal'] },
        { turnIndex: 12, signals: ['repair'] },
      ],
    });

    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: -0.35,
      attitudeDelta: -0.35,
      signals: ['betrayal', 'deception', 'hostility'],
    });
  });

  test('counts each signal only once even when supplied for several turns', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomesFromSignals({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        { speakerAgentId: agent1, utterance: 'Hi.' },
        { speakerAgentId: agent2, utterance: 'One.' },
        { speakerAgentId: agent1, utterance: 'Thanks.' },
        { speakerAgentId: agent2, utterance: 'Two.' },
      ],
      turnSignals: [
        { turnIndex: 1, signals: ['cooperation'] },
        { turnIndex: 3, signals: ['cooperation'] },
      ],
    });

    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: 0.06,
      attitudeDelta: 0.06,
      signals: ['cooperation'],
    });
  });
});

describe('severity-weighted conversation outcomes', () => {
  test('scales rule-table base deltas by per-signal severity under conversation-outcome-v3', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomesFromSignalSeverities({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        { speakerAgentId: agent1, utterance: 'Did you bring the grain?', intent: 'ask' },
        {
          speakerAgentId: agent2,
          utterance: "I just can't keep my word to you, sorry.",
          intent: 'confess-failure',
        },
        { speakerAgentId: agent1, utterance: 'That hurts my season.', intent: 'explain' },
        { speakerAgentId: agent2, utterance: 'I have no excuse.', intent: 'accept-blame' },
      ],
      turnSignals: [
        { turnIndex: 1, signals: [{ signal: 'betrayal', severity: 0.6 }] },
        { turnIndex: 3, signals: [{ signal: 'repair' }] },
      ],
    });

    expect(outcome.policyVersion).toBe('conversation-outcome-v3');
    // betrayal base -0.3/-0.24 x 0.6 plus repair base 0.02/0.08 x 1 (default severity).
    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: -0.16,
      attitudeDelta: -0.064,
      signals: ['betrayal', 'repair'],
      signalSeverities: [
        { signal: 'betrayal', severity: 0.6 },
        { signal: 'repair', severity: 1 },
      ],
    });
    expect(outcome.targetToInitiator).toMatchObject({
      relationDelta: 0,
      attitudeDelta: 0,
      signals: [],
      signalSeverities: [],
    });
  });

  test('clamps severity-scaled totals to the conversation delta bounds', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomesFromSignalSeverities({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        { speakerAgentId: agent1, utterance: 'We need to talk.' },
        { speakerAgentId: agent2, utterance: 'Fine.' },
        { speakerAgentId: agent1, utterance: 'This is hard.' },
        { speakerAgentId: agent2, utterance: 'Go on.' },
      ],
      turnSignals: [
        { turnIndex: 1, signals: [{ signal: 'betrayal', severity: 1 }] },
        { turnIndex: 3, signals: [{ signal: 'deception', severity: 0.8 }] },
      ],
    });

    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: -0.35,
      attitudeDelta: -0.35,
      signals: ['betrayal', 'deception'],
    });
  });

  test('counts each signal once with the first supplied severity and skips invalid severities', () => {
    const agent1 = asAgentId('agent-1');
    const agent2 = asAgentId('agent-2');
    const outcome = evaluateConversationSocialOutcomesFromSignalSeverities({
      initiatorAgentId: agent1,
      targetAgentId: agent2,
      turns: [
        { speakerAgentId: agent1, utterance: 'Hi.' },
        { speakerAgentId: agent2, utterance: 'One.' },
        { speakerAgentId: agent1, utterance: 'Thanks.' },
        { speakerAgentId: agent2, utterance: 'Two.' },
        { speakerAgentId: agent1, utterance: 'Right.' },
        { speakerAgentId: agent2, utterance: 'Three.' },
      ],
      turnSignals: [
        { turnIndex: 1, signals: [{ signal: 'cooperation', severity: 0.5 }] },
        { turnIndex: 3, signals: [{ signal: 'cooperation', severity: 1 }] },
        { turnIndex: 5, signals: [{ signal: 'hostility', severity: 2 }] },
      ],
    });

    expect(outcome.initiatorToTarget).toMatchObject({
      relationDelta: 0.03,
      attitudeDelta: 0.03,
      signals: ['cooperation'],
      signalSeverities: [{ signal: 'cooperation', severity: 0.5 }],
    });
  });
});
