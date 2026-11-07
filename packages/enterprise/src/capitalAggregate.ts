import { hasProtectedEarnedLabor } from './earnedPayroll';
import { hasOpenEnterprisePeriodicPositions } from './periodicAccounting';
import { hasOpenServiceBusiness } from './serviceBusiness';
import type { EnterpriseState } from './model';
import {
  initialEnterpriseCapital,
  applyCapitalEvent,
  capitalNeedsManagement,
} from './capitalAgreement';
import { capitalFactsEqual, assertEnterpriseCapitalState, capitalTime } from './capitalValidation';
import { capitalPayments } from './capitalRights';
import {
  CAPITAL_AGREEMENTS_POLICY,
  type CapitalEvent,
  type CapitalPosition,
  type CapitalAccount,
} from './capitalModel';
import {
  assertEnterpriseManagementAuthority,
  enterpriseControlVersion,
  enterpriseController,
  type EnterpriseManagementAuthority,
} from './control';
import { sameController } from '@aivilization/authority';

export type EnterpriseCapitalEvent =
  | {
      readonly type: 'EnterpriseCapitalClosed';
      readonly at: number;
      readonly equityVersion: number;
      readonly totalAmount: number;
      readonly payments: readonly { readonly account: CapitalAccount; readonly amount: number }[];
      readonly authority: EnterpriseManagementAuthority;
    }
  | {
      readonly type: 'EnterpriseCapitalEnabled';
      readonly at: number;
      readonly policyVersion: typeof CAPITAL_AGREEMENTS_POLICY.version;
      readonly initialPositions: readonly CapitalPosition[];
      readonly authority: EnterpriseManagementAuthority;
    }
  | { readonly type: 'EnterpriseCapitalAgreementCommitted'; readonly event: CapitalEvent }
  | {
      readonly type: 'EnterpriseCapitalDividendPaid';
      readonly dividendPolicyVersion: string;
      readonly equityVersion: number;
      readonly totalAmount: number;
      readonly paidAt: number;
      readonly payments: readonly { readonly account: CapitalAccount; readonly amount: number }[];
    };

/** Legacy weights are preserved exactly as recorded; conversion neither chooses a new owner nor rounds away rights. */
export function inheritedEnterpriseCapital(e: EnterpriseState): readonly CapitalPosition[] {
  return Object.entries(e.ownershipShares ?? { [e.ownerAgentId]: 1 })
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([id, weight]) => ({
      account: { sector: 'agent' as const, id },
      weight,
    }));
}
export function applyEnterpriseCapitalEvent(
  e: EnterpriseState,
  event: Exclude<EnterpriseCapitalEvent, { type: 'EnterpriseCapitalDividendPaid' }>,
): EnterpriseState {
  if (event.type === 'EnterpriseCapitalEnabled') {
    if (
      e.capital ||
      e.status === 'closed' ||
      event.policyVersion !== CAPITAL_AGREEMENTS_POLICY.version ||
      !capitalTime(event.at) ||
      event.at < e.foundedAt ||
      !capitalFactsEqual(event.initialPositions, inheritedEnterpriseCapital(e))
    )
      throw Error('invalid-enterprise-capital-origin');
    assertEnterpriseManagementAuthority(e, event.authority, 'activate-capital');
    return { ...e, capital: initialEnterpriseCapital(event.initialPositions) };
  }
  if (event.type === 'EnterpriseCapitalClosed') {
    if (
      !e.capital ||
      e.status === 'closed' ||
      !capitalTime(event.at) ||
      event.at < e.foundedAt ||
      event.equityVersion !== e.capital.equityVersion ||
      event.totalAmount !== e.balance ||
      !capitalFactsEqual(event.payments, enterpriseCapitalPayments(e, e.balance))
    )
      throw Error('capital-closure-source-mismatch');
    assertEnterpriseManagementAuthority(e, event.authority, 'close');
    if (Object.values(e.inventory).some((q) => q !== 0))
      throw Error('capital-closure-needs-real-inventory-disposition');
    if (Object.values(e.capital.agreements).some((a) => a.status === 'proposed'))
      throw Error('capital-closure-has-pending-agreements');
    if (hasProtectedEarnedLabor(e) || hasOpenServiceBusiness(e) || (e.wageArrears ?? 0) > 0)
      throw Error('capital-closure-has-protected-obligations');
    if (hasOpenEnterprisePeriodicPositions(e))
      throw Error('capital-closure-has-periodic-obligations');
    return {
      ...e,
      balance: 0,
      inventory: {},
      employeeAgentIds: [],
      status: 'closed',
      closedAt: event.at,
    };
  }
  if (!e.capital || e.status === 'closed' || event.event.at < e.foundedAt)
    throw Error('enterprise-capital-unavailable');
  const c = event.event;
  if (
    c.operation === 'authorize' ||
    (c.operation === 'execute' && capitalNeedsManagement(c.agreement))
  ) {
    const proof = c.agreement.management;
    if (
      !proof ||
      proof.controlVersion !== enterpriseControlVersion(e) ||
      !sameController(proof.authority.controller, enterpriseController(e))
    )
      throw Error('capital-management-source-mismatch');
  }
  const capital = applyCapitalEvent(e.capital, c);
  const incoming =
    c.flows.reduce((sum, f) => sum + (f.to.sector === 'enterprise' ? f.amountMicros : 0), 0) /
    CAPITAL_AGREEMENTS_POLICY.moneyScale;
  const balance = e.balance + incoming;
  if (!Number.isFinite(balance) || (incoming > 0 && balance <= e.balance))
    throw Error('unrepresentable-enterprise-capital');
  return { ...e, capital, balance };
}
export function assertCapitalDividend(
  e: EnterpriseState,
  event: Extract<EnterpriseCapitalEvent, { type: 'EnterpriseCapitalDividendPaid' }>,
): void {
  if (
    !e.capital ||
    event.equityVersion !== e.capital.equityVersion ||
    !capitalFactsEqual(event.payments, capitalPayments(e.capital.positions, event.totalAmount))
  )
    throw Error('capital-dividend-rights-mismatch');
  assertEnterpriseCapitalState(e.capital);
  if (
    !capitalTime(event.paidAt) ||
    event.paidAt < e.foundedAt ||
    event.paidAt <= (e.lastDividendPaidAt ?? -1) ||
    !event.dividendPolicyVersion.trim() ||
    event.totalAmount <= 0 ||
    event.totalAmount > e.balance ||
    event.totalAmount > Math.max(0, e.retainedEarnings ?? 0) ||
    e.status !== 'active'
  )
    throw Error('unearned-capital-dividend');
}
/** Actual cash rights; callers must settle collective accounts without creating synthetic resident IDs. */
export function enterpriseCapitalPayments(e: EnterpriseState, amount: number) {
  return capitalPayments(e.capital?.positions ?? inheritedEnterpriseCapital(e), amount);
}
