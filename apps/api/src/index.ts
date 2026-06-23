import type { CommandEnvelope } from '@aivilization/sim-core';

export type ApiCommandSubmission = {
  readonly command: CommandEnvelope;
  readonly accepted: boolean;
};
