import { occupations, type OccupationConfig } from '@aivilization/content';

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
