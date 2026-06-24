import type {
  LongTermAgentProfile,
  LongTermProfileEntry,
  LongTermProfileSection,
} from '@aivilization/memory';

export type ProfileInfluenceEntryMatch = {
  readonly section: LongTermProfileSection;
  readonly key: string;
  readonly tag: string;
  readonly contribution: number;
  readonly provenanceRecordIds: readonly string[];
};

export type ProfileInfluenceScore = {
  readonly score: number;
  readonly matches: readonly ProfileInfluenceEntryMatch[];
};

const sectionWeights = {
  beliefs: 0.5,
  habits: 2,
  mood: 1.25,
  values: 2,
  personality: 1,
  socialRecords: 1,
} as const satisfies Record<LongTermProfileSection, number>;

const sectionOrder = {
  beliefs: 0,
  habits: 1,
  mood: 2,
  values: 3,
  personality: 4,
  socialRecords: 5,
} as const satisfies Record<LongTermProfileSection, number>;

export function scoreProfileInfluence(input: {
  readonly profile: LongTermAgentProfile;
  readonly affinityTags: readonly string[];
}): ProfileInfluenceScore {
  const affinityTags = input.affinityTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);

  if (affinityTags.length === 0) {
    return { score: 0, matches: [] };
  }

  const matches = (
    [
      ['beliefs', input.profile.beliefs],
      ['habits', input.profile.habits],
      ['mood', input.profile.mood],
      ['values', input.profile.values],
      ['personality', input.profile.personality],
      ['socialRecords', input.profile.socialRecords],
    ] as const
  ).flatMap(([section, entries]) => scoreSection(section, entries, affinityTags));

  return {
    score: roundScore(matches.reduce((sum, match) => sum + match.contribution, 0)),
    matches: matches.sort(compareMatches),
  };
}

function scoreSection(
  section: LongTermProfileSection,
  entries: readonly LongTermProfileEntry[],
  affinityTags: readonly string[],
): ProfileInfluenceEntryMatch[] {
  return entries.flatMap((entry) =>
    affinityTags
      .filter((tag) => entryMatchesTag(entry, tag))
      .map((tag) => ({
        section,
        key: entry.key,
        tag,
        contribution: contributionForEntry(section, entry),
        provenanceRecordIds: [...entry.provenanceRecordIds],
      })),
  );
}

function entryMatchesTag(entry: LongTermProfileEntry, tag: string): boolean {
  const normalizedTag = normalize(tag);
  return (
    normalize(entry.key).includes(normalizedTag) ||
    normalize(entry.statement).includes(normalizedTag)
  );
}

function socialBonus(entry: LongTermProfileEntry): number {
  return Math.max(0, entry.relationDelta ?? 0) + Math.max(0, entry.attitudeDelta ?? 0);
}

function contributionForEntry(
  section: LongTermProfileSection,
  entry: LongTermProfileEntry,
): number {
  return roundScore(
    section === 'socialRecords' ? socialBonus(entry) : entry.confidence * sectionWeights[section],
  );
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function compareMatches(
  left: ProfileInfluenceEntryMatch,
  right: ProfileInfluenceEntryMatch,
): number {
  if (left.section !== right.section) {
    return sectionOrder[left.section] - sectionOrder[right.section];
  }
  if (left.key !== right.key) {
    return left.key.localeCompare(right.key);
  }
  return left.tag.localeCompare(right.tag);
}
