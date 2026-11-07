import type { Controller } from '@aivilization/authority';

/** A real financial right holder, never a fabricated resident for a collective. */
export type CapitalAccount = { readonly sector: 'agent' | 'collective'; readonly id: string };
export type CapitalPosition = { readonly account: CapitalAccount; readonly weight: number };
export type CapitalContribution = {
  readonly account: CapitalAccount;
  readonly amountMicros: number;
};
export type CapitalDestination = CapitalAccount | { readonly sector: 'enterprise' };
export type CapitalDisbursement = {
  readonly account: CapitalDestination;
  readonly amountMicros: number;
};
export type CapitalAuthority = {
  readonly actorId: string;
  readonly controller: Controller;
  readonly decisionId?: string;
};
export type CapitalConsent = {
  readonly authority: CapitalAuthority;
  readonly at: number;
};
export type CapitalAgreement = {
  readonly id: string;
  readonly revision: number;
  readonly proposedBy: string;
  readonly proposerAuthority: CapitalAuthority;
  readonly proposedAt: number;
  readonly expiresAt: number;
  readonly terms: string;
  readonly equityVersion: number;
  readonly positions: readonly CapitalPosition[];
  readonly contributions: readonly CapitalContribution[];
  readonly disbursements: readonly CapitalDisbursement[];
  readonly participants: readonly CapitalAccount[];
  readonly consents: Readonly<Record<string, CapitalConsent>>;
  /** Only required when the agreement actually changes the company's cash. */
  readonly management?: CapitalConsent & { readonly controlVersion: number };
  readonly status: 'proposed' | 'executed' | 'cancelled';
  readonly endedAt?: number;
  readonly endReason?: 'completed' | 'withdrawn' | 'expired' | 'equity-version-changed';
};
export const CAPITAL_AGREEMENTS_POLICY = {
  version: 'enterprise-capital-agreements-v1',
  moneyScale: 1_000_000,
  maxParties: 32,
  maxAgreements: 1000,
  maxOpenAgreements: 16,
  maxTermsChars: 4000,
  maxHorizonMs: 30 * 86_400_000,
} as const;
export type CapitalAgreementsPolicy = typeof CAPITAL_AGREEMENTS_POLICY;
export type EnterpriseCapitalState = {
  readonly initialPositions: readonly CapitalPosition[];
  readonly policyVersion: CapitalAgreementsPolicy['version'];
  readonly equityVersion: number;
  readonly positions: readonly CapitalPosition[];
  readonly agreements: Readonly<Record<string, CapitalAgreement>>;
};
export type CapitalFlow = {
  readonly from: CapitalAccount | { readonly sector: 'escrow' };
  readonly to: CapitalDestination | { readonly sector: 'escrow' };
  readonly amountMicros: number;
};
export type CapitalEvent = {
  readonly type: 'EnterpriseCapitalAgreementChanged';
  readonly policyVersion: CapitalAgreementsPolicy['version'];
  readonly operation: 'propose' | 'accept' | 'authorize' | 'execute' | 'cancel';
  readonly actorId: string;
  readonly at: number;
  readonly previousRevision: number;
  readonly agreement: CapitalAgreement;
  /** Exact transfers bound to this agreement; application must settle these atomically. */
  readonly flows: readonly CapitalFlow[];
};
export type CapitalCommand =
  | {
      readonly type: 'propose';
      readonly id: string;
      readonly terms: string;
      readonly expectedEquityVersion: number;
      readonly expiresAt: number;
      readonly positions: readonly CapitalPosition[];
      readonly contributions: readonly CapitalContribution[];
      readonly disbursements: readonly CapitalDisbursement[];
    }
  | {
      readonly type: 'accept';
      readonly id: string;
      readonly expectedRevision: number;
      readonly account: CapitalAccount;
    }
  | {
      readonly type: 'authorize';
      readonly id: string;
      readonly expectedRevision: number;
      readonly expectedControlVersion: number;
    }
  | { readonly type: 'execute' | 'cancel'; readonly id: string; readonly expectedRevision: number };
export const capitalAccountKey = (a: CapitalAccount): string => `${a.sector}:${a.id}`;
export type CapitalAccess = {
  readonly controller: Controller;
  readonly balanceMicros: number;
  readonly open: boolean;
};
export type CapitalManagement = {
  readonly controller: Controller;
  readonly controlVersion: number;
};
