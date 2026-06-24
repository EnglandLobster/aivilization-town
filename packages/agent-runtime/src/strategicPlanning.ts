import type { LongHorizonObjective } from '@aivilization/memory';
import { createBranchPlan, type BranchPlan, type PlannerBranch } from './planner';

export type StrategicPlanCompilerInput = {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
};

export type StrategicPlanCompilationUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type StrategicPlanCompilationAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: StrategicPlanCompilationUsage;
};

export type StrategicPlanCompilationTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly StrategicPlanCompilationAttemptTrace[];
  readonly usage?: StrategicPlanCompilationUsage;
};

export type StrategicPlanCompilationResult = {
  readonly plan: BranchPlan;
  readonly planningTrace: StrategicPlanCompilationTrace;
};

export type StrategicPlanCompilerOutput = BranchPlan | StrategicPlanCompilationResult;

export type StrategicPlanCompiler = (
  input: StrategicPlanCompilerInput,
) => StrategicPlanCompilerOutput | Promise<StrategicPlanCompilerOutput>;

export type NormalizedStrategicPlanCompilation = {
  readonly plan: BranchPlan;
  readonly planningTrace?: StrategicPlanCompilationTrace;
};

export function normalizeStrategicPlanCompilerOutput(
  output: StrategicPlanCompilerOutput,
): NormalizedStrategicPlanCompilation {
  if (isStrategicPlanCompilationResult(output)) {
    return {
      plan: output.plan,
      planningTrace: output.planningTrace,
    };
  }

  return { plan: output };
}

export function compileStrategicObjectiveToBranchPlan(
  input: StrategicPlanCompilerInput,
): BranchPlan {
  assertFiniteNumber(input.issuedAt, 'issuedAt');
  const objectiveText = input.objective.statement;
  const tags = normalizeTags(input.objective.affinityTags);
  const context = createPlanningContext({ objectiveText, tags });
  const branches = STRATEGIC_DOMAIN_RULES.filter((rule) => ruleMatchesContext(rule, context)).map(
    (rule) =>
      createDomainBranch({
        rule,
        objectiveText,
        objectivePriority: input.objective.priority,
        tags,
      }),
  );

  if (branches.length === 0) {
    branches.push(
      createPrimaryObjectiveFallback({
        objectiveText,
        objectivePriority: input.objective.priority,
        tags,
      }),
    );
  }

  return createBranchPlan({
    objective: objectiveText,
    branches,
  });
}

type StrategicDomainName =
  | 'study'
  | 'residential'
  | 'health'
  | 'eat'
  | 'work'
  | 'production'
  | 'trade'
  | 'sleep'
  | 'social';

type StrategicDomainRule = {
  readonly domain: StrategicDomainName;
  readonly branchId: string;
  readonly subtaskId: string;
  readonly branchObjective: string;
  readonly subtaskDescription: (objectiveText: string) => string;
  readonly priorityOffset: number;
  readonly affinityAliases: readonly string[];
  readonly keywords: readonly string[];
};

type PlanningTextContext = {
  readonly text: string;
  readonly tokens: ReadonlySet<string>;
  readonly tags: ReadonlySet<string>;
};

const STRATEGIC_DOMAIN_RULES: readonly StrategicDomainRule[] = [
  {
    domain: 'study',
    branchId: 'development',
    subtaskId: 'study',
    branchObjective: 'Invest in education before short-term labor pressure dominates.',
    subtaskDescription: () => 'Study toward the long-horizon objective.',
    priorityOffset: 10,
    affinityAliases: ['study', 'education', 'learn', 'school'],
    keywords: ['study', 'education', 'learn', 'school'],
  },
  {
    domain: 'residential',
    branchId: 'residential-readiness',
    subtaskId: 'upgrade-residential-tier',
    branchObjective: 'Reach residential readiness for the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Upgrade residential tier toward: ${objectiveText}`,
    priorityOffset: 11,
    affinityAliases: ['residential', 'housing', 'home'],
    keywords: ['residential', 'housing', 'home', 'house', 'tier', 'upgrade'],
  },
  {
    domain: 'health',
    branchId: 'health',
    subtaskId: 'see-doctor',
    branchObjective: 'Recover health before pursuing the long-horizon objective.',
    subtaskDescription: (objectiveText) => `See doctor toward: ${objectiveText}`,
    priorityOffset: 11,
    affinityAliases: ['health', 'doctor', 'hospital', 'medical'],
    keywords: [
      'doctor',
      'health',
      'healthy',
      'hospital',
      'ill',
      'illness',
      'medical',
      'recover health',
      'see doctor',
      'sick',
    ],
  },
  {
    domain: 'eat',
    branchId: 'satiety',
    subtaskId: 'eat',
    branchObjective: 'Recover satiety before pursuing the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Eat toward: ${objectiveText}`,
    priorityOffset: 9,
    affinityAliases: ['eat', 'satiety', 'food', 'hunger', 'hungry'],
    keywords: ['eat', 'food', 'hunger', 'hungry', 'meal', 'satiety'],
  },
  {
    domain: 'work',
    branchId: 'employment',
    subtaskId: 'apply-for-work',
    branchObjective: 'Secure work capability for the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Apply for work toward: ${objectiveText}`,
    priorityOffset: 10,
    affinityAliases: ['work', 'job', 'career', 'income', 'employment'],
    keywords: [
      'apply',
      'career',
      'employ',
      'employment',
      'earn',
      'income',
      'job',
      'occupation',
      'work as',
      'find work',
    ],
  },
  {
    domain: 'production',
    branchId: 'production',
    subtaskId: 'produce-target',
    branchObjective: 'Produce resources required by the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Produce toward: ${objectiveText}`,
    priorityOffset: 9,
    affinityAliases: ['production', 'produce', 'craft', 'manufacturing'],
    keywords: [
      'bake',
      'build',
      'cook',
      'craft',
      'farm',
      'grow',
      'make',
      'manufacture',
      'produce',
      'production',
    ],
  },
  {
    domain: 'trade',
    branchId: 'market',
    subtaskId: 'trade-for-resources',
    branchObjective: 'Use the market to support the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Trade toward: ${objectiveText}`,
    priorityOffset: 8,
    affinityAliases: ['trade', 'market', 'buy', 'sell'],
    keywords: ['buy', 'purchase', 'sell', 'shop', 'trade'],
  },
  {
    domain: 'sleep',
    branchId: 'rest',
    subtaskId: 'sleep',
    branchObjective: 'Restore energy before pursuing the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Sleep toward: ${objectiveText}`,
    priorityOffset: 8,
    affinityAliases: ['sleep', 'rest', 'energy'],
    keywords: ['energy', 'fatigue', 'rest', 'sleep', 'tired'],
  },
  {
    domain: 'social',
    branchId: 'social',
    subtaskId: 'socialize',
    branchObjective: 'Build relationships that support the long-horizon objective.',
    subtaskDescription: (objectiveText) => `Socialize toward: ${objectiveText}`,
    priorityOffset: 8,
    affinityAliases: ['social', 'community', 'friend', 'relationship'],
    keywords: ['community', 'friend', 'relationship', 'social', 'socialize'],
  },
];

function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))];
}

function createPlanningContext(input: {
  readonly objectiveText: string;
  readonly tags: readonly string[];
}): PlanningTextContext {
  const text = `${input.objectiveText.toLowerCase()} ${input.tags.join(' ')}`;
  return {
    text,
    tokens: new Set(tokenizeText(text)),
    tags: new Set(input.tags),
  };
}

function ruleMatchesContext(rule: StrategicDomainRule, context: PlanningTextContext): boolean {
  if (rule.affinityAliases.some((alias) => context.tags.has(alias))) {
    return true;
  }

  return rule.keywords.some((keyword) => keywordMatchesContext(keyword, context));
}

function keywordMatchesContext(keyword: string, context: PlanningTextContext): boolean {
  const normalized = keyword.toLowerCase();
  if (normalized.includes(' ')) {
    return context.text.includes(normalized);
  }
  return context.tokens.has(normalized);
}

function createDomainBranch(input: {
  readonly rule: StrategicDomainRule;
  readonly objectiveText: string;
  readonly objectivePriority: number;
  readonly tags: readonly string[];
}): PlannerBranch {
  const affinityTags = createDomainAffinityTags({
    domain: input.rule.domain,
    aliases: input.rule.affinityAliases,
    tags: input.tags,
  });

  return {
    id: input.rule.branchId,
    objective: input.rule.branchObjective,
    subtasks: [
      {
        id: input.rule.subtaskId,
        description: input.rule.subtaskDescription(input.objectiveText),
        basePriority: input.rule.priorityOffset + input.objectivePriority,
        signalKeys: sortedUnique([...input.tags, input.rule.domain]),
        intentionAffinityTags: affinityTags,
        memoryAffinityTags: affinityTags,
        profileAffinityTags: affinityTags,
      },
    ],
  };
}

function createDomainAffinityTags(input: {
  readonly domain: StrategicDomainName;
  readonly aliases: readonly string[];
  readonly tags: readonly string[];
}): readonly string[] {
  const aliasSet = new Set(input.aliases);
  return stableUnique([
    input.domain,
    ...input.tags.filter((tag) => tag !== input.domain && aliasSet.has(tag)),
  ]);
}

function createPrimaryObjectiveFallback(input: {
  readonly objectiveText: string;
  readonly objectivePriority: number;
  readonly tags: readonly string[];
}): PlannerBranch {
  return {
    id: 'primary-objective',
    objective: input.objectiveText,
    subtasks: [
      {
        id: 'pursue-objective',
        description: `Pursue: ${input.objectiveText}`,
        basePriority: 8 + input.objectivePriority,
        signalKeys: sortedUnique(input.tags),
        intentionAffinityTags: input.tags,
        memoryAffinityTags: input.tags,
        profileAffinityTags: input.tags,
      },
    ],
  };
}

function tokenizeText(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function isStrategicPlanCompilationResult(
  value: StrategicPlanCompilerOutput,
): value is StrategicPlanCompilationResult {
  return 'plan' in value && 'planningTrace' in value;
}

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
