import type { PublicAction, PublicProposal } from '@aivilization/governance';
import type { GovernanceChangeCommand, GovernanceChangeAuthority } from '@aivilization/society';

/** Deterministic integration metadata; policy terms are copied exactly from the approved action. */
export function publicPolicyCommand(
  jurisdictionId: string,
  p: PublicProposal,
  actorId: string,
): GovernanceChangeCommand | undefined {
  const a: PublicAction = p.action;
  const authority: GovernanceChangeAuthority = {
    kind: 'public-procedure',
    jurisdictionId,
    proposalId: p.id,
    procedureRevision: p.procedureRevision,
    agentId: actorId,
  };
  const common = {
    reason: `Public decision ${p.id}`,
    authority,
    expectedRevision: a.expectedRevision,
  };
  if (a.kind === 'set-tax')
    return {
      ...common,
      type: 'SetTaxPolicy',
      policy: {
        ...a.terms,
        policyVersion: 'resident-public-tax-v1',
        source: 'resident-public-procedure-v1',
      },
    };
  if (a.kind === 'set-budget')
    return {
      ...common,
      type: 'SetPublicBudget',
      policy: { ...a.terms, policyVersion: 'resident-public-budget-v1' },
    };
  if (a.kind === 'set-subsidy')
    return {
      ...common,
      type: 'SetSubsidyPolicy',
      policy: {
        ...a.terms,
        policyVersion: 'resident-public-subsidy-v1',
        source: 'resident-public-procedure-v1',
      },
    };
  return undefined;
}
