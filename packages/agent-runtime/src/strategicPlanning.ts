import type { LongHorizonObjective } from '@aivilization/memory';
import { createBranchPlan, type BranchPlan, type PlannerBranch } from './planner';

export type StrategicPlanCompilerInput = {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
};

export type StrategicPlanCompiler = (
  input: StrategicPlanCompilerInput,
) => BranchPlan | Promise<BranchPlan>;

export function compileStrategicObjectiveToBranchPlan(
  input: StrategicPlanCompilerInput,
): BranchPlan {
  assertFiniteNumber(input.issuedAt, 'issuedAt');
  const objectiveText = input.objective.statement;
  const tags = normalizeTags(input.objective.affinityTags);
  const context = `${objectiveText.toLowerCase()} ${tags.join(' ')}`;
  const branches: PlannerBranch[] = [];

  if (containsAny(context, ['study', 'education', 'learn', 'school'])) {
    branches.push({
      id: 'development',
      objective: 'Invest in education before short-term labor pressure dominates.',
      subtasks: [
        {
          id: 'study',
          description: 'Study toward the long-horizon objective.',
          basePriority: 10 + input.objective.priority,
          intentionAffinityTags: tags,
          memoryAffinityTags: tags,
          profileAffinityTags: tags,
        },
      ],
    });
  }

  if (containsAny(context, ['health', 'satiety', 'energy', 'maintain', 'maintenance'])) {
    branches.push({
      id: 'wellbeing',
      objective: 'Preserve physiological stability while pursuing the objective.',
      subtasks: [
        {
          id: 'maintain-physiology',
          description: 'Maintain energy, satiety, and health before over-committing.',
          basePriority: 8 + input.objective.priority,
          intentionAffinityTags: tags,
          memoryAffinityTags: tags,
          profileAffinityTags: tags,
        },
      ],
    });
  }

  branches.push({
    id: 'primary-objective',
    objective: objectiveText,
    subtasks: [
      {
        id: 'pursue-objective',
        description: `Pursue: ${objectiveText}`,
        basePriority: 8 + input.objective.priority,
        intentionAffinityTags: tags,
        memoryAffinityTags: tags,
        profileAffinityTags: tags,
      },
    ],
  });

  return createBranchPlan({
    objective: objectiveText,
    branches,
  });
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
