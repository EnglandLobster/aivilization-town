import {
  deriveEducationLevel,
  validateEducationSystemPolicy,
  type EducationLevel,
  type EducationSystemPolicy,
} from './educationSystem';
export const EDUCATION_AUTHORITY_VERSION = 'resident-education-authority-v1';
export type QualificationOrigin = {
  readonly source:
    | 'scenario-initial-qualification'
    | 'existing-formal-record'
    | 'legacy-score-derived-qualification-preserved'
    | 'registration-initial-qualification';
  readonly level: EducationLevel;
  readonly recordedAt: number;
  readonly institutionPolicyVersion: string;
};
/** One-time recognition, never a rule for converting subsequent learning into qualifications. */
export function recognizeInitialQualification(input: {
  readonly educationScore: number;
  readonly educationLevel?: EducationLevel;
  readonly at: number;
  readonly mode: 'scenario' | 'legacy' | 'registration';
  readonly policy: EducationSystemPolicy;
}): QualificationOrigin {
  validateEducationSystemPolicy(input.policy);
  if (
    !input.policy.enabled ||
    !Number.isSafeInteger(input.at) ||
    input.at < 0 ||
    !Number.isFinite(input.educationScore) ||
    input.educationScore < 0
  )
    throw Error('invalid-qualification-recognition');
  const level = input.educationLevel ?? deriveEducationLevel(input.educationScore, input.policy);
  if (!Number.isInteger(level) || level < 0 || level > 5)
    throw Error('invalid-formal-education-level');
  if (input.mode === 'registration' && (input.educationScore !== 0 || level !== 0))
    throw Error('registration-cannot-invent-qualification');
  return {
    source:
      input.mode === 'registration'
        ? 'registration-initial-qualification'
        : input.mode === 'scenario'
          ? 'scenario-initial-qualification'
          : input.educationLevel === undefined
            ? 'legacy-score-derived-qualification-preserved'
            : 'existing-formal-record',
    level,
    recordedAt: input.at,
    institutionPolicyVersion: input.policy.policyVersion,
  };
}
