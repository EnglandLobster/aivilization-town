export const RESIDENT_LEARNING_POLICY = { version: 'resident-learning-v1', maxText: 8000 } as const;
export type LearningAssessment = {
  id: string;
  bookingId: string;
  teacherId: string;
  learnerId: string;
  content: string;
  at: number;
};
export type LearningState = {
  version: 'resident-learning-v1';
  assessments: Readonly<Record<string, LearningAssessment>>;
};
export type LearningEvent = { type: 'LearningAssessmentRecorded'; assessment: LearningAssessment };
export function emptyLearningState(): LearningState {
  return { version: 'resident-learning-v1', assessments: {} };
}
export function decideLearningAssessment(
  s: LearningState,
  a: string,
  at: number,
  input: { id: string; bookingId: string; content: string },
  evidence: { teacherId: string; learnerId: string; completed: boolean } | undefined,
): { accepted: true; events: readonly LearningEvent[] } | { accepted: false; reason: string } {
  if (!evidence?.completed || evidence.teacherId !== a)
    return { accepted: false, reason: 'completed-course-teacher-required' };
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(input.id) ||
    Object.hasOwn(s.assessments, input.id) ||
    !input.content.trim() ||
    input.content.length > RESIDENT_LEARNING_POLICY.maxText
  )
    return { accepted: false, reason: 'invalid-assessment' };
  return {
    accepted: true,
    events: [
      {
        type: 'LearningAssessmentRecorded',
        assessment: {
          id: input.id,
          bookingId: input.bookingId,
          teacherId: a,
          learnerId: evidence.learnerId,
          content: input.content,
          at,
        },
      },
    ],
  };
}
export function applyLearningEvent(s: LearningState, e: LearningEvent): LearningState {
  return { ...s, assessments: { ...s.assessments, [e.assessment.id]: e.assessment } };
}
