import type { CreditPolicy } from './policy';
import type { CreditDomainEvent } from './aggregate';
import type { LoanState } from './model';
export const ESTATE_CREDIT_CONTINUITY_POLICY = {
  version: 'resident-estate-credit-continuity-v1',
  collectionPolicyVersion: 'credit-shared-borrower-cash-budget-v1',
  settlementPolicyVersion: 'resident-estate-credit-settlement-v1',
  maxCustomers: 2000,
  maxLoansPerCustomer: 128,
} as const;
export type EstateCreditDeparture = {
  readonly eventId: string;
  readonly ownerId: string;
  readonly at: number;
  readonly cause: 'death' | 'emigration';
  readonly populationPolicyVersion: string;
};
/** A credit-customer lifecycle, not a cash account, body, executor or replacement borrower. Bank positions stay in BankState. */
export type EstateCreditCustomer = {
  readonly id: string;
  readonly revision: number;
  readonly departure: EstateCreditDeparture;
  readonly at: number;
  readonly nextCadenceAt: number;
  readonly cashReceiptSerial: number;
};
export type EstateCreditState = {
  readonly policy: typeof ESTATE_CREDIT_CONTINUITY_POLICY;
  readonly creditPolicy: CreditPolicy;
  readonly customers: Readonly<Record<string, EstateCreditCustomer>>;
};
export type EstateCreditBankEvent = Extract<
  CreditDomainEvent,
  { type: 'LoanRepaid' | 'LoanDefaulted' | 'DepositInterestPaid' }
>;
/** Read-only source proof. These are bank facts, never a second customer ledger. */
export type EstateCreditBankSource = {
  readonly balance: number;
  readonly deposit: number;
  readonly loans: readonly LoanState[];
};
export type EstateCreditEvent =
  | {
      readonly type: 'EstateCreditEnabled';
      readonly policy: typeof ESTATE_CREDIT_CONTINUITY_POLICY;
      readonly creditPolicy: CreditPolicy;
    }
  | { readonly type: 'EstateCreditCustomerRecorded'; readonly customer: EstateCreditCustomer }
  | {
      readonly type: 'EstateCreditCadenceRecorded';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly availableCash: number;
      readonly bankSource: EstateCreditBankSource;
      readonly bankEvents: readonly EstateCreditBankEvent[];
      readonly previousCashReceiptSerial: number;
      readonly nextCashReceiptSerial: number;
    };
export type EstateCreditDecision =
  | { readonly accepted: true; readonly events: readonly EstateCreditEvent[] }
  | { readonly accepted: false; readonly reason: string };
