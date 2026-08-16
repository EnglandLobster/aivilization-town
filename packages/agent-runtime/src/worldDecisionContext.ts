import type { AgentId } from '@aivilization/sim-core';
import type {
  EducationLevel,
  LifecycleStage,
  LifestyleTier,
  WellbeingBand,
} from '@aivilization/society';

export type WorldDecisionAgentContext = {
  readonly agentId: AgentId;
  readonly locationId: string | null;
  /**
   * The citizen's own display name, sanitized at the adapter boundary via
   * {@link sanitizeDecisionDisplayName} (control characters stripped,
   * whitespace collapsed, hard length cap) so free-text registration data can
   * never become a prompt-injection surface. The agent previously saw every
   * other citizen's name in the society directory but never its own —
   * docs/AGENT_CONTEXT_DESIGN.md §3 problem 1.
   */
  readonly displayName?: string;
  readonly physiology: {
    readonly energy: number;
    readonly satiety: number;
    readonly health: number;
  };
  readonly educationScore: number;
  /**
   * Discrete education level under education-system-v2. Present only when the
   * resolved command policies carry an enabled education-system policy; absent
   * means the legacy continuous-score semantics.
   */
  readonly educationLevel?: EducationLevel;
  /**
   * Chinese-language stage label for the education level (e.g. '小学(义务教育)',
   * '高中(普高)'). Present only together with `educationLevel`.
   */
  readonly educationStage?: string;
  /** True when the agent has not completed the compulsory education stage. */
  readonly compulsoryEducationIncomplete?: boolean;
  /**
   * Cumulative exam attempts under education-system-v2. Present only together
   * with `educationLevel`.
   */
  readonly examAttempts?: number;
  /**
   * Read-model view of the next exam-gated level above the agent's current
   * level (中考/高考/考研): how many applications the current cycle already
   * holds for that level, and the previous completed cycle's admission rate
   * and cutoff score. Present only when the education-system policy is enabled
   * and an exam-gated level lies ahead.
   */
  readonly nextEducationExam?: WorldDecisionEducationExamContext;
  /**
   * Rational investment view of the next education level (cost vs wage uplift).
   * Present only when the education-system policy is enabled.
   */
  readonly educationReturn?: WorldDecisionEducationReturnContext;
  readonly balance: number;
  readonly residentialTier: number;
  /** Accumulated unpaid residential upkeep; absent or zero when the household is current. */
  readonly upkeepArrears?: number;
  /**
   * Region the agent currently belongs to (resolved from its location, the
   * same source authoritative trade gating and upkeep pricing use). Present
   * only when the resolved command policies carry residential upkeep pricing.
   */
  readonly regionId?: string;
  /**
   * Latest smoothed land value index for the agent's region, straight from the
   * projection slice the authoritative upkeep settlement reads. Present only
   * once a land value policy has produced an index for the region.
   */
  readonly regionalLandValueIndex?: number;
  /**
   * Effective per-hour residential upkeep rate for the agent's current tier
   * and region (base tier cost plus the land value term), resolved with the
   * same function and policy the settlement uses. Absent when the tier has no
   * configured upkeep cost.
   */
  readonly residentialUpkeepRatePerHour?: number;
  /**
   * Optional town-bank banking view of this agent. Present only when the
   * resolved command policies carry a credit policy; exposes the deposit
   * balance, active loans, credit history, and the policy rates/limit for
   * planning — settlement never consumes it.
   */
  readonly banking?: WorldDecisionBankingContext;
  /**
   * Optional wealth-tier lifestyle derived from the agent's net worth.
   * Present only when the resolved command policies carry a lifestyle policy;
   * the context exposes it for situational awareness and planning budget
   * guardrails — settlement never consumes it.
   */
  readonly lifestyle?: LifestyleTier;
  /**
   * Optional durable lifecycle view (town-lifecycle-v1): the agent's settled
   * life stage, current age, and retirement status. Present only when the
   * resolved command policies carry a lifecycle policy; the stage and
   * retirement flag come straight from the projection, the age is derived
   * with the same registration-based rule the settlement uses. Read-path
   * only — settlement never consumes this context.
   */
  readonly lifecycle?: {
    readonly stage: LifecycleStage;
    readonly ageDays: number;
    readonly retired: boolean;
  };
  /**
   * Optional durable wellbeing view (town-wellbeing-v1): the authoritative
   * settled scalar plus its derived band. Present only when the resolved
   * command policies carry a wellbeing policy; the value comes straight from
   * the projection (absent durable value means the policy initialValue), and
   * the band is derived read-path state — settlement never consumes this
   * context.
   */
  readonly wellbeing?: {
    readonly value: number;
    readonly band: WellbeingBand;
  };
  /**
   * Optional social-graph view (context-view v2): this agent's strongest
   * directed relations, sorted by |relationScore| and capped at
   * {@link DECISION_RELATIONS_MAX_COUNT}. Both directions are listed as
   * separate entries ('outgoing' = my disposition toward them, 'incoming' =
   * theirs toward me) so no aggregation semantics are invented; narrative
   * interaction summaries deliberately stay out (they live in memory) to
   * avoid triple-representing the same relation —
   * docs/AGENT_CONTEXT_DESIGN.md §4 right 2.
   */
  readonly relations?: readonly WorldDecisionRelationContext[];
  readonly job: string | null;
  readonly inventory: Readonly<Record<string, number>>;
  readonly durableGoods?: readonly {
    readonly lotId: string;
    readonly commodityName: string;
    readonly quantity: number;
    readonly utilityPoints: number;
    readonly acquiredAt: number;
    readonly expiresAt: number;
  }[];
};

export type WorldDecisionBankingLoanContext = {
  readonly loanId: string;
  readonly principal: number;
  readonly accruedInterest: number;
  /** Read-model estimate of the amortization installments still ahead. */
  readonly remainingTermDays: number;
};

/**
 * One directed social relation as seen by the owning agent. Direction is
 * explicit because the underlying relation records are directed; entries for
 * the same counterpart in both directions are two rows, never merged.
 */
export type WorldDecisionRelationContext = {
  /** The counterpart agent this relation points at (or comes from). */
  readonly agentId: AgentId;
  /** Counterpart's sanitized display name when the society directory has it. */
  readonly displayName?: string;
  /** 'outgoing' = my disposition toward them; 'incoming' = theirs toward me. */
  readonly direction: 'outgoing' | 'incoming';
  /** Relation label straight from the social settlement (e.g. 'friend'). */
  readonly relationLabel: string;
  /** Signed relation score; |score| drives the section's ordering. */
  readonly relationScore: number;
  readonly attitudeScore: number;
  readonly interactionCount: number;
};

export type WorldDecisionBankingContext = {
  readonly depositBalance: number;
  readonly activeLoans: readonly WorldDecisionBankingLoanContext[];
  readonly repaidCount: number;
  readonly defaultedCount: number;
  /** Current history-scaled credit limit for the next loan request. */
  readonly maxLoanAmount: number;
  readonly depositDailyInterestRate: number;
  readonly loanDailyInterestRate: number;
};

export type WorldDecisionEducationExamContext = {
  /** Exam-gated level the agent would apply for next (中考 3, 高考 4, 考研 5). */
  readonly targetLevel: EducationLevel;
  /** Applications parked for that level in the current exam cycle so far. */
  readonly currentCycleApplications: number;
  /** Admission rate (admitted / applications) of the latest completed cycle for that level. */
  readonly previousCycleAdmissionRate?: number;
  /** Cutoff score of the latest completed cycle for that level. */
  readonly previousCycleCutoffScore?: number;
};

/**
 * Rational investment view of the education ladder (education-system-v4): what
 * the next level costs (score, study hours at the canonical rate, tuition) and
 * what it returns (exam admission odds, estimated wage uplift from the job-tier
 * catalog). Read-only planning context — settlement never consumes it. Present
 * only when the education-system policy is enabled.
 */
export type WorldDecisionEducationReturnContext = {
  readonly currentLevel: EducationLevel;
  readonly currentStage: string;
  /** Next level to study toward; null when the agent already holds level 5. */
  readonly nextLevel: EducationLevel | null;
  /**
   * Score required to enter `nextLevel`. When `nextLevel` is null this is the
   * entry threshold of the top level (already met).
   */
  readonly requiredScore: number;
  readonly currentScore: number;
  /**
   * Study hours still needed to reach `requiredScore` at the canonical
   * education rate, including the employed-study efficiency penalty when the
   * agent holds a job.
   */
  readonly expectedStudyHoursRemaining: number;
  /** True when entry into `nextLevel` is decided by an exam cycle (levels 3-5). */
  readonly isExamGated: boolean;
  /** Admission outlook for the exam gate, from the education exam read model. */
  readonly examAdmission?: {
    readonly quota: number;
    readonly lastCycleCutoffScore?: number;
    readonly lastCycleAdmissionRate?: number;
  };
  /** Tuition per study hour at the agent's current level. */
  readonly tuitionPerHour: number;
  /** True when the current level belongs to the treasury-covered compulsory stage. */
  readonly compulsoryFree: boolean;
  /**
   * Wage uplift estimate from the occupation catalog: the minimum base wage of
   * the highest job tier the current score unlocks vs the one the next level's
   * required score would unlock.
   */
  readonly wageUpliftEstimate: {
    readonly currentTierWage: number;
    readonly nextLevelMinTierWage: number;
  };
};

export type WorldDecisionMarketSpotPrice = {
  readonly commodity: string;
  readonly spotPrice: number;
};

export type WorldDecisionMarketPriceIndex = {
  readonly baselineAt: number;
  readonly recordedAt: number;
  readonly overall: number;
  readonly ratios: Readonly<Record<string, number>>;
};

export type WorldDecisionMarketContext = {
  readonly spotPrices: readonly WorldDecisionMarketSpotPrice[];
  readonly latestPriceIndex?: WorldDecisionMarketPriceIndex;
};

export type WorldDecisionOccupationApplicationQuota = {
  readonly residentialTier: number;
  readonly limit: number;
  readonly currentApplications: number;
  readonly remaining: number;
};

export type WorldDecisionOccupationRule = {
  readonly occupationName: string;
  readonly jobTier: number;
  readonly baseWage: number;
  readonly currentWage?: number;
  readonly effectiveEducationThreshold: number;
  /**
   * The agent's bonus-adjusted education score for this occupation
   * (vocational-track tier bonus, education-system-v4). Present only when it
   * differs from the raw educationScore; eligibility and employer ranking both
   * use it.
   */
  readonly effectiveEducationScore?: number;
  readonly requiredResidentialTier: number;
  readonly prerequisiteCommodity: string | null;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly string[];
  readonly applicationQuota?: WorldDecisionOccupationApplicationQuota;
};

export type WorldDecisionProductionRule = {
  readonly commodity: string;
  readonly minResidentialTier: number | null;
  readonly inputs: Readonly<Record<string, number>>;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly timeCostSeconds: number;
  readonly outputSpotPrice?: number;
  readonly inputSpotCost?: number;
  readonly grossMargin?: number;
  readonly grossMarginPerSecond?: number;
  readonly producible: boolean;
  readonly rejectionReasons: readonly string[];
};

export type WorldDecisionResidentialUpgradeRule = {
  readonly targetResidentialTier: number;
  readonly currencyCost: number;
  readonly minEducationScore: number;
  readonly inventoryCosts: Readonly<Record<string, number>>;
  readonly missingInventory: Readonly<Record<string, number>>;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly string[];
};

export type WorldDecisionEducationOpportunityCostRule = {
  readonly policyVersion: string;
  readonly studyDurationSeconds: number;
  readonly educationRatePerSecond: number;
  readonly expectedEducationGain: number;
  readonly directCurrencyCost: number;
  readonly directInventoryCosts: Readonly<Record<string, number>>;
  readonly workLaborSeconds: number;
  readonly currentOccupationName: string | null;
  readonly foregoneLaborIncome: number;
  readonly totalCurrencyOpportunityCost: number;
  readonly minimumBalanceReserve: number;
  readonly balanceAfterDirectCost: number;
  readonly directlyAffordable: boolean;
  readonly preservesMinimumBalanceReserve: boolean;
};

export type WorldDecisionConsumptionRule = {
  readonly commodityName: string;
  readonly kind: 'consumable' | 'durable';
  readonly utilityPoints: number;
  readonly lifetimeSeconds?: number;
  readonly inventoryQuantity: number;
  readonly activeDurableQuantity: number;
};

export type WorldDecisionRulesContext = {
  readonly criticalThresholds?: {
    readonly energy: number;
    readonly health: number;
  };
  readonly occupations: readonly WorldDecisionOccupationRule[];
  readonly production: readonly WorldDecisionProductionRule[];
  readonly consumption?: readonly WorldDecisionConsumptionRule[];
  readonly residentialUpgrade?: WorldDecisionResidentialUpgradeRule;
  readonly educationOpportunityCost?: WorldDecisionEducationOpportunityCostRule;
};

export type WorldDecisionSocietyAgentContext = {
  readonly agentId: AgentId;
  readonly ownerPartitionKey: string;
  readonly ownerLastAppliedSequence: number;
  readonly locationId: string | null;
  readonly job: string | null;
  readonly residentialTier: number;
  readonly educationScore: number;
  readonly displayName?: string;
  readonly activityAvailableAt?: number;
  readonly transit?: {
    readonly fromLocationId: string;
    readonly toLocationId: string;
    readonly departedAt: number;
    readonly arrivesAt: number;
  };
};

export type WorldDecisionSocietyContext = {
  readonly directoryId: string;
  readonly simulationId: string;
  readonly partitionBoundaries: readonly {
    readonly partitionKey: string;
    readonly lastAppliedSequence: number;
    readonly snapshotSequence: number;
    readonly simulationTime: number;
  }[];
  readonly agents: readonly WorldDecisionSocietyAgentContext[];
};

/**
 * Optional simulation-wide weather visible to agent planning. Present only
 * when the town-weather policy is enabled; the
 * context exposes it for situational awareness only — it does not change any
 * activity policy. `since` is the simulation time the current weather started.
 */
export type WorldDecisionTownPulseEntry = {
  readonly kind:
    | 'death'
    | 'emigration'
    | 'arrival'
    | 'petition-threshold'
    | 'weather-change'
    | 'enterprise-founded'
    | 'enterprise-closed';
  readonly atMs: number;
  readonly subjectAgentId?: AgentId;
  /** Sanitized subject name captured at event time (departure removes the agent). */
  readonly subjectDisplayName?: string;
  readonly subjectEnterpriseName?: string;
  /** Machine-readable qualifier (cause, weather transition, petition topic). */
  readonly detail?: string;
};

export type WorldDecisionWeatherContext = {
  readonly current: string;
  readonly since: number;
};

/** One open petition visible to agent planning (collective-action switch). */
export type WorldDecisionPetitionContext = {
  readonly petitionId: string;
  readonly topic: string;
  readonly statement: string;
  readonly signatureCount: number;
  readonly threshold: number;
  readonly signedByMe: boolean;
  readonly expiresAt: number;
};

/**
 * Optional town day/night calendar visible to agent planning (town-calendar
 * switch). Present only when the town-calendar policy is enabled; exposes the
 * current phase, when it ends, and what follows so schedules can be
 * day/night-aware. Read-path only — settlement never consumes this context.
 */
export type WorldDecisionCalendarContext = {
  readonly dayIndex: number;
  readonly phase: string;
  readonly phaseEndsAtMs: number;
  readonly nextPhase: string;
  readonly dayLengthMs: number;
};

/**
 * A derived town condition visible to agent planning. Present only when the
 * town-conditions policy is enabled;
 * conditions are derived from durable physiology axes, weather, and location
 * exposure — the context exposes them for situational awareness only and does
 * not change any activity policy.
 */
export type WorldDecisionConditionContext = {
  readonly kind: string;
  readonly severity: string;
  readonly need: string;
};

/**
 * Optional public-finance context visible to agent planning. Present only when
 * the resolved command policies carry a tax policy; the neutral rate is the
 * headline rate agents reason about, while settlement uses the brackets.
 */
export type WorldDecisionFiscalContext = {
  readonly incomeTaxBrackets: readonly {
    readonly upToAmount: number | null;
    readonly rate: number;
  }[];
  readonly tradeTaxRate: number;
  readonly neutralRate: number;
};

/**
 * Per-commodity external-trade view visible to agent planning. Present only
 * when the resolved command policies carry an external-trade policy; the
 * indicative unit prices are evaluated at the current rolling net-export
 * balance (positive = net exports) against the spot price of the market pool
 * the agent can actually trade on — settlement never consumes this context.
 */
export type WorldDecisionExternalTradeCommodityContext = {
  readonly commodityName: string;
  readonly netExportBalance: number;
  readonly exportUnitPrice: number;
  readonly importUnitPrice: number;
};

export type WorldDecisionEnterpriseContext = {
  readonly enterpriseId: string;
  readonly name: string;
  readonly ownerAgentId: AgentId;
  readonly occupationName: string;
  readonly balance: number;
  readonly inventory: Readonly<Record<string, number>>;
  readonly maxEmployees: number;
  readonly employeeAgentIds: readonly AgentId[];
  readonly status: 'active' | 'insolvent' | 'bankrupt' | 'closed';
  readonly cumulativeSales: number;
  readonly cumulativePurchases: number;
  readonly cumulativeWages: number;
  readonly ownershipShares?: Readonly<Record<string, number>>;
  readonly retainedEarnings?: number;
  readonly cumulativeDividends?: number;
  readonly insolvencyStartedAt?: number;
  /** Published hiring offer; absent means the enterprise is not hiring. */
  readonly jobPosting?: {
    readonly wageOffer: number;
    readonly openSlots: number;
  };
  /** Accumulated unpaid wages the enterprise still owes its employees. */
  readonly wageArrears?: number;
};

export type WorldDecisionContext = {
  readonly agent: WorldDecisionAgentContext;
  readonly market: WorldDecisionMarketContext;
  /**
   * Optional town-pulse view (context-view v3): recent town-wide occurrences
   * (deaths, departures, arrivals, petition thresholds, weather shifts,
   * enterprise lifecycle) derived deterministically from the projection's
   * bounded pulse ring, newest first, capped at
   * {@link DECISION_TOWN_PULSE_MAX_COUNT} within a
   * {@link DECISION_TOWN_PULSE_WINDOW_DAYS}-day window. Hearsay by nature —
   * citizens learn town news by hearing it, not by omniscience
   * (docs/AGENT_CONTEXT_DESIGN.md §4 right 3).
   */
  readonly townPulse?: readonly WorldDecisionTownPulseEntry[];
  readonly society?: WorldDecisionSocietyContext;
  readonly weather?: WorldDecisionWeatherContext;
  readonly calendar?: WorldDecisionCalendarContext;
  /**
   * Open petitions visible to agent planning (town-collective-action switch):
   * latest first, capped, present only when the resolved command policies
   * carry a collective-action policy. Read-path only.
   */
  readonly petitions?: readonly WorldDecisionPetitionContext[];
  readonly conditions?: readonly WorldDecisionConditionContext[];
  readonly fiscal?: WorldDecisionFiscalContext;
  readonly externalTrade?: readonly WorldDecisionExternalTradeCommodityContext[];
  readonly enterprises?: readonly WorldDecisionEnterpriseContext[];
  readonly rules?: WorldDecisionRulesContext;
};

export type WorldDecisionContextTrace = {
  readonly agentId: AgentId;
  readonly hasLocationId: boolean;
  /** Present when the identity view carried the citizen's own sanitized display name. */
  readonly hasDisplayName?: boolean;
  readonly displayNameLength?: number;
  /** Present when the social-graph view carried at least one relation entry. */
  readonly relationCount?: number;
  /** Present when the town-pulse view carried at least one news entry. */
  readonly townPulseCount?: number;
  readonly hasPhysiology: boolean;
  readonly hasJob: boolean;
  readonly hasBalance: boolean;
  readonly hasEducationScore: boolean;
  readonly hasResidentialTier: boolean;
  readonly hasInventory: boolean;
  readonly inventoryItemCount: number;
  readonly marketSpotPriceCount: number;
  readonly hasLatestPriceIndex: boolean;
  readonly hasEconomicState: boolean;
  readonly hasMarketPrices: boolean;
  readonly completeEconomicContext: boolean;
  readonly hasSocietyDirectory?: boolean;
  readonly societyPartitionCount?: number;
  readonly societyAgentCount?: number;
  readonly remoteSocietyAgentCount?: number;
  readonly hasWeather?: boolean;
  readonly weatherCurrent?: string;
  readonly hasCalendar?: boolean;
  readonly petitionCount?: number;
  readonly calendarDayIndex?: number;
  readonly calendarPhase?: string;
  readonly calendarNextPhase?: string;
  readonly conditionCount?: number;
  readonly conditionKinds?: readonly string[];
  readonly durableGoodCount?: number;
  readonly enterpriseCount?: number;
  readonly activeEnterpriseCount?: number;
  readonly occupationRuleCount: number;
  readonly eligibleOccupationRuleCount: number;
  readonly productionRuleCount: number;
  readonly producibleCommodityRuleCount: number;
  readonly consumptionRuleCount?: number;
  readonly hasResidentialUpgradeRule?: boolean;
  readonly residentialUpgradeEligible?: boolean;
  readonly hasEducationOpportunityCost?: boolean;
  readonly educationInvestmentDirectlyAffordable?: boolean;
  readonly educationInvestmentPreservesMinimumBalanceReserve?: boolean;
};

export function createWorldDecisionContextTrace(
  context: WorldDecisionContext,
): WorldDecisionContextTrace {
  const hasBalance = Number.isFinite(context.agent.balance);
  const hasInventory = context.agent.inventory !== undefined;
  const hasLatestPriceIndex = context.market.latestPriceIndex !== undefined;
  const hasEconomicState = hasBalance && hasInventory;
  const hasMarketPrices =
    context.market.spotPrices.length > 0 &&
    context.market.spotPrices.every(
      (price) => price.commodity.trim().length > 0 && Number.isFinite(price.spotPrice),
    );
  const localOwnerPartitionKey = context.society?.agents.find(
    (agent) => agent.agentId === context.agent.agentId,
  )?.ownerPartitionKey;

  return {
    agentId: context.agent.agentId,
    hasLocationId: context.agent.locationId !== undefined,
    ...(context.agent.displayName === undefined
      ? {}
      : { hasDisplayName: true, displayNameLength: context.agent.displayName.length }),
    ...(context.agent.relations === undefined
      ? {}
      : { relationCount: context.agent.relations.length }),
    ...(context.townPulse === undefined ? {} : { townPulseCount: context.townPulse.length }),
    hasPhysiology:
      Number.isFinite(context.agent.physiology.energy) &&
      Number.isFinite(context.agent.physiology.satiety) &&
      Number.isFinite(context.agent.physiology.health),
    hasJob: context.agent.job !== undefined,
    hasBalance,
    hasEducationScore: Number.isFinite(context.agent.educationScore),
    hasResidentialTier: Number.isFinite(context.agent.residentialTier),
    hasInventory,
    inventoryItemCount: Object.keys(context.agent.inventory).length,
    ...(context.agent.durableGoods === undefined
      ? {}
      : { durableGoodCount: context.agent.durableGoods.length }),
    marketSpotPriceCount: context.market.spotPrices.length,
    hasLatestPriceIndex,
    hasEconomicState,
    hasMarketPrices,
    completeEconomicContext: hasEconomicState && hasMarketPrices && hasLatestPriceIndex,
    ...(context.society === undefined
      ? {}
      : {
          hasSocietyDirectory: true,
          societyPartitionCount: context.society.partitionBoundaries.length,
          societyAgentCount: context.society.agents.length,
          remoteSocietyAgentCount: context.society.agents.filter(
            (agent) => agent.ownerPartitionKey !== localOwnerPartitionKey,
          ).length,
        }),
    ...(context.weather === undefined
      ? {}
      : { hasWeather: true, weatherCurrent: context.weather.current }),
    ...(context.petitions === undefined
      ? {}
      : { petitionCount: context.petitions.length }),
    ...(context.calendar === undefined
      ? {}
      : {
          hasCalendar: true,
          calendarDayIndex: context.calendar.dayIndex,
          calendarPhase: context.calendar.phase,
          calendarNextPhase: context.calendar.nextPhase,
        }),
    ...(context.conditions === undefined
      ? {}
      : {
          conditionCount: context.conditions.length,
          conditionKinds: context.conditions.map((condition) => condition.kind),
        }),
    ...(context.enterprises === undefined
      ? {}
      : {
          enterpriseCount: context.enterprises.length,
          activeEnterpriseCount: context.enterprises.filter(
            (enterprise) => enterprise.status === 'active',
          ).length,
        }),
    occupationRuleCount: context.rules?.occupations.length ?? 0,
    eligibleOccupationRuleCount:
      context.rules?.occupations.filter((occupation) => occupation.eligible).length ?? 0,
    productionRuleCount: context.rules?.production.length ?? 0,
    producibleCommodityRuleCount:
      context.rules?.production.filter((production) => production.producible).length ?? 0,
    ...(context.rules?.consumption === undefined
      ? {}
      : { consumptionRuleCount: context.rules.consumption.length }),
    hasResidentialUpgradeRule: context.rules?.residentialUpgrade !== undefined,
    residentialUpgradeEligible: context.rules?.residentialUpgrade?.eligible ?? false,
    hasEducationOpportunityCost: context.rules?.educationOpportunityCost !== undefined,
    educationInvestmentDirectlyAffordable:
      context.rules?.educationOpportunityCost?.directlyAffordable ?? false,
    educationInvestmentPreservesMinimumBalanceReserve:
      context.rules?.educationOpportunityCost?.preservesMinimumBalanceReserve ?? false,
  };
}

/**
 * Version of the read-path context view (identity hygiene rules, section
 * caps, framing composition). It changes LLM inputs and therefore behavior
 * trajectories, but never settlement or event replay, so it deliberately
 * does NOT occupy a domain policyVersion slot —
 * docs/AGENT_CONTEXT_DESIGN.md §4 right 5.
 */
export const WORLD_DECISION_CONTEXT_VIEW_VERSION = 'world-decision-context-view-v3';

/** Hard cap for any free-text field entering prompts (injection hygiene). */
export const DECISION_FREE_TEXT_MAX_LENGTH = 64;

/**
 * Cap for the agent's own relations section. Deliberately aligned with the
 * agent-cycle memory retrieval limit (8): relations carry the structured
 * facts, memory retrieval keeps the narratives — one quota each, no overlap
 * (docs/AGENT_CONTEXT_DESIGN.md §4 right 2 dedup rule).
 */
export const DECISION_RELATIONS_MAX_COUNT = 8;

/**
 * Cap for foreign-partition society entries that survive the relations-based
 * trim. Local-partition entries stay uncapped (they are the agent's actual
 * neighbors); foreign entries appear only when a relation record exists, at
 * most this many, strongest first (docs/AGENT_CONTEXT_DESIGN.md §7 step 2
 * budget binding — K=16 per the review's §11.3 question 6 stance).
 */
export const DECISION_SOCIETY_FOREIGN_RELATED_MAX_COUNT = 16;

/** Cap for the town-pulse section — the "recent town news" a citizen hears. */
export const DECISION_TOWN_PULSE_MAX_COUNT = 6;

/**
 * Town-pulse time window in simulation days (day length follows the calendar
 * policy, 24h wall-clock-equivalent when absent). Records older than the
 * window are stale news and dropped.
 */
export const DECISION_TOWN_PULSE_WINDOW_DAYS = 3;

/**
 * Sanitize a display name before it enters any prompt payload: strip C0/C1
 * control characters, zero-width joiners and bidi marks (prompt-injection
 * surface), collapse whitespace, trim, and cap the length on a code-point
 * boundary. Returns undefined for names that sanitize to nothing.
 */
export function sanitizeDecisionDisplayName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = value
    // eslint-disable-next-line no-control-regex -- matching control characters is this sanitizer's purpose
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) {
    return undefined;
  }
  const characters = Array.from(cleaned);
  return characters.length <= DECISION_FREE_TEXT_MAX_LENGTH
    ? cleaned
    : characters.slice(0, DECISION_FREE_TEXT_MAX_LENGTH).join('');
}

/**
 * Compose the one-sentence citizen framing for persona-style system prompts
 * ("You are acting as Li Na — retired carpenter of this town."). Pure
 * derivation from authoritative context fields; no narrative invention —
 * the framing must never state facts that are not in the JSON payload.
 * Returns null when the agent has no displayName, in which case callers
 * keep the neutral module framing.
 */
export function describeCitizenFraming(agent: WorldDecisionAgentContext): string | null {
  const displayName = agent.displayName;
  if (displayName === undefined || displayName.length === 0) {
    return null;
  }
  const descriptors: string[] = [];
  if (agent.lifecycle !== undefined) {
    descriptors.push(agent.lifecycle.retired ? 'retired' : agent.lifecycle.stage);
  }
  descriptors.push(agent.job === null || agent.job.length === 0 ? 'resident' : agent.job);
  return `You are acting as ${displayName} — ${descriptors.join(' ')} of this town.`;
}

/**
 * Wrap a stage's neutral module system prompt with the citizen framing for
 * persona-style stages (action sequence, social dialogue, daily planning —
 * docs/AGENT_CONTEXT_DESIGN.md §6.1). Without a framing the module prompt is
 * returned untouched, so non-persona runs and legacy contexts are unaffected.
 */
export function composePersonaSystemPrompt(input: {
  readonly framing: string | null;
  readonly modulePrompt: string;
}): string {
  if (input.framing === null) {
    return input.modulePrompt;
  }
  return `${input.framing} ${input.modulePrompt} The citizen framing must not contradict the JSON state; all authoritative facts live in the JSON payload.`;
}
