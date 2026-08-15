import type { Inventory } from '@aivilization/economy';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import { assertValidEnterprisePolicy, type EnterprisePolicy } from './policy';
import {
  assertValidEnterpriseState,
  isEnterpriseOperational,
  normalizeEnterpriseState,
  type EnterpriseState,
} from './model';

export type EnterpriseDomainEvent =
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
      readonly wageOffer: number;
      readonly openSlots: number;
    }
  | { readonly type: 'EnterpriseEmployeeLeft'; readonly agentId: AgentId }
  | { readonly type: 'EnterpriseEmployeeLaidOff'; readonly agentId: AgentId }
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
  readonly wageOffer: number;
  readonly openSlots: number;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (!isEnterpriseOperational(enterprise)) {
    return rejected('enterprise is bankrupt or closed');
  }
  if (enterprise.ownerAgentId !== input.actorAgentId) {
    return rejected('only the enterprise owner may set the job posting');
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
  readonly employeeAgentId: AgentId;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (enterprise.status === 'closed') {
    return rejected('enterprise is closed');
  }
  if (enterprise.ownerAgentId !== input.actorAgentId) {
    return rejected('only the enterprise owner may lay off employees');
  }
  if (!enterprise.employeeAgentIds.includes(input.employeeAgentId)) {
    return rejected('agent is not an enterprise employee');
  }
  return accepted({ type: 'EnterpriseEmployeeLaidOff', agentId: input.employeeAgentId });
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
  if (enterprise.status === 'bankrupt' || enterprise.status === 'closed') {
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
  readonly closedAt: number;
}): EnterpriseDecision {
  const enterprise = normalizeAndValidate(input.enterprise);
  if (enterprise.status === 'closed') {
    return rejected('enterprise is already closed');
  }
  if (enterprise.ownerAgentId !== input.actorAgentId) {
    return rejected('only the enterprise owner may close it');
  }
  return accepted({ type: 'EnterpriseClosed', closedAt: input.closedAt });
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
  if (enterprise.ownerAgentId !== input.ownerAgentId) {
    return rejected('owner-departure closure requires the owning agent');
  }
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
  const current = normalizeAndValidate(state);
  switch (event.type) {
    case 'EnterpriseMemberJoined':
      return normalizeEnterpriseState({
        ...current,
        employeeAgentIds: [...current.employeeAgentIds, event.agentId],
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
      return normalizeEnterpriseState({
        ...current,
        balance: current.balance - event.totalAmount,
        retainedEarnings: (current.retainedEarnings ?? 0) - event.totalAmount,
        cumulativeDividends: (current.cumulativeDividends ?? 0) + event.totalAmount,
        lastDividendPaidAt: event.paidAt,
      });
    case 'EnterpriseClosed':
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
