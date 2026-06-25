import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import type { AtomicActionProposal } from './actions';
import { createBranchPlan, type PrioritizedSubtask } from './planner';
import {
  applySocialDialogueProposal,
  createDeterministicSocialDialogueGenerationResult,
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
        turnCount: 2,
        rationale: 'deterministic social dialogue fallback payload',
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
        ],
      },
    });

    expect(result).toEqual({
      targetAgentId,
      topic: 'splitting market errands',
      relationDelta: 0.08,
      attitudeDelta: 0.04,
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
          ],
        },
      }),
    ).toThrow('social dialogue first turn must be spoken by agent-1');
  });

  test('rejects dialogue where one participant never speaks', () => {
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
          ],
        },
      }),
    ).toThrow('social dialogue must include at least one turn from agent-2');
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
});
