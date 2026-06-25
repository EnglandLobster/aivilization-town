import type { LongTermAgentProfile } from './profile';
import type { ShortTermMemoryRecord } from './records';

export type MemorySynthesisShortTermMemoryContextTrace = {
  readonly recordCount: number;
};

export type MemorySynthesisLongTermProfileContextTrace = {
  readonly entryCount: number;
};

export type MemorySynthesisCognitiveContextTrace = {
  readonly shortTermMemoryContext?: MemorySynthesisShortTermMemoryContextTrace;
  readonly longTermProfileContext?: MemorySynthesisLongTermProfileContextTrace;
};

export function createMemorySynthesisCognitiveContextTrace(input: {
  readonly records?: readonly ShortTermMemoryRecord[] | undefined;
  readonly longTermProfile?: LongTermAgentProfile | undefined;
}): MemorySynthesisCognitiveContextTrace {
  return {
    ...(input.records === undefined
      ? {}
      : { shortTermMemoryContext: { recordCount: input.records.length } }),
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
