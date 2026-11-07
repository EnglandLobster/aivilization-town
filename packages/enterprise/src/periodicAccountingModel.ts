import type { PrincipalAuthorization, PrincipalOperationRequest } from '@aivilization/authority';

/** Cash-surplus accounting plus protected payment positions; not accrual profit, capital assets or lending. */
export const ENTERPRISE_PERIODIC_ACCOUNTING_POLICY = {
  version: 'enterprise-periodic-obligations-cash-v1',
  sourcePolicyVersion: 'resident-periodic-obligations-v1',
  moneyScale: 1000000,
  maxPositions: 2000,
  maxPeriods: 128,
  minPeriodMs: 60000,
  maxTotalMicros: 1000000000000,
} as const;
export type EnterprisePeriodicStatus = 'paid' | 'unpaid' | 'waived';
export type EnterprisePeriodicPosition = {
  readonly id: string;
  readonly side: 'payer' | 'revenue';
  readonly amountMicros: number;
  readonly periods: number;
  readonly firstDueAt: number;
  readonly periodMs: number;
  readonly acceptedAt: number;
  /** The original whole agreement approval, not a new approval impersonating its signer. */
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly sourceRevision: number;
  readonly at: number;
  readonly cursor: number;
  readonly futureStoppedAt?: number;
  readonly installments: Readonly<
    Record<string, { readonly status: EnterprisePeriodicStatus; readonly at: number }>
  >;
};
export type EnterprisePeriodicAccounting = {
  readonly policyVersion: typeof ENTERPRISE_PERIODIC_ACCOUNTING_POLICY.version;
  readonly positions: Readonly<Record<string, EnterprisePeriodicPosition>>;
};
export type EnterprisePeriodicAccountingEvent =
  | {
      readonly type: 'EnterprisePeriodicPositionRegistered';
      readonly policyVersion: typeof ENTERPRISE_PERIODIC_ACCOUNTING_POLICY.version;
      readonly position: EnterprisePeriodicPosition;
    }
  | {
      readonly type: 'EnterprisePeriodicPositionChanged';
      readonly policyVersion: typeof ENTERPRISE_PERIODIC_ACCOUNTING_POLICY.version;
      readonly id: string;
      readonly previousSourceRevision: number;
      readonly at: number;
      readonly change:
        | { readonly type: 'due'; readonly period: number; readonly status: 'paid' | 'unpaid' }
        | { readonly type: 'settle' | 'waive'; readonly period: number }
        | { readonly type: 'stop' };
    };
