import type { PrincipalControlRequest, PrincipalOperationRequest } from '@aivilization/authority';
import type {
  TaxPolicy,
  PublicBudgetPolicy,
  SafetyNetSubsidyPolicy,
  PublicEmploymentTerms,
  PublicHousingTerms,
} from '@aivilization/society';

/** Authorization and attributed procedure facts only. Money and enacted policy remain in their owning domains. */
export const PUBLIC_GOVERNANCE_POLICY = {
  version: 'resident-public-governance-v1',
  minimumBudgetCadenceMs: 60000,
  maxElectors: 100,
  maxProposals: 10000,
  maxVotingMs: 30 * 86400000,
  maxExecutionMs: 30 * 86400000,
  maxVoteChanges: 100,
} as const;
export type PublicProcedure = {
  readonly electorate: readonly string[];
  readonly minimumTurnout: number;
  readonly minimumYes: number;
  readonly allowVoteChanges: boolean;
  readonly minimumVotingMs: number;
  readonly maximumVotingMs: number;
  readonly executionWindowMs: number;
  readonly executors: 'electorate' | readonly string[];
};
export type PublicAction =
  | {
      readonly kind: 'manage-resource';
      readonly expectedRevision: number;
      readonly request: PrincipalOperationRequest;
    }
  | {
      readonly kind: 'control-resource';
      readonly expectedRevision: number;
      readonly request: PrincipalControlRequest;
    }
  | {
      readonly kind: 'set-housing';
      readonly expectedRevision: number;
      readonly terms: PublicHousingTerms;
    }
  | {
      readonly kind: 'set-employment';
      readonly expectedRevision: number;
      readonly terms: PublicEmploymentTerms;
    }
  | {
      readonly kind: 'set-tax';
      readonly expectedRevision: number;
      readonly terms: Omit<TaxPolicy, 'policyVersion' | 'source'>;
    }
  | {
      readonly kind: 'set-budget';
      readonly expectedRevision: number;
      readonly terms: Omit<PublicBudgetPolicy, 'policyVersion'>;
    }
  | {
      readonly kind: 'set-subsidy';
      readonly expectedRevision: number;
      readonly terms: SafetyNetSubsidyPolicy;
    }
  | {
      readonly kind: 'set-procedure';
      readonly expectedRevision: number;
      readonly terms: PublicProcedure;
    }
  | {
      readonly kind: 'invalidate-decision';
      readonly proposalId: string;
      readonly expectedRevision: number;
      readonly reason: string;
    };
export type PublicJurisdictionGrant = {
  readonly id: string;
  readonly source: {
    readonly kind: 'explicit-scenario-grant';
    readonly version: string;
    readonly description: string;
  };
  readonly residents: readonly string[];
  readonly actions: readonly PublicAction['kind'][];
  readonly employment?: typeof PUBLIC_EMPLOYMENT_GRANT;
  readonly housing?: typeof PUBLIC_HOUSING_GRANT;
  readonly construction?: typeof PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT;
  readonly resourceCustody?: typeof PUBLIC_RESOURCE_CUSTODY_GRANT;
};
export const PUBLIC_RESOURCE_CUSTODY_GRANT = {
  version: 'public-resource-custody-v2',
  source: 'explicit-scenario-extension',
  resourceKinds: ['stock', 'premises'],
  scope: 'exact-control-or-operation-not-personal-participation',
} as const;
export const PUBLIC_HOUSING_GRANT = {
  version: 'resident-public-housing-v1',
  source: 'explicit-scenario-extension',
  scope: 'initial-housing-service-tariff-and-upgrade-eligibility',
  effect: 'from-execution-time',
} as const;
export const PUBLIC_EMPLOYMENT_GRANT = {
  version: 'resident-public-employment-rules-v1',
  source: 'explicit-scenario-extension',
  scope: 'existing-public-recruitment',
  effect: 'next-recruitment-cycle',
} as const;
export type PublicVote = {
  readonly actorId: string;
  readonly choice: 'yes' | 'no' | 'abstain';
  readonly at: number;
};
export type PublicProposal = {
  readonly id: string;
  readonly revision: number;
  readonly authorId: string;
  readonly text: string;
  readonly action: PublicAction;
  readonly procedureRevision: number;
  readonly procedure: PublicProcedure;
  readonly createdAt: number;
  readonly closesAt: number;
  readonly expiresAt: number;
  readonly votes: Readonly<Record<string, PublicVote>>;
  readonly voteChanges: Readonly<Record<string, number>>;
  readonly status: 'voting' | 'approved' | 'rejected' | 'withdrawn' | 'executed' | 'invalidated';
  readonly closedAt?: number;
  readonly closedBy?: string;
  readonly result?: { readonly yes: number; readonly no: number; readonly abstain: number };
  readonly executedAt?: number;
  readonly executedBy?: string;
  readonly effectIds?: readonly string[];
  readonly invalidatedByProposal?: string;
};
export type PublicObjection = {
  readonly id: string;
  readonly proposalId: string;
  readonly actorId: string;
  readonly text: string;
  readonly at: number;
};
export type PublicGovernanceState = {
  readonly policy: typeof PUBLIC_GOVERNANCE_POLICY;
  readonly grant: PublicJurisdictionGrant;
  readonly procedure: PublicProcedure;
  readonly procedureRevision: number;
  readonly proposals: Readonly<Record<string, PublicProposal>>;
  readonly objections: Readonly<Record<string, PublicObjection>>;
};
export type PublicGovernanceEvent =
  | { readonly type: 'PublicProposalOpened'; readonly proposal: PublicProposal }
  | {
      readonly type: 'PublicVoteRecorded';
      readonly proposalId: string;
      readonly previousRevision: number;
      readonly vote: PublicVote;
    }
  | {
      readonly type: 'PublicBallotClosed';
      readonly proposalId: string;
      readonly previousRevision: number;
      readonly actorId: string;
      readonly at: number;
      readonly approved: boolean;
      readonly counts: NonNullable<PublicProposal['result']>;
    }
  | {
      readonly type: 'PublicProposalWithdrawn';
      readonly proposalId: string;
      readonly previousRevision: number;
      readonly actorId: string;
      readonly at: number;
    }
  | {
      readonly type: 'PublicDecisionExecuted';
      readonly proposalId: string;
      readonly previousRevision: number;
      readonly actorId: string;
      readonly at: number;
      readonly effectIds: readonly string[];
    }
  | {
      readonly type: 'PublicProcedureChanged';
      readonly proposalId: string;
      readonly previousRevision: number;
      readonly procedure: PublicProcedure;
    }
  | {
      readonly type: 'PublicDecisionInvalidated';
      readonly proposalId: string;
      readonly previousRevision: number;
      readonly byProposalId: string;
    }
  | { readonly type: 'PublicObjectionRecorded'; readonly objection: PublicObjection };
export type PublicCommand =
  | {
      readonly type: 'propose';
      readonly id: string;
      readonly text: string;
      readonly action: PublicAction;
      readonly closesAt: number;
      readonly expectedProcedureRevision: number;
    }
  | {
      readonly type: 'vote';
      readonly id: string;
      readonly expectedRevision: number;
      readonly choice: PublicVote['choice'];
    }
  | { readonly type: 'close' | 'withdraw'; readonly id: string; readonly expectedRevision: number }
  | {
      readonly type: 'object';
      readonly id: string;
      readonly proposalId: string;
      readonly text: string;
    };
export type PublicDecision =
  | { readonly accepted: true; readonly events: readonly PublicGovernanceEvent[] }
  | { readonly accepted: false; readonly reason: string };

export const PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT = {
  version: 'public-construction-principals-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['construction-site', 'construction-project'],
  scope: 'exact-project-authority-not-personal-labor',
} as const;
