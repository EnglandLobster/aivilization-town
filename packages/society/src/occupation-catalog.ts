import {
  jobTiers,
  occupations,
  type JobTierConfig,
  type OccupationConfig,
} from '@aivilization/content';

export function resolveOccupation(input: {
  readonly occupationName: string;
  readonly occupationCatalog?: readonly OccupationConfig[];
}): OccupationConfig {
  const occupationCatalog = input.occupationCatalog ?? occupations;
  const occupation = occupationCatalog.find((candidate) => candidate.name === input.occupationName);
  if (occupation === undefined) {
    throw new Error(`unknown occupation ${input.occupationName}`);
  }

  return occupation;
}

export function resolveJobTier(input: {
  readonly jobTier: number;
  readonly jobTierCatalog?: readonly JobTierConfig[];
}): JobTierConfig {
  const jobTierCatalog = input.jobTierCatalog ?? jobTiers;
  const jobTier = jobTierCatalog.find((candidate) => candidate.tier === input.jobTier);
  if (jobTier === undefined) {
    throw new Error(`unknown job tier ${input.jobTier}`);
  }

  return jobTier;
}
