import { quoteEarnedLaborCompensation, type TaxPolicy } from '@aivilization/society';
import type { ResidentLaborConfiguration, ResidentLaborTerms } from './residentLaborModel';

/** One price source for ordinary work and production. Each start freezes its own terms. */
export function quoteWorldLaborCompensation(input: {
  configuration: ResidentLaborConfiguration;
  durationMs: number;
  quotedWage: number;
  wageSource: ResidentLaborTerms['wageSource'];
  tax?: TaxPolicy;
}): ResidentLaborTerms {
  return {
    ...quoteEarnedLaborCompensation({
      quotedWage: input.quotedWage,
      laborSeconds: input.durationMs / 1000,
      pay: input.configuration.pay,
      ...(input.tax ? { tax: input.tax } : {}),
    }),
    wageSource: input.wageSource,
  };
}
