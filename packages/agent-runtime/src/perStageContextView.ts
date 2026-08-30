import {
  selectActiveScheduledIntentions,
  type AgentIntentionState,
  type ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import {
  WORLD_DECISION_CONTEXT_VIEW_VERSION,
  type WorldDecisionAgentContext,
  type WorldDecisionContext,
  type WorldDecisionContextTrace,
  type WorldDecisionEnterpriseContext,
  type WorldDecisionMarketContext,
  type WorldDecisionRulesContext,
  type WorldDecisionSocietyAgentContext,
  type WorldDecisionSocietyContext,
} from './worldDecisionContext';

export type PerStageContextViewStage =
  | 'subtask-prioritization'
  | 'action-sequence-generation'
  | 'global-synthesis'
  | 'social-dialogue'
  | 'reaction-evaluation'
  | 'reactive-correction'
  | 'replanning'
  | 'strategic-planning'
  | 'daily-planning';

export type PerStageContextSalienceKind =
  | 'survival'
  | 'obligation'
  | 'memory'
  | 'relationship'
  | 'opportunity';

export type PerStageContextSalienceEntry = {
  readonly kind: PerStageContextSalienceKind;
  readonly source:
    | 'critical-threshold'
    | 'scheduled-intention'
    | 'high-importance-memory'
    | 'eligible-rule';
  readonly sourceId: string;
  readonly summary: string;
};

type PerStageAgentContext = Pick<WorldDecisionAgentContext, 'agentId'> &
  Partial<Omit<WorldDecisionAgentContext, 'agentId'>>;

type PerStageSocietyContext = Pick<WorldDecisionSocietyContext, 'directoryId' | 'simulationId'> & {
  readonly agents: readonly WorldDecisionSocietyAgentContext[];
};

/**
 * The JSON-safe read model supplied to one LLM stage. It deliberately is not
 * assignable to the complete WorldDecisionContext: omitted sections are the
 * contract, not missing authoritative state. Domain decisions and deterministic
 * proposers continue to consume the complete context.
 */
export type PerStageContextView = {
  readonly contextViewVersion: typeof WORLD_DECISION_CONTEXT_VIEW_VERSION;
  readonly stage: PerStageContextViewStage;
  readonly salience: readonly PerStageContextSalienceEntry[];
  readonly agent: PerStageAgentContext;
  readonly market?: WorldDecisionMarketContext;
  readonly townPulse?: WorldDecisionContext['townPulse'];
  readonly society?: PerStageSocietyContext;
  readonly weather?: WorldDecisionContext['weather'];
  readonly calendar?: WorldDecisionContext['calendar'];
  readonly petitions?: WorldDecisionContext['petitions'];
  readonly conditions?: WorldDecisionContext['conditions'];
  readonly fiscal?: WorldDecisionContext['fiscal'];
  readonly externalTrade?: WorldDecisionContext['externalTrade'];
  readonly enterprises?: readonly WorldDecisionEnterpriseContext[];
  readonly rules?: WorldDecisionRulesContext;
};

export const PER_STAGE_CONTEXT_SALIENCE_MAX_COUNT = 6;
export const PER_STAGE_CONTEXT_HIGH_IMPORTANCE_MEMORY_THRESHOLD = 0.8;
export const PER_STAGE_CONTEXT_SALIENCE_TEXT_MAX_LENGTH = 160;

export function createPerStageContextViewManifest() {
  return {
    contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
    stageVisibility: {
      ranking: {
        stages: ['subtask-prioritization', 'global-synthesis'],
        omittedSections: ['society', 'enterprises', 'rules'],
      },
      dialogue: {
        stages: ['social-dialogue'],
        visibleSections: ['salience', 'agent.identity-and-relations', 'society.counterpart'],
      },
      reaction: {
        stages: ['reaction-evaluation'],
        visibleSections: ['salience', 'agent', 'townPulse', 'conditions'],
      },
      actionable: {
        stages: [
          'action-sequence-generation',
          'reactive-correction',
          'replanning',
          'strategic-planning',
          'daily-planning',
        ],
        visibility: 'complete-capped-context',
      },
    },
    salience: {
      maxCount: PER_STAGE_CONTEXT_SALIENCE_MAX_COUNT,
      highImportanceMemoryThreshold: PER_STAGE_CONTEXT_HIGH_IMPORTANCE_MEMORY_THRESHOLD,
      textMaxLength: PER_STAGE_CONTEXT_SALIENCE_TEXT_MAX_LENGTH,
      priorityOrder: ['survival', 'obligation', 'memory', 'relationship', 'opportunity'],
      deterministicTieBreak: 'existing-source-priority-then-source-id',
      authoritativeSources: [
        'critical-thresholds',
        'active-scheduled-intentions',
        'short-term-memory-importance',
        'eligible-rules',
      ],
    },
  } as const;
}

export function createPerStageContextView(input: {
  readonly stage: PerStageContextViewStage;
  readonly context: WorldDecisionContext;
  readonly at: SimulationTimestamp;
  readonly intentionState?: AgentIntentionState;
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly targetAgentId?: AgentId;
}): PerStageContextView {
  const salience = createPerStageContextSalience(input);
  switch (input.stage) {
    case 'subtask-prioritization':
    case 'global-synthesis':
      return createRankingContextView(input, salience);
    case 'social-dialogue':
      return createDialogueContextView(input, salience);
    case 'reaction-evaluation':
      return createReactionContextView(input, salience);
    case 'action-sequence-generation':
    case 'reactive-correction':
    case 'replanning':
    case 'strategic-planning':
    case 'daily-planning':
      return createActionableContextView(input, salience);
  }
}

export function createPerStageContextViewTrace(
  view: PerStageContextView,
): WorldDecisionContextTrace {
  const agent = view.agent;
  const physiology = agent.physiology;
  const market = view.market;
  const rules = view.rules;
  const hasBalance = Number.isFinite(agent.balance);
  const hasInventory = agent.inventory !== undefined;
  const hasLatestPriceIndex = market?.latestPriceIndex !== undefined;
  const hasMarketPrices =
    market !== undefined &&
    market.spotPrices.length > 0 &&
    market.spotPrices.every(
      (price) => price.commodity.trim().length > 0 && Number.isFinite(price.spotPrice),
    );
  const localOwnerPartitionKey = view.society?.agents.find(
    (entry) => entry.agentId === agent.agentId,
  )?.ownerPartitionKey;

  return {
    agentId: agent.agentId,
    contextViewVersion: view.contextViewVersion,
    contextViewStage: view.stage,
    visibleContextSections: visibleContextSections(view),
    salienceCount: view.salience.length,
    salienceKinds: [...new Set(view.salience.map((entry) => entry.kind))],
    hasLocationId: agent.locationId !== undefined,
    ...(agent.displayName === undefined
      ? {}
      : { hasDisplayName: true, displayNameLength: agent.displayName.length }),
    ...(agent.relations === undefined ? {} : { relationCount: agent.relations.length }),
    ...(view.townPulse === undefined ? {} : { townPulseCount: view.townPulse.length }),
    hasPhysiology:
      physiology !== undefined &&
      Number.isFinite(physiology.energy) &&
      Number.isFinite(physiology.satiety) &&
      Number.isFinite(physiology.health),
    hasJob: agent.job !== undefined,
    hasBalance,
    hasEducationScore: Number.isFinite(agent.educationScore),
    hasResidentialTier: Number.isFinite(agent.residentialTier),
    hasInventory,
    inventoryItemCount: agent.inventory === undefined ? 0 : Object.keys(agent.inventory).length,
    ...(agent.durableGoods === undefined ? {} : { durableGoodCount: agent.durableGoods.length }),
    marketSpotPriceCount: market?.spotPrices.length ?? 0,
    hasLatestPriceIndex,
    hasEconomicState: hasBalance && hasInventory,
    hasMarketPrices,
    completeEconomicContext: hasBalance && hasInventory && hasMarketPrices && hasLatestPriceIndex,
    ...(view.society === undefined
      ? {}
      : {
          hasSocietyDirectory: true,
          societyPartitionCount: 0,
          societyAgentCount: view.society.agents.length,
          remoteSocietyAgentCount: view.society.agents.filter(
            (entry) => entry.ownerPartitionKey !== localOwnerPartitionKey,
          ).length,
        }),
    ...(view.weather === undefined
      ? {}
      : { hasWeather: true, weatherCurrent: view.weather.current }),
    ...(view.petitions === undefined ? {} : { petitionCount: view.petitions.length }),
    ...(view.calendar === undefined
      ? {}
      : {
          hasCalendar: true,
          calendarDayIndex: view.calendar.dayIndex,
          calendarPhase: view.calendar.phase,
          calendarNextPhase: view.calendar.nextPhase,
        }),
    ...(view.conditions === undefined
      ? {}
      : {
          conditionCount: view.conditions.length,
          conditionKinds: view.conditions.map((condition) => condition.kind),
        }),
    ...(view.enterprises === undefined
      ? {}
      : {
          enterpriseCount: view.enterprises.length,
          activeEnterpriseCount: view.enterprises.filter(
            (enterprise) => enterprise.status === 'active',
          ).length,
        }),
    occupationRuleCount: rules?.occupations.length ?? 0,
    eligibleOccupationRuleCount:
      rules?.occupations.filter((occupation) => occupation.eligible).length ?? 0,
    productionRuleCount: rules?.production.length ?? 0,
    producibleCommodityRuleCount:
      rules?.production.filter((production) => production.producible).length ?? 0,
    ...(rules?.consumption === undefined ? {} : { consumptionRuleCount: rules.consumption.length }),
    hasResidentialUpgradeRule: rules?.residentialUpgrade !== undefined,
    residentialUpgradeEligible: rules?.residentialUpgrade?.eligible ?? false,
    hasEducationOpportunityCost: rules?.educationOpportunityCost !== undefined,
    educationInvestmentDirectlyAffordable:
      rules?.educationOpportunityCost?.directlyAffordable ?? false,
    educationInvestmentPreservesMinimumBalanceReserve:
      rules?.educationOpportunityCost?.preservesMinimumBalanceReserve ?? false,
  };
}

function createRankingContextView(
  input: Parameters<typeof createPerStageContextView>[0],
  salience: readonly PerStageContextSalienceEntry[],
): PerStageContextView {
  const context = input.context;
  return {
    contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
    stage: input.stage,
    salience,
    agent: context.agent,
    market: context.market,
    ...(context.townPulse === undefined ? {} : { townPulse: context.townPulse }),
    ...(context.weather === undefined ? {} : { weather: context.weather }),
    ...(context.calendar === undefined ? {} : { calendar: context.calendar }),
    ...(context.petitions === undefined ? {} : { petitions: context.petitions }),
    ...(context.conditions === undefined ? {} : { conditions: context.conditions }),
    ...(context.fiscal === undefined ? {} : { fiscal: context.fiscal }),
    ...(context.externalTrade === undefined ? {} : { externalTrade: context.externalTrade }),
  };
}

function createDialogueContextView(
  input: Parameters<typeof createPerStageContextView>[0],
  salience: readonly PerStageContextSalienceEntry[],
): PerStageContextView {
  const context = input.context;
  const targetAgentId = input.targetAgentId;
  const target =
    targetAgentId === undefined
      ? undefined
      : context.society?.agents.find((entry) => entry.agentId === targetAgentId);
  return {
    contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
    stage: input.stage,
    salience: salience.filter(
      (entry) =>
        entry.kind === 'obligation' || entry.kind === 'memory' || entry.kind === 'relationship',
    ),
    agent: {
      agentId: context.agent.agentId,
      ...(context.agent.locationId === undefined ? {} : { locationId: context.agent.locationId }),
      ...(context.agent.displayName === undefined
        ? {}
        : { displayName: context.agent.displayName }),
      ...(context.agent.job === undefined ? {} : { job: context.agent.job }),
      ...(context.agent.lifecycle === undefined ? {} : { lifecycle: context.agent.lifecycle }),
      ...(context.agent.relations === undefined ? {} : { relations: context.agent.relations }),
    },
    ...(target === undefined || context.society === undefined
      ? {}
      : {
          society: {
            directoryId: context.society.directoryId,
            simulationId: context.society.simulationId,
            agents: [target],
          },
        }),
  };
}

function createReactionContextView(
  input: Parameters<typeof createPerStageContextView>[0],
  salience: readonly PerStageContextSalienceEntry[],
): PerStageContextView {
  const context = input.context;
  return {
    contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
    stage: input.stage,
    salience,
    agent: context.agent,
    ...(context.townPulse === undefined ? {} : { townPulse: context.townPulse }),
    ...(context.conditions === undefined ? {} : { conditions: context.conditions }),
  };
}

function createActionableContextView(
  input: Parameters<typeof createPerStageContextView>[0],
  salience: readonly PerStageContextSalienceEntry[],
): PerStageContextView {
  const context = input.context;
  return {
    contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
    stage: input.stage,
    salience,
    agent: context.agent,
    market: context.market,
    ...(context.townPulse === undefined ? {} : { townPulse: context.townPulse }),
    ...(context.society === undefined
      ? {}
      : {
          society: {
            directoryId: context.society.directoryId,
            simulationId: context.society.simulationId,
            agents: context.society.agents,
          },
        }),
    ...(context.weather === undefined ? {} : { weather: context.weather }),
    ...(context.calendar === undefined ? {} : { calendar: context.calendar }),
    ...(context.petitions === undefined ? {} : { petitions: context.petitions }),
    ...(context.conditions === undefined ? {} : { conditions: context.conditions }),
    ...(context.fiscal === undefined ? {} : { fiscal: context.fiscal }),
    ...(context.externalTrade === undefined ? {} : { externalTrade: context.externalTrade }),
    ...(context.enterprises === undefined ? {} : { enterprises: context.enterprises }),
    ...(context.rules === undefined ? {} : { rules: context.rules }),
  };
}

function createPerStageContextSalience(
  input: Parameters<typeof createPerStageContextView>[0],
): readonly PerStageContextSalienceEntry[] {
  const candidates: SalienceCandidate[] = [];
  appendSurvivalSalience(candidates, input.context);
  appendIntentionSalience(candidates, input.intentionState, input.at);
  appendMemorySalience(candidates, input.shortTermMemoryContext);
  appendOpportunitySalience(candidates, input.context.rules);
  return candidates
    .sort(compareSalienceCandidates)
    .slice(0, PER_STAGE_CONTEXT_SALIENCE_MAX_COUNT)
    .map((entry) => ({
      kind: entry.kind,
      source: entry.source,
      sourceId: entry.sourceId,
      summary: entry.summary,
    }));
}

type SalienceCandidate = PerStageContextSalienceEntry & {
  readonly rank: number;
  readonly sourcePriority: number;
};

function appendSurvivalSalience(target: SalienceCandidate[], context: WorldDecisionContext): void {
  const thresholds = context.rules?.criticalThresholds;
  if (thresholds === undefined) {
    return;
  }
  const axes = [
    {
      id: 'health',
      label: 'Health',
      value: context.agent.physiology.health,
      threshold: thresholds.health,
    },
    {
      id: 'energy',
      label: 'Energy',
      value: context.agent.physiology.energy,
      threshold: thresholds.energy,
    },
  ] as const;
  for (const axis of axes) {
    if (axis.value >= axis.threshold) {
      continue;
    }
    const relativeDeficit =
      axis.threshold <= 0 ? 0 : (axis.threshold - axis.value) / axis.threshold;
    target.push({
      kind: 'survival',
      source: 'critical-threshold',
      sourceId: axis.id,
      summary: `${axis.label} is ${axis.value}, below the critical threshold ${axis.threshold}.`,
      rank: 0,
      sourcePriority: -relativeDeficit,
    });
  }
}

function appendIntentionSalience(
  target: SalienceCandidate[],
  intentionState: AgentIntentionState | undefined,
  at: SimulationTimestamp,
): void {
  if (intentionState === undefined) {
    return;
  }
  for (const intention of selectActiveScheduledIntentions(intentionState, at)) {
    target.push({
      kind: 'obligation',
      source: 'scheduled-intention',
      sourceId: intention.id,
      summary: sanitizeSalienceText(intention.description),
      rank: 1,
      sourcePriority: -intention.priority,
    });
  }
}

function appendMemorySalience(
  target: SalienceCandidate[],
  records: readonly ShortTermMemoryRecord[] | undefined,
): void {
  for (const record of records ?? []) {
    if (record.importanceScore < PER_STAGE_CONTEXT_HIGH_IMPORTANCE_MEMORY_THRESHOLD) {
      continue;
    }
    target.push({
      kind: record.kind === 'social-interaction' ? 'relationship' : 'memory',
      source: 'high-importance-memory',
      sourceId: record.id,
      summary: sanitizeSalienceText(record.summary),
      rank: record.kind === 'social-interaction' ? 3 : 2,
      sourcePriority: -record.importanceScore,
    });
  }
}

function appendOpportunitySalience(
  target: SalienceCandidate[],
  rules: WorldDecisionRulesContext | undefined,
): void {
  if (rules === undefined) {
    return;
  }
  for (const occupation of rules.occupations) {
    if (occupation.eligible) {
      target.push({
        kind: 'opportunity',
        source: 'eligible-rule',
        sourceId: `occupation:${occupation.occupationName}`,
        summary: `Eligible occupation: ${sanitizeSalienceText(occupation.occupationName)}.`,
        rank: 4,
        sourcePriority: 0,
      });
    }
  }
  for (const production of rules.production) {
    if (production.producible) {
      target.push({
        kind: 'opportunity',
        source: 'eligible-rule',
        sourceId: `production:${production.commodity}`,
        summary: `Producible commodity: ${sanitizeSalienceText(production.commodity)}.`,
        rank: 4,
        sourcePriority: 1,
      });
    }
  }
  if (rules.residentialUpgrade?.eligible === true) {
    target.push({
      kind: 'opportunity',
      source: 'eligible-rule',
      sourceId: `residential-upgrade:${rules.residentialUpgrade.targetResidentialTier}`,
      summary: `Eligible residential upgrade to tier ${rules.residentialUpgrade.targetResidentialTier}.`,
      rank: 4,
      sourcePriority: 2,
    });
  }
}

function sanitizeSalienceText(value: string): string {
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- free-text prompt hygiene requires this match
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, PER_STAGE_CONTEXT_SALIENCE_TEXT_MAX_LENGTH).join('');
}

function compareSalienceCandidates(left: SalienceCandidate, right: SalienceCandidate): number {
  if (left.rank !== right.rank) {
    return left.rank - right.rank;
  }
  if (left.sourcePriority !== right.sourcePriority) {
    return left.sourcePriority - right.sourcePriority;
  }
  return left.sourceId.localeCompare(right.sourceId);
}

function visibleContextSections(view: PerStageContextView): readonly string[] {
  const sections: string[] = ['salience', 'agent'];
  const optionalSections = [
    'market',
    'townPulse',
    'society',
    'weather',
    'calendar',
    'petitions',
    'conditions',
    'fiscal',
    'externalTrade',
    'enterprises',
    'rules',
  ] as const;
  for (const section of optionalSections) {
    if (view[section] !== undefined) {
      sections.push(section);
    }
  }
  return sections;
}
