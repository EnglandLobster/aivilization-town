import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applySocialInteraction, classifyRelation, createDirectedSocialRelationKey } from './index';

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
