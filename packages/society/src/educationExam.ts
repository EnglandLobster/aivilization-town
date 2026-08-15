/**
 * Exam-gated education promotion (education-system-v2): 中考/高考/考研放榜制.
 *
 * Pure decision functions only. Agents apply for the exam into the next level
 * (`evaluateEducationExamEligibility` gates the application); once per exam
 * cycle the world settles every pending application through
 * `evaluateEducationExamCycle`, which ranks each target-level group by score,
 * admits the top `ceil(applicants × quota)` candidates (放榜划线), and splits
 * 中考 admittees into the academic (普高) and vocational (中职) tracks. The
 * world adapter maps the resolutions onto durable events; nothing here reads
 * or writes world state.
 */

import {
  isEducationExamTargetLevel,
  type EducationExamTargetLevel,
  type EducationLevel,
  type EducationSystemPolicy,
  type EducationTrack,
} from './educationSystem';

export type EducationExamApplication = {
  readonly applicationId: string;
  readonly agentId: string;
  readonly targetLevel: EducationExamTargetLevel;
  readonly educationScore: number;
  /**
   * Ranking score snapshot recorded at submission when a wellbeing bonus (or
   * any future submission-time adjustment) applied; absent ranks on the raw
   * educationScore. Recorded as a final fact so cycle replay never recomputes
   * the bonus (the same convention as recruitment's effectiveEducationScore).
   */
  readonly effectiveEducationScore?: number;
  readonly submittedAt: number;
};

/**
 * Wellbeing exam-score bonus (education × town-wellbeing interlock): linear
 * in (wellbeing − 50)/50 and clamped to ±maxBonus — content candidates get a
 * modest edge, distressed candidates a modest drag. Pure; the caller
 * snapshots the result into the application at submission time.
 */
export function evaluateWellbeingExamScoreBonus(input: {
  readonly wellbeing: number;
  readonly policy: EducationSystemPolicy;
}): number {
  const config = input.policy.wellbeingExamScoreBonus;
  if (config === undefined) {
    return 0;
  }
  if (!Number.isFinite(input.wellbeing)) {
    throw new Error('wellbeing exam bonus requires a finite wellbeing value');
  }
  const maxBonus = config.maxBonus;
  if (!Number.isFinite(maxBonus) || maxBonus < 0) {
    throw new Error('wellbeingExamScoreBonus.maxBonus must be non-negative finite');
  }
  const bonus = (maxBonus * (input.wellbeing - 50)) / 50;
  return Math.max(-maxBonus, Math.min(maxBonus, bonus));
}

/** Ranking score of an application: the snapshot when present, else the raw. */
export function resolveExamRankingScore(application: EducationExamApplication): number {
  return application.effectiveEducationScore ?? application.educationScore;
}

export type EducationExamEligibilityRejectionReason =
  | 'policy-disabled'
  | 'unsupported-target-level'
  | 'level-mismatch'
  | 'score-below-threshold'
  | 'track-ineligible'
  | 'attempts-exhausted';

export type EducationExamEligibilityDecision =
  | {
      readonly status: 'accepted';
      readonly targetLevel: EducationExamTargetLevel;
    }
  | {
      readonly status: 'rejected';
      readonly reason: EducationExamEligibilityRejectionReason;
      readonly detail: string;
    };

/**
 * Gate one exam application. Eligible exactly when the policy is enabled, the
 * target is an exam-gated level (3/4/5), the agent currently sits one level
 * below it, the agent's score meets the target's entry threshold, the track
 * constraint holds (高考 requires the academic track — 中职 does not feed
 * directly into university), and the optional attempt cap is not exhausted.
 */
export function evaluateEducationExamEligibility(input: {
  readonly agent: {
    readonly educationLevel: EducationLevel;
    readonly educationTrack?: EducationTrack;
    readonly educationScore: number;
    readonly examAttempts: number;
  };
  readonly targetLevel: number;
  readonly policy: EducationSystemPolicy;
}): EducationExamEligibilityDecision {
  if (!input.policy.enabled) {
    return rejectEligibility('policy-disabled', 'education system policy is disabled');
  }
  if (!Number.isInteger(input.targetLevel) || !isEducationExamTargetLevel(input.targetLevel)) {
    return rejectEligibility(
      'unsupported-target-level',
      `exam target level ${String(input.targetLevel)} must be one of 3, 4, 5`,
    );
  }
  const targetLevel = input.targetLevel;
  if (input.agent.educationLevel !== targetLevel - 1) {
    return rejectEligibility(
      'level-mismatch',
      `exam into level ${targetLevel} requires current level ${targetLevel - 1}, got ${input.agent.educationLevel}`,
    );
  }
  const threshold = input.policy.levelScoreThresholds[targetLevel - 1];
  if (threshold === undefined) {
    return rejectEligibility(
      'score-below-threshold',
      `education system policy defines no entry threshold for level ${targetLevel}`,
    );
  }
  if (!Number.isFinite(input.agent.educationScore) || input.agent.educationScore < threshold) {
    return rejectEligibility(
      'score-below-threshold',
      `exam into level ${targetLevel} requires score ${threshold}, got ${input.agent.educationScore}`,
    );
  }
  if (targetLevel === 4 && (input.agent.educationTrack ?? 'academic') !== 'academic') {
    return rejectEligibility(
      'track-ineligible',
      'the university entrance exam (高考) requires the academic track; vocational-track (中职) agents cannot apply',
    );
  }
  if (
    input.policy.maxExamAttempts !== undefined &&
    input.agent.examAttempts >= input.policy.maxExamAttempts
  ) {
    return rejectEligibility(
      'attempts-exhausted',
      `exam attempt cap ${input.policy.maxExamAttempts} reached (${input.agent.examAttempts} attempts)`,
    );
  }
  return { status: 'accepted', targetLevel };
}

function rejectEligibility(
  reason: EducationExamEligibilityRejectionReason,
  detail: string,
): EducationExamEligibilityDecision {
  return { status: 'rejected', reason, detail };
}

export type EducationExamResolutionStatus = 'admitted' | 'rejected';

export type EducationExamResolutionReason = 'quota-admitted' | 'below-cutoff';

export type EducationExamResolution = {
  readonly applicationId: string;
  readonly agentId: string;
  readonly targetLevel: EducationExamTargetLevel;
  readonly status: EducationExamResolutionStatus;
  /** Track assignment for admitted 中考 (target 3) candidates only. */
  readonly track?: EducationTrack;
  /** Cutoff score of the candidate's level group, when the group admitted anyone. */
  readonly cutoffScore?: number;
  readonly reason: EducationExamResolutionReason;
};

export type EducationExamLevelSummary = {
  readonly targetLevel: EducationExamTargetLevel;
  readonly applicationCount: number;
  readonly admittedCount: number;
  /** Lowest admitted score of the group; absent when nobody was admitted. */
  readonly cutoffScore?: number;
};

export type EducationExamCycleDecision = {
  readonly cycleNumber: number;
  readonly resolutions: readonly EducationExamResolution[];
  readonly summaries: readonly EducationExamLevelSummary[];
};

/**
 * Settle one exam cycle (放榜). Applications are grouped by target level; each
 * group ranks by score descending (ties broken by agentId, then applicationId,
 * for deterministic replay) and admits the top `ceil(count × quota)`. The
 * cutoff is the lowest admitted score. Admitted 中考 candidates split into
 * tracks: the top `round(admitted × (1 − vocationalTrackShare))` enter the
 * academic track (普高), the rest the vocational track (中职).
 */
export function evaluateEducationExamCycle(input: {
  readonly applications: readonly EducationExamApplication[];
  readonly cycleNumber: number;
  readonly policy: EducationSystemPolicy;
}): EducationExamCycleDecision {
  if (!Number.isInteger(input.cycleNumber) || input.cycleNumber < 0) {
    throw new Error('education exam cycleNumber must be a non-negative integer');
  }
  validateExamApplications(input.applications);

  const resolutions: EducationExamResolution[] = [];
  const summaries: EducationExamLevelSummary[] = [];
  const groups = new Map<EducationExamTargetLevel, EducationExamApplication[]>();
  for (const application of input.applications) {
    const group = groups.get(application.targetLevel) ?? [];
    group.push(application);
    groups.set(application.targetLevel, group);
  }

  for (const targetLevel of [...groups.keys()].sort((left, right) => left - right)) {
    const group = (groups.get(targetLevel) ?? []).slice().sort(compareExamCandidates);
    const quota = input.policy.admissionQuotaByLevel[String(targetLevel)] ?? 0;
    const admittedCount = Math.min(group.length, Math.ceil(group.length * quota));
    const admitted = group.slice(0, admittedCount);
    const cutoffScore =
      admitted[admitted.length - 1] === undefined
        ? undefined
        : resolveExamRankingScore(admitted[admitted.length - 1] as EducationExamApplication);

    const trackByApplicationId = new Map<string, EducationTrack>();
    if (targetLevel === 3 && admitted.length > 0) {
      const academicCount = Math.round(admitted.length * (1 - input.policy.vocationalTrackShare));
      admitted.forEach((application, index) => {
        trackByApplicationId.set(
          application.applicationId,
          index < academicCount ? 'academic' : 'vocational',
        );
      });
    }

    for (const application of group) {
      const isAdmitted = admitted.includes(application);
      resolutions.push({
        applicationId: application.applicationId,
        agentId: application.agentId,
        targetLevel,
        status: isAdmitted ? 'admitted' : 'rejected',
        ...(isAdmitted && targetLevel === 3
          ? { track: trackByApplicationId.get(application.applicationId) ?? 'academic' }
          : {}),
        ...(cutoffScore === undefined ? {} : { cutoffScore }),
        reason: isAdmitted ? 'quota-admitted' : 'below-cutoff',
      });
    }
    summaries.push({
      targetLevel,
      applicationCount: group.length,
      admittedCount,
      ...(cutoffScore === undefined ? {} : { cutoffScore }),
    });
  }

  return {
    cycleNumber: input.cycleNumber,
    resolutions,
    summaries,
  };
}

function compareExamCandidates(
  left: EducationExamApplication,
  right: EducationExamApplication,
): number {
  return (
    resolveExamRankingScore(right) - resolveExamRankingScore(left) ||
    left.agentId.localeCompare(right.agentId) ||
    left.applicationId.localeCompare(right.applicationId)
  );
}

function validateExamApplications(applications: readonly EducationExamApplication[]): void {
  const applicationIds = new Set<string>();
  const agentTargets = new Set<string>();
  for (const application of applications) {
    if (application.applicationId.trim().length === 0) {
      throw new Error('education exam applicationId must not be empty');
    }
    if (application.agentId.trim().length === 0) {
      throw new Error('education exam agentId must not be empty');
    }
    if (!isEducationExamTargetLevel(application.targetLevel)) {
      throw new Error(
        `education exam target level ${String(application.targetLevel)} must be one of 3, 4, 5`,
      );
    }
    if (!Number.isFinite(application.educationScore) || application.educationScore < 0) {
      throw new Error('education exam educationScore must be non-negative');
    }
    if (
      application.effectiveEducationScore !== undefined &&
      !Number.isFinite(application.effectiveEducationScore)
    ) {
      throw new Error('education exam effectiveEducationScore must be finite');
    }
    if (!Number.isFinite(application.submittedAt) || application.submittedAt < 0) {
      throw new Error('education exam submittedAt must be non-negative');
    }
    if (applicationIds.has(application.applicationId)) {
      throw new Error(`duplicate education exam application id ${application.applicationId}`);
    }
    applicationIds.add(application.applicationId);
    const agentTarget = `${application.agentId}\0${application.targetLevel}`;
    if (agentTargets.has(agentTarget)) {
      throw new Error(
        `duplicate education exam application for ${application.agentId} and level ${application.targetLevel}`,
      );
    }
    agentTargets.add(agentTarget);
  }
}
