import type { WorldProjection } from '@aivilization/world';
/** A single own process, not a full course catalogue or another person's body/finances. */
export function ownStudyContext(world: WorldProjection, actorId: string) {
  const state = world.residentStudy;
  if (!state) return undefined;
  const id = state.process.activeByActor[actorId],
    s = id ? state.process.sessions[id] : undefined;
  return {
    policyVersion: state.process.policy.version,
    source: state.configuration.source.provider,
    active: s
      ? {
          id: s.id,
          revision: s.revision,
          startedAt: s.startedAt,
          until: s.until,
          settledAt: s.settledAt,
          elapsedMs: s.elapsedMs,
          ownTuitionHeld: (s.terms.allocation.residentMicros - s.applied.residentMicros) / 1e6,
          initialPublicTuitionHeld:
            (s.terms.allocation.treasuryMicros - s.applied.treasuryMicros) / 1e6,
          actualLearning: s.applied.educationNanoPoints / 1e9,
          stopWith: 'town education stop',
        }
      : null,
    readWith: 'town city observe --view study',
    rulesWith: 'town city observe --view rules --section study',
  };
}
