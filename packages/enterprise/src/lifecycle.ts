import {
  applyEnterpriseDomainEvent,
  ownershipPayments,
  type EnterpriseDomainEvent,
} from './aggregate';
import type { AgentId } from '@aivilization/sim-core';
import { normalizeEnterpriseState, type EnterpriseState } from './model';
import { assertValidEnterprisePolicy, type EnterprisePolicy } from './policy';

export type EnterpriseLifecycleDecision = {
  readonly events: readonly EnterpriseDomainEvent[];
  readonly dividendPayments: readonly {
    readonly agentId: AgentId;
    readonly amount: number;
  }[];
};

export function evaluateEnterpriseLifecycle(input: {
  readonly enterprise: EnterpriseState;
  readonly evaluatedAt: number;
  readonly policy: EnterprisePolicy;
}): EnterpriseLifecycleDecision {
  assertValidEnterprisePolicy(input.policy);
  let enterprise = normalizeEnterpriseState(input.enterprise);
  const events: EnterpriseDomainEvent[] = [];
  const solvency = input.policy.solvency;
  if (
    solvency !== undefined &&
    isCadenceDue(
      enterprise.lastSolvencyEvaluatedAt ?? enterprise.foundedAt,
      input.evaluatedAt,
      solvency.evaluationCadenceMs,
    )
  ) {
    if (enterprise.balance < solvency.minimumCashBalance) {
      if (enterprise.insolvencyStartedAt === undefined) {
        const event: EnterpriseDomainEvent = {
          type: 'EnterpriseInsolvencyStarted',
          evaluatedAt: input.evaluatedAt,
        };
        events.push(event);
        enterprise = applyEnterpriseDomainEvent(enterprise, event);
      } else if (input.evaluatedAt - enterprise.insolvencyStartedAt >= solvency.gracePeriodMs) {
        const event: EnterpriseDomainEvent = {
          type: 'EnterpriseBankruptcyDeclared',
          declaredAt: input.evaluatedAt,
        };
        events.push(event);
        enterprise = applyEnterpriseDomainEvent(enterprise, event);
      }
    } else if (enterprise.status === 'insolvent') {
      const event: EnterpriseDomainEvent = {
        type: 'EnterpriseSolvencyRestored',
        evaluatedAt: input.evaluatedAt,
      };
      events.push(event);
      enterprise = applyEnterpriseDomainEvent(enterprise, event);
    }
  }

  const dividend = input.policy.dividend;
  if (
    dividend !== undefined &&
    enterprise.status === 'active' &&
    isCadenceDue(
      enterprise.lastDividendPaidAt ?? enterprise.foundedAt,
      input.evaluatedAt,
      dividend.paymentCadenceMs,
    )
  ) {
    const distributableProfit = Math.max(0, enterprise.retainedEarnings ?? 0);
    const availableCash = Math.max(0, enterprise.balance - dividend.minimumCashReserve);
    const totalAmount = Math.min(distributableProfit * dividend.payoutRatio, availableCash);
    if (totalAmount > 0) {
      const event: EnterpriseDomainEvent = {
        type: 'EnterpriseDividendPaid',
        totalAmount,
        paidAt: input.evaluatedAt,
      };
      events.push(event);
      return {
        events,
        dividendPayments: ownershipPayments({ enterprise, totalAmount }),
      };
    }
  }
  return { events, dividendPayments: [] };
}

function isCadenceDue(previousAt: number, currentAt: number, cadenceMs: number): boolean {
  return currentAt > previousAt && currentAt % cadenceMs === 0;
}
