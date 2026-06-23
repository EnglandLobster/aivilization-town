export type EducationAccumulationInput = {
  readonly currentEducationScore: number;
  readonly educationRatePerSecond: number;
  readonly studyDurationSeconds: number;
};

export function accumulateEducation(input: EducationAccumulationInput): number {
  assertNonNegativeFinite(input.currentEducationScore, 'currentEducationScore');
  assertNonNegativeFinite(input.educationRatePerSecond, 'educationRatePerSecond');
  assertNonNegativeFinite(input.studyDurationSeconds, 'studyDurationSeconds');

  return input.currentEducationScore + input.educationRatePerSecond * input.studyDurationSeconds;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
