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
  WorldDecisionExternalTradeCommodityContext,
  WorldDecisionOccupationRule,
  WorldDecisionProductionRule,
  WorldDecisionResidentialUpgradeRule,
  WorldDecisionRulesContext,
} from '@aivilization/agent-runtime';
import type { AgentId } from '@aivilization/sim-core';
import {
  calculateApplicationQuota,
  calculateRecruitmentCycleNumber,
  calculateEffectiveKnowledgeThreshold,
  deriveAgentConditions,
  evaluateLifestyleTier,
} from '@aivilization/society';
import type {
  WorldAgentState,
  WorldCommandPolicies,
  WorldMarketPriceIndexState,
  WorldProjection,
} from '@aivilization/world';
import {
  activeLoansByBorrower,
  DEFAULT_MARKET_REGION_ID,
  resolveCreditLimit,
} from '@aivilization/world';
import type { AmmPool } from '@aivilization/economy';
import {
  createEducationOpportunityCostRule,
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
      ...createBankingDecisionContext({
        projection: input.projection,
        agent,
        ...(input.policies === undefined ? {} : { policies: input.policies }),
      }),
      job: agent.job,
      inventory: copyPositiveSortedRecord(agent.inventory),
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
      : { society: createSocietyDecisionContext(input.societyDirectory) }),
    ...(input.projection.weather === undefined ? {} : { weather: { ...input.projection.weather } }),
    ...createConditionDecisionContext(input),
    ...createFiscalDecisionContext(input),
    ...createExternalTradeDecisionContext({
      projection: input.projection,
      marketPools,
      ...(input.policies === undefined ? {} : { policies: input.policies }),
    }),
    ...createEnterpriseDecisionContext(input),
    ...(rules === undefined ? {} : { rules }),
  };
}

function createEnterpriseDecisionContext(input: {
  readonly projection: WorldProjection;
  readonly policies?: WorldCommandPolicies;
}): Pick<WorldDecisionContext, 'enterprises'> | Record<string, never> {
  if (input.policies?.enterprise === undefined) {
    return {};
  }
  return {
    enterprises: Object.values(input.projection.enterprises)
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
      }))
      .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId)),
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

function createSocietyDecisionContext(directory: LocalSimulationSocietyDirectory) {
  return {
    directoryId: directory.directoryId,
    simulationId: directory.simulationId,
    partitionBoundaries: directory.partitionBoundaries.map((boundary) => ({ ...boundary })),
    agents: directory.agents.map((agent) => ({
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
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
}): Pick<WorldDecisionRulesContext, 'educationOpportunityCost'> | Record<string, never> {
  const educationOpportunityCost = createEducationOpportunityCostRule({
    agent: input.agent,
    policies: input.policies,
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
      const rejectionReasons = createOccupationRejectionReasons({
        agent: input.agent,
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

function createOccupationRejectionReasons(input: {
  readonly agent: WorldAgentState;
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
  if (input.agent.educationScore < input.effectiveEducationThreshold) {
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
