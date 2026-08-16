import { commodities, jobTiers, occupations } from '@aivilization/content';
import {
  calculateNetWorth,
  evaluateExternalExportPrice,
  evaluateExternalImportPrice,
  evaluateProductionEfficiency,
  getInventoryQuantity,
  getSpotPrice,
  resolveProductionDefinition,
  scaleProductionCost,
} from '@aivilization/economy';
import type {
  WorldDecisionAgentContext,
  WorldDecisionContext,
  WorldDecisionConsumptionRule,
  WorldDecisionEducationReturnContext,
  WorldDecisionExternalTradeCommodityContext,
  WorldDecisionOccupationRule,
  WorldDecisionProductionRule,
  WorldDecisionRelationContext,
  WorldDecisionResidentialUpgradeRule,
  WorldDecisionRulesContext,
} from '@aivilization/agent-runtime';
import {
  DECISION_ENTERPRISE_MAX_COUNT,
  DECISION_RELATIONS_MAX_COUNT,
  DECISION_SOCIETY_FOREIGN_RELATED_MAX_COUNT,
  DECISION_TOWN_PULSE_MAX_COUNT,
  DECISION_TOWN_PULSE_WINDOW_DAYS,
  sanitizeDecisionDisplayName,
} from '@aivilization/agent-runtime';
import type { AgentId } from '@aivilization/sim-core';
import {
  calculateApplicationQuota,
  calculateRecruitmentCycleNumber,
  calculateEffectiveKnowledgeThreshold,
  deriveAgentConditions,
  deriveEducationLevel,
  describeEducationStage,
  describeWellbeingBand,
  deriveAgentAgeMs,
  EDUCATION_EXAM_TARGET_LEVELS,
  EDUCATION_SYSTEM_MAX_LEVEL,
  evaluateEffectiveEducationScoreForOccupation,
  evaluateLifestyleTier,
  isCompulsoryLevel,
  isEducationExamTargetLevel,
  type EducationExamTargetLevel,
  type EducationLevel,
  type EducationSystemPolicy,
  type LifecyclePolicy,
  resolveResidentialUpkeepRate,
  resolveTownDayPhase,
} from '@aivilization/society';
import { resolveAgentAgeAnchorMs } from '@aivilization/world';
import type {
  WorldAgentState,
  WorldCommandPolicies,
  WorldMarketPriceIndexState,
  WorldProjection,
} from '@aivilization/world';
import {
  activeLoansByBorrower,
  DEFAULT_MARKET_REGION_ID,
  resolveAgentRegion,
  resolveCreditLimit,
} from '@aivilization/world';
import type { AmmPool } from '@aivilization/economy';
import {
  createEducationOpportunityCostRule,
  resolveEducationOpportunityCostSettings,
  type EducationOpportunityCostConfig,
} from './educationOpportunityCost';
import type { LocalSimulationSocietyDirectory } from './localSimulationSocietyDirectory';

/**
 * A read-only override for the market prices an agent plans against. When the
 * simulation-wide authority owns the unified AMM, the partition projection's
 * `marketPools` only reflect this partition's own trades, so planning must read
 * the authoritative global pools instead. This is deliberately just the pool map
 * (not a full projection): it feeds spot-price reads only and never replaces the
 * projection that is dispatched against or persisted to the checkpoint.
 */
export type WorldDecisionMarketOverride = {
  readonly marketPools: Readonly<Record<string, AmmPool>>;
};

/**
 * Resolve the market pools an agent should plan against. The source is the
 * override when provided (authoritative global pools), otherwise the partition
 * projection's own pools. When any source pool carries a regionId, the agent
 * only sees the pools of the region it currently stands in — so regional price
 * divergence is visible locally but an agent must physically move to compare or
 * exploit a foreign region's prices. When no pool is region-tagged every pool
 * belongs to the single default region and the full map is returned unchanged.
 */
export function resolveAgentMarketPools(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly override?: Readonly<Record<string, AmmPool>>;
}): Readonly<Record<string, AmmPool>> {
  const source = input.override ?? input.projection.marketPools;
  const hasRegionalPools = Object.values(source).some((pool) => pool.regionId !== undefined);
  if (!hasRegionalPools) {
    return source;
  }
  const location =
    input.agent.locationId === null
      ? undefined
      : input.projection.locations[input.agent.locationId];
  const agentRegionId = location?.regionId ?? DEFAULT_MARKET_REGION_ID;
  const filtered: Record<string, AmmPool> = {};
  for (const [poolKey, pool] of Object.entries(source)) {
    if ((pool.regionId ?? DEFAULT_MARKET_REGION_ID) === agentRegionId) {
      filtered[poolKey] = pool;
    }
  }
  return filtered;
}

export function createWorldDecisionContextFromProjection(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
  readonly policies?: WorldCommandPolicies;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
  readonly societyDirectory?: LocalSimulationSocietyDirectory;
  readonly marketOverride?: WorldDecisionMarketOverride;
}): WorldDecisionContext {
  const agent = input.projection.agents[input.agentId];
  if (agent === undefined) {
    throw new Error(`cannot create world decision context for unknown agent ${input.agentId}`);
  }
  // Identity view (AGENT_CONTEXT_DESIGN.md §4 right 1): the citizen's own
  // name, sanitized at this boundary — the society directory has always
  // exposed other agents' names while the agent itself stayed anonymous.
  const displayName = sanitizeDecisionDisplayName(agent.registration?.displayName);
  // Social-graph view (§4 right 2) + the society-directory trim input (§7
  // step 2 budget binding): relations are collected in full, sorted by
  // |relationScore|; the section takes the top slice and the directory trim
  // consumes the complete set. Relation records merge across partitions
  // (localSimulationSocietyProjection), so a counterpart may legitimately be
  // absent from the local projection while listed in the directory.
  const directoryAgentIds =
    input.societyDirectory === undefined
      ? undefined
      : new Set(input.societyDirectory.agents.map((directoryAgent) => directoryAgent.agentId));
  const relationEntries = collectAgentRelationEntries({
    projection: input.projection,
    agentId: input.agentId,
    ...(directoryAgentIds === undefined ? {} : { directoryAgentIds }),
  });
  const relations =
    relationEntries.length === 0
      ? undefined
      : attachRelationDisplayNames(
          relationEntries.slice(0, DECISION_RELATIONS_MAX_COUNT),
          input.societyDirectory,
        );

  const marketPools = resolveAgentMarketPools({
    projection: input.projection,
    agent,
    ...(input.marketOverride === undefined ? {} : { override: input.marketOverride.marketPools }),
  });
  const latestPriceIndex = resolveLatestPriceIndex(input.projection.marketPriceIndices);
  const rules =
    input.policies === undefined
      ? undefined
      : createWorldDecisionRulesContext({
          projection: input.projection,
          agent,
          policies: input.policies,
          marketPools,
          ...(input.educationOpportunityCost === undefined
            ? {}
            : { educationOpportunityCost: input.educationOpportunityCost }),
        });
  return {
    agent: {
      agentId: agent.agentId,
      locationId: agent.locationId,
      ...(displayName === undefined ? {} : { displayName }),
      ...(relations === undefined ? {} : { relations }),
      physiology: { ...agent.physiology },
      educationScore: agent.educationScore,
      balance: agent.balance,
      residentialTier: agent.residentialTier,
      upkeepArrears: agent.upkeepArrears ?? 0,
      ...createLifestyleDecisionContext({
        agent,
        marketPools,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
      }),
      ...createWellbeingDecisionContext({
        agent,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
      }),
      ...createLifecycleDecisionContext({
        projection: input.projection,
        agent,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
      }),
      ...createBankingDecisionContext({
        projection: input.projection,
        agent,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
      }),
      ...createHousingDecisionContext({
        projection: input.projection,
        agent,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
      }),
      job: agent.job,
      inventory: copyPositiveSortedRecord(agent.inventory),
      ...createEducationSystemDecisionContext({
        projection: input.projection,
        agent,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
        ...(input.educationOpportunityCost === undefined
          ? {}
          : { educationOpportunityCost: input.educationOpportunityCost }),
      }),
      ...(agent.durableGoods === undefined
        ? {}
        : {
            durableGoods: agent.durableGoods
              .map((lot) => ({ ...lot }))
              .sort(
                (left, right) =>
                  left.expiresAt - right.expiresAt || left.lotId.localeCompare(right.lotId),
              ),
          }),
    },
    market: {
      spotPrices: Object.values(marketPools)
        .map((pool) => ({
          commodity: pool.commodity,
          spotPrice: getSpotPrice(pool),
        }))
        .sort((left, right) => left.commodity.localeCompare(right.commodity)),
      ...(latestPriceIndex === undefined
        ? {}
        : {
            latestPriceIndex: {
              baselineAt: latestPriceIndex.baselineAt,
              recordedAt: latestPriceIndex.recordedAt,
              overall: latestPriceIndex.overall,
              ratios: copyPositiveSortedRecord(latestPriceIndex.ratios),
            },
          }),
    },
    ...(input.societyDirectory === undefined
      ? {}
      : {
          society: createSocietyDecisionContext(input.societyDirectory, {
            agentId: input.agentId,
            relationEntries,
          }),
        }),
    ...(input.projection.weather === undefined ? {} : { weather: { ...input.projection.weather } }),
    ...createTownPulseDecisionContext(input),
    ...createCalendarDecisionContext(input),
    ...createPetitionDecisionContext(input),
    ...createConditionDecisionContext(input),
    ...createFiscalDecisionContext(input),
    ...createExternalTradeDecisionContext({
      projection: input.projection,
      marketPools,
      ...(input.policies === undefined ? {} : { policies: input.policies }),
    }),
    ...createEnterpriseDecisionContext({
      projection: input.projection,
      agentId: input.agentId,
      ...(input.policies === undefined ? {} : { policies: input.policies }),
    }),
    ...(rules === undefined ? {} : { rules }),
  };
}

function createTownPulseDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'townPulse'> | Record<string, never> {
  if (input.projection.townPulse.length === 0) {
    return {};
  }
  // Day length follows the calendar policy (24h-equivalent fallback); the
  // window drops stale news, the sort is newest-first with event sequence as
  // the deterministic tiebreak, and the cap bounds the section.
  const dayLengthMs = input.policies?.calendar?.dayLengthMs ?? 86_400_000;
  const windowStartMs =
    input.projection.clock.now - DECISION_TOWN_PULSE_WINDOW_DAYS * dayLengthMs;
  const entries = input.projection.townPulse
    .filter((record) => record.occurredAt >= windowStartMs)
    .sort((left, right) => right.occurredAt - left.occurredAt || right.sequence - left.sequence)
    .slice(0, DECISION_TOWN_PULSE_MAX_COUNT)
    .map((record) => {
      const subjectDisplayName = sanitizeDecisionDisplayName(record.subjectDisplayName);
      const subjectEnterpriseName = sanitizeDecisionDisplayName(record.subjectEnterpriseName);
      return {
        kind: record.kind,
        atMs: record.occurredAt,
        ...(record.subjectAgentId === undefined ? {} : { subjectAgentId: record.subjectAgentId }),
        ...(subjectDisplayName === undefined ? {} : { subjectDisplayName }),
        ...(subjectEnterpriseName === undefined ? {} : { subjectEnterpriseName }),
        ...(record.detail === undefined || record.detail.length === 0
          ? {}
          : { detail: record.detail }),
      };
    });
  if (entries.length === 0) {
    return {};
  }
  return { townPulse: entries };
}

function createEnterpriseDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'enterprises'> | Record<string, never> {
  if (input.policies?.enterprise === undefined) {
    return {};
  }
  // §7 step 4 budget binding: tiered relevance — own employment/ownership
  // first, then open job postings, then the rest — deterministic id order
  // within a tier, capped at DECISION_ENTERPRISE_MAX_COUNT. (Enterprises
  // carry no region field, so the design doc's same-region tier degrades to
  // the general tail; recorded as an open item in the doc.)
  const tierOf = (enterprise: (typeof input.projection.enterprises)[string]): number => {
    if (
      enterprise.ownerAgentId === input.agentId ||
      enterprise.employeeAgentIds.includes(input.agentId) ||
      (enterprise.ownershipShares?.[input.agentId] ?? 0) > 0
    ) {
      return 0;
    }
    return (enterprise.jobPosting?.openSlots ?? 0) > 0 ? 1 : 2;
  };
  return {
    enterprises: Object.values(input.projection.enterprises)
      .sort(
        (left, right) =>
          tierOf(left) - tierOf(right) || left.enterpriseId.localeCompare(right.enterpriseId),
      )
      .slice(0, DECISION_ENTERPRISE_MAX_COUNT)
      .map((enterprise) => ({
        enterpriseId: enterprise.enterpriseId,
        name: enterprise.name,
        ownerAgentId: enterprise.ownerAgentId,
        occupationName: enterprise.occupationName,
        balance: enterprise.balance,
        inventory: copyPositiveSortedRecord(enterprise.inventory),
        maxEmployees: enterprise.maxEmployees,
        employeeAgentIds: [...enterprise.employeeAgentIds].sort((left, right) =>
          left.localeCompare(right),
        ),
        status: enterprise.status,
        cumulativeSales: enterprise.cumulativeSales,
        cumulativePurchases: enterprise.cumulativePurchases,
        cumulativeWages: enterprise.cumulativeWages,
        ...(enterprise.ownershipShares === undefined
          ? {}
          : { ownershipShares: { ...enterprise.ownershipShares } }),
        ...(enterprise.retainedEarnings === undefined
          ? {}
          : { retainedEarnings: enterprise.retainedEarnings }),
        ...(enterprise.cumulativeDividends === undefined
          ? {}
          : { cumulativeDividends: enterprise.cumulativeDividends }),
        ...(enterprise.insolvencyStartedAt === undefined
          ? {}
          : { insolvencyStartedAt: enterprise.insolvencyStartedAt }),
        ...(enterprise.jobPosting === undefined
          ? {}
          : { jobPosting: { ...enterprise.jobPosting } }),
        wageArrears: enterprise.wageArrears ?? 0,
      })),
  };
}

/**
 * Derive the agent's discrete education level and stage label when the
 * education-system policy is enabled, plus the exam-attempt counter and a
 * read-model view of the next exam-gated level (current-cycle competition,
 * previous-cycle admission rate and cutoff). Absent `educationLevel` on the
 * agent state (legacy snapshots) falls back to deriving the level from the
 * score. Returns an empty object when the policy is absent or disabled so
 * legacy runs keep the context education-system-free.
 */
function createEducationSystemDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies?: WorldCommandPolicies;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
}):
  | Pick<
      WorldDecisionAgentContext,
      | 'educationLevel'
      | 'educationStage'
      | 'compulsoryEducationIncomplete'
      | 'examAttempts'
      | 'nextEducationExam'
      | 'educationReturn'
    >
  | Record<string, never> {
  const policy = input.policies?.educationSystem;
  if (policy === undefined || !policy.enabled) {
    return {};
  }
  const level =
    input.agent.educationLevel ?? deriveEducationLevel(input.agent.educationScore, policy);
  const examAttempts = input.agent.examAttempts ?? 0;
  const educationStage = describeEducationStage({
    level,
    ...(input.agent.educationTrack === undefined ? {} : { track: input.agent.educationTrack }),
  });
  return {
    educationLevel: level,
    educationStage,
    compulsoryEducationIncomplete: policy.compulsoryLevels.some(
      (compulsoryLevel) => level < compulsoryLevel,
    ),
    examAttempts,
    ...createNextEducationExamContext({ projection: input.projection, level, policy }),
    educationReturn: createEducationReturnContext({
      projection: input.projection,
      agent: input.agent,
      level,
      stage: educationStage,
      policy,
      educationRatePerSecond: resolveEducationOpportunityCostSettings(
        input.educationOpportunityCost,
      ).educationRatePerSecond,
    }),
  };
}

/**
 * Rational investment view of the education ladder (CS2 stayEarn/quitEarn
 * simplified): the score, study-hour, and tuition cost of the next level
 * against its exam-admission outlook and the wage uplift implied by the
 * job-tier catalog. Study hours use the canonical education rate with the
 * employed-study penalty when the agent holds a job; the wage uplift compares
 * the minimum base wage of the highest job tier each score unlocks.
 */
function createEducationReturnContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly level: EducationLevel;
  readonly stage: string;
  readonly policy: EducationSystemPolicy;
  readonly educationRatePerSecond: number;
}): WorldDecisionEducationReturnContext {
  const nextLevel =
    input.level === EDUCATION_SYSTEM_MAX_LEVEL
      ? null
      : ((input.level + 1) as EducationLevel);
  const requiredScore =
    input.level === EDUCATION_SYSTEM_MAX_LEVEL
      ? (input.policy.levelScoreThresholds.at(-1) ?? 0)
      : (input.policy.levelScoreThresholds[input.level] ?? 0);
  const missingScore = Math.max(0, requiredScore - input.agent.educationScore);
  const studyRatePerSecond =
    input.educationRatePerSecond *
    (input.agent.job === null ? 1 : input.policy.employedStudyEfficiencyRatio);
  const expectedStudyHoursRemaining =
    missingScore === 0
      ? 0
      : studyRatePerSecond > 0
        ? missingScore / studyRatePerSecond / 3600
        : Number.POSITIVE_INFINITY;
  const isExamGated = nextLevel !== null && isEducationExamTargetLevel(nextLevel);
  const examAdmission =
    isExamGated && nextLevel !== null
      ? createExamAdmissionContext({
          projection: input.projection,
          targetLevel: nextLevel,
          policy: input.policy,
        })
      : undefined;
  const currentTierWage = estimateMinTierWageForScore(input.agent.educationScore);
  return {
    currentLevel: input.level,
    currentStage: input.stage,
    nextLevel,
    requiredScore,
    currentScore: input.agent.educationScore,
    expectedStudyHoursRemaining,
    isExamGated,
    ...(examAdmission === undefined ? {} : { examAdmission }),
    tuitionPerHour: input.policy.levelTuitionPerHour[String(input.level)] ?? 0,
    compulsoryFree: isCompulsoryLevel(input.level, input.policy),
    wageUpliftEstimate: {
      currentTierWage,
      nextLevelMinTierWage:
        nextLevel === null ? currentTierWage : estimateMinTierWageForScore(requiredScore),
    },
  };
}

/** Latest completed exam cycle's admission outlook for one exam-gated level. */
function createExamAdmissionContext(input: {
  readonly projection: WorldProjection;
  readonly targetLevel: EducationExamTargetLevel;
  readonly policy: EducationSystemPolicy;
}): NonNullable<WorldDecisionEducationReturnContext['examAdmission']> {
  const previousCycle = [...input.projection.educationExamCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)
    .find((cycle) => (cycle.applicationsByLevel[String(input.targetLevel)] ?? 0) > 0);
  return {
    quota: input.policy.admissionQuotaByLevel[String(input.targetLevel)] ?? 0,
    ...(previousCycle === undefined
      ? {}
      : {
          lastCycleAdmissionRate:
            (previousCycle.admittedByLevel[String(input.targetLevel)] ?? 0) /
            (previousCycle.applicationsByLevel[String(input.targetLevel)] ?? 1),
          ...(previousCycle.cutoffScoresByLevel[String(input.targetLevel)] === undefined
            ? {}
            : {
                lastCycleCutoffScore:
                  previousCycle.cutoffScoresByLevel[String(input.targetLevel)],
              }),
        }),
  };
}

/**
 * Minimum base wage among the occupations of the highest job tier a score
 * unlocks (jobTiers.minEducationScore ladder). Pure read-model estimate over
 * the content catalog.
 */
function estimateMinTierWageForScore(score: number): number {
  const tier = jobTiers.reduce(
    (best, candidate) => (score >= candidate.minEducationScore ? candidate.tier : best),
    1,
  );
  const tierWages = occupations
    .filter((occupation) => occupation.jobTier === tier)
    .map((occupation) => occupation.baseWage);
  return Math.min(...tierWages);
}

/**
 * Next exam-gated level above the agent's current level: the smallest target
 * in {3, 4, 5} strictly above it. Reports the current cycle's parked
 * applications for that level and the latest completed cycle's admission rate
 * and cutoff so planners can gauge competition. Absent when no exam-gated
 * level lies ahead (already at/above level 5's gate).
 */
function createNextEducationExamContext(input: {
  readonly projection: WorldProjection;
  readonly level: EducationLevel;
  readonly policy: EducationSystemPolicy;
}): Pick<WorldDecisionAgentContext, 'nextEducationExam'> | Record<string, never> {
  const targetLevel = EDUCATION_EXAM_TARGET_LEVELS.find((target) => target > input.level);
  if (targetLevel === undefined) {
    return {};
  }
  const currentCycleNumber = calculateRecruitmentCycleNumber({
    simulationTime: input.projection.clock.now,
    cycleDurationMs: input.policy.examCycleDurationMs,
  });
  const currentCycleApplications = input.projection.educationExamApplications.filter(
    (application) =>
      application.targetLevel === targetLevel && application.cycleNumber === currentCycleNumber,
  ).length;
  const previousCycle = [...input.projection.educationExamCycles]
    .sort((left, right) => right.cycleNumber - left.cycleNumber)
    .find((cycle) => (cycle.applicationsByLevel[String(targetLevel)] ?? 0) > 0);
  return {
    nextEducationExam: {
      targetLevel,
      currentCycleApplications,
      ...(previousCycle === undefined
        ? {}
        : {
            previousCycleAdmissionRate:
              (previousCycle.admittedByLevel[String(targetLevel)] ?? 0) /
              (previousCycle.applicationsByLevel[String(targetLevel)] ?? 1),
            ...(previousCycle.cutoffScoresByLevel[String(targetLevel)] === undefined
              ? {}
              : {
                  previousCycleCutoffScore: previousCycle.cutoffScoresByLevel[String(targetLevel)],
                }),
          }),
    },
  };
}

/**
 * Expose the town tax regime to agent planning when the resolved policies
 * carry a tax policy. Returns an empty object when the policy is absent so
 * tax-free runs keep the context fiscal-free.
 */
function createFiscalDecisionContext(input: {
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'fiscal'> | Record<string, never> {
  const policy = input.policies?.tax;
  if (policy === undefined) {
    return {};
  }
  return {
    fiscal: {
      incomeTaxBrackets: policy.incomeTaxBrackets.map((bracket) => ({ ...bracket })),
      tradeTaxRate: policy.tradeTaxRate,
      neutralRate: policy.neutralRate,
    },
  };
}

/**
 * Expose the external-trade view (rolling net-export balance plus indicative
 * export/import unit prices per commodity) when the resolved policies carry an
 * external-trade policy. Prices are quoted off the spot price of the market
 * pools the agent actually sees (region-filtered, override-aware), matching
 * the market the settlement handler resolves. Returns an empty object when the
 * policy is absent so external-trade-free runs keep the context free of it.
 */
function createExternalTradeDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'externalTrade'> | Record<string, never> {
  const policy = input.policies?.externalTrade;
  if (policy === undefined) {
    return {};
  }
  const balances = input.projection.externalTrade?.balancesByCommodity ?? {};
  const externalTrade: WorldDecisionExternalTradeCommodityContext[] = Object.values(
    input.marketPools,
  )
    .map((pool) => {
      const netExportBalance = balances[pool.commodity] ?? 0;
      const spotPrice = getSpotPrice(pool);
      return {
        commodityName: pool.commodity,
        netExportBalance,
        exportUnitPrice: evaluateExternalExportPrice({
          spotPrice,
          quantity: 1,
          netExportBalance,
          policy,
        }).unitPrice,
        importUnitPrice: evaluateExternalImportPrice({
          spotPrice,
          quantity: 1,
          netExportBalance,
          policy,
        }).unitPrice,
      };
    })
    .sort((left, right) => left.commodityName.localeCompare(right.commodityName));
  return { externalTrade };
}

/**
 * Derive the agent's town conditions when the town-conditions catalog is part
 * of the resolved policies. Exposure is read from the agent's location: the
 * open-air public spaces (kind `social`) count as outdoors; every building and
 * the unplaced state count as sheltered. Returns an empty object when the
 * policy is absent so flag-off runs stay condition-free.
 */
function createConditionDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'conditions'> | Record<string, never> {
  const policy = input.policies?.conditions;
  if (policy === undefined) {
    return {};
  }
  const agent = input.projection.agents[input.agentId];
  if (agent === undefined) {
    return {};
  }
  const location =
    agent.locationId === null ? undefined : input.projection.locations[agent.locationId];
  const conditions = deriveAgentConditions({
    physiology: agent.physiology,
    residentialTier: agent.residentialTier,
    outdoors: location?.kind === 'social',
    ...(input.projection.weather === undefined
      ? {}
      : { weather: input.projection.weather.current }),
    policy,
  });
  return { conditions: conditions.map((condition) => ({ ...condition })) };
}

/**
 * Derive the agent's wealth-tier lifestyle when the resolved command policies
 * carry a lifestyle policy. Net worth values the inventory at the spot prices
 * of the pools the agent plans against (region-filtered, override-aware), so
 * the tier matches the market the agent actually sees. Returns an empty object
 * when the policy is absent so policy-free runs keep the context
 * lifestyle-free.
 */
function createLifestyleDecisionContext(input: {
  readonly agent: WorldAgentState;
  readonly policies?: WorldCommandPolicies;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
}): Pick<WorldDecisionAgentContext, 'lifestyle'> | Record<string, never> {
  const policy = input.policies?.lifestyle;
  if (policy === undefined) {
    return {};
  }
  return {
    lifestyle: evaluateLifestyleTier({
      netWorth: calculateNetWorth({
        currencyBalance: input.agent.balance,
        inventory: input.agent.inventory,
        pools: Object.values(input.marketPools),
      }),
      policy,
    }),
  };
}

/**
 * Expose the town day/night calendar when the resolved command policies carry
 * a calendar policy. The current phase comes from the projection calendar
 * slice (the settled TownDayPhaseChanged cache); before the first transition
 * event it falls back to the same pure clock function the settlement uses.
 * nextPhase/phaseEndsAtMs are derived with that same resolveTownDayPhase —
 * never recomputed business rules. Returns an empty object when the policy is
 * absent so policy-free runs keep the context calendar-free.
 */
/**
 * Open petitions for planning, when the resolved command policies carry a
 * collective-action policy. Read straight off the projection slice (the
 * authoritative shared state, replicated town-wide by the authority);
 * latest-raised first, capped at 8 so the context stays bounded.
 */
function createPetitionDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'petitions'> | Record<string, never> {
  const policy = input.policies?.collectiveAction;
  if (policy === undefined) {
    return {};
  }
  const open = (input.projection.petitions ?? [])
    .filter((petition) => petition.status === 'open')
    .sort((left, right) => right.raisedAt - left.raisedAt || left.petitionId.localeCompare(right.petitionId))
    .slice(0, 8);
  if (open.length === 0) {
    return {};
  }
  return {
    petitions: open.map((petition) => ({
      petitionId: petition.petitionId,
      topic: petition.topic,
      statement: petition.statement,
      signatureCount: petition.signatureAgentIds.length,
      threshold: policy.petitionSignatureThreshold,
      signedByMe: petition.signatureAgentIds.includes(input.agentId),
      expiresAt: petition.expiresAt,
    })),
  };
}

function createCalendarDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'calendar'> | Record<string, never> {
  const policy = input.policies?.calendar;
  if (policy === undefined) {
    return {};
  }
  const slice = input.projection.calendar;
  const resolved = resolveTownDayPhase({
    atMs: slice?.since ?? input.projection.clock.now,
    policy,
  });
  const dayIndex = slice?.dayIndex ?? resolved.dayIndex;
  const nextPhase = resolveTownDayPhase({ atMs: resolved.phaseEndsAtMs, policy }).phase;
  return {
    calendar: {
      dayIndex,
      phase: resolved.phase,
      phaseEndsAtMs: resolved.phaseEndsAtMs,
      nextPhase,
      dayLengthMs: policy.dayLengthMs,
    },
  };
}

/**
 * Expose the agent's durable wellbeing when the resolved command policies
 * carry a wellbeing policy. The value comes straight from the projection (the
 * authoritative settled state; absent means the policy initialValue for legacy
 * agents) and the band is derived with describeWellbeingBand — the context
 * never recomputes the settlement target. Returns an empty object when the
 * policy is absent so policy-free runs keep the context wellbeing-free.
 */
/**
 * Expose the agent's lifecycle when the resolved command policies carry a
 * lifecycle policy. The stage and retirement flag come straight from the
 * durable projection state (absent stage means 'adult', every registered
 * agent is an adult at registration); the age is derived with the same
 * registration-based rule the settlement uses — never recomputed stage
 * decisions. Returns an empty object when the policy is absent so
 * policy-free runs keep the context lifecycle-free.
 */
function createLifecycleDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionAgentContext, 'lifecycle'> | Record<string, never> {
  const policy: LifecyclePolicy | undefined = input.policies?.lifecycle;
  if (policy === undefined) {
    return {};
  }
  const ageDays =
    deriveAgentAgeMs({
      nowMs: input.projection.clock.now,
      registeredAtMs: resolveAgentAgeAnchorMs(input.agent),
      policy,
    }) / policy.dayLengthMs;
  return {
    lifecycle: {
      stage: input.agent.lifeStage ?? 'adult',
      ageDays,
      retired: input.agent.retiredAtMs !== undefined,
    },
  };
}

function createWellbeingDecisionContext(input: {
  readonly agent: WorldAgentState;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionAgentContext, 'wellbeing'> | Record<string, never> {
  const policy = input.policies?.wellbeing;
  if (policy === undefined) {
    return {};
  }
  const value = input.agent.wellbeing ?? policy.initialValue;
  return {
    wellbeing: {
      value,
      band: describeWellbeingBand(value, policy.bandThresholds),
    },
  };
}

/**
 * Expose the agent's town-bank position when the resolved policies carry a
 * credit policy. Data comes from the projection bank slice (the authoritative
 * settlement state); returns an empty object when the policy is absent so
 * bank-free runs keep the context banking-free.
 */
function createBankingDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionAgentContext, 'banking'> | Record<string, never> {
  const policy = input.policies?.credit;
  if (policy === undefined) {
    return {};
  }
  const bank = input.projection.bank;
  const history = bank?.creditHistoryByAgent[input.agent.agentId];
  return {
    banking: {
      depositBalance: bank?.deposits[input.agent.agentId] ?? 0,
      activeLoans: (bank === undefined ? [] : activeLoansByBorrower(bank, input.agent.agentId)).map(
        (loan) => ({
          loanId: loan.loanId,
          principal: loan.principal,
          accruedInterest: loan.accruedInterest,
          remainingTermDays: Math.max(
            0,
            loan.termDays -
              Math.floor((input.projection.clock.now - loan.issuedAt) / policy.accrualCadenceMs),
          ),
        }),
      ),
      repaidCount: history?.repaidCount ?? 0,
      defaultedCount: history?.defaultedCount ?? 0,
      maxLoanAmount: resolveCreditLimit({ history, policy }),
      depositDailyInterestRate: policy.depositDailyInterestRate,
      loanDailyInterestRate: policy.loanDailyInterestRate,
    },
  };
}

/**
 * Expose the agent's housing price signal when the resolved policies carry
 * residential upkeep pricing: the agent's region, its latest land value
 * index, and the effective per-hour upkeep rate. All three come from the same
 * projection slice, region resolution, policy, and rate function the
 * authoritative settlement uses, so planning and settlement never diverge.
 * Returns an empty object when no upkeep policy is present.
 */
function createHousingDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies?: WorldCommandPolicies;
}):
  | Pick<
      WorldDecisionAgentContext,
      'regionId' | 'regionalLandValueIndex' | 'residentialUpkeepRatePerHour'
    >
  | Record<string, never> {
  const policy = input.policies?.residentialUpkeep;
  if (policy === undefined) {
    return {};
  }
  const regionId = resolveAgentRegion({
    projection: input.projection,
    agentLocationId: input.agent.locationId,
  });
  // The land value index only enters pricing when a land value policy is
  // active; without one the authoritative settlement prices flat, so the
  // context must not read the persisted slice either (the two would diverge).
  const landValueIndex =
    input.policies?.landValue === undefined
      ? undefined
      : input.projection.regionalLandValues?.[regionId];
  const rate = resolveResidentialUpkeepRate({
    residentialTier: input.agent.residentialTier,
    policy,
    ...(landValueIndex === undefined ? {} : { landValueIndex }),
  });
  return {
    regionId,
    ...(landValueIndex === undefined ? {} : { regionalLandValueIndex: landValueIndex }),
    ...(rate === undefined ? {} : { residentialUpkeepRatePerHour: rate }),
  };
}

function createSocietyDecisionContext(
  directory: LocalSimulationSocietyDirectory,
  input: {
    readonly agentId: AgentId;
    readonly relationEntries: readonly WorldDecisionRelationContext[];
  },
) {
  // §7 step 2 budget binding: the full cross-partition directory scales with
  // total population; the per-agent view keeps every local-partition neighbor
  // (they share the agent's actual market and places) and admits foreign
  // agents only when a relation record exists, strongest first, capped at
  // DECISION_SOCIETY_FOREIGN_RELATED_MAX_COUNT.
  const strongestRelationScoreByCounterpart = new Map<string, number>();
  for (const entry of input.relationEntries) {
    const strongest = Math.abs(entry.relationScore);
    const known = strongestRelationScoreByCounterpart.get(entry.agentId);
    if (known === undefined || strongest > known) {
      strongestRelationScoreByCounterpart.set(entry.agentId, strongest);
    }
  }
  const foreignAllowed = new Set(
    [...strongestRelationScoreByCounterpart.entries()]
      .sort(
        ([leftId, leftScore], [rightId, rightScore]) =>
          rightScore - leftScore || leftId.localeCompare(rightId),
      )
      .slice(0, DECISION_SOCIETY_FOREIGN_RELATED_MAX_COUNT)
      .map(([agentId]) => agentId),
  );
  const self = directory.agents.find((agent) => agent.agentId === input.agentId);
  const visibleAgents =
    self === undefined
      ? directory.agents
      : directory.agents.filter(
          (agent) =>
            agent.ownerPartitionKey === self.ownerPartitionKey ||
            foreignAllowed.has(agent.agentId),
        );
  return {
    directoryId: directory.directoryId,
    simulationId: directory.simulationId,
    partitionBoundaries: directory.partitionBoundaries.map((boundary) => ({ ...boundary })),
    agents: visibleAgents.map((agent) => ({
      agentId: agent.agentId,
      ownerPartitionKey: agent.ownerPartitionKey,
      ownerLastAppliedSequence: agent.ownerLastAppliedSequence,
      locationId: agent.publicState.locationId,
      job: agent.publicState.job,
      residentialTier: agent.publicState.residentialTier,
      educationScore: agent.publicState.educationScore,
      ...(agent.publicState.displayName === undefined
        ? {}
        : { displayName: agent.publicState.displayName }),
      ...(agent.publicState.activityAvailableAt === undefined
        ? {}
        : { activityAvailableAt: agent.publicState.activityAvailableAt }),
      ...(agent.publicState.transit === undefined
        ? {}
        : { transit: { ...agent.publicState.transit } }),
    })),
  };
}

/**
 * Collect every directed relation record that involves the agent, sorted by
 * |relationScore| (agentId then outgoing-first as deterministic tiebreaks).
 * Narrative interaction summaries stay out — they live in memory retrieval
 * (§4 right 2 dedup rule). Counterparts known to neither the local projection
 * nor the society directory (stale records after death/emigration) are
 * filtered so they cannot resurrect ghosts in the read view; remote agents
 * listed only in the directory are legitimate (relations merge across
 * partitions).
 */
function collectAgentRelationEntries(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
  readonly directoryAgentIds?: ReadonlySet<string>;
}): readonly WorldDecisionRelationContext[] {
  return Object.values(input.projection.socialRelations)
    .filter((relation) => {
      if (
        (relation.sourceAgentId !== input.agentId && relation.targetAgentId !== input.agentId) ||
        relation.sourceAgentId === relation.targetAgentId
      ) {
        return false;
      }
      const counterpart =
        relation.sourceAgentId === input.agentId
          ? relation.targetAgentId
          : relation.sourceAgentId;
      return (
        input.projection.agents[counterpart] !== undefined ||
        input.directoryAgentIds?.has(counterpart) === true
      );
    })
    .map((relation) => {
      const outgoing = relation.sourceAgentId === input.agentId;
      return {
        agentId: outgoing ? relation.targetAgentId : relation.sourceAgentId,
        direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
        relationLabel: relation.relationLabel,
        relationScore: relation.relationScore,
        attitudeScore: relation.attitudeScore,
        interactionCount: relation.interactionCount,
      };
    })
    .sort(
      (left, right) =>
        Math.abs(right.relationScore) - Math.abs(left.relationScore) ||
        left.agentId.localeCompare(right.agentId) ||
        (left.direction === right.direction ? 0 : left.direction === 'outgoing' ? -1 : 1),
    );
}

function attachRelationDisplayNames(
  entries: readonly WorldDecisionRelationContext[],
  directory: LocalSimulationSocietyDirectory | undefined,
): readonly WorldDecisionRelationContext[] {
  if (directory === undefined) {
    return entries;
  }
  const displayNames = new Map<string, string>();
  for (const agent of directory.agents) {
    if (agent.publicState.displayName !== undefined) {
      displayNames.set(agent.agentId, agent.publicState.displayName);
    }
  }
  return entries.map((entry) => {
    const displayName = displayNames.get(entry.agentId);
    return displayName === undefined ? entry : { ...entry, displayName };
  });
}

function resolveLatestPriceIndex(
  indices: readonly WorldMarketPriceIndexState[],
): WorldMarketPriceIndexState | undefined {
  return indices.reduce<WorldMarketPriceIndexState | undefined>(
    (latest, candidate) =>
      latest === undefined || candidate.recordedAt > latest.recordedAt ? candidate : latest,
    undefined,
  );
}

function copyPositiveSortedRecord(
  values: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function createWorldDecisionRulesContext(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
}): WorldDecisionRulesContext {
  return {
    criticalThresholds: { ...input.policies.criticalThresholds },
    occupations: createOccupationRules(input),
    production: createProductionRules(input),
    ...withConsumptionRules(input),
    ...withResidentialUpgradeRule(input),
    ...withEducationOpportunityCostRule(input),
  };
}

function withConsumptionRules(input: {
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): Pick<WorldDecisionRulesContext, 'consumption'> | Record<string, never> {
  const policy = input.policies.consumption;
  if (policy === undefined) {
    return {};
  }
  const consumption: WorldDecisionConsumptionRule[] = Object.entries(policy.rules)
    .map(([commodityName, rule]) => ({
      commodityName,
      kind: rule.kind,
      utilityPoints: rule.utilityPoints,
      ...(rule.kind === 'durable' ? { lifetimeSeconds: rule.lifetimeSeconds } : {}),
      inventoryQuantity: input.agent.inventory[commodityName] ?? 0,
      activeDurableQuantity: (input.agent.durableGoods ?? [])
        .filter((lot) => lot.commodityName === commodityName)
        .reduce((total, lot) => total + lot.quantity, 0),
    }))
    .sort((left, right) => left.commodityName.localeCompare(right.commodityName));
  return { consumption };
}

function withResidentialUpgradeRule(input: {
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): Pick<WorldDecisionRulesContext, 'residentialUpgrade'> | Record<string, never> {
  const policy = input.policies.residentialTierUpgrade;
  if (policy === undefined) {
    return {};
  }
  const targetResidentialTier = input.agent.residentialTier + 1;
  if (
    policy.maxResidentialTier !== undefined &&
    targetResidentialTier > policy.maxResidentialTier
  ) {
    return {};
  }
  const cost = policy.costs.find(
    (candidate) => candidate.targetResidentialTier === targetResidentialTier,
  );
  if (cost === undefined) {
    return {};
  }

  const currencyCost = cost.currencyCost ?? 0;
  const minEducationScore = cost.minEducationScore ?? 0;
  const inventoryCosts = copyPositiveSortedRecord(cost.inventoryCosts ?? {});
  const missingInventory = Object.fromEntries(
    Object.entries(inventoryCosts)
      .map(
        ([commodity, requiredQuantity]) =>
          [
            commodity,
            Math.max(0, requiredQuantity - getInventoryQuantity(input.agent.inventory, commodity)),
          ] as const,
      )
      .filter(([, missingQuantity]) => missingQuantity > 0),
  );
  const rejectionReasons = [
    ...(input.agent.educationScore < minEducationScore ? ['insufficient-education'] : []),
    ...(input.agent.balance < currencyCost ? ['insufficient-balance'] : []),
    ...(Object.keys(missingInventory).length > 0 ? ['insufficient-inventory'] : []),
  ];
  const residentialUpgrade: WorldDecisionResidentialUpgradeRule = {
    targetResidentialTier,
    currencyCost,
    minEducationScore,
    inventoryCosts,
    missingInventory,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
  };
  return { residentialUpgrade };
}

function withEducationOpportunityCostRule(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
}): Pick<WorldDecisionRulesContext, 'educationOpportunityCost'> | Record<string, never> {
  const educationOpportunityCost = createEducationOpportunityCostRule({
    agent: input.agent,
    policies: input.policies,
    treasuryBalance: input.projection.treasury ?? null,
    ...(input.educationOpportunityCost === undefined
      ? {}
      : { config: input.educationOpportunityCost }),
  });
  return educationOpportunityCost === undefined ? {} : { educationOpportunityCost };
}

function createOccupationRules(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): readonly WorldDecisionOccupationRule[] {
  const jobApplication = input.policies.jobApplication;
  if (jobApplication === undefined) {
    return [];
  }

  const currentCycleNumber =
    jobApplication.recruitmentCycle === undefined
      ? undefined
      : calculateRecruitmentCycleNumber({
          simulationTime: input.projection.clock.now,
          cycleDurationMs: jobApplication.recruitmentCycle.cycleDurationMs,
        });
  const currentApplications = input.projection.jobApplications.filter(
    (application) =>
      application.agentId === input.agent.agentId &&
      (currentCycleNumber === undefined || application.cycleNumber === currentCycleNumber),
  ).length;
  const applicationLimit = calculateApplicationQuota({
    residentialTier: input.agent.residentialTier,
    quotaByResidentialTier: jobApplication.quotaByResidentialTier,
  });
  const educationSystemPolicy = input.policies.educationSystem;
  const agentEducationLevel = resolveEnabledAgentEducationLevel({
    agent: input.agent,
    policies: input.policies,
  });

  return occupations
    .map((occupation): WorldDecisionOccupationRule => {
      const jobTier = resolveJobTier(occupation.jobTier);
      const occupationThreshold = calculateEffectiveKnowledgeThreshold({
        educationScores: jobApplication.populationEducationScores,
        educationFloor: occupation.educationFloor,
        eligibilityShare: occupation.eligibilityShare,
      });
      const effectiveEducationThreshold = Math.max(occupationThreshold, jobTier.minEducationScore);
      const requiredResidentialTier = Math.max(
        occupation.minResidentialTier,
        jobTier.minResidentialTier,
      );
      // education-system-v3: eligibility mirrors settlement — a vocational-track
      // applicant is evaluated at the bonus-adjusted effective score.
      const effectiveEducationScore =
        educationSystemPolicy === undefined || agentEducationLevel === undefined
          ? input.agent.educationScore
          : evaluateEffectiveEducationScoreForOccupation({
              score: input.agent.educationScore,
              level: agentEducationLevel,
              ...(input.agent.educationTrack === undefined
                ? {}
                : { track: input.agent.educationTrack }),
              occupationTier: occupation.jobTier,
              policy: educationSystemPolicy,
            });
      const rejectionReasons = createOccupationRejectionReasons({
        agent: input.agent,
        effectiveEducationScore,
        effectiveEducationThreshold,
        requiredResidentialTier,
        prerequisiteCommodity: jobTier.prerequisiteCommodity,
        applicationLimit,
        currentApplications,
      });

      return {
        occupationName: occupation.name,
        jobTier: occupation.jobTier,
        baseWage: occupation.baseWage,
        currentWage: input.policies.wageCalculator(occupation.name),
        effectiveEducationThreshold,
        ...(effectiveEducationScore === input.agent.educationScore
          ? {}
          : { effectiveEducationScore }),
        requiredResidentialTier,
        prerequisiteCommodity: jobTier.prerequisiteCommodity,
        eligible: rejectionReasons.length === 0,
        rejectionReasons,
        applicationQuota: {
          residentialTier: input.agent.residentialTier,
          limit: applicationLimit,
          currentApplications,
          remaining: Math.max(0, applicationLimit - currentApplications),
        },
      };
    })
    .sort(
      (left, right) =>
        left.jobTier - right.jobTier || left.occupationName.localeCompare(right.occupationName),
    );
}

/**
 * The agent's discrete education level when the education-system policy is
 * enabled (score-derived fallback for legacy snapshots), undefined otherwise
 * so disabled-policy runs keep the legacy continuous-score semantics.
 */
function resolveEnabledAgentEducationLevel(input: {
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
}): EducationLevel | undefined {
  const policy = input.policies.educationSystem;
  if (policy === undefined || !policy.enabled) {
    return undefined;
  }
  return input.agent.educationLevel ?? deriveEducationLevel(input.agent.educationScore, policy);
}

function createOccupationRejectionReasons(input: {
  readonly agent: WorldAgentState;
  readonly effectiveEducationScore: number;
  readonly effectiveEducationThreshold: number;
  readonly requiredResidentialTier: number;
  readonly prerequisiteCommodity: string | null;
  readonly applicationLimit: number;
  readonly currentApplications: number;
}): readonly string[] {
  const reasons: string[] = [];
  if (input.currentApplications >= input.applicationLimit) {
    reasons.push('application-quota-exhausted');
  }
  if (input.agent.residentialTier < input.requiredResidentialTier) {
    reasons.push('residential-tier-too-low');
  }
  if (input.effectiveEducationScore < input.effectiveEducationThreshold) {
    reasons.push('education-too-low');
  }
  if (
    input.prerequisiteCommodity !== null &&
    getInventoryQuantity(input.agent.inventory, input.prerequisiteCommodity) < 1
  ) {
    reasons.push('missing-prerequisite');
  }
  return reasons;
}

function createProductionRules(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
  readonly marketPools: Readonly<Record<string, AmmPool>>;
}): readonly WorldDecisionProductionRule[] {
  const agentEducationLevel = resolveEnabledAgentEducationLevel({
    agent: input.agent,
    policies: input.policies,
  });
  return commodities
    .flatMap((commodity): readonly WorldDecisionProductionRule[] => {
      const definition = resolveProductionDefinition(commodity.name, {
        ...(input.policies.production?.recipeOverrides === undefined
          ? {}
          : { recipeOverrides: input.policies.production.recipeOverrides }),
      });
      if (definition === undefined) {
        return [];
      }

      const productionEfficiencyDecision =
        input.policies.production?.efficiency === undefined
          ? undefined
          : evaluateProductionEfficiency({
              agent: {
                residentialTier: input.agent.residentialTier,
                educationScore: input.agent.educationScore,
                ...(agentEducationLevel === undefined
                  ? {}
                  : { educationLevel: agentEducationLevel }),
                energy: input.agent.physiology.energy,
                satiety: input.agent.physiology.satiety,
                health: input.agent.physiology.health,
              },
              policy: input.policies.production.efficiency,
            });
      const productionEfficiency =
        productionEfficiencyDecision?.status === 'accepted'
          ? productionEfficiencyDecision.efficiency
          : undefined;
      const energyCost = scaleProductionCost(definition.recipe.energyCost, productionEfficiency);
      const satietyCost = scaleProductionCost(definition.recipe.satietyCost, productionEfficiency);
      const timeCostSeconds = scaleProductionCost(
        definition.recipe.timeCostSeconds,
        productionEfficiency,
      );
      const rejectionReasons = createProductionRejectionReasons({
        agent: input.agent,
        rule: {
          minResidentialTier: definition.commodity.minResidentialTier,
          inputs: definition.recipe.inputs,
          energyCost,
          satietyCost,
        },
        productionEfficiencyRejected: productionEfficiencyDecision?.status === 'rejected',
      });
      const outputSpotPrice = resolveCommoditySpotPrice(input.marketPools, commodity.name);
      const inputSpotCost = Object.entries(definition.recipe.inputs).reduce(
        (total, [inputCommodity, quantity]) => {
          const spotPrice = resolveCommoditySpotPrice(input.marketPools, inputCommodity);
          return spotPrice === undefined ? Number.NaN : total + spotPrice * quantity;
        },
        0,
      );
      const grossMargin =
        outputSpotPrice === undefined || !Number.isFinite(inputSpotCost)
          ? undefined
          : outputSpotPrice - inputSpotCost;
      const grossMarginPerSecond =
        grossMargin === undefined || timeCostSeconds <= 0
          ? undefined
          : grossMargin / timeCostSeconds;

      return [
        {
          commodity: commodity.name,
          minResidentialTier: definition.commodity.minResidentialTier,
          inputs: copyPositiveSortedRecord(definition.recipe.inputs),
          energyCost,
          satietyCost,
          timeCostSeconds,
          ...(outputSpotPrice === undefined ? {} : { outputSpotPrice }),
          ...(Number.isFinite(inputSpotCost) ? { inputSpotCost } : {}),
          ...(grossMargin === undefined ? {} : { grossMargin }),
          ...(grossMarginPerSecond === undefined ? {} : { grossMarginPerSecond }),
          producible: rejectionReasons.length === 0,
          rejectionReasons,
        },
      ];
    })
    .sort((left, right) => left.commodity.localeCompare(right.commodity));
}

function resolveCommoditySpotPrice(
  marketPools: Readonly<Record<string, AmmPool>>,
  commodity: string,
): number | undefined {
  const pool = marketPools[commodity];
  return pool === undefined ? undefined : getSpotPrice(pool);
}

function createProductionRejectionReasons(input: {
  readonly agent: WorldAgentState;
  readonly rule: {
    readonly minResidentialTier: number | null;
    readonly inputs: Readonly<Record<string, number>>;
    readonly energyCost: number;
    readonly satietyCost: number;
  };
  readonly productionEfficiencyRejected: boolean;
}): readonly string[] {
  const reasons: string[] = [];
  if (
    input.rule.minResidentialTier !== null &&
    input.agent.residentialTier < input.rule.minResidentialTier
  ) {
    reasons.push('residential-tier-too-low');
  }
  if (input.productionEfficiencyRejected) {
    reasons.push('policy-invalid');
  }
  if (hasMissingInputs({ inventory: input.agent.inventory, inputs: input.rule.inputs })) {
    reasons.push('insufficient-input');
  }
  if (input.agent.physiology.energy < input.rule.energyCost) {
    reasons.push('insufficient-energy');
  }
  if (input.agent.physiology.satiety < input.rule.satietyCost) {
    reasons.push('insufficient-satiety');
  }
  return reasons;
}

function hasMissingInputs(input: {
  readonly inventory: Readonly<Record<string, number>>;
  readonly inputs: Readonly<Record<string, number>>;
}): boolean {
  return Object.entries(input.inputs).some(
    ([itemName, requiredQuantity]) =>
      getInventoryQuantity(input.inventory, itemName) < requiredQuantity,
  );
}

function resolveJobTier(tier: number): (typeof jobTiers)[number] {
  const jobTier = jobTiers.find((candidate) => candidate.tier === tier);
  if (jobTier === undefined) {
    throw new Error(`missing job tier ${tier}`);
  }
  return jobTier;
}
