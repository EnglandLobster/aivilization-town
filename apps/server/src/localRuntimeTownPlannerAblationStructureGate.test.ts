import { describe, expect, test } from 'vitest';
import { evaluateLocalRuntimeTownPlannerAblationStructureGate } from './localRuntimeTownPlannerAblationStructureGate';

describe('local runtime town planner ablation structure gate', () => {
  test('passes default planner only when branch and objective decomposition are both present', () => {
    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'default',
        metrics: createMetrics({
          planCount: 1,
          meanBranchCount: 2,
          singleBranchPlanRatio: 0,
          multiSubtaskBranchRatio: 0.5,
        }),
      }),
    ).toEqual({
      variant: 'default',
      status: 'pass',
      failureCount: 0,
      failures: [],
    });

    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'default',
        metrics: createMetrics({
          planCount: 1,
          meanBranchCount: 1,
          singleBranchPlanRatio: 1,
          multiSubtaskBranchRatio: 0,
        }),
      }).failures,
    ).toEqual([
      {
        code: 'default-branch-decomposition-missing',
        message: 'default planner must retain branch decomposition',
        evidence: { actual: 1, minimum: 2 },
      },
      {
        code: 'default-objective-decomposition-missing',
        message: 'default planner must retain branch-internal objective decomposition',
        evidence: { actual: 0, minimumExclusive: 0 },
      },
    ]);
  });

  test('passes without-branch only when every plan is a single branch', () => {
    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'without-branch',
        metrics: createMetrics({
          planCount: 1,
          meanBranchCount: 1,
          singleBranchPlanRatio: 1,
          multiSubtaskBranchRatio: 0,
        }),
      }),
    ).toMatchObject({
      variant: 'without-branch',
      status: 'pass',
      failureCount: 0,
    });

    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'without-branch',
        metrics: createMetrics({
          planCount: 1,
          meanBranchCount: 2,
          singleBranchPlanRatio: 0,
          multiSubtaskBranchRatio: 0.5,
        }),
      }).failures,
    ).toContainEqual({
      code: 'without-branch-retains-branch-decomposition',
      message: 'without-branch planner must restrict every plan to a single branch',
      evidence: { actual: 0, expected: 1 },
    });
  });

  test('passes without-objective-decomposition only when branches remain but branch-internal decomposition is removed', () => {
    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'without-objective-decomposition',
        metrics: createMetrics({
          planCount: 1,
          meanBranchCount: 3,
          singleBranchPlanRatio: 0,
          multiSubtaskBranchRatio: 0,
        }),
      }),
    ).toMatchObject({
      variant: 'without-objective-decomposition',
      status: 'pass',
      failureCount: 0,
    });

    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'without-objective-decomposition',
        metrics: createMetrics({
          planCount: 1,
          meanBranchCount: 3,
          singleBranchPlanRatio: 0,
          multiSubtaskBranchRatio: 0.25,
        }),
      }).failures,
    ).toContainEqual({
      code: 'without-objective-decomposition-retains-objective-decomposition',
      message:
        'without-objective-decomposition planner must remove branch-internal objective decomposition',
      evidence: { actual: 0.25, expected: 0 },
    });
  });

  test('fails any known ablation variant without durable branch plan metrics', () => {
    expect(
      evaluateLocalRuntimeTownPlannerAblationStructureGate({
        variant: 'default',
        metrics: [],
      }),
    ).toEqual({
      variant: 'default',
      status: 'fail',
      failureCount: 3,
      failures: [
        {
          code: 'planner-plan-count-too-low',
          message: 'planner ablation variant must have at least one durable branch plan',
          evidence: { actual: 0, minimum: 1 },
        },
        {
          code: 'default-branch-decomposition-missing',
          message: 'default planner must retain branch decomposition',
          evidence: { actual: 0, minimum: 2 },
        },
        {
          code: 'default-objective-decomposition-missing',
          message: 'default planner must retain branch-internal objective decomposition',
          evidence: { actual: 0, minimumExclusive: 0 },
        },
      ],
    });
  });
});

function createMetrics(input: {
  readonly planCount: number;
  readonly meanBranchCount: number;
  readonly singleBranchPlanRatio: number;
  readonly multiSubtaskBranchRatio: number;
}) {
  return [
    { metricId: 'planner-plan-count', value: input.planCount, higherIsBetter: true },
    {
      metricId: 'planner-mean-branch-count',
      value: input.meanBranchCount,
      higherIsBetter: true,
    },
    {
      metricId: 'planner-single-branch-plan-ratio',
      value: input.singleBranchPlanRatio,
      higherIsBetter: false,
    },
    {
      metricId: 'planner-multi-subtask-branch-ratio',
      value: input.multiSubtaskBranchRatio,
      higherIsBetter: true,
    },
  ];
}
