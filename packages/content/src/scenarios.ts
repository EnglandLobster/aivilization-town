import {
  asAgentId,
  type AgentId,
  type LocationId,
  type SimulationClock,
} from '@aivilization/sim-core';
import { commodities } from './commodities';
import { townLocations, type TownLocationConfig } from './locations';

export type MbtiType =
  | 'INTJ'
  | 'INTP'
  | 'ENTJ'
  | 'ENTP'
  | 'INFJ'
  | 'INFP'
  | 'ENFJ'
  | 'ENFP'
  | 'ISTJ'
  | 'ISFJ'
  | 'ESTJ'
  | 'ESFJ'
  | 'ISTP'
  | 'ISFP'
  | 'ESTP'
  | 'ESFP';

export type ScenarioPhysiologySeed = {
  readonly energy: number;
  readonly satiety: number;
  readonly health: number;
};

export type ScenarioResidentialPhysiologyCapConfig = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
  readonly source: string;
};

export type ScenarioSleepDeprivationPolicyConfig = {
  readonly energyThreshold: number;
  readonly healthDecayPerSecond: number;
  readonly minHealth: number;
  readonly source: string;
};

export type ScenarioStochasticIllnessPolicyConfig = {
  readonly illnessProbabilityPercentPerHour: number;
  readonly healthDamage: number;
  readonly minHealth: number;
  readonly source: string;
};

export type ScenarioTownWeatherKind =
  | 'sunny'
  | 'cloudy'
  | 'windy'
  | 'rainy'
  | 'stormy'
  | 'snowy'
  | 'foggy';

export type ScenarioTownWeatherTransitionMatrix = Readonly<
  Record<ScenarioTownWeatherKind, Readonly<Record<ScenarioTownWeatherKind, number>>>
>;

export type ScenarioTownWeatherPolicyConfig = {
  readonly policyVersion: string;
  readonly initialWeather: ScenarioTownWeatherKind;
  readonly transitionCadenceMs: number;
  readonly transitions: ScenarioTownWeatherTransitionMatrix;
  readonly source: string;
};

export type ScenarioTownConditionSeverity = 'mild' | 'moderate' | 'severe';

export type ScenarioTownConditionNeed = 'eat' | 'sleep' | 'shelter' | 'warm-up' | 'see-doctor';

export type ScenarioTownPhysiologyConditionConfig = {
  readonly triggerBelow: number;
  readonly severeBelow: number;
  readonly need: ScenarioTownConditionNeed;
};

export type ScenarioTownWeatherConditionConfig = {
  readonly outdoorSeverityByWeather: Readonly<Record<string, ScenarioTownConditionSeverity>>;
  readonly shelteredSeverity?: ScenarioTownConditionSeverity;
  readonly shelteredMaxResidentialTier?: number;
  readonly need: ScenarioTownConditionNeed;
};

export type ScenarioTownConditionsPolicyConfig = {
  readonly policyVersion: string;
  readonly soaked: ScenarioTownWeatherConditionConfig;
  readonly cold: ScenarioTownWeatherConditionConfig;
  readonly overtired: ScenarioTownPhysiologyConditionConfig;
  readonly hungry: ScenarioTownPhysiologyConditionConfig;
  readonly stressed: ScenarioTownPhysiologyConditionConfig;
  readonly source: string;
};

export type ScenarioTownBulletinPolicyConfig = {
  readonly policyVersion: string;
  readonly highPriorityIntentionPriority: number;
  readonly highPriorityReactionWindowMs: number;
  readonly source: string;
};

export type ScenarioSocialMattersPolicyConfig = {
  readonly policyVersion: string;
  readonly defaultExpiryMs: number;
  readonly source: string;
};

export type ScenarioTownConflictPolicyConfig = {
  readonly policyVersion: string;
  readonly grievanceRelationThreshold: number;
  readonly baseDamage: number;
  readonly attackerEnergyDamageFactor: number;
  readonly targetEnergyDefenseFactor: number;
  readonly minDamage: number;
  readonly maxDamage: number;
  readonly attackerEnergyCost: number;
  readonly minHealthAfterAttack: number;
  readonly witnessAttitudePenaltyScale: number;
  /**
   * Optional wellbeing grievance shift (active only when the run also carries
   * a town-wellbeing policy): the strained-relation threshold shifts by
   * maxShift × (50 − wellbeing)/50. Omitted keeps the static threshold.
   */
  readonly wellbeingGrievanceShift?: {
    readonly maxShift: number;
  };
  readonly source: string;
};

export type ScenarioTownWellbeingPolicyConfig = {
  readonly policyVersion: string;
  readonly initialValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly baseline: number;
  readonly convergencePerHour: number;
  readonly coefficients: {
    readonly health: number;
    readonly energy: number;
    readonly satiety: number;
    readonly employed: number;
    readonly unemployed: number;
    readonly residentialTier: readonly number[];
    readonly lifestyleTier: readonly number[];
    readonly upkeepArrearsPerUnit: number;
    readonly distress: number;
    readonly positiveRelation: number;
    readonly negativeRelation: number;
  };
  readonly source: string;
};

export type ScenarioTownCalendarPolicyConfig = {
  readonly policyVersion: string;
  readonly dayLengthMs: number;
  readonly phases: readonly {
    readonly phase: string;
    readonly startFraction: number;
  }[];
  readonly physiologicalDecay: {
    readonly energyPerHour: number;
    readonly satietyPerHour: number;
  };
  readonly source: string;
};

export type ScenarioTownLifecyclePolicyConfig = {
  readonly policyVersion: string;
  readonly dayLengthMs: number;
  readonly stageThresholdsDays: {
    readonly teen: number;
    readonly adult: number;
    readonly elderly: number;
  };
  readonly minLifespanDays: number;
  readonly maxLifespanDays: number;
  readonly illnessDeathHealthThreshold: number;
  readonly illnessDeathProbabilityPerSettlementScale: number;
  readonly pensionPerHour: number;
  readonly source: string;
};


export type ScenarioIncomeTaxBracketConfig = {
  // Inclusive upper bound of the single wage payment this bracket covers;
  // null marks the top (uncapped) bracket.
  readonly upToAmount: number | null;
  readonly rate: number;
};

export type ScenarioTaxPolicyConfig = {
  readonly policyVersion: string;
  readonly neutralRate: number;
  readonly incomeTaxBrackets: readonly ScenarioIncomeTaxBracketConfig[];
  readonly tradeTaxRate: number;
  /** Optional flat rate (0..1) on enterprise dividend payouts, credited to the treasury. */
  readonly dividendTaxRate?: number;
  readonly source: string;
};

export type ScenarioCreditPolicyConfig = {
  readonly policyVersion: string;
  readonly depositDailyInterestRate: number;
  readonly loanDailyInterestRate: number;
  readonly loanTermDays: number;
  /** Simulation ms per credit accrual "day" boundary. */
  readonly accrualCadenceMs: number;
  readonly reserveRatio: number;
  readonly maxLoansPerAgent: number;
  readonly graceMissedPayments: number;
  readonly baseLoanLimit: number;
  readonly creditLimitRepaidBonusRatio: number;
  readonly creditLimitDefaultPenaltyRatio: number;
  readonly creditLimitMinMultiplier: number;
  readonly creditLimitMaxMultiplier: number;
  readonly source: string;
};

export type ScenarioExternalTradePolicyConfig = {
  readonly policyVersion: string;
  /** Fraction of the rolling per-commodity net-export balance decayed per cadence. */
  readonly balanceDecayRatioPerCadence: number;
  /** Simulation ms per balance-decay cadence boundary. */
  readonly cadenceMs: number;
  /** Maximum relative external-price impact once the √balance term saturates. */
  readonly priceImpactRatio: number;
  /** Normalization scale of the √|balance| impact term. */
  readonly balanceScale: number;
  readonly source: string;
};

export type ScenarioLifestylePolicyConfig = {
  readonly policyVersion: string;
  // Strictly increasing net-worth ceilings, exactly 3 entries:
  // below [0] struggling, below [1] stable, below [2] comfortable, else affluent.
  readonly netWorthBoundaries: readonly [number, number, number];
  readonly strugglingNonSurvivalSpendCapRatio: number;
  readonly source: string;
};

export type ScenarioResidentialUpkeepCostConfig = {
  readonly residentialTier: number;
  readonly currencyCostPerHour: number;
  readonly source: string;
};

export type ScenarioResidentialUpkeepPolicyConfig = {
  /**
   * Policy version recorded in the manifest. Absent marks legacy v1 flat
   * per-tier pricing; v2 adds the regional land value term.
   */
  readonly policyVersion?: string;
  readonly costs: readonly ScenarioResidentialUpkeepCostConfig[];
  /**
   * Hours of unpaid upkeep (at the current tier rate) that may accumulate before
   * a forced one-tier downgrade. Omit to disable downgrade consequences.
   */
  readonly arrearsDowngradeThresholdHours?: number;
  /**
   * Optional coefficient converting the agent's regional land value index into
   * an additional per-hour upkeep charge. Omit to keep flat v1 pricing.
   */
  readonly landValueCoefficientPerHour?: number;
};

export type ScenarioLandValuePolicyConfig = {
  readonly policyVersion: string;
  /** Simulation milliseconds between land value re-evaluations. */
  readonly updateCadenceMs: number;
  /** Base index every region starts from and decays toward. */
  readonly baseline: number;
  /** Weight on sqrt(regional agent count). */
  readonly populationWeight: number;
  /** Weight on log1p(regional market liquidity). */
  readonly liquidityWeight: number;
  /** Lerp factor toward the raw target per cadence, in (0, 1]. */
  readonly smoothingFactor: number;
  /** Inclusive clamp bounds for the index. */
  readonly minIndex: number;
  readonly maxIndex: number;
  readonly source: string;
};

export type ScenarioPhysiologicalSafetyNetPolicyConfig = {
  readonly policyVersion: string;
  readonly criticalThresholds: ScenarioPhysiologySeed;
  readonly persistenceDurationMs: number;
  readonly grantCooldownMs: number;
  readonly essentialInventoryTargets: ScenarioInventorySeed;
  readonly source: string;
};

export type ScenarioMedicalTreatmentCostConfig = {
  readonly currencyCostPerSecond: number;
  readonly source: string;
};

export type ScenarioEducationInvestmentPolicyConfig = {
  readonly policyVersion: string;
  readonly currencyCostPerHour: number;
  readonly inventoryCostsPerHour: ScenarioInventorySeed;
  readonly source: string;
};

export type ScenarioEducationSystemPolicyConfig = {
  readonly policyVersion: string;
  /** false falls every consumer back to the legacy continuous-score semantics. */
  readonly enabled: boolean;
  /** Score thresholds to advance into levels 1..5 (strictly increasing). */
  readonly levelScoreThresholds: readonly [number, number, number, number, number];
  /** Levels financed by the treasury (nine-year compulsory education). */
  readonly compulsoryLevels: readonly number[];
  /** Tuition per study hour indexed by level; compulsory levels are reimbursed at this rate. */
  readonly levelTuitionPerHour: Readonly<Record<string, number>>;
  /** Efficiency multiplier applied to study while employed (0 < ratio <= 1). */
  readonly employedStudyEfficiencyRatio: number;
  /** Exam-release cadence: one admission cycle settles per crossed boundary. */
  readonly examCycleDurationMs: number;
  /** Admission quota per exam-gated target level ('3'/'4'/'5'), each in [0, 1]. */
  readonly admissionQuotaByLevel: Readonly<Record<string, number>>;
  /** Share of 中考 admittees tracked into the vocational school (中职), in [0, 1]. */
  readonly vocationalTrackShare: number;
  /**
   * Education-score bonus for vocational-track (中职, level 3) applicants to
   * skilled-manual occupations, keyed by job tier.
   */
  readonly vocationalTrackJobTierBonus: Readonly<Record<string, number>>;
  /** Optional cap on cumulative exam attempts per agent; omitted allows retakes. */
  readonly maxExamAttempts?: number;
  /**
   * Optional wellbeing exam-score bonus (active only when the run also
   * carries a town-wellbeing policy): submissions snapshot a
   * wellbeing-adjusted ranking score, linear in (wellbeing − 50)/50 clamped
   * to ±maxBonus. Omitted keeps ranking on the raw score.
   */
  readonly wellbeingExamScoreBonus?: {
    readonly maxBonus: number;
  };
  readonly source: string;
};

export type ScenarioProductionEfficiencyPhysiologyCapConfig = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
};

export type ScenarioProductionEfficiencyPhysiologyCapPolicyConfig = {
  readonly caps: readonly ScenarioProductionEfficiencyPhysiologyCapConfig[];
};

export type ScenarioProductionEfficiencyPolicyConfig = {
  readonly minEfficiency: number;
  readonly educationScoreForMaxEfficiency: number;
  /**
   * Per-level multiplier applied to the education efficiency factor
   * (education-system-v3), indexed by discrete education level 0..5. Only
   * applies when the caller supplies the agent's education level; legacy
   * continuous-score runs omit the level and keep the un-multiplied factor.
   */
  readonly educationLevelMultipliers: readonly number[];
  readonly physiologyCaps: ScenarioProductionEfficiencyPhysiologyCapPolicyConfig;
  readonly residentialTierForMaxEfficiency: number;
  readonly source: string;
};

export type ScenarioSurvivalTimePolicyDefaults = {
  readonly sleepDeprivation: ScenarioSleepDeprivationPolicyConfig;
  readonly stochasticIllness: ScenarioStochasticIllnessPolicyConfig;
  readonly residentialUpkeep: ScenarioResidentialUpkeepPolicyConfig;
  readonly physiologicalSafetyNet: ScenarioPhysiologicalSafetyNetPolicyConfig;
  readonly landValue: ScenarioLandValuePolicyConfig;
};

export type ScenarioHealthcarePolicyDefaults = {
  readonly seeDoctorTreatmentCost: ScenarioMedicalTreatmentCostConfig;
};

export type ScenarioEducationPolicyDefaults = {
  readonly studyInvestment: ScenarioEducationInvestmentPolicyConfig;
  readonly educationSystem: ScenarioEducationSystemPolicyConfig;
};

export type ScenarioWagePolicyDefaults = {
  readonly policyVersion: string;
  readonly knowledgePremiumPerEducationPoint: number;
  readonly shortTermAdjustment: number;
  readonly maxShortTermAdjustment: number;
  readonly missingMarketPriceIndexStrategy: 'neutral';
  readonly source: string;
};

export type ScenarioApplicationQuotaPolicyConfig = {
  readonly policyVersion: string;
  readonly quotaByResidentialTier: readonly number[];
  readonly source: string;
};

export type ScenarioRecruitmentCyclePolicyConfig = {
  readonly policyVersion: string;
  readonly cycleDurationMs: number;
  readonly defaultOccupationCapacity: number;
  readonly occupationCapacityOverrides: Readonly<Record<string, number>>;
  readonly matchingStrategy: 'applicant-proposing-stable';
  readonly source: string;
};

export type ScenarioJobApplicationPolicyDefaults = {
  readonly applicationQuota: ScenarioApplicationQuotaPolicyConfig;
  readonly recruitmentCycle: ScenarioRecruitmentCyclePolicyConfig;
};

export type ScenarioProductionPolicyDefaults = {
  readonly productionEfficiency: ScenarioProductionEfficiencyPolicyConfig;
};

export type ScenarioInventorySeed = Readonly<Record<string, number>>;

export type ScenarioAgentProfileSeed = {
  readonly personality: {
    readonly mbti: MbtiType;
  };
  readonly source: string;
};

export type ScenarioAgentSeed = {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly profile: ScenarioAgentProfileSeed;
  readonly physiology: ScenarioPhysiologySeed;
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: ScenarioInventorySeed;
  readonly locationId: LocationId | null;
  readonly source: string;
  readonly tags: readonly string[];
};

export type ScenarioMarketPoolSeed = {
  readonly commodity: string;
  readonly commodityReserve: number;
  readonly currencyReserve: number;
  readonly source: string;
  /**
   * Optional regional market this seed belongs to. When the regional-markets
   * switch is enabled, each region gets its own AMM pool per commodity so prices
   * can diverge across the town. Omitted means the global/single-region pool and
   * preserves the legacy seed shape.
   */
  readonly regionId?: string;
};

export type AivilizationScenarioDefaults = {
  readonly maxPhysiology: ScenarioPhysiologySeed;
  readonly ablationInitialPhysiology: ScenarioPhysiologySeed;
  readonly publicTimeScale: number;
  readonly ablationTimeScale: number;
  readonly ablationCohortSize: number;
  readonly agentsPerMbtiType: number;
  readonly mbtiTypes: readonly MbtiType[];
  readonly sources: {
    readonly profileExample: string;
    readonly ablationSetup: string;
    readonly defaultClock: string;
  };
};

export type ScenarioPreset = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly clock: SimulationClock;
  readonly timeScale: number;
  readonly locations: readonly TownLocationConfig[];
  readonly agentSeeds: readonly ScenarioAgentSeed[];
  readonly source: string;
};

export type CreateAivilizationAblationAgentSeedsInput = {
  readonly idPrefix?: string;
  readonly startingIndex?: number;
  readonly locationId?: LocationId | null;
  readonly residentialTier?: number;
  readonly source?: string;
};

export type CreateAivilizationPopulationAgentSeedsInput = {
  readonly agentCount: number;
  readonly idPrefix?: string;
  readonly displayNamePrefix?: string;
  readonly startingIndex?: number;
  readonly locationIds?: readonly LocationId[];
  readonly residentialTier?: number;
  readonly source?: string;
};

export type CreateAivilizationPopulationScenarioPresetInput = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly agentCount: number;
  readonly idPrefix?: string;
  readonly displayNamePrefix?: string;
  readonly startingIndex?: number;
  readonly residentialTier?: number;
  readonly timeScale?: number;
  readonly clock?: SimulationClock;
  readonly locations?: readonly TownLocationConfig[];
  readonly source?: string;
};

export type CreateCommodityMarketPoolSeedsInput = {
  readonly commodityReserve: number;
  readonly currencyReserve: number;
  readonly source?: string;
  /**
   * Optional region to tag every produced seed with. Omitted keeps the legacy
   * single-region seed shape. Used only when the regional-markets switch is on.
   */
  readonly regionId?: string;
};

const profileExampleSource = 'AIvilization v0 Appendix A Table 6';
const ablationSetupSource = 'AIvilization v0 Section 5.1 Experimental Setup';
const activityTradeSource =
  'AIvilization v0 Appendix B Table 8 trade excludes Gold Apple; reserves supplied by scenario caller';
const runtimeScaleProfileSource =
  'AIvilization v0 backend runtime scale profile for 25/100/1000 agent town modes';
const residentialPhysiologyCapSource =
  'AIvilization v0 Section 3.1.1 residential-tier physiology bounds; Appendix A Table 6 shows tier 5 uses 500 caps';
const survivalTimePolicySource =
  'AIvilization v0 Section 3.1.1 survival constraints and Section 3.2 labor-consumption feedback default runtime tuning';
const physiologicalSafetyNetPolicySource =
  'AIvilization v0 Section 3.1.1 requires essential subsidies after persistent low physiology; physiological-safety-net-v1 thresholds, persistence, cooldown, and inventory targets are repository policy decisions because the paper does not specify them';
const healthcarePolicySource =
  'AIvilization v0 Section 3.1.1 healthcare recovery action and resource-constrained survival default runtime tuning';
const educationInvestmentPolicySource =
  'AIvilization v0 Section 3.2.1 requires resource-consuming education; education-investment-v1 is a repository policy decision because the paper does not specify cost rates';
const educationSystemPolicySource =
  'Town education system; education-system-v3 discrete levels, the nine-year compulsory stage (levels 1-2), level thresholds and tuition rates, the employed-study efficiency penalty, the exam-release parameters (cycle cadence, per-level admission quotas, vocational track share), and the vocational-track job-tier education bonus are repository policy decisions because the paper models education as a continuous score';
const wagePolicySource =
  'AIvilization v0 Section 3.2.4 defines static and dynamic wage regimes; wage-regime-v1 is a repository policy decision because the paper does not specify Phi or the short-term shock process';
const jobApplicationPolicySource =
  'AIvilization v0 Section 3.2.3 Equation 13 requires a non-negative, bounded, non-decreasing Nmax(R); application-quota-v1 is a repository policy decision because the paper does not specify tier values';
const recruitmentCyclePolicySource =
  'AIvilization v0 Section 3.2.3 requires recruitment cycles and competitive scarcity; recruitment-cycle-v1 is a repository policy decision because the paper does not specify cadence, capacity, ranking tie-breaks, or matching strategy';
const productionPolicySource =
  'AIvilization v0 Section 3.1.1 productive efficiency G(S,E,J,R,H) and Section 3.2.1 education score default runtime tuning';
const townWeatherPolicySource =
  'Authoritative town weather; town-weather-v1 states, transition matrix, and cadence are repository policy decisions because the paper does not model weather';
const townConditionsPolicySource =
  'Town condition catalog; town-conditions-v1 conditions, thresholds, severities, and implied needs are repository policy decisions because the paper does not model conditions';
const townBulletinPolicySource =
  'Town bulletin board; town-bulletin-v1 priority and preemption parameters are repository policy decisions because the paper does not model bulletin boards';
const socialMattersPolicySource =
  'Social matters state machine; social-matters-v1 lifecycle and expiry parameters are repository policy decisions because the paper does not model social matters';
const townConflictPolicySource =
  'Town conflict system; town-conflict-v1 grievance and damage parameters are repository policy decisions because the paper does not model conflict';
const townWellbeingPolicySource =
  'Town wellbeing; town-wellbeing-v1 baseline, convergence rate, and factor coefficients are repository policy decisions benchmarked against the CS2 citizen Happiness aggregation (health, wealth, employment, housing, and social factors feeding one well-being value), because the paper does not model wellbeing';
const townCalendarPolicySource =
  'Town calendar; town-calendar-v1 day length, phase boundaries, and passive decay rates are repository policy decisions benchmarked against the CS2 daily cycle (citizen sleep window 0.875→0.175), because the paper does not model a day/night calendar';
const townLifecyclePolicySource =
  'Town lifecycle; town-lifecycle-v1 stage thresholds, lifespan window, illness-death risk shape, and pension rate are repository policy decisions benchmarked against the CS2 citizen lifecycle (pre-rolled lifespan, illness death risk concentrated at low health, forced retirement), because the paper does not model population turnover';
const taxPolicySource =
  'Town public finance; tax-regime-v2 brackets, the CS2-convention 10% neutral rate, the trade tax rate, and the dividend tax rate are repository policy decisions because the paper does not model taxation';
const lifestylePolicySource =
  'Town wealth-tiered consumption; lifestyle-v1 net-worth boundaries and the struggling-tier non-survival spend cap are repository policy decisions because the paper does not model wealth-tiered consumption (benchmarked against the CS2 consumption multiplier 0.3+10*smoothstep(wealth))';
const creditPolicySource =
  'Town banking and credit; credit-v1 rates, reserve ratio, amortized loan term, missed-payment grace, and the history-scaled credit-limit schedule are repository policy decisions because the paper does not model banking';
const externalTradePolicySource =
  'Town external trade; external-trade-v1 balance decay, saturating sqrt-balance price impact, and balance scale are repository policy decisions benchmarked against the CS2 TradeSystem rolling trade balance with 1% decay and sqrt|balance| trade cost (TradeSystem.cs:344-364), because the paper does not model external trade';

export const aivilizationScenarioDefaults = {
  maxPhysiology: { energy: 500, satiety: 500, health: 500 },
  ablationInitialPhysiology: { energy: 60, satiety: 60, health: 60 },
  publicTimeScale: 7,
  ablationTimeScale: 35,
  ablationCohortSize: 80,
  agentsPerMbtiType: 5,
  mbtiTypes: [
    'INTJ',
    'INTP',
    'ENTJ',
    'ENTP',
    'INFJ',
    'INFP',
    'ENFJ',
    'ENFP',
    'ISTJ',
    'ISFJ',
    'ESTJ',
    'ESFJ',
    'ISTP',
    'ISFP',
    'ESTP',
    'ESFP',
  ],
  sources: {
    profileExample: profileExampleSource,
    ablationSetup: ablationSetupSource,
    defaultClock: 'AIvilization v0 Section 4.1 and Section 5.1 accelerated clock settings',
  },
} as const satisfies AivilizationScenarioDefaults;

export const aivilizationResidentialPhysiologyCaps = [
  {
    residentialTier: 1,
    maxEnergy: 100,
    maxSatiety: 100,
    maxHealth: 100,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 2,
    maxEnergy: 200,
    maxSatiety: 200,
    maxHealth: 200,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 3,
    maxEnergy: 300,
    maxSatiety: 300,
    maxHealth: 300,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 4,
    maxEnergy: 400,
    maxSatiety: 400,
    maxHealth: 400,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 5,
    maxEnergy: 500,
    maxSatiety: 500,
    maxHealth: 500,
    source: residentialPhysiologyCapSource,
  },
  {
    residentialTier: 6,
    maxEnergy: 500,
    maxSatiety: 500,
    maxHealth: 500,
    source: residentialPhysiologyCapSource,
  },
] as const satisfies readonly ScenarioResidentialPhysiologyCapConfig[];

export const RESIDENTIAL_UPKEEP_POLICY_VERSION = 'residential-upkeep-v2';
export const LAND_VALUE_POLICY_VERSION = 'land-value-v1';

export const aivilizationSurvivalTimePolicyDefaults = {
  sleepDeprivation: {
    energyThreshold: 20,
    healthDecayPerSecond: 0.005,
    minHealth: 10,
    source: survivalTimePolicySource,
  },
  stochasticIllness: {
    illnessProbabilityPercentPerHour: 1,
    healthDamage: 5,
    minHealth: 10,
    source: survivalTimePolicySource,
  },
  residentialUpkeep: {
    policyVersion: RESIDENTIAL_UPKEEP_POLICY_VERSION,
    costs: [
      { residentialTier: 1, currencyCostPerHour: 0, source: survivalTimePolicySource },
      { residentialTier: 2, currencyCostPerHour: 20, source: survivalTimePolicySource },
      { residentialTier: 3, currencyCostPerHour: 40, source: survivalTimePolicySource },
      { residentialTier: 4, currencyCostPerHour: 80, source: survivalTimePolicySource },
      { residentialTier: 5, currencyCostPerHour: 160, source: survivalTimePolicySource },
      { residentialTier: 6, currencyCostPerHour: 320, source: survivalTimePolicySource },
    ],
    // Roughly three days of unpaid upkeep force a one-tier downgrade.
    arrearsDowngradeThresholdHours: 72,
    // Full land value pressure adds roughly a mid-tier upkeep rate on top.
    landValueCoefficientPerHour: 1,
  },
  landValue: {
    policyVersion: LAND_VALUE_POLICY_VERSION,
    // Re-evaluated once per simulation day from regional population and
    // market liquidity; smoothed so single-tick bursts cannot move rents.
    updateCadenceMs: 86_400_000,
    baseline: 0,
    populationWeight: 2,
    liquidityWeight: 1,
    smoothingFactor: 0.4,
    minIndex: 0,
    maxIndex: 100,
    source: survivalTimePolicySource,
  },
  physiologicalSafetyNet: {
    policyVersion: 'physiological-safety-net-v1',
    criticalThresholds: { satiety: 20, energy: 20, health: 20 },
    persistenceDurationMs: 3_600_000,
    grantCooldownMs: 21_600_000,
    essentialInventoryTargets: { Apple: 2 },
    source: physiologicalSafetyNetPolicySource,
  },
} as const satisfies ScenarioSurvivalTimePolicyDefaults;

export const TOWN_WEATHER_POLICY_VERSION = 'town-weather-v1';

/**
 * Authoritative town weather. The Markov
 * transition matrix is evaluated once per `transitionCadenceMs` of simulation
 * time; every row sums to 1 so rain can naturally persist or clear. The policy
 * is opt-in (default off) and only settles while explicitly enabled.
 */
export const aivilizationTownWeatherPolicyDefaults = {
  policyVersion: TOWN_WEATHER_POLICY_VERSION,
  initialWeather: 'sunny',
  transitionCadenceMs: 3_600_000,
  transitions: {
    sunny: { sunny: 0.55, cloudy: 0.25, windy: 0.1, rainy: 0, stormy: 0, snowy: 0, foggy: 0.1 },
    cloudy: { sunny: 0.3, cloudy: 0.35, windy: 0.1, rainy: 0.15, stormy: 0, snowy: 0, foggy: 0.1 },
    windy: {
      sunny: 0.15,
      cloudy: 0.25,
      windy: 0.3,
      rainy: 0.15,
      stormy: 0.1,
      snowy: 0.05,
      foggy: 0,
    },
    rainy: {
      sunny: 0,
      cloudy: 0.25,
      windy: 0.1,
      rainy: 0.4,
      stormy: 0.15,
      snowy: 0.05,
      foggy: 0.05,
    },
    stormy: { sunny: 0, cloudy: 0.2, windy: 0.2, rainy: 0.35, stormy: 0.25, snowy: 0, foggy: 0 },
    snowy: { sunny: 0, cloudy: 0.3, windy: 0.1, rainy: 0.1, stormy: 0, snowy: 0.35, foggy: 0.15 },
    foggy: { sunny: 0.25, cloudy: 0.3, windy: 0, rainy: 0.1, stormy: 0, snowy: 0.05, foggy: 0.3 },
  },
  source: townWeatherPolicySource,
} as const satisfies ScenarioTownWeatherPolicyConfig;

export const TOWN_CONDITIONS_POLICY_VERSION = 'town-conditions-v1';

/**
 * Condition catalog. Conditions are
 * derived read-path state over durable physiology axes, the town weather, and
 * location exposure — never stored. Pure threshold triggers keep derivation
 * deterministic without events or RNG. Opt-in via the town-conditions switch.
 */
export const aivilizationTownConditionsPolicyDefaults = {
  policyVersion: TOWN_CONDITIONS_POLICY_VERSION,
  soaked: {
    outdoorSeverityByWeather: { rainy: 'moderate', stormy: 'severe' },
    need: 'shelter',
  },
  cold: {
    outdoorSeverityByWeather: { snowy: 'severe', foggy: 'moderate' },
    shelteredSeverity: 'mild',
    shelteredMaxResidentialTier: 1,
    need: 'warm-up',
  },
  overtired: { triggerBelow: 30, severeBelow: 10, need: 'sleep' },
  hungry: { triggerBelow: 30, severeBelow: 10, need: 'eat' },
  stressed: { triggerBelow: 40, severeBelow: 20, need: 'see-doctor' },
  source: townConditionsPolicySource,
} as const satisfies ScenarioTownConditionsPolicyConfig;

export const TOWN_BULLETIN_POLICY_VERSION = 'town-bulletin-v1';

/**
 * Town bulletin board. Opt-in via the
 * town-bulletin switch. High-priority bulletins preempt resident planning with
 * a forced-attention ScheduledIntention; normal bulletins only enter awareness
 * memory. The reaction window uses wall-clock ms, matching the social
 * observation reaction scheduling convention.
 */
export const aivilizationTownBulletinPolicyDefaults = {
  policyVersion: TOWN_BULLETIN_POLICY_VERSION,
  highPriorityIntentionPriority: 90,
  highPriorityReactionWindowMs: 3_600_000,
  source: townBulletinPolicySource,
} as const satisfies ScenarioTownBulletinPolicyConfig;

export const SOCIAL_MATTERS_POLICY_VERSION = 'social-matters-v1';

/**
 * Social matters: conversation
 * commitments escalate into a world-side matter state machine, and agents can
 * raise help requests with candidate/assignment/fulfillment tracking. Opt-in
 * via the social-matters switch. Default expiry is 4 simulation hours.
 */
export const aivilizationSocialMattersPolicyDefaults = {
  policyVersion: SOCIAL_MATTERS_POLICY_VERSION,
  defaultExpiryMs: 14_400_000,
  source: socialMattersPolicySource,
} as const satisfies ScenarioSocialMattersPolicyConfig;

export const TOWN_CONFLICT_POLICY_VERSION = 'town-conflict-v1';

/**
 * Town conflict system. Opt-in via the
 * town-conflict switch. The world adjudicates grievance issuance, damage, and
 * fallout deterministically; attacks incapacitate but never kill.
 */
export const aivilizationTownConflictPolicyDefaults = {
  policyVersion: TOWN_CONFLICT_POLICY_VERSION,
  grievanceRelationThreshold: 0,
  baseDamage: 15,
  attackerEnergyDamageFactor: 0.05,
  targetEnergyDefenseFactor: 0.02,
  minDamage: 1,
  maxDamage: 40,
  attackerEnergyCost: 10,
  minHealthAfterAttack: 0,
  witnessAttitudePenaltyScale: 0.5,
  // relationScore ∈ [−1, 1]: a max shift of 0.2 means a fully distressed
  // attacker (wellbeing 0) treats relations below +0.2 as strained, while a
  // thriving one (wellbeing 100) needs genuine hostility below −0.2.
  wellbeingGrievanceShift: { maxShift: 0.2 },
  source: townConflictPolicySource,
} as const satisfies ScenarioTownConflictPolicyConfig;

export const TOWN_WELLBEING_POLICY_VERSION = 'town-wellbeing-v1';

/**
 * Agent wellbeing (幸福感) authoritative state variable, benchmarked against
 * the Cities: Skylines II citizen Happiness system. Opt-in via the
 * town-wellbeing switch. AdvanceSimulationTime settles one per-agent scalar:
 * the target is the baseline plus per-factor contributions (physiology axes
 * normalized around 50, employment, housing/lifestyle tiers, upkeep arrears,
 * safety-net distress, and social relation means), and the durable value
 * converges toward it by at most convergencePerHour per hour, snapping onto
 * the target once reachable so quiet agents stop emitting events. Coefficients
 * stay mild: every single factor moves the target by at most 10.
 */
export const aivilizationTownWellbeingPolicyDefaults = {
  policyVersion: TOWN_WELLBEING_POLICY_VERSION,
  initialValue: 50,
  minValue: 0,
  maxValue: 100,
  baseline: 50,
  convergencePerHour: 2,
  coefficients: {
    health: 10,
    energy: 6,
    satiety: 6,
    employed: 4,
    unemployed: -6,
    // Indexed by residentialTier (tiers start at 1; index 0 is unused).
    residentialTier: [0, -4, -2, 0, 2, 4, 6],
    // Indexed by the canonical lifestyle order struggling..affluent.
    lifestyleTier: [-6, -2, 2, 6],
    upkeepArrearsPerUnit: -0.05,
    distress: -8,
    positiveRelation: 6,
    negativeRelation: -8,
  },
  source: townWellbeingPolicySource,
} as const satisfies ScenarioTownWellbeingPolicyConfig;

export const TOWN_CALENDAR_POLICY_VERSION = 'town-calendar-v1';

/**
 * Town day/night calendar and passive physiological decay, benchmarked against
 * the Cities: Skylines II daily cycle. Opt-in via the town-calendar switch.
 * One simulation day is 24 simulation hours (86_400_000 ms) — the same grid
 * the land value and education exam cadences already use; at the default
 * public timeScale (7 sim-ms per wall-ms tick of 1000 ms) a phase boundary
 * becomes observable within minutes of wall time. Phase boundaries map the
 * CS2 citizen sleep window (0.875 → 0.175) onto evening + night. Passive
 * decay drains a full 100-point satiety axis in about 8 simulation hours and
 * a full energy axis in about 16, so agents must eat roughly every workday
 * and sleep once per day, matching the CS2 daily routine rhythm.
 */
export const aivilizationTownCalendarPolicyDefaults = {
  policyVersion: TOWN_CALENDAR_POLICY_VERSION,
  dayLengthMs: 86_400_000,
  phases: [
    { phase: 'night', startFraction: 0 },
    { phase: 'dawn', startFraction: 0.175 },
    { phase: 'day', startFraction: 0.3 },
    { phase: 'dusk', startFraction: 0.8 },
    { phase: 'evening', startFraction: 0.875 },
  ],
  physiologicalDecay: { energyPerHour: 6.25, satietyPerHour: 12.5 },
  source: townCalendarPolicySource,
} as const satisfies ScenarioTownCalendarPolicyConfig;

export const TOWN_LIFECYCLE_POLICY_VERSION = 'town-lifecycle-v1';

/**
 * Population lifecycle minimal set, benchmarked against the Cities: Skylines
 * II citizen lifecycle. Opt-in via the town-lifecycle switch. Every agent is
 * an adult at registration (child/teen are reserved for a future birth
 * mechanism); agents turn elderly after 70 simulation days, die of old age at
 * a per-agent pre-rolled lifespan in [90, 130] days, and can die of illness
 * only below health 30 with quadratically concentrated risk (CS2's
 * `(10 − health/10)²` shape). Elderly agents holding a job are forcibly
 * retired and paid an hourly pension from the public treasury (1/hour keeps a
 * pensioner above the physiological safety net without competing with wages).
 */
export const aivilizationTownLifecyclePolicyDefaults = {
  policyVersion: TOWN_LIFECYCLE_POLICY_VERSION,
  dayLengthMs: 86_400_000,
  stageThresholdsDays: { teen: 15, adult: 21, elderly: 70 },
  minLifespanDays: 90,
  maxLifespanDays: 130,
  illnessDeathHealthThreshold: 30,
  illnessDeathProbabilityPerSettlementScale: 20,
  pensionPerHour: 1,
  source: townLifecyclePolicySource,
} as const satisfies ScenarioTownLifecyclePolicyConfig;


export const aivilizationHealthcarePolicyDefaults = {
  seeDoctorTreatmentCost: {
    currencyCostPerSecond: 0.02,
    source: healthcarePolicySource,
  },
} as const satisfies ScenarioHealthcarePolicyDefaults;

export const EDUCATION_SYSTEM_POLICY_VERSION = 'education-system-v3';

/**
 * Town education system. Education becomes a discrete six-level ladder
 * (未受教育/小学/初中/高中/大学/研究生) derived from the accumulated score; levels
 * 1-2 form the nine-year compulsory stage whose tuition the public treasury
 * covers (with an agent fallback when the treasury is off or short), later
 * levels are self-funded at their level's hourly rate, and studying while
 * employed accumulates score at the reduced efficiency ratio. Promotion inside
 * the compulsory stage is automatic at the thresholds; entry into levels 3-5
 * is exam-gated (education-system-v2): agents apply for the 中考/高考/考研, one
 * admission cycle releases per examCycleDurationMs boundary, each level group
 * admits its top `ceil(applicants × quota)` candidates by score, and admitted
 * 中考 candidates split into the academic (普高) and vocational (中职) tracks at
 * the vocationalTrackShare ratio. Under education-system-v3, vocational-track
 * (中职, level 3) applicants to skilled-manual occupations are evaluated at an
 * effective education score (raw + vocationalTrackJobTierBonus[tier]) for both
 * eligibility and employer ranking.
 */
export const aivilizationEducationSystemPolicyDefaults = {
  policyVersion: EDUCATION_SYSTEM_POLICY_VERSION,
  enabled: true,
  levelScoreThresholds: [20, 70, 180, 320, 450],
  compulsoryLevels: [1, 2],
  levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
  employedStudyEfficiencyRatio: 0.3,
  examCycleDurationMs: 86_400_000,
  admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
  vocationalTrackShare: 0.5,
  vocationalTrackJobTierBonus: { 2: 20, 3: 10 },
  // ±10 score points on a 0-450 scale: a nudge on competitive position, never
  // enough to cross an eligibility threshold on its own (eligibility always
  // checks the raw score).
  wellbeingExamScoreBonus: { maxBonus: 10 },
  source: educationSystemPolicySource,
} as const satisfies ScenarioEducationSystemPolicyConfig;

export const aivilizationEducationPolicyDefaults = {
  studyInvestment: {
    policyVersion: 'education-investment-v1',
    currencyCostPerHour: 20,
    inventoryCostsPerHour: {},
    source: educationInvestmentPolicySource,
  },
  educationSystem: aivilizationEducationSystemPolicyDefaults,
} as const satisfies ScenarioEducationPolicyDefaults;

export const aivilizationWagePolicyDefaults = {
  policyVersion: 'wage-regime-v1',
  knowledgePremiumPerEducationPoint: 0.001,
  shortTermAdjustment: 0,
  maxShortTermAdjustment: 0.1,
  missingMarketPriceIndexStrategy: 'neutral',
  source: wagePolicySource,
} as const satisfies ScenarioWagePolicyDefaults;

export const aivilizationJobApplicationPolicyDefaults = {
  applicationQuota: {
    policyVersion: 'application-quota-v1',
    quotaByResidentialTier: [1, 1, 2, 3, 4, 5],
    source: jobApplicationPolicySource,
  },
  recruitmentCycle: {
    policyVersion: 'recruitment-cycle-v1',
    cycleDurationMs: 86_400_000,
    defaultOccupationCapacity: 1,
    occupationCapacityOverrides: {},
    matchingStrategy: 'applicant-proposing-stable',
    source: recruitmentCyclePolicySource,
  },
} as const satisfies ScenarioJobApplicationPolicyDefaults;

export const aivilizationProductionPolicyDefaults = {
  productionEfficiency: {
    minEfficiency: 0.5,
    educationScoreForMaxEfficiency: 500,
    educationLevelMultipliers: [1, 1.2, 1.5, 2, 2.5, 3],
    physiologyCaps: {
      caps: aivilizationResidentialPhysiologyCaps.map((cap) => ({
        residentialTier: cap.residentialTier,
        maxEnergy: cap.maxEnergy,
        maxSatiety: cap.maxSatiety,
        maxHealth: cap.maxHealth,
      })),
    },
    residentialTierForMaxEfficiency: 5,
    source: productionPolicySource,
  },
} as const satisfies ScenarioProductionPolicyDefaults;

export const TAX_POLICY_VERSION = 'tax-regime-v2';

/**
 * Town public finance. Wage income is taxed progressively per payment
 * (brackets below) and sell-side trades pay a flat rate on the proceeds; both
 * settle as transfers into the projection treasury, which funds safety-net
 * subsidies once present. Enterprise dividend payouts additionally pay a flat
 * profit tax into the treasury (v2). The neutral rate is the CS2-convention
 * 10% shown to agents in decision contexts; settlement always uses the
 * brackets.
 */
export const aivilizationTaxPolicyDefaults = {
  policyVersion: TAX_POLICY_VERSION,
  neutralRate: 0.1,
  incomeTaxBrackets: [
    // 低档工资免税（起征点）
    { upToAmount: 300, rate: 0 },
    { upToAmount: 800, rate: 0.08 },
    { upToAmount: null, rate: 0.12 },
  ],
  tradeTaxRate: 0.05,
  dividendTaxRate: 0.1,
  source: taxPolicySource,
} as const satisfies ScenarioTaxPolicyConfig;

export const LIFESTYLE_POLICY_VERSION = 'lifestyle-v1';

/**
 * Wealth-tiered consumption. Net worth (balance plus inventory valued at spot
 * prices) maps onto struggling/stable/comfortable/affluent tiers; only the
 * struggling tier constrains planning — its non-survival spending (non-food
 * purchases, residential upgrades, education investment) is capped at
 * `strugglingNonSurvivalSpendCapRatio` of the spendable balance, mirroring the
 * low end of the CS2 consumption multiplier `0.3+10*smoothstep(wealth)`.
 */
export const aivilizationLifestylePolicyDefaults = {
  policyVersion: LIFESTYLE_POLICY_VERSION,
  netWorthBoundaries: [500, 2000, 10000],
  strugglingNonSurvivalSpendCapRatio: 0.3,
  source: lifestylePolicySource,
} as const satisfies ScenarioLifestylePolicyConfig;

export const CREDIT_POLICY_VERSION = 'credit-v1';

/**
 * Town banking and credit. The town bank accepts agent deposits paying a
 * daily interest rate out of its own cash, and issues amortized loans whose
 * daily auto-collection settles interest-first from the borrower's cash;
 * consecutive under-covered days beyond the grace window default the loan.
 * Issuance is bounded by the borrower's history-scaled credit limit and by
 * the reserve requirement (bank cash must keep `reserveRatio` of deposits).
 * All movements are transfers between circulating accounts, so banking never
 * moves the money supply; deposit and loan rates differ so the bank can run
 * a spread loss or profit.
 */
export const aivilizationCreditPolicyDefaults = {
  policyVersion: CREDIT_POLICY_VERSION,
  depositDailyInterestRate: 0.001,
  loanDailyInterestRate: 0.01,
  loanTermDays: 30,
  accrualCadenceMs: 86_400_000,
  reserveRatio: 0.2,
  maxLoansPerAgent: 1,
  graceMissedPayments: 3,
  baseLoanLimit: 5000,
  creditLimitRepaidBonusRatio: 0.2,
  creditLimitDefaultPenaltyRatio: 0.5,
  creditLimitMinMultiplier: 0.1,
  creditLimitMaxMultiplier: 3,
  source: creditPolicySource,
} as const satisfies ScenarioCreditPolicyConfig;

export const EXTERNAL_TRADE_POLICY_VERSION = 'external-trade-v1';

/**
 * Town external trade (import/export with the external sector). Agents and
 * enterprises sell into / buy from the external sector at their regional AMM
 * spot price adjusted by a rolling per-commodity net-export balance: the more
 * the town net-exports a commodity the lower the next export price, and the
 * more it net-imports the higher the next import price, with the impact
 * saturating at `priceImpactRatio` via a √balance term. The balance decays
 * 1% per cadence (CS2 TradeSystem convention). Exports inject currency from
 * the external sector (moneySupply rises) and imports burn into it (falls).
 */
export const aivilizationExternalTradePolicyDefaults = {
  policyVersion: EXTERNAL_TRADE_POLICY_VERSION,
  balanceDecayRatioPerCadence: 0.01,
  cadenceMs: 3_600_000,
  priceImpactRatio: 0.2,
  balanceScale: 50,
  source: externalTradePolicySource,
} as const satisfies ScenarioExternalTradePolicyConfig;

export function createAivilizationAblationAgentSeeds(
  input: CreateAivilizationAblationAgentSeedsInput = {},
): ScenarioAgentSeed[] {
  const idPrefix = input.idPrefix ?? 'ablation-agent';
  const startingIndex = input.startingIndex ?? 1;
  const residentialTier = input.residentialTier ?? 1;
  const locationId = input.locationId === undefined ? null : input.locationId;
  const source = input.source ?? ablationSetupSource;

  assertNonEmptyString(idPrefix, 'idPrefix');
  assertPositiveInteger(startingIndex, 'startingIndex');
  assertPositiveInteger(residentialTier, 'residentialTier');
  assertNonEmptyString(source, 'source');

  return aivilizationScenarioDefaults.mbtiTypes.flatMap((mbti, typeIndex) =>
    Array.from({ length: aivilizationScenarioDefaults.agentsPerMbtiType }, (_, cohortIndex) => {
      const serial =
        startingIndex + typeIndex * aivilizationScenarioDefaults.agentsPerMbtiType + cohortIndex;
      return {
        agentId: asAgentId(`${idPrefix}-${formatAgentSerial(serial)}`),
        displayName: `Ablation Agent ${formatAgentSerial(serial)}`,
        profile: {
          personality: { mbti },
          source: profileExampleSource,
        },
        physiology: { ...aivilizationScenarioDefaults.ablationInitialPhysiology },
        educationScore: 0,
        balance: 0,
        residentialTier,
        job: null,
        inventory: {},
        locationId,
        source,
        tags: ['ablation', 'empty-profile'],
      };
    }),
  );
}

export function createCommodityMarketPoolSeeds(
  input: CreateCommodityMarketPoolSeedsInput,
): ScenarioMarketPoolSeed[] {
  assertPositiveFinite(input.commodityReserve, 'commodityReserve');
  assertPositiveFinite(input.currencyReserve, 'currencyReserve');
  const source = input.source ?? activityTradeSource;
  assertNonEmptyString(source, 'source');

  return commodities
    .filter((commodity) => commodity.name !== 'Gold Apple')
    .map((commodity) => ({
      commodity: commodity.name,
      commodityReserve: input.commodityReserve,
      currencyReserve: input.currencyReserve,
      source,
      ...(input.regionId === undefined ? {} : { regionId: input.regionId }),
    }));
}

export function createAivilizationPopulationAgentSeeds(
  input: CreateAivilizationPopulationAgentSeedsInput,
): ScenarioAgentSeed[] {
  const idPrefix = input.idPrefix ?? 'agent';
  const displayNamePrefix = input.displayNamePrefix ?? 'Agent';
  const startingIndex = input.startingIndex ?? 1;
  const residentialTier = input.residentialTier ?? 1;
  const source = input.source ?? runtimeScaleProfileSource;
  const locationIds = input.locationIds ?? townLocations.map((location) => location.locationId);

  assertPositiveInteger(input.agentCount, 'agentCount');
  assertNonEmptyString(idPrefix, 'idPrefix');
  assertNonEmptyString(displayNamePrefix, 'displayNamePrefix');
  assertPositiveInteger(startingIndex, 'startingIndex');
  assertPositiveInteger(residentialTier, 'residentialTier');
  assertNonEmptyString(source, 'source');
  assertNonEmptyArray(locationIds, 'locationIds');

  return Array.from({ length: input.agentCount }, (_, index) => {
    const serial = startingIndex + index;
    const serialLabel = formatAgentSerial(serial);
    const mbti =
      aivilizationScenarioDefaults.mbtiTypes[
        index % aivilizationScenarioDefaults.mbtiTypes.length
      ] ?? 'INTJ';
    const locationId = locationIds[index % locationIds.length];
    if (locationId === undefined) {
      throw new Error('locationIds must not be empty');
    }

    return {
      agentId: asAgentId(`${idPrefix}-${serialLabel}`),
      displayName: `${displayNamePrefix} ${serialLabel}`,
      profile: {
        personality: { mbti },
        source: profileExampleSource,
      },
      physiology: { ...aivilizationScenarioDefaults.maxPhysiology },
      educationScore: (index % 6) * 80,
      balance: 100 + (index % 20) * 25,
      residentialTier,
      job: null,
      inventory: {},
      locationId,
      source,
      tags: ['runtime-scale', 'profile-seeded'],
    };
  });
}

export function createAivilizationPopulationScenarioPreset(
  input: CreateAivilizationPopulationScenarioPresetInput,
): ScenarioPreset {
  const source = input.source ?? runtimeScaleProfileSource;
  const locations = input.locations ?? townLocations;
  const timeScale = input.timeScale ?? aivilizationScenarioDefaults.publicTimeScale;

  assertNonEmptyString(input.id, 'id');
  assertNonEmptyString(input.name, 'name');
  assertNonEmptyString(input.description, 'description');
  assertNonEmptyString(source, 'source');
  assertPositiveFinite(timeScale, 'timeScale');
  assertNonEmptyArray(locations, 'locations');

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    clock: input.clock ?? { now: 0, tickDurationMs: 1000 },
    timeScale,
    locations,
    agentSeeds: createAivilizationPopulationAgentSeeds({
      agentCount: input.agentCount,
      ...(input.idPrefix === undefined ? {} : { idPrefix: input.idPrefix }),
      ...(input.displayNamePrefix === undefined
        ? {}
        : { displayNamePrefix: input.displayNamePrefix }),
      ...(input.startingIndex === undefined ? {} : { startingIndex: input.startingIndex }),
      ...(input.residentialTier === undefined ? {} : { residentialTier: input.residentialTier }),
      locationIds: locations.map((location) => location.locationId),
      source,
    }),
    source,
  };
}

export const aivilizationAblationScenarioPreset = {
  id: 'aivilization-ablation-80-agent-cohort',
  name: 'AIvilization Ablation Cohort',
  description:
    'Deterministic 80-agent cohort matching Section 5.1 initial state and MBTI distribution assumptions.',
  clock: { now: 0, tickDurationMs: 1000 },
  timeScale: aivilizationScenarioDefaults.ablationTimeScale,
  locations: townLocations,
  agentSeeds: createAivilizationAblationAgentSeeds(),
  source: ablationSetupSource,
} as const satisfies ScenarioPreset;

function formatAgentSerial(value: number): string {
  return String(value).padStart(3, '0');
}

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}

function assertNonEmptyArray<TValue>(values: readonly TValue[], name: string): void {
  if (values.length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
