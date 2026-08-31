import { describe, expect, test } from 'vitest';
import { applyActionSequenceProposal } from './actionSequenceGeneration';

describe('action sequence generation', () => {
  test('preserves deterministic blocked availability across generated wording', () => {
    const [generated] = applyActionSequenceProposal({
      selectedSubtask: {
        branchId: 'labor',
        subtaskId: 'work',
        description: 'Work at the workshop.',
        score: 10,
      },
      deterministicActions: [
        {
          id: 'deterministic-wait',
          description: 'Wait for workshop access.',
          commandType: 'AgentObserveLocation',
          payload: { focus: 'Workshop access' },
          availability: {
            status: 'blocked',
            reason: 'destination workshop is at-capacity',
          },
        },
      ],
      actions: [
        {
          id: 'generated-wait',
          description: 'Look around while waiting.',
          commandType: 'AgentObserveLocation',
          payload: { focus: 'Workshop access' },
          rationale: 'The workshop is currently full.',
        },
      ],
    });

    expect(generated).toMatchObject({
      id: 'generated-wait',
      availability: {
        status: 'blocked',
        reason: 'destination workshop is at-capacity',
      },
    });
  });
});
