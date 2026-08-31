import type {
  WorldDecisionContext,
  WorldDecisionOccupationRule,
} from '@aivilization/agent-runtime';
import type { WorldAgentState } from '@aivilization/world';

export const AUTONOMOUS_LIFE_COURSE_POLICY_VERSION = 'autonomous-life-course-v4';

const scores = {
  secureHousing: 92,
  expandHousing: 88,
  occupationApplication: 82,
  residentialUpgrade: 78,
  progressionAcquisition: 76,
  educationInvestment: 72,
  employmentIncome: 68,
  progressionSupply: 64,
  inventorySale: 62,
  profitableProduction: 56,
} as const;

const MARKET_BUY_SLIPPAGE_RESERVE_MULTIPLIER = 1.1;
const PROGRESSION_PREREQUISITE_RESERVE_QUANTITY = 1;
const PROGRESSION_SUPPLY_TARGET_QUANTITY = 2;

export type AutonomousLifeCourseCandidate = {
  readonly id: string;
  readonly statement: string;
  readonly priority: number;
  readonly affinityTags: readonly string[];
  readonly planningDomains?: readonly string[];
  readonly score: number;
  readonly rationale: string;
  readonly shortTermMemoryContextIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
};

export function createAutonomousLifeCoursePolicyManifest() {
  return {
    policyVersion: AUTONOMOUS_LIFE_COURSE_POLICY_VERSION,
    source: 'repository-design' as const,
    paperDefinesCandidateUtility: false as const,
    precedence: [
      'secure-housing',
      'expand-housing',
      'occupation-application',
      'residential-upgrade',
      'progression-acquisition',
      'education-investment',
      'employment-income',
      'progression-supply',
      'inventory-sale',
      'profitable-production',
    ],
    scores: { ...scores },
    marketBuySlippageReserveMultiplier: MARKET_BUY_SLIPPAGE_RESERVE_MULTIPLIER,
    progressionPrerequisiteReserveQuantity: PROGRESSION_PREREQUISITE_RESERVE_QUANTITY,
    progressionSupplyTargetQuantity: PROGRESSION_SUPPLY_TARGET_QUANTITY,
    occupationSelection: 'current-wage-times-stable-agent-preference-then-tier-then-name' as const,
    applicationDeferral:
      'prepare-one-missing-prerequisite-before-submitting-a-lower-tier-application' as const,
    educationTarget: 'nearest-unmet-threshold-within-current-or-next-residential-tier' as const,
    productionSelection:
      'current-tier-prerequisite-supply-before-positive-gross-margin-per-second' as const,
    inventoryLiquidation:
      'sell-surplus-above-future-occupation-prerequisite-reserve-before-more-profitable-production' as const,
    housingSelection: 'most-vacancies-then-location-id' as const,
  };
}

export function createAutonomousLifeCourseCandidates(input: {
  readonly agent: WorldAgentState;
  readonly worldDecisionContext: WorldDecisionContext;
}): readonly AutonomousLifeCourseCandidate[] {
  const rules = input.worldDecisionContext.rules;
  if (rules === undefined) {
    return [];
  }

  const candidates: AutonomousLifeCourseCandidate[] = [];
  const housing = input.worldDecisionContext.society?.housing;
  const availableResidence = housing?.residences
    .filter((residence) => residence.vacancies > 0)
    .sort(
      (left, right) =>
        right.vacancies - left.vacancies || left.locationId.localeCompare(right.locationId),
    )[0];
  if (input.worldDecisionContext.agent.housed === false && availableResidence !== undefined) {
    candidates.push(
      createCandidate({
        id: `secure-housing:${availableResidence.locationId}`,
        statement: `Secure a home at ${availableResidence.locationId}.`,
        affinityTags: ['residential', 'housing', 'home', 'shelter'],
        planningDomains: ['residential'],
        score: scores.secureHousing,
        rationale: `The Agent is unhoused and ${availableResidence.locationId} has ${availableResidence.vacancies} authoritative vacancy slot(s).`,
      }),
    );
  }
  const housingConstruction = rules.housingConstruction;
  if (housingConstruction?.eligible === true && housingConstruction.locationId !== null) {
    candidates.push(
      createCandidate({
        id: `expand-housing:${housingConstruction.locationId}`,
        statement: `Expand housing capacity at ${housingConstruction.locationId}.`,
        affinityTags: ['residential', 'housing', 'construction', 'supply'],
        planningDomains: ['residential'],
        score: scores.expandHousing,
        rationale: `Town housing occupancy is ${Math.round(housingConstruction.occupancyRatio * 100)}%, the Agent is the elected builder, and the required inventory is available.`,
      }),
    );
  }
  const currentOccupation = rules.occupations.find(
    (occupation) => occupation.occupationName === input.agent.job,
  );
  const currentWage = currentOccupation?.currentWage ?? currentOccupation?.baseWage ?? 0;
  const occupationBlockedOnlyByPrerequisite = selectBestOccupation(
    rules.occupations.filter(
      (occupation) =>
        occupation.occupationName !== input.agent.job &&
        isOccupationPrerequisitePreparationCandidate(occupation.rejectionReasons),
    ),
    input.agent.agentId,
  );
  const bestEligibleOccupation = selectBestOccupation(
    rules.occupations.filter(
      (occupation) =>
        occupation.eligible &&
        occupation.occupationName !== input.agent.job &&
        (input.agent.job === null || readWage(occupation) > currentWage),
    ),
    input.agent.agentId,
  );
  const shouldDeferEligibleOccupation =
    bestEligibleOccupation !== undefined &&
    occupationBlockedOnlyByPrerequisite !== undefined &&
    occupationBlockedOnlyByPrerequisite.jobTier > bestEligibleOccupation.jobTier;
  if (bestEligibleOccupation !== undefined && !shouldDeferEligibleOccupation) {
    candidates.push(
      createCandidate({
        id: `occupation-application:${bestEligibleOccupation.occupationName}`,
        statement: `Apply for ${bestEligibleOccupation.occupationName} to advance through the town's occupation ladder.`,
        affinityTags: ['work', 'job', 'career', 'apply', bestEligibleOccupation.occupationName],
        planningDomains: ['work'],
        score: scores.occupationApplication + bestEligibleOccupation.jobTier,
        rationale: `The occupation is currently eligible and pays ${readWage(bestEligibleOccupation)}, compared with the current wage ${currentWage}.`,
      }),
    );
  }

  const residentialUpgrade = rules.residentialUpgrade;
  if (residentialUpgrade?.eligible === true) {
    candidates.push(
      createCandidate({
        id: `residential-upgrade:${residentialUpgrade.targetResidentialTier}`,
        statement: `Upgrade residential tier to ${residentialUpgrade.targetResidentialTier}.`,
        affinityTags: [
          'residential',
          'housing',
          'home',
          'upgrade',
          `tier-${residentialUpgrade.targetResidentialTier}`,
        ],
        planningDomains: ['residential'],
        score: scores.residentialUpgrade + residentialUpgrade.targetResidentialTier,
        rationale: `The Agent satisfies the education, balance, and inventory requirements for residential tier ${residentialUpgrade.targetResidentialTier}.`,
      }),
    );
  }

  if (
    residentialUpgrade !== undefined &&
    hasOnlyRejection(residentialUpgrade.rejectionReasons, 'insufficient-inventory')
  ) {
    const acquisition = createAcquisitionCandidate({
      idPrefix: `residential-prerequisite:${residentialUpgrade.targetResidentialTier}`,
      missingInventory: residentialUpgrade.missingInventory,
      preservedBalance: residentialUpgrade.currencyCost,
      score: scores.progressionAcquisition + residentialUpgrade.targetResidentialTier,
      rationaleSuffix: `while preserving ${residentialUpgrade.currencyCost} currency for the residential upgrade`,
      context: input.worldDecisionContext,
    });
    if (acquisition !== undefined) {
      candidates.push(acquisition);
    }
  }

  if (
    occupationBlockedOnlyByPrerequisite !== undefined &&
    occupationBlockedOnlyByPrerequisite.prerequisiteCommodity !== null
  ) {
    const acquisition = createAcquisitionCandidate({
      idPrefix: `occupation-prerequisite:${occupationBlockedOnlyByPrerequisite.occupationName}`,
      missingInventory: { [occupationBlockedOnlyByPrerequisite.prerequisiteCommodity]: 1 },
      preservedBalance:
        rules.educationOpportunityCost?.minimumBalanceReserve ?? Math.max(20, currentWage * 0.1),
      score: scores.progressionAcquisition + occupationBlockedOnlyByPrerequisite.jobTier,
      rationaleSuffix: `to qualify for ${occupationBlockedOnlyByPrerequisite.occupationName}`,
      context: input.worldDecisionContext,
    });
    if (acquisition !== undefined) {
      candidates.push(acquisition);
    }
  }

  const educationTarget = resolveEducationTarget(input.worldDecisionContext);
  const educationOpportunityCost = resolveEducationMilestoneOpportunity({
    agent: input.agent,
    targetEducationScore: educationTarget,
    context: input.worldDecisionContext,
  });
  if (
    educationTarget !== undefined &&
    educationOpportunityCost?.directlyAffordable === true &&
    educationOpportunityCost.preservesMinimumBalanceReserve
  ) {
    candidates.push(
      createCandidate({
        id: `education-investment:${educationTarget}`,
        statement: `Study toward education score ${educationTarget} for the next occupation and residential milestone.`,
        affinityTags: ['study', 'education', 'learn', `education-target-${educationTarget}`],
        planningDomains: ['study'],
        score: scores.educationInvestment + Math.min(5, educationTarget / 100),
        rationale: `The nearest reachable progression threshold is ${educationTarget}; a ${educationOpportunityCost.studyDurationSeconds}-second study action adds at most ${educationOpportunityCost.expectedEducationGain} education and costs ${educationOpportunityCost.totalCurrencyOpportunityCost} including foregone income while preserving the configured balance reserve.`,
      }),
    );
  }

  const progressionNeedsIncome =
    residentialUpgrade?.rejectionReasons.includes('insufficient-balance') === true ||
    educationOpportunityCost?.directlyAffordable === false ||
    educationOpportunityCost?.preservesMinimumBalanceReserve === false;
  if (input.agent.job !== null && progressionNeedsIncome) {
    candidates.push(
      createCandidate({
        id: `employment-income:${input.agent.job}`,
        statement: `Work as ${input.agent.job} to fund the next education and residential milestone.`,
        affinityTags: ['work', 'income', 'job', input.agent.job],
        planningDomains: ['work'],
        score: scores.employmentIncome,
        rationale: `The Agent needs more disposable balance for the next progression step and currently holds the ${input.agent.job} occupation.`,
      }),
    );
  }

  const progressionSupply = resolveProgressionSupplyCandidate(input.worldDecisionContext);
  if (progressionSupply !== undefined) {
    candidates.push(
      createCandidate({
        id: `progression-supply:${progressionSupply.commodity}`,
        statement: `Produce ${progressionSupply.commodity} to supply the town's tier ${input.agent.residentialTier} progression economy.`,
        affinityTags: ['production', 'produce', 'supply', progressionSupply.commodity],
        planningDomains: ['production'],
        score: scores.progressionSupply + Math.min(6, input.agent.residentialTier),
        rationale: `${progressionSupply.commodity} is the prerequisite commodity for the current residential tier's occupation market; its production chain is structurally accessible.`,
      }),
    );
  }

  const profitableProduction = [...rules.production]
    .filter((production) => production.producible)
    .filter((production) => (production.grossMargin ?? 0) > 0)
    .filter((production) => (input.agent.inventory[production.commodity] ?? 0) < 1)
    .sort(
      (left, right) =>
        (right.grossMarginPerSecond ?? right.grossMargin ?? 0) -
          (left.grossMarginPerSecond ?? left.grossMargin ?? 0) ||
        left.commodity.localeCompare(right.commodity),
    )[0];
  if (profitableProduction !== undefined) {
    const marginRate =
      profitableProduction.grossMarginPerSecond ?? profitableProduction.grossMargin ?? 0;
    candidates.push(
      createCandidate({
        id: `profitable-production:${profitableProduction.commodity}`,
        statement: `Produce ${profitableProduction.commodity} for profitable market supply.`,
        affinityTags: ['production', 'produce', 'market', profitableProduction.commodity],
        planningDomains: ['production'],
        score: scores.profitableProduction + Math.min(6, Math.max(0, marginRate) / 10),
        rationale: `The current estimated gross margin is ${profitableProduction.grossMargin} and the margin rate is ${marginRate} per simulated second.`,
      }),
    );
  }

  const sale = selectInventorySale(input);
  if (sale !== undefined) {
    candidates.push(
      createCandidate({
        id: `inventory-sale:${sale.commodity}`,
        statement: `Sell one ${sale.commodity} through the town market to realize production income.`,
        affinityTags: ['trade', 'market', 'sell', sale.commodity],
        planningDomains: ['trade'],
        score: scores.inventorySale + Math.min(5, sale.spotPrice / 100),
        rationale: `The Agent can sell ${sale.quantity} ${sale.commodity} above a reserved quantity of ${sale.reservedQuantity}; its current spot price is ${sale.spotPrice}.`,
      }),
    );
  }

  return candidates;
}

function isOccupationPrerequisitePreparationCandidate(
  rejectionReasons: readonly string[],
): boolean {
  return (
    rejectionReasons.includes('missing-prerequisite') &&
    rejectionReasons.every(
      (reason) => reason === 'missing-prerequisite' || reason === 'application-quota-exhausted',
    )
  );
}

function resolveEducationMilestoneOpportunity(input: {
  readonly agent: WorldAgentState;
  readonly targetEducationScore: number | undefined;
  readonly context: WorldDecisionContext;
}) {
  const rule = input.context.rules?.educationOpportunityCost;
  if (rule === undefined || input.targetEducationScore === undefined) {
    return undefined;
  }
  const missingEducation = Math.max(0, input.targetEducationScore - input.agent.educationScore);
  const studyDurationSeconds =
    rule.educationRatePerSecond <= 0
      ? rule.studyDurationSeconds
      : Math.min(
          rule.studyDurationSeconds,
          Math.ceil(missingEducation / rule.educationRatePerSecond),
        );
  const durationRatio = studyDurationSeconds / rule.studyDurationSeconds;
  const directCurrencyCost = rule.directCurrencyCost * durationRatio;
  const directInventoryCosts = Object.fromEntries(
    Object.entries(rule.directInventoryCosts).map(([commodity, quantity]) => [
      commodity,
      quantity * durationRatio,
    ]),
  );
  const directlyAffordable =
    input.agent.balance >= directCurrencyCost &&
    Object.entries(directInventoryCosts).every(
      ([commodity, quantity]) => (input.agent.inventory[commodity] ?? 0) >= quantity,
    );
  const foregoneLaborIncome = rule.foregoneLaborIncome * durationRatio;
  const balanceAfterDirectCost = input.agent.balance - directCurrencyCost;
  return {
    studyDurationSeconds,
    expectedEducationGain: studyDurationSeconds * rule.educationRatePerSecond,
    directCurrencyCost,
    directInventoryCosts,
    foregoneLaborIncome,
    totalCurrencyOpportunityCost: directCurrencyCost + foregoneLaborIncome,
    balanceAfterDirectCost,
    directlyAffordable,
    preservesMinimumBalanceReserve:
      directlyAffordable && balanceAfterDirectCost >= rule.minimumBalanceReserve,
  };
}

function resolveEducationTarget(context: WorldDecisionContext): number | undefined {
  const currentEducation = context.agent.educationScore;
  const maximumReachableResidentialTier = context.agent.residentialTier + 1;
  const thresholds = [
    ...(context.rules?.residentialUpgrade === undefined
      ? []
      : [context.rules.residentialUpgrade.minEducationScore]),
    ...(context.rules?.occupations
      .filter(
        (occupation) =>
          occupation.requiredResidentialTier <= maximumReachableResidentialTier &&
          occupation.effectiveEducationThreshold > currentEducation,
      )
      .map((occupation) => occupation.effectiveEducationThreshold) ?? []),
  ]
    .filter((threshold) => threshold > currentEducation)
    .sort((left, right) => left - right);
  return thresholds[0];
}

function resolveProgressionSupplyCandidate(context: WorldDecisionContext) {
  const prerequisiteCommodities = new Set(
    context.rules?.occupations
      .filter((occupation) => occupation.jobTier === context.agent.residentialTier)
      .flatMap((occupation) =>
        occupation.prerequisiteCommodity === null ? [] : [occupation.prerequisiteCommodity],
      ) ?? [],
  );
  return context.rules?.production
    .filter((production) => prerequisiteCommodities.has(production.commodity))
    .filter(
      (production) =>
        (context.agent.inventory[production.commodity] ?? 0) < PROGRESSION_SUPPLY_TARGET_QUANTITY,
    )
    .filter((production) =>
      production.rejectionReasons.every((reason) => reason === 'insufficient-input'),
    )
    .sort((left, right) => left.commodity.localeCompare(right.commodity))[0];
}

function createAcquisitionCandidate(input: {
  readonly idPrefix: string;
  readonly missingInventory: Readonly<Record<string, number>>;
  readonly preservedBalance: number;
  readonly score: number;
  readonly rationaleSuffix: string;
  readonly context: WorldDecisionContext;
}): AutonomousLifeCourseCandidate | undefined {
  const [missing] = Object.entries(input.missingInventory).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (missing === undefined) {
    return undefined;
  }
  const [commodity, missingQuantity] = missing;
  const spotPrice = input.context.market.spotPrices.find(
    (price) => price.commodity === commodity,
  )?.spotPrice;
  if (spotPrice === undefined || spotPrice <= 0) {
    return undefined;
  }
  const quantity = Math.max(1, Math.ceil(missingQuantity));
  const estimatedTradeCost = spotPrice * quantity * MARKET_BUY_SLIPPAGE_RESERVE_MULTIPLIER;
  if (input.context.agent.balance < input.preservedBalance + estimatedTradeCost) {
    return undefined;
  }
  return createCandidate({
    id: `${input.idPrefix}:${commodity}`,
    statement: `Buy ${quantity} ${commodity} from the town market.`,
    affinityTags: ['trade', 'market', 'buy', commodity, 'progression'],
    planningDomains: ['trade'],
    score: input.score,
    rationale: `The Agent is missing ${missingQuantity} ${commodity}; the estimated purchase reserve is ${estimatedTradeCost} ${input.rationaleSuffix}.`,
  });
}

function selectInventorySale(input: {
  readonly agent: WorldAgentState;
  readonly worldDecisionContext: WorldDecisionContext;
}):
  | {
      readonly commodity: string;
      readonly quantity: number;
      readonly reservedQuantity: number;
      readonly spotPrice: number;
    }
  | undefined {
  return Object.entries(input.agent.inventory)
    .flatMap(([commodity, quantity]) => {
      const spotPrice = input.worldDecisionContext.market.spotPrices.find(
        (price) => price.commodity === commodity,
      )?.spotPrice;
      const reservedQuantity = resolveOccupationPrerequisiteReserve(
        input.worldDecisionContext,
        commodity,
      );
      const sellableQuantity = quantity - reservedQuantity;
      return sellableQuantity >= 1 && spotPrice !== undefined
        ? [{ commodity, quantity: sellableQuantity, reservedQuantity, spotPrice }]
        : [];
    })
    .sort(
      (left, right) =>
        right.spotPrice - left.spotPrice || left.commodity.localeCompare(right.commodity),
    )[0];
}

function resolveOccupationPrerequisiteReserve(
  context: WorldDecisionContext,
  commodity: string,
): number {
  const currentJobTier =
    context.rules?.occupations.find((occupation) => occupation.occupationName === context.agent.job)
      ?.jobTier ?? 0;
  const isFutureOccupationPrerequisite =
    context.rules?.occupations.some(
      (occupation) =>
        occupation.prerequisiteCommodity === commodity &&
        occupation.jobTier > currentJobTier &&
        occupation.jobTier <= context.agent.residentialTier,
    ) ?? false;
  return isFutureOccupationPrerequisite ? PROGRESSION_PREREQUISITE_RESERVE_QUANTITY : 0;
}

function selectBestOccupation(
  occupations: readonly WorldDecisionOccupationRule[],
  agentId: string,
): WorldDecisionOccupationRule | undefined {
  return [...occupations].sort(
    (left, right) =>
      occupationUtility(right, agentId) - occupationUtility(left, agentId) ||
      right.jobTier - left.jobTier ||
      left.occupationName.localeCompare(right.occupationName),
  )[0];
}

function occupationUtility(occupation: WorldDecisionOccupationRule, agentId: string): number {
  return readWage(occupation) * stablePreferenceFactor(agentId, occupation.occupationName);
}

function stablePreferenceFactor(agentId: string, occupationName: string): number {
  let hash = 2_166_136_261;
  for (const character of `${agentId}:${occupationName}`) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619) >>> 0;
  }
  return 0.97 + (hash % 601) / 10_000;
}

function readWage(occupation: WorldDecisionOccupationRule): number {
  return occupation.currentWage ?? occupation.baseWage;
}

function hasOnlyRejection(reasons: readonly string[], expected: string): boolean {
  return reasons.length === 1 && reasons[0] === expected;
}

function createCandidate(input: {
  readonly id: string;
  readonly statement: string;
  readonly affinityTags: readonly string[];
  readonly planningDomains: readonly string[];
  readonly score: number;
  readonly rationale: string;
}): AutonomousLifeCourseCandidate {
  return {
    ...input,
    priority: 2,
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
  };
}
