import { cumulativeUnitAllocation } from '@aivilization/economy';
import type { AgentId } from '@aivilization/sim-core';
import type { EnterpriseState } from './model';

export const EARNED_PAYROLL_POLICY = {
  version: 'enterprise-earned-payroll-v1',
  moneyScale: 1_000_000,
  maxClaims: 100_000,
  maxDurationMs: 86_400_000,
} as const;

export type EarnedWageClaim = {
  readonly id: string;
  readonly actorId: AgentId;
  readonly laborId: string;
  readonly revision: number;
  readonly startedAt: number;
  readonly settledAt: number;
  readonly plannedMs: number;
  readonly totalWageMicros: number;
  readonly elapsedMs: number;
  readonly earnedMicros: number;
  readonly paidMicros: number;
  readonly status: 'active' | 'ended';
};
export type EarnedPayrollState = {
  readonly policyVersion: typeof EARNED_PAYROLL_POLICY.version;
  readonly revision: number;
  /** Historical money stays exact and unassigned; migration does not invent creditors. */
  readonly legacyUnattributedAmount: number;
  readonly claims: Readonly<Record<string, EarnedWageClaim>>;
};
export type EarnedPayrollEvent =
  | { readonly type: 'EnterpriseEarnedPayrollEnabled'; readonly legacyUnattributedAmount: number }
  | {
      readonly type: 'EnterpriseEarnedWageRecorded';
      readonly previousRevision: number;
      readonly claim: EarnedWageClaim;
    }
  | {
      readonly type: 'EnterpriseEarnedWagePaid';
      readonly previousRevision: number;
      readonly claimId: string;
      readonly actorId: AgentId;
      readonly amountMicros: number;
    };
type Decision =
  | { readonly accepted: true; readonly event: EarnedPayrollEvent }
  | { readonly accepted: false; readonly reason: string };
const reject = (reason: string): Decision => ({ accepted: false, reason });
const integer = (n: number) => Number.isSafeInteger(n) && n >= 0;
const key = (s: string) =>
  typeof s === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(s) &&
  !['constructor', 'prototype', '__proto__'].includes(s);
const claimAt = (s: EarnedPayrollState, id: string) =>
  Object.hasOwn(s.claims, id) ? s.claims[id] : undefined;
const earnedAt = (c: EarnedWageClaim, elapsedMs: number) =>
  cumulativeUnitAllocation(c.totalWageMicros, elapsedMs, c.plannedMs);

export function earnedPayrollArrears(s: EarnedPayrollState): number {
  let unpaid = 0;
  for (const claim of Object.values(s.claims)) {
    unpaid += claim.earnedMicros - claim.paidMicros;
    if (!integer(unpaid)) throw Error('earned-payroll-obligation-overflow');
  }
  const total = s.legacyUnattributedAmount + unpaid / EARNED_PAYROLL_POLICY.moneyScale;
  if (!Number.isFinite(total) || total < 0) throw Error('earned-payroll-obligation-overflow');
  return total;
}

export function assertEarnedPayrollState(s: EarnedPayrollState): void {
  if (
    s.policyVersion !== EARNED_PAYROLL_POLICY.version ||
    !integer(s.revision) ||
    s.revision < 1 ||
    !Number.isFinite(s.legacyUnattributedAmount) ||
    s.legacyUnattributedAmount < 0 ||
    Object.keys(s.claims).length > EARNED_PAYROLL_POLICY.maxClaims
  )
    throw Error('invalid-earned-payroll-state');
  const laborIds = new Set<string>(),
    activeActors = new Set<string>();
  for (const [id, c] of Object.entries(s.claims)) {
    if (
      id !== c.id ||
      !key(id) ||
      !key(c.actorId) ||
      !key(c.laborId) ||
      !integer(c.revision) ||
      c.revision < 1 ||
      !integer(c.startedAt) ||
      !integer(c.settledAt) ||
      !integer(c.plannedMs) ||
      c.plannedMs < 1 ||
      c.plannedMs > EARNED_PAYROLL_POLICY.maxDurationMs ||
      !integer(c.totalWageMicros) ||
      !integer(c.elapsedMs) ||
      c.elapsedMs > c.plannedMs ||
      c.settledAt < c.startedAt ||
      c.elapsedMs > c.settledAt - c.startedAt ||
      !integer(c.earnedMicros) ||
      !integer(c.paidMicros) ||
      c.paidMicros > c.earnedMicros ||
      c.earnedMicros !== earnedAt(c, c.elapsedMs) ||
      !['active', 'ended'].includes(c.status) ||
      (c.status === 'active' && c.elapsedMs === c.plannedMs) ||
      laborIds.has(c.laborId) ||
      (c.status === 'active' && activeActors.has(c.actorId))
    )
      throw Error('invalid-earned-wage-claim');
    laborIds.add(c.laborId);
    if (c.status === 'active') activeActors.add(c.actorId);
  }
  earnedPayrollArrears(s);
}

export function decideEnableEarnedPayroll(enterprise: EnterpriseState): Decision {
  if (enterprise.earnedPayroll) return reject('earned-payroll-already-enabled');
  if (enterprise.status === 'closed') return reject('enterprise-is-closed');
  const legacyUnattributedAmount = enterprise.wageArrears ?? 0;
  if (!Number.isFinite(legacyUnattributedAmount) || legacyUnattributedAmount < 0)
    return reject('invalid-legacy-wage-arrears');
  return {
    accepted: true,
    event: { type: 'EnterpriseEarnedPayrollEnabled', legacyUnattributedAmount },
  };
}

/** Called only after the application authorizes the frozen wage and the person's body reservation. */
export function decideStartEarnedLabor(input: {
  readonly enterprise: EnterpriseState;
  readonly actorId: AgentId;
  readonly id: string;
  readonly laborId: string;
  readonly at: number;
  readonly plannedMs: number;
  readonly totalWageMicros: number;
}): Decision {
  const e = input.enterprise,
    s = e.earnedPayroll;
  if (!s) return reject('earned-payroll-not-enabled');
  if (!['active', 'insolvent'].includes(e.status) || !e.employeeAgentIds.includes(input.actorId))
    return reject('current-operational-employment-required');
  if (claimAt(s, input.id)) return reject('earned-wage-claim-already-exists');
  if (Object.values(s.claims).some((c) => c.status === 'active' && c.actorId === input.actorId))
    return reject('earned-labor-already-active');
  const claim: EarnedWageClaim = {
    id: input.id,
    actorId: input.actorId,
    laborId: input.laborId,
    revision: 1,
    startedAt: input.at,
    settledAt: input.at,
    plannedMs: input.plannedMs,
    totalWageMicros: input.totalWageMicros,
    elapsedMs: 0,
    earnedMicros: 0,
    paidMicros: 0,
    status: 'active',
  };
  return validateDecision(e, {
    type: 'EnterpriseEarnedWageRecorded',
    previousRevision: s.revision,
    claim,
  });
}

/** Employment can have ended: previously performed labor still belongs to this creditor. */
export function decideAccrueEarnedLabor(input: {
  readonly enterprise: EnterpriseState;
  readonly claimId: string;
  readonly expectedRevision: number;
  readonly through: number;
  readonly elapsedMs: number;
  readonly ended: boolean;
}): Decision {
  const s = input.enterprise.earnedPayroll;
  if (!s) return reject('earned-payroll-not-enabled');
  const c = claimAt(s, input.claimId);
  if (!c || c.status !== 'active') return reject('active-earned-labor-required');
  if (c.revision !== input.expectedRevision) return reject('earned-wage-revision-conflict');
  if (!integer(input.elapsedMs) || input.elapsedMs < c.elapsedMs || input.elapsedMs > c.plannedMs)
    return reject('invalid-earned-labor-progress');
  return validateDecision(input.enterprise, {
    type: 'EnterpriseEarnedWageRecorded',
    previousRevision: s.revision,
    claim: {
      ...c,
      revision: c.revision + 1,
      settledAt: input.through,
      elapsedMs: input.elapsedMs,
      earnedMicros: earnedAt(c, input.elapsedMs),
      status: input.ended || input.elapsedMs === c.plannedMs ? 'ended' : 'active',
    },
  });
}

export function decidePayEarnedWage(input: {
  readonly enterprise: EnterpriseState;
  readonly actorId: AgentId;
  readonly claimId: string;
  readonly expectedRevision: number;
}): Decision {
  const s = input.enterprise.earnedPayroll;
  if (!s) return reject('earned-payroll-not-enabled');
  const c = claimAt(s, input.claimId);
  if (!c || c.actorId !== input.actorId) return reject('own-earned-wage-required');
  if (c.revision !== input.expectedRevision) return reject('earned-wage-revision-conflict');
  // Flooring cash never promises sub-micro currency or overdraws the real account.
  const available = Math.floor(input.enterprise.balance * EARNED_PAYROLL_POLICY.moneyScale);
  const amountMicros = Math.min(c.earnedMicros - c.paidMicros, available);
  if (!integer(amountMicros) || amountMicros <= 0) return reject('no-payable-earned-wage');
  return validateDecision(input.enterprise, {
    type: 'EnterpriseEarnedWagePaid',
    previousRevision: s.revision,
    claimId: c.id,
    actorId: c.actorId,
    amountMicros,
  });
}

/** Aggregate-owned state transition. Payment only debits the enterprise; world must credit/tax atomically. */
export function applyEarnedPayrollEvent(
  e: EnterpriseState,
  event: EarnedPayrollEvent,
): EnterpriseState {
  if (event.type === 'EnterpriseEarnedPayrollEnabled') {
    if (
      e.earnedPayroll ||
      e.status === 'closed' ||
      event.legacyUnattributedAmount !== (e.wageArrears ?? 0)
    )
      throw Error('invalid-earned-payroll-activation');
    const earnedPayroll: EarnedPayrollState = {
      policyVersion: EARNED_PAYROLL_POLICY.version,
      revision: 1,
      legacyUnattributedAmount: event.legacyUnattributedAmount,
      claims: {},
    };
    assertEarnedPayrollState(earnedPayroll);
    return { ...e, earnedPayroll, wageArrears: earnedPayrollArrears(earnedPayroll) };
  }
  const s = e.earnedPayroll;
  if (!s || s.revision !== event.previousRevision || e.status === 'closed')
    throw Error('earned-payroll-revision-conflict');
  let c: EarnedWageClaim,
    amount = 0;
  if (event.type === 'EnterpriseEarnedWageRecorded') {
    c = event.claim;
    const old = claimAt(s, c.id);
    if (!old) {
      if (
        !['active', 'insolvent'].includes(e.status) ||
        !e.employeeAgentIds.includes(c.actorId) ||
        c.revision !== 1 ||
        c.elapsedMs !== 0 ||
        c.earnedMicros !== 0 ||
        c.paidMicros !== 0 ||
        c.startedAt !== c.settledAt ||
        c.status !== 'active'
      )
        throw Error('invalid-earned-labor-start');
    } else if (
      old.status !== 'active' ||
      c.revision !== old.revision + 1 ||
      c.actorId !== old.actorId ||
      c.laborId !== old.laborId ||
      c.startedAt !== old.startedAt ||
      c.plannedMs !== old.plannedMs ||
      c.totalWageMicros !== old.totalWageMicros ||
      c.paidMicros !== old.paidMicros ||
      c.settledAt < old.settledAt ||
      c.elapsedMs < old.elapsedMs ||
      c.elapsedMs - old.elapsedMs > c.settledAt - old.settledAt ||
      (c.elapsedMs === old.elapsedMs && c.status === old.status)
    )
      throw Error('invalid-earned-labor-transition');
  } else {
    const old = claimAt(s, event.claimId);
    amount = event.amountMicros / EARNED_PAYROLL_POLICY.moneyScale;
    if (
      !old ||
      old.actorId !== event.actorId ||
      !integer(event.amountMicros) ||
      event.amountMicros <= 0 ||
      event.amountMicros > old.earnedMicros - old.paidMicros ||
      amount > e.balance
    )
      throw Error('invalid-earned-wage-payment');
    c = { ...old, revision: old.revision + 1, paidMicros: old.paidMicros + event.amountMicros };
  }
  const earnedPayroll: EarnedPayrollState = {
    ...s,
    revision: s.revision + 1,
    claims: { ...s.claims, [c.id]: structuredClone(c) },
  };
  assertEarnedPayrollState(earnedPayroll);
  return {
    ...e,
    earnedPayroll,
    wageArrears: earnedPayrollArrears(earnedPayroll),
    balance: e.balance - amount,
    cumulativeWages: e.cumulativeWages + amount,
    ...(amount
      ? {
          retainedEarnings:
            (e.retainedEarnings ??
              e.cumulativeSales -
                e.cumulativePurchases -
                e.cumulativeWages -
                (e.cumulativeDividends ?? 0)) - amount,
        }
      : {}),
  };
}

export function hasProtectedEarnedLabor(e: EnterpriseState): boolean {
  return (
    e.earnedPayroll !== undefined &&
    (earnedPayrollArrears(e.earnedPayroll) > 0 ||
      Object.values(e.earnedPayroll.claims).some((c) => c.status === 'active'))
  );
}

function validateDecision(e: EnterpriseState, event: EarnedPayrollEvent): Decision {
  try {
    applyEarnedPayrollEvent(e, event);
    return { accepted: true, event };
  } catch (error) {
    return reject(error instanceof Error ? error.message : 'invalid-earned-payroll-decision');
  }
}
