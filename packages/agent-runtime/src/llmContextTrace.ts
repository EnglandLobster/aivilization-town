import type { LongTermAgentProfile, ShortTermMemoryRecord } from '@aivilization/memory';

export type LlmShortTermMemoryContextTrace = {
  readonly recordCount: number;
};

export type LlmLongTermProfileContextTrace = {
  readonly entryCount: number;
};

export type LlmCognitiveContextTrace = {
  readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
  readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
};

export function createLlmCognitiveContextTrace(input: {
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
}): LlmCognitiveContextTrace {
  return {
    ...(input.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: { recordCount: input.shortTermMemoryContext.length } }),
    ...(input.longTermProfile === undefined
      ? {}
      : {
          longTermProfileContext: {
            entryCount: countLongTermProfileEntries(input.longTermProfile),
          },
        }),
  };
}

function countLongTermProfileEntries(profile: LongTermAgentProfile): number {
  return (
    profile.beliefs.length +
    profile.habits.length +
    profile.mood.length +
    profile.values.length +
    profile.personality.length +
    profile.socialRecords.length
  );
}
