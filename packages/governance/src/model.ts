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
      readonly kind: 'fund-goods';
      readonly orderId: string;
      readonly expectedRevision: number;
      readonly amount: number;
    }
  | {
      readonly kind: 'fund-service';
      readonly expectedRevision: number;
      readonly engagementId: string;
      readonly maximumCharge: number;
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
  readonly procurement?: typeof PUBLIC_PROCUREMENT_GRANT;
  readonly goodsProcurement?: typeof PUBLIC_GOODS_PROCUREMENT_GRANT;
  readonly employment?: typeof PUBLIC_EMPLOYMENT_GRANT;
  readonly housing?: typeof PUBLIC_HOUSING_GRANT;
  readonly principalPermits?: typeof PUBLIC_PRINCIPAL_PERMITS_GRANT;
  readonly resourceSales?:
    | typeof PUBLIC_RESOURCE_SALES_GRANT
    | typeof PUBLIC_RESOURCE_SALES_GRANT_V2;
  readonly periodicObligations?: typeof PUBLIC_PERIODIC_OBLIGATIONS_GRANT;
  readonly principalTrade?: typeof PUBLIC_PRINCIPAL_TRADE_GRANT;
  readonly constructionTrade?: typeof PUBLIC_CONSTRUCTION_TRADE_GRANT;
  readonly services?: typeof PUBLIC_SERVICE_PRINCIPALS_GRANT;
  readonly serviceCreation?: typeof PUBLIC_SERVICE_CREATION_GRANT;
  readonly vehicles?: typeof PUBLIC_VEHICLE_PRINCIPALS_GRANT;
  readonly construction?: typeof PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT;
  readonly resourceCustody?: typeof PUBLIC_RESOURCE_CUSTODY_GRANT;
};
export const PUBLIC_PERIODIC_OBLIGATIONS_GRANT = {
  version: 'public-finite-periodic-commitments-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['periodic-obligation'],
  capabilities: [
    'obligations.offer',
    'obligations.accept',
    'obligations.withdraw',
    'obligations.decline',
    'obligations.terminate',
    'obligations.settle',
    'obligations.waive',
  ],
  maximumTotalMicros: 1000000000000,
  maximumPeriods: 128,
  scope: 'exact-finite-original-parties-terms-and-total-no-borrowing',
} as const;
export const PUBLIC_RESOURCE_SALES_GRANT = {
  version: 'public-paid-resource-control-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['resource-sale'],
  scope: 'exact-price-accounts-source-and-bound-control-effect',
} as const;
export const PUBLIC_RESOURCE_SALES_GRANT_V2 = {
  ...PUBLIC_RESOURCE_SALES_GRANT,
  version: 'public-paid-resource-control-v2',
  assetKinds: ['premises', 'stock', 'vehicle'],
} as const;
export const PUBLIC_CONSTRUCTION_TRADE_GRANT = {
  version: 'public-construction-trade-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['construction-project', 'construction-order'],
  capabilities: [
    'construction-trades.offer',
    'construction-trades.accept',
    'construction-trades.observe',
    'construction-trades.withdraw',
    'construction-trades.propose-settlement',
    'construction-trades.accept-settlement',
  ],
  scope: 'exact-project-order-accounts-price-and-independent-settlement-not-personal-labor',
} as const;
export const PUBLIC_PRINCIPAL_TRADE_GRANT = {
  version: 'public-principal-permit-fees-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['evidence-order'],
  scope: 'exact-permit-order-and-original-treasury-account',
} as const;
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
export const PUBLIC_PROCUREMENT_GRANT = {
  version: 'resident-public-procurement-v1',
  source: 'explicit-scenario-extension',
  treasuryId: 'public-treasury',
  budgetMode: 'actual-service-procurement',
} as const;
export const PUBLIC_GOODS_PROCUREMENT_GRANT = {
  version: 'resident-public-goods-procurement-v1',
  source: 'explicit-scenario-extension',
  treasuryId: 'public-treasury',
  sourceKind: 'freight',
  ownership: 'named-recipient-not-implicit-public-property',
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
  /** Captured by the owning proposal decision, never supplied by the proposer. Absence is legacy v1. */
  readonly resourceSalesScopeVersion?:
    | typeof PUBLIC_RESOURCE_SALES_GRANT.version
    | typeof PUBLIC_RESOURCE_SALES_GRANT_V2.version;
  readonly constructionTradeScopeVersion?: typeof PUBLIC_CONSTRUCTION_TRADE_GRANT.version;
  readonly periodicObligationsScopeVersion?: typeof PUBLIC_PERIODIC_OBLIGATIONS_GRANT.version;
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

export const PUBLIC_PRINCIPAL_PERMITS_GRANT = {
  version: 'public-principal-permits-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['premises-permit'],
  scope: 'exact-permission-contract-not-personal-participation',
} as const;

export const PUBLIC_VEHICLE_PRINCIPALS_GRANT = {
  version: 'public-vehicle-principals-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['vehicle'],
  scope: 'exact-vehicle-custody-and-driver-permissions-not-personal-driving',
} as const;

export const PUBLIC_SERVICE_PRINCIPALS_GRANT = {
  version: 'public-service-principals-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['service'],
  scope: 'exact-directory-and-named-supply-not-body-or-income',
} as const;
export const PUBLIC_SERVICE_CREATION_GRANT = {
  version: 'public-service-creation-v1',
  source: 'explicit-scenario-extension',
  resourceKinds: ['service-directory'],
  scope: 'exact-directory-creation-not-personal-labor-or-physical-facilities',
} as const;
