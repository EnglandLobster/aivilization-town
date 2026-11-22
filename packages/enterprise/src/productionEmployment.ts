import { enterpriseRequiresManagement } from './control';
import type { ControlAuthorizationPort } from '@aivilization/authority';
import {
  enterpriseManagementAuthority,
  assertEnterpriseManagementAuthority,
  type EnterpriseManagementAuthority,
} from './control';
import type { AgentId } from '@aivilization/sim-core';
import type { EnterpriseState } from './model';

/** Financial authorization only. Materials owns the task, resources and actual work. */
export const PRODUCTION_EMPLOYMENT_POLICY = {
  version: 'enterprise-production-employment-v1',
  maxAssignments: 10_000,
  maxWorkers: 30,
  maxAuthorizedMs: 1_000_000_000,
} as const;
export type ProductionEmploymentAssignment = {
  readonly authority?: EnterpriseManagementAuthority;
  readonly productionId: string;
  readonly authorizedBy: AgentId;
  readonly at: number;
  readonly authorizedWorkMs: number;
  readonly wageOffers: Readonly<Record<string, number>>;
};
export type ProductionEmploymentState = {
  readonly policyVersion: typeof PRODUCTION_EMPLOYMENT_POLICY.version;
  readonly assignments: Readonly<Record<string, ProductionEmploymentAssignment>>;
};
export type ProductionEmploymentEvent = {
  readonly type: 'EnterpriseProductionEmploymentAssigned';
  readonly policyVersion: typeof PRODUCTION_EMPLOYMENT_POLICY.version;
  readonly assignment: ProductionEmploymentAssignment;
};
type Decision =
  | { readonly accepted: true; readonly event: ProductionEmploymentEvent }
  | { readonly accepted: false; readonly reason: string };
const key = (s: string) =>
  typeof s === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(s) &&
  !['constructor', 'prototype', '__proto__'].includes(s);
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function assertProductionEmployment(s: ProductionEmploymentState): void {
  if (
    s.policyVersion !== PRODUCTION_EMPLOYMENT_POLICY.version ||
    Object.keys(s.assignments).length > PRODUCTION_EMPLOYMENT_POLICY.maxAssignments
  )
    throw Error('invalid-production-employment-state');
  for (const [id, a] of Object.entries(s.assignments)) {
    const workers = Object.entries(a.wageOffers);
    if (
      !key(id) ||
      id !== a.productionId ||
      !key(a.authorizedBy) ||
      !integer(a.at) ||
      !integer(a.authorizedWorkMs) ||
      a.authorizedWorkMs < 1 ||
      a.authorizedWorkMs > PRODUCTION_EMPLOYMENT_POLICY.maxAuthorizedMs ||
      workers.length < 1 ||
      workers.length > PRODUCTION_EMPLOYMENT_POLICY.maxWorkers ||
      workers.some(([actor, wage]) => !key(actor) || !Number.isFinite(wage) || wage < 0)
    )
      throw Error('invalid-production-employment-assignment');
  }
}

export function decideAssignProductionEmployment(input: {
  readonly enterprise: EnterpriseState;
  readonly authorize?: ControlAuthorizationPort;
  readonly actorId: AgentId;
  readonly productionId: string;
  readonly at: number;
  readonly authorizedWorkMs: number;
  readonly workers: readonly AgentId[];
}): Decision {
  const e = input.enterprise;
  const authority = enterpriseManagementAuthority(
    e,
    input.actorId,
    'authorize-production',
    input.authorize,
  );
  if (!authority) return { accepted: false, reason: 'production-employer-authority-required' };
  if (!['active', 'insolvent'].includes(e.status) || !e.earnedPayroll)
    return { accepted: false, reason: 'operational-earned-payroll-required' };
  if (new Set(input.workers).size !== input.workers.length)
    return { accepted: false, reason: 'duplicate-production-employee' };
  const wageOffers: Record<string, number> = {};
  for (const actor of input.workers) {
    const wage = e.employeeWageOffers?.[actor];
    if (!key(actor) || !e.employeeAgentIds.includes(actor) || wage === undefined)
      return { accepted: false, reason: 'production-employee-contracted-wage-required' };
    wageOffers[actor] = wage;
  }
  const event: ProductionEmploymentEvent = {
    type: 'EnterpriseProductionEmploymentAssigned',
    policyVersion: PRODUCTION_EMPLOYMENT_POLICY.version,
    assignment: {
      ...(enterpriseRequiresManagement(e) ? { authority } : {}),
      productionId: input.productionId,
      authorizedBy: input.actorId,
      at: input.at,
      authorizedWorkMs: input.authorizedWorkMs,
      wageOffers,
    },
  };
  try {
    applyProductionEmploymentEvent(e, event);
    return { accepted: true, event };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : 'invalid-production-employment',
    };
  }
}

export function applyProductionEmploymentEvent(
  e: EnterpriseState,
  event: ProductionEmploymentEvent,
): EnterpriseState {
  const a = event.assignment;
  if (enterpriseRequiresManagement(e))
    assertEnterpriseManagementAuthority(e, a.authority, 'authorize-production');
  if (
    event.policyVersion !== PRODUCTION_EMPLOYMENT_POLICY.version ||
    !['active', 'insolvent'].includes(e.status) ||
    !e.earnedPayroll ||
    (enterpriseRequiresManagement(e)
      ? a.authority?.actorId !== a.authorizedBy
      : a.authorizedBy !== e.ownerAgentId) ||
    a.at < e.foundedAt ||
    Object.hasOwn(e.productionEmployment?.assignments ?? {}, a.productionId) ||
    Object.entries(a.wageOffers).some(
      ([actor, wage]) =>
        !e.employeeAgentIds.includes(actor as AgentId) || e.employeeWageOffers?.[actor] !== wage,
    )
  )
    throw Error('production-employment-authorization-mismatch');
  const state: ProductionEmploymentState = {
    policyVersion: event.policyVersion,
    assignments: {
      ...e.productionEmployment?.assignments,
      [a.productionId]: structuredClone(a),
    },
  };
  assertProductionEmployment(state);
  return { ...e, productionEmployment: state };
}

/** Membership or a new employment bargain cannot silently reuse an older task's wage authorization. */
export function productionEmploymentWage(
  e: EnterpriseState,
  productionId: string,
  actorId: AgentId,
): number | undefined {
  const a = e.productionEmployment?.assignments[productionId];
  const wage = a?.wageOffers[actorId];
  return a &&
    ['active', 'insolvent'].includes(e.status) &&
    e.employeeAgentIds.includes(actorId) &&
    wage !== undefined &&
    e.employeeWageOffers?.[actorId] === wage
    ? wage
    : undefined;
}
