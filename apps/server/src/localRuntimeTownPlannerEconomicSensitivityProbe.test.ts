import type { SubtaskPrioritizer, SubtaskPrioritizerInput } from '@aivilization/agent-runtime';
import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownPlannerEconomicSensitivityProbeResults } from './localRuntimeTownPlannerEconomicSensitivityProbe';

describe('local runtime town planner economic sensitivity probe', () => {
  test('runs a standard matrix across price, inventory, occupation, and production context', async () => {
    const prioritizerInputs: SubtaskPrioritizerInput[] = [];
    const results = await createLocalRuntimeTownPlannerEconomicSensitivityProbeResults({
      profileId: 'smoke-25',
      variant: 'default',
      issuedAt: 700,
      subtaskPrioritizer: createMatrixAwarePrioritizer(prioritizerInputs),
    });

    expect(results.map((result) => result.scenarioId)).toEqual([
      'fish-price-affordability',
      'inventory-food-buffer',
      'occupation-eligibility-gate',
      'production-input-readiness',
    ]);
    expect(
      results.map((result) => ({
        status: result.status,
        selectionChanged: result.selectionChanged,
        completeEconomicContext: result.completeEconomicContext,
      })),
    ).toEqual([
      { status: 'sensitive', selectionChanged: true, completeEconomicContext: true },
      { status: 'sensitive', selectionChanged: true, completeEconomicContext: true },
      { status: 'sensitive', selectionChanged: true, completeEconomicContext: true },
      { status: 'sensitive', selectionChanged: true, completeEconomicContext: true },
    ]);
    expect(results.map((result) => result.baseline.selected.subtaskId)).toEqual([
      'buy-food',
      'buy-food',
      'study',
      'gather-inputs',
    ]);
    expect(results.map((result) => result.comparison.selected.subtaskId)).toEqual([
      'work',
      'consume-inventory-food',
      'apply-occupation',
      'craft-chip',
    ]);
    expect(prioritizerInputs).toHaveLength(8);
    expect(results[1]?.comparison.worldDecisionContext?.inventoryItemCount).toBe(1);
    expect(results[2]?.baseline.worldDecisionContext?.eligibleOccupationRuleCount).toBe(0);
    expect(results[2]?.comparison.worldDecisionContext?.eligibleOccupationRuleCount).toBe(1);
    expect(results[3]?.baseline.worldDecisionContext?.producibleCommodityRuleCount).toBe(0);
    expect(results[3]?.comparison.worldDecisionContext?.producibleCommodityRuleCount).toBe(1);
  });
});

function createMatrixAwarePrioritizer(calls: SubtaskPrioritizerInput[]): SubtaskPrioritizer {
  return (input) => {
    calls.push(input);
    return {
      candidates: rankCandidates(input, choosePreferredSubtaskId(input)),
      trace: { status: 'accepted', source: 'llm' },
    };
  };
}

function choosePreferredSubtaskId(input: SubtaskPrioritizerInput): string {
  const subtaskIds = new Set(input.candidates.map((candidate) => candidate.subtaskId));
  const world = input.worldDecisionContext;
  if (world === undefined) {
    throw new Error('matrix probe prioritizer requires worldDecisionContext');
  }

  if (subtaskIds.has('consume-inventory-food')) {
    return (world.agent.inventory.Fish ?? 0) > 0 ? 'consume-inventory-food' : 'buy-food';
  }
  if (subtaskIds.has('apply-occupation')) {
    return world.rules?.occupations.some((occupation) => occupation.eligible) === true
      ? 'apply-occupation'
      : 'study';
  }
  if (subtaskIds.has('craft-chip')) {
    return world.rules?.production.some(
      (production) => production.commodity === 'Chip' && production.producible,
    ) === true
      ? 'craft-chip'
      : 'gather-inputs';
  }

  const fishSpotPrice =
    world.market.spotPrices.find((price) => price.commodity === 'Fish')?.spotPrice ??
    Number.POSITIVE_INFINITY;
  return fishSpotPrice <= world.agent.balance * 0.5 ? 'buy-food' : 'work';
}

function rankCandidates(
  input: SubtaskPrioritizerInput,
  preferredSubtaskId: string,
): SubtaskPrioritizerInput['candidates'] {
  const preferred = input.candidates.find((candidate) => candidate.subtaskId === preferredSubtaskId);
  if (preferred === undefined) {
    throw new Error(`missing preferred probe candidate ${preferredSubtaskId}`);
  }
  return [preferred, ...input.candidates.filter((candidate) => candidate !== preferred)];
}
