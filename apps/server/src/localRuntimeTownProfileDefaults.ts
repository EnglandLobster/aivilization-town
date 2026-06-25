import {
  createBranchPlan,
  type AdaptiveReplanningPolicy,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileDefaults = {
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
  readonly minimumFullReplanMaterializationCount?: number;
  readonly minimumSimulatorRolloutCoverageRatio?: number;
};

const RECOVERY_DRILL_REPLANNING_POLICY: AdaptiveReplanningPolicy = {
  consecutiveFailureThreshold: 2,
  majorContextShift: {
    key: 'profile-recovery-drill',
    reason: 'profile recovery drill requires a replacement plan',
  },
};

export function createLocalRuntimeTownProfileDefaults(
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): LocalRuntimeTownProfileDefaults {
  if (profileId !== 'recovery-drill-25') {
    return {
      minimumSimulatorRolloutCoverageRatio: 1,
    };
  }

  return {
    strategicPlanCompiler: createRecoveryDrillStrategicPlanCompiler(),
    replanningPolicy: RECOVERY_DRILL_REPLANNING_POLICY,
    minimumFullReplanMaterializationCount: 1,
    minimumSimulatorRolloutCoverageRatio: 1,
  };
}

function createRecoveryDrillStrategicPlanCompiler(): StrategicPlanCompiler {
  return ({ objective }) => ({
    plan: createBranchPlan({
      objective: objective.statement,
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
    }),
    planningTrace: {
      status: 'deterministic',
      source: 'deterministic',
      message: 'Built-in recovery drill strategic plan',
    },
  });
}
