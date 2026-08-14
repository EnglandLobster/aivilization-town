/**
 * Discrete education levels and the nine-year compulsory education stage.
 *
 * Pure decision functions only: the education system derives an agent's level
 * from its accumulated education score, decides how a study session is funded
 * (compulsory levels are billed to the public treasury, later levels are
 * self-funded), applies the employed-study efficiency penalty, and decides
 * automatic promotion inside the compulsory stage. Exam-gated promotion into
 * levels 3-5 lives in `educationExam.ts` (education-system-v2: application,
 * quantile cutoffs, and the academic/vocational split);
 * `evaluateAutomaticPromotion` returns null for those transitions.
 */

export type EducationLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type EducationTrack = 'academic' | 'vocational';

export type EducationSystemPolicy = {
  readonly policyVersion: string;
  /**
   * When false, every consumer must fall back to the legacy continuous
   * education-score semantics (self-paid study investment, no levels).
   */
  readonly enabled: boolean;
  /**
   * Score thresholds to advance INTO levels 1..5 (小学/初中/高中/大学/研究生).
   * thresholds[i] is the score required to advance from level i to i+1.
   */
  readonly levelScoreThresholds: readonly [number, number, number, number, number];
  /**
   * Levels financed by the town treasury (nine-year compulsory education).
   * The treasury covers tuition for studying at these levels.
   */
  readonly compulsoryLevels: readonly EducationLevel[];
  /**
   * Tuition per study hour indexed by level. Compulsory levels carry a price
   * too — the treasury is reimbursed at this rate.
   */
  readonly levelTuitionPerHour: Readonly<Record<string, number>>;
  /**
   * Multiplier applied to the education rate while studying with a job
   * (0 < ratio <= 1).
   */
  readonly employedStudyEfficiencyRatio: number;
  /**
   * Exam-release cadence (education-system-v2): one admission cycle settles per
   * crossed boundary of this duration (中考/高考/考研 放榜).
   */
  readonly examCycleDurationMs: number;
  /**
   * Admission quota per exam-gated target level, keyed by level ('3' 中考,
   * '4' 高考, '5' 考研): the top `ceil(applicants × quota)` candidates of each
   * cycle are admitted. Values in [0, 1]; a missing key admits nobody.
   */
  readonly admissionQuotaByLevel: Readonly<Record<string, number>>;
  /**
   * Share of 中考 (target level 3) admittees tracked into the vocational
   * school (中职); the higher-scored remainder enters the academic track
   * (普高). In [0, 1].
   */
  readonly vocationalTrackShare: number;
  /**
   * Education-score bonus granted to vocational-track (中职, level 3)
   * applicants when they apply for skilled-manual occupations, keyed by job
   * tier (e.g. { '2': 20, '3': 10 }). Recruitment evaluates the effective
   * score (raw + bonus) for both eligibility and employer ranking; the
   * academic track and university levels never receive a bonus (普高只是升学台阶).
   * Optional so education-system-v2 policies keep their semantics; absent
   * means no bonus.
   */
  readonly vocationalTrackJobTierBonus?: Readonly<Record<string, number>>;
  /**
   * Optional cap on cumulative exam attempts per agent; omitted allows
   * unlimited retakes.
   */
  readonly maxExamAttempts?: number;
  readonly source: string;
};

export const EDUCATION_SYSTEM_MAX_LEVEL = 5 as const satisfies EducationLevel;

export function validateEducationSystemPolicy(policy: EducationSystemPolicy): void {
  if (typeof policy.policyVersion !== 'string' || policy.policyVersion.trim().length === 0) {
    throw new Error('education system policyVersion must be a non-empty string');
  }
  if (typeof policy.enabled !== 'boolean') {
    throw new Error('education system enabled must be a boolean');
  }
  const thresholds = policy.levelScoreThresholds;
  if (thresholds.length !== EDUCATION_SYSTEM_MAX_LEVEL) {
    throw new Error(
      `education system levelScoreThresholds must have exactly ${String(EDUCATION_SYSTEM_MAX_LEVEL)} entries`,
    );
  }
  let previousThreshold = -1;
  thresholds.forEach((threshold, index) => {
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error(`education system levelScoreThresholds[${index}] must be non-negative`);
    }
    if (threshold <= previousThreshold) {
      throw new Error('education system levelScoreThresholds must be strictly increasing');
    }
    previousThreshold = threshold;
  });
  const seenCompulsoryLevels = new Set<number>();
  for (const level of policy.compulsoryLevels) {
    if (!Number.isInteger(level) || level < 0 || level > EDUCATION_SYSTEM_MAX_LEVEL) {
      throw new Error(`education system compulsory level ${String(level)} is out of range 0..5`);
    }
    if (seenCompulsoryLevels.has(level)) {
      throw new Error(`education system compulsory level ${String(level)} is duplicated`);
    }
    seenCompulsoryLevels.add(level);
  }
  for (const [level, tuition] of Object.entries(policy.levelTuitionPerHour)) {
    if (level.trim().length === 0) {
      throw new Error('education system tuition level key must not be empty');
    }
    if (!Number.isFinite(tuition) || tuition < 0) {
      throw new Error(`education system tuition for level ${level} must be non-negative`);
    }
  }
  const ratio = policy.employedStudyEfficiencyRatio;
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
    throw new Error('education system employedStudyEfficiencyRatio must be within (0, 1]');
  }
  if (!Number.isFinite(policy.examCycleDurationMs) || policy.examCycleDurationMs <= 0) {
    throw new Error('education system examCycleDurationMs must be positive');
  }
  for (const [level, quota] of Object.entries(policy.admissionQuotaByLevel)) {
    if (!EDUCATION_EXAM_TARGET_LEVEL_KEYS.has(level)) {
      throw new Error(`education system admission quota level ${level} must be one of 3, 4, 5`);
    }
    if (!Number.isFinite(quota) || quota < 0 || quota > 1) {
      throw new Error(`education system admission quota for level ${level} must be within [0, 1]`);
    }
  }
  if (
    !Number.isFinite(policy.vocationalTrackShare) ||
    policy.vocationalTrackShare < 0 ||
    policy.vocationalTrackShare > 1
  ) {
    throw new Error('education system vocationalTrackShare must be within [0, 1]');
  }
  for (const [tier, bonus] of Object.entries(policy.vocationalTrackJobTierBonus ?? {})) {
    if (!Number.isInteger(Number(tier)) || Number(tier) < 1) {
      throw new Error(`education system vocational track bonus tier ${tier} must be a positive integer`);
    }
    if (!Number.isFinite(bonus) || bonus < 0) {
      throw new Error(`education system vocational track bonus for tier ${tier} must be non-negative`);
    }
  }
  if (
    policy.maxExamAttempts !== undefined &&
    (!Number.isInteger(policy.maxExamAttempts) || policy.maxExamAttempts < 1)
  ) {
    throw new Error('education system maxExamAttempts must be a positive integer');
  }
  if (typeof policy.source !== 'string' || policy.source.trim().length === 0) {
    throw new Error('education system source must be a non-empty string');
  }
}

/** Exam-gated target levels (中考→3, 高考→4, 考研→5) under education-system-v2. */
export type EducationExamTargetLevel = 3 | 4 | 5;

export const EDUCATION_EXAM_TARGET_LEVELS: readonly EducationExamTargetLevel[] = [3, 4, 5];

const EDUCATION_EXAM_TARGET_LEVEL_KEYS = new Set(
  EDUCATION_EXAM_TARGET_LEVELS.map((level) => String(level)),
);

export function isEducationExamTargetLevel(level: number): level is EducationExamTargetLevel {
  return EDUCATION_EXAM_TARGET_LEVEL_KEYS.has(String(level));
}

/**
 * Map an accumulated education score onto the discrete level scale: the level
 * is the number of advancement thresholds the score has met.
 */
export function deriveEducationLevel(score: number, policy: EducationSystemPolicy): EducationLevel {
  if (!Number.isFinite(score) || score < 0) {
    throw new Error('education score must be non-negative');
  }
  let level: EducationLevel = 0;
  for (const threshold of policy.levelScoreThresholds) {
    if (score >= threshold) {
      level = Math.min(level + 1, EDUCATION_SYSTEM_MAX_LEVEL) as EducationLevel;
    } else {
      break;
    }
  }
  return level;
}

export function isCompulsoryLevel(level: EducationLevel, policy: EducationSystemPolicy): boolean {
  return policy.compulsoryLevels.includes(level);
}

export type StudyCostDecision =
  | {
      readonly status: 'accepted';
      /** Tuition paid from the agent's own balance (burned like legacy study investment). */
      readonly selfPayCost: number;
      /** Tuition covered by the public treasury (transfer, supply unchanged). */
      readonly treasuryCoveredCost: number;
      readonly consumedInventory: Readonly<Record<string, number>>;
    }
  | {
      readonly status: 'rejected';
      readonly reason: 'insufficient-balance' | 'policy-invalid';
      readonly detail: string;
    };

/**
 * Decide how one study session is funded.
 *
 * - Compulsory level with a treasury (treasuryBalance !== null): the treasury
 *   covers tuition up to its balance; any shortfall falls back to the agent.
 * - Compulsory level without a treasury feature (null): fully self-paid
 *   (legacy fallback semantics).
 * - Non-compulsory level: fully self-paid.
 *
 * Inventory consumption is zero under education-system-v2: tuition is currency
 * only, mirroring the canonical education investment policy which defines no
 * inventory costs. The field stays in the accepted shape so the settlement
 * events keep a uniform contract.
 */
export type StudyTuitionQuote = {
  /** Full session tuition at the level's hourly rate. */
  readonly tuition: number;
  /** Share billed to the public treasury (compulsory levels only). */
  readonly treasuryCoveredCost: number;
  /** Share billed to the agent's own balance. */
  readonly selfPayCost: number;
};

/**
 * Price one study session without deciding affordability: compulsory levels
 * bill the treasury up to its balance and the remainder falls back to the
 * agent. Returns undefined when the policy defines no usable tuition for the
 * level or an input is not a non-negative finite number, so callers keep the
 * evaluateStudyCost validation for authoritative rejections.
 */
export function quoteStudyTuition(input: {
  readonly level: EducationLevel;
  readonly durationSeconds: number;
  readonly treasuryBalance: number | null;
  readonly policy: EducationSystemPolicy;
}): StudyTuitionQuote | undefined {
  const tuitionPerHour = input.policy.levelTuitionPerHour[String(input.level)];
  if (
    tuitionPerHour === undefined ||
    !isNonNegativeFinite(tuitionPerHour) ||
    !isNonNegativeFinite(input.durationSeconds) ||
    (input.treasuryBalance !== null && !isNonNegativeFinite(input.treasuryBalance))
  ) {
    return undefined;
  }
  const tuition = (tuitionPerHour * input.durationSeconds) / 3600;
  const treasuryCoveredCost =
    isCompulsoryLevel(input.level, input.policy) && input.treasuryBalance !== null
      ? Math.min(tuition, input.treasuryBalance)
      : 0;
  return { tuition, treasuryCoveredCost, selfPayCost: tuition - treasuryCoveredCost };
}

export function evaluateStudyCost(input: {
  readonly level: EducationLevel;
  readonly durationSeconds: number;
  readonly balance: number;
  readonly inventory: Readonly<Record<string, number>>;
  readonly treasuryBalance: number | null;
  readonly policy: EducationSystemPolicy;
}): StudyCostDecision {
  if (!isNonNegativeFinite(input.balance)) {
    return rejectStudyCost('policy-invalid', 'balance must be non-negative');
  }
  if (!isNonNegativeFinite(input.durationSeconds)) {
    return rejectStudyCost('policy-invalid', 'durationSeconds must be non-negative');
  }
  if (input.treasuryBalance !== null && !isNonNegativeFinite(input.treasuryBalance)) {
    return rejectStudyCost('policy-invalid', 'treasuryBalance must be non-negative when provided');
  }
  const tuitionPerHour = input.policy.levelTuitionPerHour[String(input.level)];
  if (tuitionPerHour === undefined) {
    return rejectStudyCost(
      'policy-invalid',
      `education system policy defines no tuition for level ${String(input.level)}`,
    );
  }
  if (!isNonNegativeFinite(tuitionPerHour)) {
    return rejectStudyCost(
      'policy-invalid',
      `tuition for level ${String(input.level)} must be non-negative`,
    );
  }
  const quote = quoteStudyTuition(input);
  if (quote === undefined) {
    // Unreachable after the validations above; keeps the decision total.
    return rejectStudyCost(
      'policy-invalid',
      `education system policy defines no usable tuition for level ${String(input.level)}`,
    );
  }
  if (quote.selfPayCost > input.balance) {
    return rejectStudyCost(
      'insufficient-balance',
      `study tuition requires ${quote.selfPayCost}, available ${input.balance}`,
    );
  }
  return {
    status: 'accepted',
    selfPayCost: quote.selfPayCost,
    treasuryCoveredCost: quote.treasuryCoveredCost,
    consumedInventory: {},
  };
}

function rejectStudyCost(reason: 'insufficient-balance' | 'policy-invalid', detail: string) {
  return { status: 'rejected' as const, reason, detail };
}

/**
 * Apply the employed-study efficiency penalty: studying while holding a job
 * accumulates education at `rate × employedStudyEfficiencyRatio`.
 */
export function applyStudyEfficiency(input: {
  readonly educationRatePerSecond: number;
  readonly employed: boolean;
  readonly policy: EducationSystemPolicy;
}): number {
  if (!isNonNegativeFinite(input.educationRatePerSecond)) {
    throw new Error('educationRatePerSecond must be non-negative');
  }
  return input.employed
    ? input.educationRatePerSecond * input.policy.employedStudyEfficiencyRatio
    : input.educationRatePerSecond;
}

/**
 * Automatic promotion inside the compulsory stage. Advancement into a level is
 * automatic exactly when that target level is compulsory (with thresholds [20,
 * 70, ...] and compulsory [1, 2]: 0→1 and 1→2 advance automatically). Entry
 * into exam-gated levels (3-5 under education-system-v2) returns null and is
 * decided by the exam-release mechanism instead.
 */
export function evaluateAutomaticPromotion(input: {
  readonly level: EducationLevel;
  readonly score: number;
  readonly policy: EducationSystemPolicy;
}): EducationLevel | null {
  if (input.level === EDUCATION_SYSTEM_MAX_LEVEL) {
    return null;
  }
  const nextLevel = (input.level + 1) as EducationLevel;
  if (!isCompulsoryLevel(nextLevel, input.policy)) {
    return null;
  }
  const threshold = input.policy.levelScoreThresholds[input.level];
  if (threshold === undefined || !Number.isFinite(threshold)) {
    return null;
  }
  return input.score >= threshold ? nextLevel : null;
}

/**
 * Effective education score of a job applicant (education-system-v3). A
 * vocational-track (中职) agent at level 3 applying for a skilled-manual
 * occupation is evaluated at `score + vocationalTrackJobTierBonus[tier]`;
 * every other applicant (academic track, other levels, tiers without a
 * configured bonus, disabled policy) keeps the raw score. Pure and
 * deterministic; callers record the result so replay never recomputes it.
 */
export function evaluateEffectiveEducationScoreForOccupation(input: {
  readonly score: number;
  readonly level: EducationLevel;
  readonly track?: EducationTrack;
  readonly occupationTier: number;
  readonly policy: EducationSystemPolicy;
}): number {
  if (!isNonNegativeFinite(input.score)) {
    throw new Error('education score must be non-negative');
  }
  if (!input.policy.enabled || input.level !== EDUCATION_VOCATIONAL_TRACK_LEVEL) {
    return input.score;
  }
  if ((input.track ?? 'academic') !== 'vocational') {
    return input.score;
  }
  const bonus = input.policy.vocationalTrackJobTierBonus?.[String(input.occupationTier)] ?? 0;
  return input.score + bonus;
}

/** Level at which the vocational (中职) track exists and receives its job bonus. */
export const EDUCATION_VOCATIONAL_TRACK_LEVEL = 3 as const satisfies EducationLevel;

/**
 * Chinese-language stage label for decision contexts. Level 3 distinguishes
 * the academic (普高) and vocational (中职) tracks; the vocational track is
 * assigned by the exam-gated tracking stage and defaults to academic.
 */
export function describeEducationStage(input: {
  readonly level: EducationLevel;
  readonly track?: EducationTrack;
}): string {
  switch (input.level) {
    case 0:
      return '未受教育';
    case 1:
      return '小学(义务教育)';
    case 2:
      return '初中(义务教育)';
    case 3:
      return input.track === 'vocational' ? '高中(中职)' : '高中(普高)';
    case 4:
      return '大学';
    case 5:
      return '研究生';
  }
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
