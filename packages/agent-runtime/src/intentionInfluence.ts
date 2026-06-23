import type { AgentIntentionState } from '@aivilization/memory';
import { selectActiveScheduledIntentions } from '@aivilization/memory';
import type { SimulationTimestamp } from '@aivilization/sim-core';

export type IntentionInfluenceSource = 'objective' | 'scheduled-intention';

export type IntentionInfluenceMatch = {
  readonly source: IntentionInfluenceSource;
  readonly id: string;
  readonly tag: string;
  readonly contribution: number;
};

export type IntentionInfluenceScore = {
  readonly score: number;
  readonly matches: readonly IntentionInfluenceMatch[];
};

const objectiveWeight = 2;
const scheduledIntentionWeight = 3;

export function scoreIntentionInfluence(input: {
  readonly intentionState: AgentIntentionState;
  readonly affinityTags: readonly string[];
  readonly at: SimulationTimestamp;
}): IntentionInfluenceScore {
  const tags = normalizeAffinityTags(input.affinityTags);
  if (tags.length === 0) {
    return { score: 0, matches: [] };
  }

  const matches: IntentionInfluenceMatch[] = [];
  const activeObjective = input.intentionState.activeObjective;
  if (activeObjective !== undefined) {
    for (const tag of tags) {
      if (
        matchesTag({
          tag,
          affinityTags: activeObjective.affinityTags,
          text: activeObjective.statement,
        })
      ) {
        matches.push({
          source: 'objective',
          id: activeObjective.id,
          tag,
          contribution: activeObjective.priority * objectiveWeight,
        });
      }
    }
  }

  for (const intention of selectActiveScheduledIntentions(input.intentionState, input.at)) {
    for (const tag of tags) {
      if (
        matchesTag({
          tag,
          affinityTags: intention.affinityTags,
          text: intention.description,
        })
      ) {
        matches.push({
          source: 'scheduled-intention',
          id: intention.id,
          tag,
          contribution: intention.priority * scheduledIntentionWeight,
        });
      }
    }
  }

  const sortedMatches = matches.sort(compareMatches);
  return {
    score: roundScore(sortedMatches.reduce((total, match) => total + match.contribution, 0)),
    matches: sortedMatches.map((match) => ({
      ...match,
      contribution: roundScore(match.contribution),
    })),
  };
}

function normalizeAffinityTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0))];
}

function matchesTag(input: {
  readonly tag: string;
  readonly affinityTags: readonly string[];
  readonly text: string;
}): boolean {
  return (
    input.affinityTags.some((affinityTag) => normalizeText(affinityTag).includes(input.tag)) ||
    normalizeText(input.text).includes(input.tag)
  );
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function compareMatches(left: IntentionInfluenceMatch, right: IntentionInfluenceMatch): number {
  if (left.source !== right.source) {
    return left.source.localeCompare(right.source);
  }
  if (left.id !== right.id) {
    return left.id.localeCompare(right.id);
  }
  return left.tag.localeCompare(right.tag);
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
