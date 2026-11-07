import type { CAPITAL_ESTATE_CONTINUITY_POLICY } from './capitalEstateContinuity';
import type { ResidentEstateCashEffects } from './residentEstateCashEffects';
import type {
  EnterpriseCapitalEvent,
  CapitalAuthority,
  CapitalAccount,
  CapitalCommand,
} from '@aivilization/enterprise';
import type { CAPITAL_AGREEMENTS_POLICY } from '@aivilization/enterprise';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
export type CapitalDeferredDistribution = {
  readonly enterpriseId: string;
  readonly at: number;
  readonly equityVersion: number;
  readonly amount: number;
  readonly reason: string;
};
export type CapitalWorldState = {
  readonly deferredDistributions?: Readonly<Record<string, CapitalDeferredDistribution>>;
  readonly policy: typeof CAPITAL_AGREEMENTS_POLICY;
  readonly enabledAt: number;
};
export type CapitalEnterpriseCommand =
  | CapitalCommand
  | { type: 'initialize' }
  | { type: 'close'; expectedEquityVersion: number; expectedControlVersion: number };
export type CapitalInvocation =
  | { readonly kind: 'management'; readonly proof: CapitalAuthority }
  | { readonly kind: 'holder'; readonly account: CapitalAccount; readonly proof: CapitalAuthority }
  | { readonly kind: 'proposer'; readonly proof: CapitalAuthority }
  | { readonly kind: 'automatic' };
export type CapitalEnterpriseEffect = {
  readonly enterpriseId: string;
  readonly event: EnterpriseCapitalEvent;
};
export type CapitalCommittedPayload = {
  readonly policyVersion: typeof CAPITAL_AGREEMENTS_POLICY.version;
  readonly actorId: string;
  readonly enterpriseId: string;
  readonly invocation: CapitalInvocation;
  readonly events: readonly EnterpriseCapitalEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly settledAt: number;
  readonly estateCashEffects?: ResidentEstateCashEffects;
  readonly estateCashPolicyVersion?: typeof CAPITAL_ESTATE_CONTINUITY_POLICY.version;
};
