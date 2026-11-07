import {
  applyEnterpriseLaborTermsEvent,
  laborTermsAfterJoin,
  type EnterpriseLaborTermsEvent,
} from './laborTerms';
import {
  applyEnterpriseResourceSaleAccounting,
  type EnterpriseResourceSaleAccountingEvent,
} from './resourceSalesAccounting';
import {
  applyEnterprisePeriodicAccounting,
  hasOpenEnterprisePeriodicPositions,
  enterprisePeriodicArrears,
} from './periodicAccounting';
import type { EnterprisePeriodicAccountingEvent } from './periodicAccountingModel';
import {
  applyEnterpriseTradeAccounting,
  hasOpenTradeAccounting,
  type EnterpriseTradeAccountingEvent,
} from './tradeAccounting';
import {
  applyEnterpriseCapitalEvent,
  assertCapitalDividend,
  type EnterpriseCapitalEvent,
} from './capitalAggregate';
import { enterpriseRequiresManagement } from './control';
import {
  applyEnterpriseControlEvent,
  enterpriseManagementAuthority,
  assertEnterpriseManagementAuthority,
  type EnterpriseControlEvent,
  type EnterpriseManagementAuthority,
} from './control';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import {
  applyServiceBusinessEvent,
  hasOpenServiceBusiness,
  type EnterpriseServiceBusinessEvent,
} from './serviceBusiness';
import type { Inventory } from '@aivilization/economy';
import {
  applyProductionEmploymentEvent,
  type ProductionEmploymentEvent,
} from './productionEmployment';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import {
  applyEarnedPayrollEvent,
  hasProtectedEarnedLabor,
  type EarnedPayrollEvent,
} from './earnedPayroll';
import { assertValidEnterprisePolicy, type EnterprisePolicy } from './policy';
import {
  assertValidEnterpriseState,
  isEnterpriseOperational,
  normalizeEnterpriseState,
  type EnterpriseState,
} from './model';

export type EnterpriseDomainEvent =
  | EnterpriseLaborTermsEvent
  | EnterpriseCapitalEvent
  | EnterpriseControlEvent
  | EnterpriseTradeAccountingEvent
  | EnterpriseResourceSaleAccountingEvent
  | EnterprisePeriodicAccountingEvent
  | EnterpriseServiceBusinessEvent
  | ProductionEmploymentEvent
  | EarnedPayrollEvent
  | {
      readonly type: 'EnterpriseFounded';
      readonly enterpriseId: string;
      readonly name: string;
      readonly ownerAgentId: AgentId;
      readonly occupationName: string;
      readonly initialCapital: number;
      readonly maxEmployees: number;
      readonly occurredAt: number;
    }
  | {
      readonly type: 'EnterpriseMemberJoined';
      readonly agentId: AgentId;
      /** Contracted wage recorded from the job posting; absent on legacy events. */
      readonly wageOffer?: number;
    }
  | { readonly type: 'EnterpriseFunded'; readonly amount: number }
  | {
      readonly type: 'EnterpriseSaleRecorded';
      readonly amount: number;
      readonly commodityName: string;
      readonly quantity: number;
    }
  | {
      readonly type: 'EnterprisePurchaseRecorded';
      readonly amount: number;
      readonly commodityName: string;
      readonly quantity: number;
    }
  | { readonly type: 'EnterprisePayrollRecorded'; readonly amount: number }
  | { readonly type: 'EnterpriseTaxRecorded'; readonly amount: number }
  | {
      readonly type: 'EnterpriseJobPostingUpdated';
      readonly authority?: EnterpriseManagementAuthority;
      readonly wageOffer: number;
      readonly openSlots: number;
    }
  | { readonly type: 'EnterpriseEmployeeLeft'; readonly agentId: AgentId }
  | {
      readonly type: 'EnterpriseEmployeeLaidOff';
      readonly agentId: AgentId;
      readonly authority?: EnterpriseManagementAuthority;
    }
  | {
      /** Wage-arrears memo update; carries no money movement of its own. */
      readonly type: 'EnterpriseWageArrearsUpdated';
      readonly nextArrears: number;
    }
  | { readonly type: 'EnterpriseInsolvencyStarted'; readonly evaluatedAt: number }
  | { readonly type: 'EnterpriseSolvencyRestored'; readonly evaluatedAt: number }
  | { readonly type: 'EnterpriseBankruptcyDeclared'; readonly declaredAt: number }
  | {
      readonly type: 'EnterpriseDividendPaid';
      readonly totalAmount: number;
      readonly paidAt: number;
    }
  | {
      readonly type: 'EnterpriseClosed';
      readonly authority?: EnterpriseManagementAuthority;
      readonly closedAt: number;
    };

export type EnterpriseDecision =
  | { readonly status: 'accepted'; readonly events: readonly EnterpriseDomainEvent[] }
  | { readonly status: 'rejected'; readonly reason: string };

export function decideFoundEnterprise(input: {
  readonly existing: EnterpriseState | undefined;
  readonly enterpriseId: string;
  readonly name: string;
  readonly ownerAgentId: AgentId;
  readonly occupationName: string;
  readonly initialCapital: number;
  readonly maxEmployees: number;
  readonly occurredAt: number;
  readonly policy: EnterprisePolicy;
}): EnterpriseDecision {
  assertValidEnterprisePolicy(input.policy);
  if (input.existing !== undefined) {
    return rejected(`enterprise ${input.enterpriseId} already exists`);
  }
  if (
    input.initialCapital < input.policy.minimumInitialCapital ||
    input.initialCapital > input.policy.maximumInitialCapital
  ) {
    return rejected(
      `initial capital must be between ${input.policy.minimumInitialCapital} and ${input.policy.maximumInitialCapital}`,
    );
  }
  if (input.maxEmployees > input.policy.maximumEmployees) {
    return rejected(`maxEmployees exceeds policy maximum ${input.policy.maximumEmployees}`);
  }
  return accepted({
    type: 'EnterpriseFounded',
    enterpriseId: input.enterpriseId,
    name: input.name,
    ownerAgentId: input.ownerAgentId,
    occupationName: input.occupationName,
    initialCapital: input.initialCapital,
    maxEmployees: input.maxEmployees,
    occurredAt: input.occurredAt,
  });
}

export function decideJoinEnterprise(input: {
  readonly enterprise: EnterpriseState;
  readonly agentId: AgentId;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (enterprise.status !== 'active') {
    return rejected('enterprise is not active');
  }
  if (enterprise.employeeAgentIds.includes(input.agentId)) {
    return rejected('agent already belongs to enterprise');
  }
  if (enterprise.employeeAgentIds.length >= enterprise.maxEmployees) {
    return rejected('enterprise has no open positions');
  }
  const posting = enterprise.jobPosting;
  if (posting === undefined) {
    return rejected('enterprise has not published a job posting');
  }
  if (posting.openSlots <= enterprise.employeeAgentIds.length) {
    return rejected('enterprise job posting has no open slots');
  }
  return accepted({
    type: 'EnterpriseMemberJoined',
    agentId: input.agentId,
    wageOffer: posting.wageOffer,
  });
}

export function decideSetEnterpriseJobPosting(input: {
  readonly enterprise: EnterpriseState;
  readonly actorAgentId: AgentId;
  readonly authorize?: ControlAuthorizationPort;
  readonly wageOffer: number;
  readonly openSlots: number;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (!isEnterpriseOperational(enterprise)) {
    return rejected('enterprise is bankrupt or closed');
  }
  const authority = enterpriseManagementAuthority(
    enterprise,
    input.actorAgentId,
    'post-job',
    input.authorize,
  );
  if (!authority) {
    return rejected(
      enterpriseRequiresManagement(enterprise)
        ? 'enterprise-management-authority-required'
        : 'only the enterprise owner may set the job posting',
    );
  }
  if (!Number.isFinite(input.wageOffer) || input.wageOffer <= 0) {
    return rejected('job posting wageOffer must be positive finite');
  }
  if (!Number.isInteger(input.openSlots) || input.openSlots < 0) {
    return rejected('job posting openSlots must be a non-negative integer');
  }
  if (input.openSlots > enterprise.maxEmployees) {
    return rejected(`openSlots exceeds maxEmployees ${enterprise.maxEmployees}`);
  }
  return accepted({
    type: 'EnterpriseJobPostingUpdated',
    ...(enterpriseRequiresManagement(enterprise) ? { authority } : {}),
    wageOffer: input.wageOffer,
    openSlots: input.openSlots,
  });
}

export function decideLeaveEnterprise(input: {
  readonly enterprise: EnterpriseState;
  readonly agentId: AgentId;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (!enterprise.employeeAgentIds.includes(input.agentId)) {
    return rejected('agent is not an enterprise employee');
  }
  return accepted({ type: 'EnterpriseEmployeeLeft', agentId: input.agentId });
}

export function decideLayoffEmployee(input: {
  readonly enterprise: EnterpriseState;
  readonly actorAgentId: AgentId;
  readonly authorize?: ControlAuthorizationPort;
  readonly employeeAgentId: AgentId;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (enterprise.status === 'closed') {
    return rejected('enterprise is closed');
  }
  const authority = enterpriseManagementAuthority(
    enterprise,
    input.actorAgentId,
    'layoff',
    input.authorize,
  );
  if (!authority) {
    return rejected(
      enterpriseRequiresManagement(enterprise)
        ? 'enterprise-management-authority-required'
        : 'only the enterprise owner may lay off employees',
    );
  }
  if (!enterprise.employeeAgentIds.includes(input.employeeAgentId)) {
    return rejected('agent is not an enterprise employee');
  }
  return accepted({
    type: 'EnterpriseEmployeeLaidOff',
    ...(enterpriseRequiresManagement(enterprise) ? { authority } : {}),
    agentId: input.employeeAgentId,
  });
}

/**
 * Payroll settlement under solvency constraints. The enterprise pays what its
 * cash allows: any unpaid wage accrues into arrears, and once cash exceeds
 * the contracted wage the surplus repays accumulated arrears first. Pins the
 * invariant `paid + nextArrears === wage + arrears` with `paid <= balance`,
 * so payroll can never overdraw the enterprise and arrears never go negative.
 */
export function decidePayWage(input: {
  readonly wage: number;
  readonly balance: number;
  readonly arrears: number;
}): { readonly paid: number; readonly nextArrears: number } {
  assertNonNegativeFinite(input.wage, 'wage');
  assertNonNegativeFinite(input.balance, 'balance');
  assertNonNegativeFinite(input.arrears, 'arrears');
  if (input.balance >= input.wage) {
    const arrearsRepayment = Math.min(input.balance - input.wage, input.arrears);
    return { paid: input.wage + arrearsRepayment, nextArrears: input.arrears - arrearsRepayment };
  }
  return {
    paid: input.balance,
    nextArrears: input.arrears + (input.wage - input.balance),
  };
}

export function decideFundEnterprise(input: {
  readonly enterprise: EnterpriseState;
  readonly amount: number;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (
    (enterprise.status === 'bankrupt' && !enterprise.earnedPayroll) ||
    enterprise.status === 'closed'
  ) {
    return rejected('enterprise is bankrupt or closed');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return rejected('funding amount must be positive finite');
  }
  return accepted({ type: 'EnterpriseFunded', amount: input.amount });
}

export function decideCloseEnterprise(input: {
  readonly enterprise: EnterpriseState;
  readonly actorAgentId: AgentId;
  readonly authorize?: ControlAuthorizationPort;
  readonly closedAt: number;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (enterprise.status === 'closed') {
    return rejected('enterprise is already closed');
  }
  if (enterprise.capital) return rejected('capital-liquidation-plan-required');
  const authority = enterpriseManagementAuthority(
    enterprise,
    input.actorAgentId,
    'close',
    input.authorize,
  );
  if (!authority) {
    return rejected(
      enterpriseRequiresManagement(enterprise)
        ? 'enterprise-management-authority-required'
        : 'only the enterprise owner may close it',
    );
  }
  if (hasOpenTradeAccounting(enterprise))
    return rejected('enterprise-has-unsettled-trade-accounting');
  if (hasOpenServiceBusiness(enterprise))
    return rejected('enterprise-service-contracts-require-settlement');
  if (hasProtectedEarnedLabor(enterprise))
    return rejected('enterprise-earned-obligations-require-settlement');
  if (hasOpenEnterprisePeriodicPositions(enterprise))
    return rejected('enterprise-periodic-obligations-require-settlement');
  return accepted({
    type: 'EnterpriseClosed',
    ...(enterpriseRequiresManagement(enterprise) ? { authority } : {}),
    closedAt: input.closedAt,
  });
}

/**
 * Owner-departure closure (death or out-migration): the owner permanently
 * left the town, so there is nobody to return the firm's assets to. The
 * enterprise closes with its cash and inventory burned out of the town
 * economy (the world adapter settles the burn); employees are released by
 * the closure itself. Not reachable through any agent command — only the
 * population-turnover settlement invokes it.
 */
export function decideCloseEnterpriseOnOwnerDeparture(input: {
  readonly enterprise: EnterpriseState;
  readonly ownerAgentId: AgentId;
  readonly closedAt: number;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (enterprise.status === 'closed') {
    return rejected('enterprise is already closed');
  }
  if (enterprise.capital) return rejected('capital-liquidation-plan-required');
  if (enterpriseRequiresManagement(enterprise))
    return rejected('enterprise-controlled-succession-required');
  if (enterprise.ownerAgentId !== input.ownerAgentId) {
    return rejected('owner-departure closure requires the owning agent');
  }
  if (hasOpenTradeAccounting(enterprise))
    return rejected('enterprise-has-unsettled-trade-accounting');
  if (hasOpenServiceBusiness(enterprise))
    return rejected('enterprise-service-contracts-require-settlement');
  if (hasProtectedEarnedLabor(enterprise))
    return rejected('enterprise-earned-obligations-require-settlement');
  if (hasOpenEnterprisePeriodicPositions(enterprise))
    return rejected('enterprise-periodic-obligations-require-settlement');
  return accepted({ type: 'EnterpriseClosed', closedAt: input.closedAt });
}

export function applyEnterpriseDomainEvent(
  state: EnterpriseState | undefined,
  event: EnterpriseDomainEvent,
): EnterpriseState {
  if (event.type === 'EnterpriseFounded') {
    if (state !== undefined) {
      throw new Error(`cannot found existing enterprise ${event.enterpriseId}`);
    }
    return normalizeEnterpriseState({
      enterpriseId: event.enterpriseId,
      name: event.name,
      ownerAgentId: event.ownerAgentId,
      occupationName: event.occupationName,
      balance: event.initialCapital,
      inventory: {},
      maxEmployees: event.maxEmployees,
      employeeAgentIds: [],
      status: 'active',
      foundedAt: event.occurredAt,
      cumulativeSales: 0,
      cumulativePurchases: 0,
      cumulativeWages: 0,
    });
  }
  if (state === undefined) {
    throw new Error(`cannot apply ${event.type} to a missing enterprise`);
  }
  if (event.type === 'EnterpriseCapitalEnabled') {
    assertValidEnterpriseState(state);
    return applyEnterpriseCapitalEvent(state, event);
  }
  const current = normalizeAndValidate(state);
  if (enterpriseRequiresManagement(current)) {
    if (event.type === 'EnterpriseJobPostingUpdated')
      assertEnterpriseManagementAuthority(current, event.authority, 'post-job');
    if (event.type === 'EnterpriseEmployeeLaidOff')
      assertEnterpriseManagementAuthority(current, event.authority, 'layoff');
    if (event.type === 'EnterpriseClosed' && (event.authority || current.status !== 'bankrupt'))
      assertEnterpriseManagementAuthority(current, event.authority, 'close');
  }
  switch (event.type) {
    case 'EnterpriseLaborTermsEnabled':
    case 'EnterpriseLaborTermsChanged':
      return applyEnterpriseLaborTermsEvent(current, event);
    case 'EnterprisePeriodicPositionRegistered':
    case 'EnterprisePeriodicPositionChanged':
      return normalizeEnterpriseState(applyEnterprisePeriodicAccounting(current, event));
    case 'EnterpriseResourceSaleAccountingRecorded':
      return normalizeEnterpriseState(applyEnterpriseResourceSaleAccounting(current, event));
    case 'EnterpriseTradeAccountingRecorded':
      return normalizeEnterpriseState(applyEnterpriseTradeAccounting(current, event));
    case 'EnterpriseCapitalClosed':
    case 'EnterpriseCapitalAgreementCommitted':
      return applyEnterpriseCapitalEvent(current, event);
    case 'EnterpriseCapitalDividendPaid':
      assertCapitalDividend(current, event);
      return applyDividendFact(current, event);
    case 'EnterpriseControlChanged':
      return applyEnterpriseControlEvent(current, event);
    case 'EnterpriseServiceAuthorized':
    case 'EnterpriseServiceAuthorizationRevoked':
    case 'EnterpriseServiceAccountingRecorded':
      return applyServiceBusinessEvent(current, event);
    case 'EnterpriseProductionEmploymentAssigned':
      return applyProductionEmploymentEvent(current, event);
    case 'EnterpriseEarnedPayrollEnabled':
    case 'EnterpriseEarnedWageRecorded':
    case 'EnterpriseEarnedWagePaid':
      return normalizeEnterpriseState(applyEarnedPayrollEvent(current, event));
    case 'EnterpriseMemberJoined':
      return normalizeEnterpriseState({
        ...current,
        employeeAgentIds: [...current.employeeAgentIds, event.agentId],
        ...(current.laborTerms ? { laborTerms: laborTermsAfterJoin(current, event.agentId) } : {}),
        ...(event.wageOffer === undefined
          ? {}
          : {
              employeeWageOffers: {
                ...current.employeeWageOffers,
                [event.agentId]: event.wageOffer,
              },
            }),
      });
    case 'EnterpriseFunded':
      return normalizeEnterpriseState({ ...current, balance: current.balance + event.amount });
    case 'EnterpriseSaleRecorded':
      return normalizeEnterpriseState({
        ...current,
        balance: current.balance + event.amount,
        cumulativeSales: current.cumulativeSales + event.amount,
        retainedEarnings: (current.retainedEarnings ?? 0) + event.amount,
        inventory: adjustInventory(current.inventory, event.commodityName, -event.quantity),
      });
    case 'EnterprisePurchaseRecorded':
      return normalizeEnterpriseState({
        ...current,
        balance: current.balance - event.amount,
        cumulativePurchases: current.cumulativePurchases + event.amount,
        retainedEarnings: (current.retainedEarnings ?? 0) - event.amount,
        inventory: adjustInventory(current.inventory, event.commodityName, event.quantity),
      });
    case 'EnterprisePayrollRecorded':
      if (current.earnedPayroll) throw Error('earned-payroll-requires-creditor-payment');
      return normalizeEnterpriseState({
        ...current,
        balance: current.balance - event.amount,
        cumulativeWages: current.cumulativeWages + event.amount,
        retainedEarnings: (current.retainedEarnings ?? 0) - event.amount,
      });
    case 'EnterpriseTaxRecorded':
      return normalizeEnterpriseState({
        ...current,
        balance: current.balance - event.amount,
        retainedEarnings: (current.retainedEarnings ?? 0) - event.amount,
      });
    case 'EnterpriseJobPostingUpdated':
      return normalizeEnterpriseState({
        ...current,
        jobPosting: { wageOffer: event.wageOffer, openSlots: event.openSlots },
      });
    case 'EnterpriseEmployeeLeft':
    case 'EnterpriseEmployeeLaidOff':
      return normalizeEnterpriseState({
        ...current,
        employeeAgentIds: current.employeeAgentIds.filter((agentId) => agentId !== event.agentId),
      });
    case 'EnterpriseWageArrearsUpdated':
      if (current.earnedPayroll) throw Error('earned-payroll-requires-creditor-obligation');
      if (!Number.isFinite(event.nextArrears) || event.nextArrears < 0) {
        throw new Error('enterprise wage arrears must be non-negative finite');
      }
      return normalizeEnterpriseState({ ...current, wageArrears: event.nextArrears });
    case 'EnterpriseInsolvencyStarted':
      return normalizeEnterpriseState({
        ...current,
        status: 'insolvent',
        insolvencyStartedAt: event.evaluatedAt,
        lastSolvencyEvaluatedAt: event.evaluatedAt,
      });
    case 'EnterpriseSolvencyRestored':
      return normalizeEnterpriseState(
        withoutInsolvencyStartedAt({
          ...current,
          status: 'active',
          lastSolvencyEvaluatedAt: event.evaluatedAt,
        }),
      );
    case 'EnterpriseBankruptcyDeclared':
      return normalizeEnterpriseState({
        ...current,
        status: 'bankrupt',
        lastSolvencyEvaluatedAt: event.declaredAt,
      });
    case 'EnterpriseDividendPaid':
      if (current.capital) throw Error('capital-dividend-source-required');
      return applyDividendFact(current, event);
    case 'EnterpriseClosed':
      if (current.capital) throw Error('capital-liquidation-plan-required');
      if (hasOpenTradeAccounting(current)) throw Error('enterprise-has-unsettled-trade-accounting');
      if (hasOpenServiceBusiness(current))
        throw Error('enterprise-service-contracts-require-settlement');
      if (hasProtectedEarnedLabor(current))
        throw Error('enterprise-earned-obligations-require-settlement');
      if (hasOpenEnterprisePeriodicPositions(current))
        throw Error('enterprise-periodic-obligations-require-settlement');
      return normalizeEnterpriseState({
        ...current,
        balance: 0,
        inventory: {},
        employeeAgentIds: [],
        status: 'closed',
        closedAt: event.closedAt,
      });
  }
}

function normalizeAndValidate(state: EnterpriseState): EnterpriseState {
  assertValidEnterpriseState(state);
  return normalizeEnterpriseState(state);
}

function accepted(event: EnterpriseDomainEvent): EnterpriseDecision {
  return { status: 'accepted', events: [event] };
}

function rejected(reason: string): EnterpriseDecision {
  return { status: 'rejected', reason };
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}

function adjustInventory(inventory: Inventory, commodityName: string, delta: number): Inventory {
  const next = (inventory[commodityName] ?? 0) + delta;
  if (next < 0) {
    throw new Error(`enterprise inventory cannot become negative for ${commodityName}`);
  }
  if (next === 0) {
    return Object.fromEntries(Object.entries(inventory).filter(([name]) => name !== commodityName));
  }
  return { ...inventory, [commodityName]: next };
}

function withoutInsolvencyStartedAt(state: EnterpriseState): EnterpriseState {
  const rest = { ...state };
  delete rest.insolvencyStartedAt;
  return rest;
}

export function ownershipPayments(input: {
  readonly enterprise: EnterpriseState;
  readonly totalAmount: number;
}): readonly { readonly agentId: AgentId; readonly amount: number }[] {
  if (input.enterprise.capital) throw Error('capital-account-payment-port-required');
  const shares = normalizeEnterpriseState(input.enterprise).ownershipShares ?? {};
  const entries = Object.entries(shares).sort(([left], [right]) => left.localeCompare(right));
  let allocated = 0;
  return entries.map(([agentId, share], index) => {
    const amount =
      index === entries.length - 1 ? input.totalAmount - allocated : input.totalAmount * share;
    allocated += amount;
    return { agentId: asAgentId(agentId), amount };
  });
}

function applyDividendFact(
  current: EnterpriseState,
  event: { totalAmount: number; paidAt: number },
): EnterpriseState {
  if (hasProtectedEarnedLabor(current)) throw Error('enterprise-earned-obligations-block-dividend');
  if (enterprisePeriodicArrears(current) > 0)
    throw Error('enterprise-periodic-arrears-block-dividend');
  return normalizeEnterpriseState({
    ...current,
    balance: current.balance - event.totalAmount,
    retainedEarnings: (current.retainedEarnings ?? 0) - event.totalAmount,
    cumulativeDividends: (current.cumulativeDividends ?? 0) + event.totalAmount,
    lastDividendPaidAt: event.paidAt,
  });
}
