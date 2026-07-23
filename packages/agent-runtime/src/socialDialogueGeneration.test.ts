import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { createBranchPlan, type PrioritizedSubtask } from './planner';
import {
  applySocialDialogueProposal,
  createDeterministicSocialDialogueGenerationResult,
  createSocialDialoguePolicyManifest,
  type SocialDialoguePayload,
} from './socialDialogueGeneration';

const agentId = asAgentId('agent-1');
const targetAgentId = asAgentId('agent-2');
const plan = createBranchPlan({
  objective: 'build a useful social routine',
  branches: [
    {
      id: 'social',
      objective: 'maintain relationships',
      subtasks: [{ id: 'check-in', description: 'check in with a neighbor', basePriority: 7 }],
    },
  ],
});
const selectedSubtask: PrioritizedSubtask = {
  branchId: 'social',
  subtaskId: 'check-in',
  description: 'check in with a neighbor',
  score: 7,
};
const deterministicPayload: SocialDialoguePayload = {
  targetAgentId,
  topic: 'neighborhood food prices',
  relationDelta: 0.05,
  attitudeDelta: 0.02,
  turns: [
    {
      speakerAgentId: agentId,
      utterance: 'Do you know whether fish stayed affordable today?',
      intent: 'ask-about-prices',
    },
    {
      speakerAgentId: targetAgentId,
      utterance: 'I heard it was still manageable near the market.',
      intent: 'share-market-rumor',
    },
    {
      speakerAgentId: agentId,
      utterance: 'Could we compare notes after the afternoon market closes?',
      intent: 'propose-follow-up',
    },
    {
      speakerAgentId: targetAgentId,
      utterance: 'Yes, I will write down the prices I see and meet you here.',
      intent: 'confirm-follow-up',
    },
  ],
};
const action: AtomicActionProposal<'AgentStartConversation', SocialDialoguePayload> = {
  id: 'social-check-in',
  description: 'Start a conversation with a neighbor.',
  commandType: 'AgentStartConversation',
  payload: deterministicPayload,
  priority: 7,
  resourceEstimate: { actionSeconds: 30 },
};

describe('social dialogue generation contract', () => {
  test('returns deterministic payload and trace when no LLM generator is configured', () => {
    const result = createDeterministicSocialDialogueGenerationResult({
      agentId,
      issuedAt: 300,
      plan,
      selectedSubtask,
      action,
      deterministicPayload,
      signals: [{ key: 'social', weight: 3 }],
    });

    expect(result).toEqual({
      payload: deterministicPayload,
      trace: {
        status: 'deterministic',
        source: 'deterministic',
        selectedSubtask: { branchId: 'social', subtaskId: 'check-in' },
        actionId: 'social-check-in',
        targetAgentId: 'agent-2',
        topic: 'neighborhood food prices',
        policyVersion: 'bounded-social-dialogue-v1',
        turnCount: 4,
        rationale: 'bounded-social-dialogue-v1; deterministic bounded dialogue',
      },
    });
  });

  test('applies a valid two-party dialogue proposal while preserving action metadata', () => {
    const result = applySocialDialogueProposal({
      agentId,
      action,
      deterministicPayload,
      proposal: {
        topic: 'splitting market errands',
        relationDelta: 0.08,
        attitudeDelta: 0.04,
        rationale: 'The plan asks for a neighbor check-in and shared errands are relevant.',
        turns: [
          {
            speakerAgentId: agentId,
            utterance: 'I am heading to the market and can compare fish prices for us.',
            intent: 'offer-help',
          },
          {
            speakerAgentId: targetAgentId,
            utterance: 'That would help; I can cover grain prices while I am there.',
            intent: 'coordinate-errands',
          },
          {
            speakerAgentId: agentId,
            utterance: 'Great, we can share notes before dinner.',
            intent: 'confirm-plan',
          },
          {
            speakerAgentId: targetAgentId,
            utterance: 'Agreed, I will bring the prices I record.',
            intent: 'accept-plan',
          },
        ],
      },
    });

    expect(result).toEqual({
      targetAgentId,
      topic: 'splitting market errands',
      relationDelta: 0.05,
      attitudeDelta: 0.02,
      turns: [
        {
          speakerAgentId: agentId,
          utterance: 'I am heading to the market and can compare fish prices for us.',
          intent: 'offer-help',
        },
        {
          speakerAgentId: targetAgentId,
          utterance: 'That would help; I can cover grain prices while I am there.',
          intent: 'coordinate-errands',
        },
        {
          speakerAgentId: agentId,
          utterance: 'Great, we can share notes before dinner.',
          intent: 'confirm-plan',
        },
        {
          speakerAgentId: targetAgentId,
          utterance: 'Agreed, I will bring the prices I record.',
          intent: 'accept-plan',
        },
      ],
    });
  });

  test('preserves deterministic deltas when a valid proposal omits them', () => {
    const result = applySocialDialogueProposal({
      agentId,
      action,
      deterministicPayload,
      proposal: {
        topic: 'market errand coordination',
        rationale: 'Coordinate with a nearby agent.',
        turns: [
          { speakerAgentId: agentId, utterance: 'Can we compare prices after your errand?' },
          {
            speakerAgentId: targetAgentId,
            utterance: 'Yes, I will tell you what I find near the stalls.',
          },
          { speakerAgentId: agentId, utterance: 'I will record the fish prices I see.' },
          {
            speakerAgentId: targetAgentId,
            utterance: 'Then I will record the grain prices for comparison.',
          },
        ],
      },
    });

    expect(result.relationDelta).toBe(deterministicPayload.relationDelta);
    expect(result.attitudeDelta).toBe(deterministicPayload.attitudeDelta);
  });

  test('rejects speakers outside the acting and target participants', () => {
    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'invalid speaker',
          rationale: 'A third participant is not part of this command payload.',
          turns: [
            { speakerAgentId: agentId, utterance: 'Hello.' },
            { speakerAgentId: asAgentId('agent-3'), utterance: 'I should not be here.' },
            { speakerAgentId: agentId, utterance: 'This is still invalid.' },
            { speakerAgentId: targetAgentId, utterance: 'This will not be reached.' },
          ],
        },
      }),
    ).toThrow('social dialogue turns[1].speakerAgentId must be agent-1 or agent-2');
  });

  test('rejects dialogue where the target speaks first', () => {
    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'target starts',
          rationale: 'The acting agent must initiate AgentStartConversation.',
          turns: [
            { speakerAgentId: targetAgentId, utterance: 'I started this unexpectedly.' },
            { speakerAgentId: agentId, utterance: 'This should not pass.' },
            { speakerAgentId: targetAgentId, utterance: 'Nor should this.' },
            { speakerAgentId: agentId, utterance: 'The contract remains invalid.' },
          ],
        },
      }),
    ).toThrow('social dialogue first turn must be spoken by agent-1');
  });

  test('rejects dialogue without strict speaker alternation', () => {
    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'monologue',
          rationale: 'A conversation needs both participants.',
          turns: [
            { speakerAgentId: agentId, utterance: 'I will talk once.' },
            { speakerAgentId: agentId, utterance: 'I will talk twice.' },
            { speakerAgentId: agentId, utterance: 'I will talk three times.' },
            { speakerAgentId: agentId, utterance: 'I will talk four times.' },
          ],
        },
      }),
    ).toThrow('social dialogue turns[1] must alternate speakers');
  });

  test('rejects empty topics, empty utterances, and non-finite deltas', () => {
    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: '   ',
          rationale: 'Invalid blank topic.',
          turns: [
            { speakerAgentId: agentId, utterance: 'Hello.' },
            { speakerAgentId: targetAgentId, utterance: 'Hello back.' },
          ],
        },
      }),
    ).toThrow('social dialogue topic must not be empty');

    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'blank utterance',
          rationale: 'Invalid blank utterance.',
          turns: [
            { speakerAgentId: agentId, utterance: 'Hello.' },
            { speakerAgentId: targetAgentId, utterance: '   ' },
            { speakerAgentId: agentId, utterance: 'This would be the third turn.' },
            { speakerAgentId: targetAgentId, utterance: 'This would be the fourth turn.' },
          ],
        },
      }),
    ).toThrow('social dialogue turns[1].utterance must not be empty');

    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'bad delta',
          relationDelta: Number.NaN,
          rationale: 'Invalid delta.',
          turns: [
            { speakerAgentId: agentId, utterance: 'Hello.' },
            { speakerAgentId: targetAgentId, utterance: 'Hello back.' },
          ],
        },
      }),
    ).toThrow('social dialogue relationDelta must be a finite number');
  });

  test('publishes and enforces the bounded dialogue policy', () => {
    expect(createSocialDialoguePolicyManifest()).toEqual({
      policyVersion: 'bounded-social-dialogue-v1',
      minimumTurns: 4,
      maximumTurns: 8,
      maximumUtteranceLength: 500,
      speakerRule: 'acting-agent-starts-and-speakers-strictly-alternate',
      participantRule: 'exactly-acting-and-target-agent',
      outcomeAuthority: 'world-evaluates-transcript-proposal-deltas-are-compatibility-only',
      failureRule: 'versioned-deterministic-bounded-dialogue-fallback',
    });

    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'too many turns',
          rationale: 'The policy caps frequent-tick dialogue size.',
          turns: Array.from({ length: 10 }, (_, index) => ({
            speakerAgentId: index % 2 === 0 ? agentId : targetAgentId,
            utterance: `Turn ${index + 1}`,
          })),
        },
      }),
    ).toThrow('social dialogue turns must contain at most 8 entries');

    expect(() =>
      applySocialDialogueProposal({
        agentId,
        action,
        deterministicPayload,
        proposal: {
          topic: 'overlong turn',
          rationale: 'The policy caps each utterance.',
          turns: [
            { speakerAgentId: agentId, utterance: 'x'.repeat(501) },
            { speakerAgentId: targetAgentId, utterance: 'Second.' },
            { speakerAgentId: agentId, utterance: 'Third.' },
            { speakerAgentId: targetAgentId, utterance: 'Fourth.' },
          ],
        },
      }),
    ).toThrow('social dialogue turns[0].utterance must contain at most 500 characters');
  });
});
