import { normalizeStrategicPlanCompilerOutput } from '@aivilization/agent-runtime';
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownProfileDefaults } from './index';

describe('local runtime town profile defaults', () => {
  test('provides deterministic recovery drill runtime and gate defaults', async () => {
    const defaults = createLocalRuntimeTownProfileDefaults('recovery-drill-25');

    expect(defaults.replanningPolicy).toEqual({
      consecutiveFailureThreshold: 2,
      majorContextShift: {
        key: 'profile-recovery-drill',
        reason: 'profile recovery drill requires a replacement plan',
      },
    });
    expect(defaults.minimumFullReplanMaterializationCount).toBe(1);
    expect(defaults.minimumSimulatorRolloutCoverageRatio).toBe(1);

    const compiler = defaults.strategicPlanCompiler;
    if (compiler === undefined) {
      throw new Error('recovery drill defaults must provide a strategic plan compiler');
    }

    const compiled = compiler({
      objective: createObjective(),
      issuedAt: 100,
    });
    const normalized = normalizeStrategicPlanCompilerOutput(await compiled);

    expect(normalized.planningTrace).toEqual({
      status: 'deterministic',
      source: 'deterministic',
      message: 'Built-in recovery drill strategic plan',
    });
    expect(normalized.plan).toMatchObject({
      objective: 'Trigger adaptive full replan recovery.',
      branches: [
        {
          id: 'eat-recovery-drill',
          objective: 'Try an impossible eat action so the profile proves replan recovery.',
          subtasks: [
            {
              id: 'eat-without-inventory',
              description: 'eat an Apple without inventory',
              basePriority: 99,
              intentionAffinityTags: ['eat'],
            },
          ],
        },
      ],
    });
  });

  test('returns empty defaults for ordinary backend profiles', () => {
    expect(createLocalRuntimeTownProfileDefaults('smoke-25')).toEqual({
      minimumSimulatorRolloutCoverageRatio: 1,
    });
  });
});

function createObjective() {
  return {
    id: 'objective-recovery-drill',
    agentId: asAgentId('recovery-drill-agent-001'),
    statement: 'Trigger adaptive full replan recovery.',
    priority: 10,
    source: 'system' as const,
    affinityTags: ['eat', 'recovery'],
    createdAt: 100,
    updatedAt: 100,
  };
}
