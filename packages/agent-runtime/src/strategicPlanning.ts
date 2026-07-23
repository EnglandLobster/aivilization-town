import type {
  LongHorizonObjective,
  LongTermAgentProfile,
  LongTermProfileEntry,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type {
  LlmLongTermProfileContextTrace,
  LlmShortTermMemoryContextTrace,
} from './llmContextTrace';
import {
  createBranchPlan,
  type BranchPlan,
  type PlannerBranch,
  type PlannerSubtask,
} from './planner';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

export type StrategicPlanCompilerInput = {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContext;
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
  readonly plannerVariant?: PaperPlannerVariant;
  readonly ablationPolicyVersion?: typeof PAPER_PLANNER_ABLATION_POLICY_VERSION;
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly StrategicPlanCompilationAttemptTrace[];
  readonly usage?: StrategicPlanCompilationUsage;
  readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
  readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
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

export const PAPER_PLANNER_ABLATION_POLICY_VERSION = 'paper-planner-ablation-v1';
export const DETERMINISTIC_STRATEGIC_PLANNING_POLICY_VERSION =
  'deterministic-strategic-planning-v3';

export function createDeterministicStrategicPlanningPolicyManifest() {
  return {
    policyVersion: DETERMINISTIC_STRATEGIC_PLANNING_POLICY_VERSION,
    source: 'repository-design' as const,
    domainSelection:
      'explicit-planning-domains-or-affinity-alias-or-unambiguous-objective-and-profile-keyword' as const,
    explicitPlanningDomainPrecedence: 'authoritative-when-present' as const,
    ambiguousTokensExcludedFromResidentialInference: ['tier'],
    completionBoundary:
      'autonomous-single-domain-objectives-must-not-gain-unrelated-selectable-branches' as const,
  };
}

export type PaperPlannerVariant = 'default' | 'without-branch' | 'without-objective-decomposition';

const PAPER_PLANNER_VARIANTS = new Set<PaperPlannerVariant>([
  'default',
  'without-branch',
  'without-objective-decomposition',
]);

export function assertPaperPlannerVariant(value: string): asserts value is PaperPlannerVariant {
  if (!PAPER_PLANNER_VARIANTS.has(value as PaperPlannerVariant)) {
    throw new Error(`unsupported paper planner variant ${value}`);
  }
}

export function createPaperPlannerAblationPolicyManifest(
  activeVariant: PaperPlannerVariant = 'default',
) {
  assertPaperPlannerVariant(activeVariant);
  return {
    policyVersion: PAPER_PLANNER_ABLATION_POLICY_VERSION,
    activeVariant,
    controlledBaseCompilerRule:
      'apply-structural-ablation-after-the-same-configured-strategic-compiler',
    variants: {
      default: {
        branchDecomposition: 'parallel-reasoning-branches',
        objectiveDecomposition: 'structured-objectives-and-subtasks',
      },
      'without-branch': {
        branchDecomposition: 'removed-single-reasoning-branch',
        objectiveDecomposition: 'preserved-structured-subtasks',
        transform: 'merge-all-source-branch-subtasks-into-one-branch',
      },
      'without-objective-decomposition': {
        branchDecomposition: 'preserved-parallel-reasoning-branches',
        objectiveDecomposition: 'removed-direct-action-generation',
        transform: 'one-direct-action-subtask-per-source-branch',
      },
    },
    heldConstant: [
      'scenario-and-agent-cohort',
      'seed-and-time-scaling',
      'base-llm-or-deterministic-compiler',
      'memory-and-context-inputs',
      'action-simulation-and-replanning',
      'world-policies-and-economic-rules',
    ],
    verificationInvariants: {
      default: 'at-least-one-valid-branch',
      'without-branch': 'exactly-one-branch-with-all-source-subtasks',
      'without-objective-decomposition':
        'source-branch-count-preserved-and-each-branch-has-one-direct-action-subtask',
    },
  } as const;
}

export function createPaperPlannerVariantCompiler(input: {
  readonly variant: PaperPlannerVariant;
  readonly baseCompiler?: StrategicPlanCompiler;
}): StrategicPlanCompiler {
  assertPaperPlannerVariant(input.variant);
  const baseCompiler = input.baseCompiler ?? compileStrategicObjectiveToBranchPlan;
  if (input.variant === 'default') {
    return baseCompiler;
  }
  const ablationVariant: Exclude<PaperPlannerVariant, 'default'> = input.variant;

  return async (compilerInput) => {
    const base = normalizeStrategicPlanCompilerOutput(await baseCompiler(compilerInput));
    const plan =
      ablationVariant === 'without-branch'
        ? transformBranchPlanWithoutBranch(base.plan)
        : transformBranchPlanWithoutObjectiveDecomposition(base.plan);
    return {
      plan,
      planningTrace: createAblationPlanningTrace({
        variant: ablationVariant,
        ...(base.planningTrace === undefined ? {} : { baseTrace: base.planningTrace }),
      }),
    };
  };
}

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
  const context = createPlanningContext({
    objectiveText,
    tags,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
  });
  const branches = selectStrategicDomainRules({
    ...(input.objective.planningDomains === undefined
      ? {}
      : { planningDomains: input.objective.planningDomains }),
    context,
  }).map((rule) =>
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

export function compileStrategicObjectiveWithoutObjectiveDecomposition(
  input: StrategicPlanCompilerInput,
): StrategicPlanCompilationResult {
  const plan = compileStrategicObjectiveToBranchPlan(input);

  return {
    plan: transformBranchPlanWithoutObjectiveDecomposition(plan),
    planningTrace: createAblationPlanningTrace({
      variant: 'without-objective-decomposition',
    }),
  };
}

export function compileStrategicObjectiveWithoutBranch(
  input: StrategicPlanCompilerInput,
): StrategicPlanCompilationResult {
  return {
    plan: transformBranchPlanWithoutBranch(compileStrategicObjectiveToBranchPlan(input)),
    planningTrace: createAblationPlanningTrace({ variant: 'without-branch' }),
  };
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

const PROFILE_PLANNING_CONTEXT_MIN_CONFIDENCE = 0.7;

function transformBranchPlanWithoutBranch(plan: BranchPlan): BranchPlan {
  return createBranchPlan({
    objective: plan.objective,
    branches: [
      {
        id: 'without-branch',
        objective: `Single reasoning branch for: ${plan.objective}`,
        subtasks: plan.branches.flatMap((branch) => branch.subtasks),
      },
    ],
  });
}

function transformBranchPlanWithoutObjectiveDecomposition(plan: BranchPlan): BranchPlan {
  return createBranchPlan({
    objective: plan.objective,
    branches: plan.branches.map(createDirectActionBranchWithoutObjectiveDecomposition),
  });
}

function createAblationPlanningTrace(input: {
  readonly variant: Exclude<PaperPlannerVariant, 'default'>;
  readonly baseTrace?: StrategicPlanCompilationTrace;
}): StrategicPlanCompilationTrace {
  return {
    ...(input.baseTrace ?? {
      status: 'deterministic' as const,
      source: 'deterministic' as const,
    }),
    plannerVariant: input.variant,
    ablationPolicyVersion: PAPER_PLANNER_ABLATION_POLICY_VERSION,
    message:
      input.variant === 'without-branch'
        ? 'Planner ablation without branch decomposition'
        : 'Planner ablation without objective decomposition',
  };
}

function createDirectActionBranchWithoutObjectiveDecomposition(
  branch: PlannerBranch,
): PlannerBranch {
  const domain = resolveBranchDomainToken(branch);
  const subtask = createDirectActionSubtaskWithoutObjectiveDecomposition({ branch, domain });

  return {
    id: `without-objective-decomposition-${branch.id}`,
    objective: `Generate direct ${domain} actions without structured objective decomposition.`,
    subtasks: [subtask],
  };
}

function createDirectActionSubtaskWithoutObjectiveDecomposition(input: {
  readonly branch: PlannerBranch;
  readonly domain: string;
}): PlannerSubtask {
  return {
    id: `${input.domain}-direct-action`,
    description: `Directly generate ${input.domain} actions without structured objective decomposition: ${summarizeDirectActionSource(input.branch)}`,
    basePriority: Math.max(...input.branch.subtasks.map((subtask) => subtask.basePriority)),
    ...optionalSubtaskTags(
      'signalKeys',
      sortedUnique(input.branch.subtasks.flatMap((subtask) => subtask.signalKeys ?? [])),
    ),
    ...optionalSubtaskTags(
      'intentionAffinityTags',
      stableUnique(input.branch.subtasks.flatMap((subtask) => subtask.intentionAffinityTags ?? [])),
    ),
    ...optionalSubtaskTags(
      'memoryAffinityTags',
      stableUnique(input.branch.subtasks.flatMap((subtask) => subtask.memoryAffinityTags ?? [])),
    ),
    ...optionalSubtaskTags(
      'profileAffinityTags',
      stableUnique(input.branch.subtasks.flatMap((subtask) => subtask.profileAffinityTags ?? [])),
    ),
  };
}

function optionalSubtaskTags<
  TKey extends keyof Pick<
    PlannerSubtask,
    'signalKeys' | 'intentionAffinityTags' | 'memoryAffinityTags' | 'profileAffinityTags'
  >,
>(key: TKey, values: readonly string[]): Pick<PlannerSubtask, TKey> | Record<string, never> {
  return values.length === 0 ? {} : ({ [key]: values } as Pick<PlannerSubtask, TKey>);
}

function summarizeDirectActionSource(branch: PlannerBranch): string {
  if (branch.subtasks.length === 1) {
    return branch.subtasks[0]?.description ?? branch.objective;
  }
  return branch.objective;
}

function resolveBranchDomainToken(branch: PlannerBranch): string {
  const matchingRule = STRATEGIC_DOMAIN_RULES.find((rule) => rule.branchId === branch.id);
  if (matchingRule !== undefined) {
    return matchingRule.domain;
  }

  const tokens = new Set<string>();
  addDomainCandidateTokens(branch.id, tokens);
  addDomainCandidateTokens(branch.objective, tokens);
  for (const subtask of branch.subtasks) {
    addDomainCandidateTokens(subtask.id, tokens);
    addDomainCandidateTokens(subtask.description, tokens);
    for (const tag of [
      ...(subtask.signalKeys ?? []),
      ...(subtask.intentionAffinityTags ?? []),
      ...(subtask.memoryAffinityTags ?? []),
      ...(subtask.profileAffinityTags ?? []),
    ]) {
      addDomainCandidateTokens(tag, tokens);
    }
  }

  return STRATEGIC_DOMAIN_RULES.find((rule) => tokens.has(rule.domain))?.domain ?? 'objective';
}

function addDomainCandidateTokens(text: string, tokens: Set<string>): void {
  for (const token of tokenizeText(text)) {
    tokens.add(token);
  }
}

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
    keywords: ['residential', 'housing', 'home', 'house', 'upgrade'],
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
  readonly longTermProfile?: LongTermAgentProfile;
}): PlanningTextContext {
  const text = [
    input.objectiveText.toLowerCase(),
    input.tags.join(' '),
    createProfilePlanningText(input.longTermProfile),
  ].join(' ');
  return {
    text,
    tokens: new Set(tokenizeText(text)),
    tags: new Set(input.tags),
  };
}

function createProfilePlanningText(profile: LongTermAgentProfile | undefined): string {
  if (profile === undefined) {
    return '';
  }

  return selectProfilePlanningEntries(profile)
    .map((entry) => `${entry.key} ${entry.statement}`.toLowerCase())
    .join(' ');
}

function selectProfilePlanningEntries(
  profile: LongTermAgentProfile,
): readonly LongTermProfileEntry[] {
  return [...profile.values, ...profile.habits]
    .filter((entry) => entry.confidence >= PROFILE_PLANNING_CONTEXT_MIN_CONFIDENCE)
    .sort(compareProfileEntries);
}

function compareProfileEntries(left: LongTermProfileEntry, right: LongTermProfileEntry): number {
  if (left.updatedAt !== right.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }
  return left.key.localeCompare(right.key);
}

function ruleMatchesContext(rule: StrategicDomainRule, context: PlanningTextContext): boolean {
  if (rule.affinityAliases.some((alias) => context.tags.has(alias))) {
    return true;
  }

  return rule.keywords.some((keyword) => keywordMatchesContext(keyword, context));
}

function selectStrategicDomainRules(input: {
  readonly planningDomains?: readonly string[];
  readonly context: PlanningTextContext;
}): readonly StrategicDomainRule[] {
  if (input.planningDomains !== undefined && input.planningDomains.length > 0) {
    const planningDomains = new Set(input.planningDomains);
    return STRATEGIC_DOMAIN_RULES.filter((rule) => planningDomains.has(rule.domain));
  }
  return STRATEGIC_DOMAIN_RULES.filter((rule) => ruleMatchesContext(rule, input.context));
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
