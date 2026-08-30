import {
  deriveEducationLevel,
  evaluateEffectiveEducationScoreForOccupation,
  resolveOccupation,
  type EducationSystemPolicy,
} from '@aivilization/society';
import type { WorldAgentState } from '../projection';

/**
 * Effective education score shared by public and enterprise employment
 * application flows. It is application-layer composition of society rules;
 * settlement events always record the resulting facts.
 */
export function resolveEffectiveApplicationEducationScore(input: {
  readonly agent: WorldAgentState;
  readonly occupationName: string;
  readonly educationSystem?: EducationSystemPolicy;
}): number {
  const policy = input.educationSystem;
  if (policy === undefined || !policy.enabled) {
    return input.agent.educationScore;
  }
  return evaluateEffectiveEducationScoreForOccupation({
    score: input.agent.educationScore,
    level: input.agent.educationLevel ?? deriveEducationLevel(input.agent.educationScore, policy),
    ...(input.agent.educationTrack === undefined ? {} : { track: input.agent.educationTrack }),
    occupationTier: resolveOccupation({ occupationName: input.occupationName }).jobTier,
    policy,
  });
}
