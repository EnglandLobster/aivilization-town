import type { PrioritizedSubtaskCandidate } from './planner';
import type {
  SubtaskPrioritizationTrace,
  SubtaskPrioritizer,
  SubtaskPrioritizerInput,
} from './subtaskPrioritization';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContextTrace,
} from './worldDecisionContext';

export type SubtaskPrioritizationSensitivityStatus = 'sensitive' | 'insensitive';

export type SubtaskPrioritizationSensitivitySelection = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly score: number;
};

export type SubtaskPrioritizationSensitivityObservation = {
  readonly selected: SubtaskPrioritizationSensitivitySelection;
  readonly trace: SubtaskPrioritizationTrace;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type SubtaskPrioritizationSensitivityProbeResult = {
  readonly scenarioId: string;
  readonly status: SubtaskPrioritizationSensitivityStatus;
  readonly selectionChanged: boolean;
  readonly completeEconomicContext: boolean;
  readonly baseline: SubtaskPrioritizationSensitivityObservation;
  readonly comparison: SubtaskPrioritizationSensitivityObservation;
};

export async function runSubtaskPrioritizationSensitivityProbe(input: {
  readonly scenarioId: string;
  readonly prioritizer: SubtaskPrioritizer;
  readonly baseline: SubtaskPrioritizerInput;
  readonly comparison: SubtaskPrioritizerInput;
}): Promise<SubtaskPrioritizationSensitivityProbeResult> {
  assertNonEmpty(input.scenarioId, 'scenarioId');
  const baseline = await runProbeObservation({
    prioritizer: input.prioritizer,
    input: input.baseline,
    label: 'baseline',
  });
  const comparison = await runProbeObservation({
    prioritizer: input.prioritizer,
    input: input.comparison,
    label: 'comparison',
  });
  const selectionChanged =
    baseline.selected.branchId !== comparison.selected.branchId ||
    baseline.selected.subtaskId !== comparison.selected.subtaskId;

  return {
    scenarioId: input.scenarioId,
    status: selectionChanged ? 'sensitive' : 'insensitive',
    selectionChanged,
    completeEconomicContext:
      baseline.worldDecisionContext?.completeEconomicContext === true &&
      comparison.worldDecisionContext?.completeEconomicContext === true,
    baseline,
    comparison,
  };
}

async function runProbeObservation(input: {
  readonly prioritizer: SubtaskPrioritizer;
  readonly input: SubtaskPrioritizerInput;
  readonly label: string;
}): Promise<SubtaskPrioritizationSensitivityObservation> {
  const result = await input.prioritizer(input.input);
  const selected = result.candidates[0];
  if (selected === undefined) {
    throw new Error(`${input.label} prioritization produced no candidates`);
  }

  return {
    selected: summarizeSelection(selected),
    trace: result.trace,
    ...(input.input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: createWorldDecisionContextTrace(input.input.worldDecisionContext) }),
  };
}

function summarizeSelection(
  candidate: PrioritizedSubtaskCandidate,
): SubtaskPrioritizationSensitivitySelection {
  return {
    branchId: candidate.branchId,
    subtaskId: candidate.subtaskId,
    score: candidate.score,
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
