import { hasEnterprisePrincipalAssets } from '../principalResourceObligations';
import { capitalCommit } from '../capitalSettlement';
import { applyWorldEvent } from '../projection';
import { enterpriseCapitalDistributions } from '@aivilization/enterprise';
import {
  applyEnterpriseDomainEvent,
  evaluateEnterpriseLifecycle,
  normalizeEnterpriseState,
  hasProtectedEarnedLabor,
  hasOpenServiceBusiness,
  type EnterprisePolicy,
} from '@aivilization/enterprise';
import type { CommandEnvelope } from '@aivilization/sim-core';
import {
  calculateCompletedRecruitmentCycleNumbers,
  evaluateDividendTax,
  type TaxPolicy,
} from '@aivilization/society';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import { makeEvent } from './shared';

/** Application scheduler adapter; enterprise formulas remain in the domain package. */
export function appendEnterpriseLifecycleEvents(input: {
  readonly command: CommandEnvelope<'AdvanceSimulationTime', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly policy?: EnterprisePolicy;
  readonly tax?: TaxPolicy;
}): void {
  const policy = input.policy;
  if (policy === undefined || (policy.solvency === undefined && policy.dividend === undefined)) {
    return;
  }
  const boundaryTimes = collectEnterpriseLifecycleBoundaryTimes({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cadences: [policy.solvency?.evaluationCadenceMs, policy.dividend?.paymentCadenceMs].filter(
      (cadence): cadence is number => cadence !== undefined,
    ),
  });
  const enterprises = new Map(
    Object.entries(input.projection.enterprises).map(([enterpriseId, enterprise]) => [
      enterpriseId,
      normalizeEnterpriseState(enterprise),
    ]),
  );
  // Running treasury view for audit payloads; the reducer applies treasury
  // deltas incrementally, so same-command budget spending stays consistent.
  let treasury = input.projection.treasury ?? 0;
  let capitalWorld = input.projection,
    capitalCursor = input.events.length;
  for (const evaluatedAt of boundaryTimes) {
    for (const [enterpriseId, initialEnterprise] of [...enterprises.entries()].sort(
      ([left], [right]) =>
        input.projection.residentLabor
          ? left < right
            ? -1
            : left > right
              ? 1
              : 0
          : left.localeCompare(right),
    )) {
      if (initialEnterprise.status === 'bankrupt' || initialEnterprise.status === 'closed') {
        continue;
      }
      let enterprise = initialEnterprise;
      const decision = evaluateEnterpriseLifecycle({ enterprise, evaluatedAt, policy });
      for (const domainEvent of decision.events) {
        if (domainEvent.type === 'EnterpriseInsolvencyStarted') {
          input.events.push(
            makeEvent(input, input.events.length, 'EnterpriseInsolvencyStarted', {
              enterpriseId,
              evaluatedAt,
              balance: enterprise.balance,
              minimumCashBalance: policy.solvency?.minimumCashBalance ?? 0,
              policyVersion: policy.policyVersion,
            }),
          );
        } else if (domainEvent.type === 'EnterpriseSolvencyRestored') {
          input.events.push(
            makeEvent(input, input.events.length, 'EnterpriseSolvencyRestored', {
              enterpriseId,
              evaluatedAt,
              balance: enterprise.balance,
              policyVersion: policy.policyVersion,
            }),
          );
        } else if (domainEvent.type === 'EnterpriseBankruptcyDeclared') {
          input.events.push(
            makeEvent(input, input.events.length, 'EnterpriseBankruptcyDeclared', {
              enterpriseId,
              declaredAt: evaluatedAt,
              balance: enterprise.balance,
              insolvencyStartedAt: enterprise.insolvencyStartedAt ?? evaluatedAt,
              policyVersion: policy.policyVersion,
            }),
          );
        } else if (
          domainEvent.type === 'EnterpriseDividendPaid' ||
          domainEvent.type === 'EnterpriseCapitalDividendPaid'
        ) {
          if (domainEvent.type === 'EnterpriseCapitalDividendPaid') {
            capitalWorld = input.events.slice(capitalCursor).reduce(applyWorldEvent, capitalWorld);
            capitalCursor = input.events.length;
            const d = capitalCommit({
              projection: capitalWorld,
              actorId: 'system',
              enterpriseId,
              requestId: `capital-dividend-${input.nextSequence + input.events.length}`,
              simulationId: input.command.simulationId,
              nextSequence: input.nextSequence + input.events.length,
              at: evaluatedAt,
              invocation: { kind: 'automatic' },
              events: [domainEvent],
            });
            if (!d.accepted) {
              input.events.push(
                makeEvent(
                  { ...input, command: { ...input.command, issuedAt: evaluatedAt } },
                  input.events.length,
                  'ResidentCapitalDistributionDeferred',
                  {
                    enterpriseId,
                    at: evaluatedAt,
                    equityVersion: domainEvent.equityVersion,
                    amount: domainEvent.totalAmount,
                    reason: d.reason,
                  },
                ),
              );
              continue;
            }
            input.events.push(...d.events);
          } else
            input.events.push(
              makeEvent(input, input.events.length, 'EnterpriseDividendPaid', {
                enterpriseId,
                totalAmount: domainEvent.totalAmount,
                payments: decision.dividendPayments.map((payment) => ({ ...payment })),
                previousBalance: enterprise.balance,
                nextBalance: enterprise.balance - domainEvent.totalAmount,
                previousRetainedEarnings: enterprise.retainedEarnings ?? 0,
                nextRetainedEarnings: (enterprise.retainedEarnings ?? 0) - domainEvent.totalAmount,
                paidAt: evaluatedAt,
                policyVersion: policy.policyVersion,
              }),
            );
          enterprise = applyEnterpriseDomainEvent(enterprise, domainEvent);
          // Profit tax on the dividend payout: charged from the post-dividend
          // cash account into the treasury; skipped when the enterprise cannot
          // cover it (v1 records no tax debt).
          const taxPolicy = input.tax;
          const dividendTax =
            taxPolicy?.dividendTaxRate === undefined
              ? 0
              : evaluateDividendTax({ amount: domainEvent.totalAmount, policy: taxPolicy });
          if (dividendTax > 0 && taxPolicy !== undefined && enterprise.balance >= dividendTax) {
            const previousTreasury = treasury;
            treasury += dividendTax;
            input.events.push(
              makeEvent(input, input.events.length, 'DividendTaxCharged', {
                enterpriseId,
                dividendAmount: domainEvent.totalAmount,
                amount: dividendTax,
                enterprisePreviousBalance: enterprise.balance,
                enterpriseNextBalance: enterprise.balance - dividendTax,
                previousTreasury,
                nextTreasury: treasury,
                policyVersion: taxPolicy.policyVersion,
              }),
            );
            enterprise = applyEnterpriseDomainEvent(enterprise, {
              type: 'EnterpriseTaxRecorded',
              amount: dividendTax,
            });
          }
          continue;
        }
        enterprise = applyEnterpriseDomainEvent(enterprise, domainEvent);
      }
      if (
        enterprise.status === 'bankrupt' &&
        !hasEnterprisePrincipalAssets(input.projection, enterpriseId) &&
        !enterprise.capital &&
        (!enterprise.control ||
          enterpriseCapitalDistributions(enterprise).every(
            (d) => !!input.projection.agents[d.agentId],
          )) &&
        !hasProtectedEarnedLabor(enterprise) &&
        !hasOpenServiceBusiness(enterprise)
      ) {
        input.events.push(
          makeEvent(input, input.events.length, 'EnterpriseClosed', {
            ...(enterprise.control
              ? { capitalDistributions: enterpriseCapitalDistributions(enterprise) }
              : {}),
            enterpriseId,
            ownerAgentId: enterprise.ownerAgentId,
            returnedBalance: enterprise.balance,
            returnedInventory: { ...enterprise.inventory },
            employeeAgentIds: [...enterprise.employeeAgentIds],
            reason: 'insolvent',
          }),
        );
        enterprise = applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseClosed',
          closedAt: evaluatedAt,
        });
      }
      enterprises.set(enterpriseId, enterprise);
    }
  }
}

function collectEnterpriseLifecycleBoundaryTimes(input: {
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly cadences: readonly number[];
}): readonly number[] {
  const times = new Set<number>();
  for (const cadenceMs of input.cadences) {
    for (const cycle of calculateCompletedRecruitmentCycleNumbers({
      previousSimulationTime: input.previousSimulationTime,
      nextSimulationTime: input.nextSimulationTime,
      cycleDurationMs: cadenceMs,
    })) {
      times.add((cycle + 1) * cadenceMs);
    }
  }
  return [...times].sort((left, right) => left - right);
}
