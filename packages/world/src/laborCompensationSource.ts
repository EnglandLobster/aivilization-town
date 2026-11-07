import {
  activeEnterpriseLaborTerms,
  ENTERPRISE_LABOR_TERMS_POLICY,
  type EnterpriseState,
} from '@aivilization/enterprise';
import {
  quoteEarnedLaborCompensation,
  calculateLaborPay,
  type TaxPolicy,
} from '@aivilization/society';
import type { ResidentLaborConfiguration, ResidentLaborTerms } from './residentLaborModel';

export const AGREED_LABOR_SOURCE = 'accepted-enterprise-labor-terms-v1';
/** One price source for ordinary work, production and services. Each start freezes its own terms. */
export function resolveLaborCompensationSource(input: {
  configuration: ResidentLaborConfiguration;
  enterprise: EnterpriseState;
  actorId: string;
  at: number;
  durationMs: number;
  legacyQuote: number;
  legacySource: 'recorded-employment-offer' | 'initial-wage-regime';
}) {
  const c = input.configuration;
  if (c.compensationSource === AGREED_LABOR_SOURCE) {
    const agreed = activeEnterpriseLaborTerms(input.enterprise, input.actorId, input.at);
    if (!agreed || input.at + input.durationMs > agreed.validUntil)
      throw Error('accepted-current-labor-terms-required');
    return {
      quotedWage: agreed.wageMicros / ENTERPRISE_LABOR_TERMS_POLICY.moneyScale,
      pay: {
        version: 'labor-proportional-pay-v1' as const,
        referenceSeconds: agreed.referenceMs / 1000,
      },
      wageSource: 'accepted-labor-terms' as const,
      agreement: {
        id: agreed.id,
        revision: agreed.revision,
        membershipGeneration: agreed.membershipGeneration,
        wageMicros: agreed.wageMicros,
        referenceMs: agreed.referenceMs,
      },
    };
  }
  return { quotedWage: input.legacyQuote, pay: c.pay, wageSource: input.legacySource };
}
export function quoteWorldLaborCompensation(
  input: Parameters<typeof resolveLaborCompensationSource>[0] & { tax?: TaxPolicy },
): ResidentLaborTerms {
  const source = resolveLaborCompensationSource(input);
  return {
    ...quoteEarnedLaborCompensation({
      quotedWage: source.quotedWage,
      laborSeconds: input.durationMs / 1000,
      pay: source.pay,
      ...(input.tax ? { tax: input.tax } : {}),
    }),
    wageSource: source.wageSource,
    ...('agreement' in source ? { agreement: source.agreement } : {}),
  };
}
/** Source validation only at start. Later payments use the frozen claim and never re-read new agreements. */
export function assertAgreedLaborCompensation(
  input: Omit<
    Parameters<typeof resolveLaborCompensationSource>[0],
    'legacyQuote' | 'legacySource'
  > & { terms: ResidentLaborTerms },
) {
  if (input.configuration.compensationSource !== AGREED_LABOR_SOURCE) {
    if (input.terms.wageSource === 'accepted-labor-terms' || input.terms.agreement)
      throw Error('labor-agreement-mode-required');
    return;
  }
  const source = resolveLaborCompensationSource({
    ...input,
    legacyQuote: 0,
    legacySource: 'initial-wage-regime',
  });
  if (
    !('agreement' in source) ||
    !source.agreement ||
    input.terms.wageSource !== 'accepted-labor-terms' ||
    !input.terms.agreement ||
    Object.entries(source.agreement).some(
      ([key, value]) => input.terms.agreement![key as keyof typeof source.agreement] !== value,
    ) ||
    input.terms.grossMicros !==
      Math.round(calculateLaborPay(source.quotedWage, input.durationMs / 1000, source.pay) * 1e6)
  )
    throw Error('labor-agreement-compensation-source-mismatch');
}
