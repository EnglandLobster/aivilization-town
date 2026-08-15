import {
  assertMoneySupplyDelta,
  createAccountingTransaction,
  createMoneyTransfer,
  economicAccount,
  type Inventory,
} from '@aivilization/economy';
import { applyEnterpriseDomainEvent } from '@aivilization/enterprise';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldEnterpriseState } from '../enterprise';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';

/**
 * Projection adapter for the enterprise bounded context. Domain transitions
 * are delegated to the aggregate; this adapter only coordinates the household
 * accounts/jobs that sit outside the enterprise boundary.
 */
export function applyEnterpriseProjectionEvent(
  projection: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  switch (event.type) {
    case 'EnterpriseFounded':
      if (projection.enterprises[event.payload.enterpriseId] !== undefined) {
        throw new Error(`cannot replay duplicate enterprise ${event.payload.enterpriseId}`);
      }
      if (event.payload.initialCapital > 0) {
        assertDomesticTransfer({
          transactionId: event.id,
          reason: 'enterprise-capitalization',
          fromSector: 'agent',
          fromId: event.payload.ownerAgentId,
          toSector: 'enterprise',
          toId: event.payload.enterpriseId,
          amount: event.payload.initialCapital,
        });
      }
      return updateAgent(
        {
          ...projection,
          enterprises: {
            ...projection.enterprises,
            [event.payload.enterpriseId]: applyEnterpriseDomainEvent(undefined, {
              type: 'EnterpriseFounded',
              enterpriseId: event.payload.enterpriseId,
              name: event.payload.name,
              ownerAgentId: event.payload.ownerAgentId,
              occupationName: event.payload.occupationName,
              initialCapital: event.payload.initialCapital,
              maxEmployees: event.payload.maxEmployees,
              occurredAt: event.occurredAt,
            }),
          },
        },
        event.payload.ownerAgentId,
        (agent) => ({ ...agent, balance: event.payload.ownerNextBalance }),
      );
    case 'EnterpriseMemberJoined':
      return updateAgent(
        updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
          applyEnterpriseDomainEvent(enterprise, {
            type: 'EnterpriseMemberJoined',
            agentId: event.payload.agentId,
            ...(event.payload.wageOffer === undefined
              ? {}
              : { wageOffer: event.payload.wageOffer }),
          }),
        ),
        event.payload.agentId,
        (agent) => ({ ...agent, job: event.payload.occupationName }),
      );
    case 'EnterpriseJobPostingUpdated':
      return updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseJobPostingUpdated',
          wageOffer: event.payload.wageOffer,
          openSlots: event.payload.openSlots,
        }),
      );
    case 'EnterpriseEmployeeLeft':
    case 'EnterpriseEmployeeLaidOff':
      // The enterprise membership transition is delegated to the aggregate;
      // the household side clears the job only when it still names this
      // enterprise's occupation.
      return updateAgent(
        updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
          applyEnterpriseDomainEvent(enterprise, {
            type:
              event.type === 'EnterpriseEmployeeLeft'
                ? 'EnterpriseEmployeeLeft'
                : 'EnterpriseEmployeeLaidOff',
            agentId: event.payload.agentId,
          }),
        ),
        event.payload.agentId,
        (agent) => (agent.job === event.payload.occupationName ? { ...agent, job: null } : agent),
      );
    case 'EnterpriseWageArrearsUpdated':
      // Arrears memo only; the paid part moved with the companion WagePaid.
      return updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseWageArrearsUpdated',
          nextArrears: event.payload.nextArrears,
        }),
      );
    case 'EnterpriseFunded':
      assertDomesticTransfer({
        transactionId: event.id,
        reason: 'enterprise-funding',
        fromSector: 'agent',
        fromId: event.payload.funderAgentId,
        toSector: 'enterprise',
        toId: event.payload.enterpriseId,
        amount: event.payload.amount,
      });
      return updateAgent(
        updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
          applyEnterpriseDomainEvent(enterprise, {
            type: 'EnterpriseFunded',
            amount: event.payload.amount,
          }),
        ),
        event.payload.funderAgentId,
        (agent) => ({ ...agent, balance: event.payload.funderNextBalance }),
      );
    case 'EnterpriseInsolvencyStarted':
      return updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseInsolvencyStarted',
          evaluatedAt: event.payload.evaluatedAt,
        }),
      );
    case 'EnterpriseSolvencyRestored':
      return updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseSolvencyRestored',
          evaluatedAt: event.payload.evaluatedAt,
        }),
      );
    case 'EnterpriseBankruptcyDeclared': {
      const next = updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseBankruptcyDeclared',
          declaredAt: event.payload.declaredAt,
        }),
      );
      // Bankruptcy is always followed by an insolvent close in the same
      // settlement, so the terminal `closed` status cannot report it; keep a
      // cumulative tally for the economic-composition observation.
      return {
        ...next,
        bankruptEnterpriseTotal: (projection.bankruptEnterpriseTotal ?? 0) + 1,
      };
    }
    case 'EnterpriseDividendPaid': {
      const transaction = createAccountingTransaction({
        transactionId: event.id,
        reason: 'enterprise-dividend',
        entries: [
          {
            account: economicAccount('enterprise', event.payload.enterpriseId),
            amount: -event.payload.totalAmount,
          },
          ...event.payload.payments.map((payment) => ({
            account: economicAccount('agent' as const, payment.agentId),
            amount: payment.amount,
          })),
        ],
      });
      assertMoneySupplyDelta({ transaction, moneySupplyDelta: 0 });
      let next = updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseDividendPaid',
          totalAmount: event.payload.totalAmount,
          paidAt: event.payload.paidAt,
        }),
      );
      for (const payment of event.payload.payments) {
        next = updateAgent(next, payment.agentId, (agent) => ({
          ...agent,
          balance: agent.balance + payment.amount,
        }));
      }
      return next;
    }
    case 'EnterpriseClosed': {
      if (event.payload.reason === 'owner-departed') {
        // The owner permanently left the town: nothing returns to them. The
        // firm's cash burns out of the town economy (the departure carried
        // the owner out; the firm's inventory perishes with it), employees
        // are released, and the enterprise record closes.
        let departed = updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
          applyEnterpriseDomainEvent(enterprise, {
            type: 'EnterpriseClosed',
            closedAt: event.occurredAt,
          }),
        );
        const burned = event.payload.burnedBalance ?? 0;
        if (burned > 0) {
          const transaction = createMoneyTransfer({
            transactionId: event.id,
            reason: 'enterprise-owner-departure-burned',
            from: economicAccount('enterprise', event.payload.enterpriseId),
            to: economicAccount('external', 'departure-estate'),
            amount: burned,
          });
          assertMoneySupplyDelta({ transaction, moneySupplyDelta: -burned });
          departed = { ...departed, moneySupply: departed.moneySupply - burned };
        }
        for (const employeeAgentId of event.payload.employeeAgentIds) {
          departed = updateAgent(departed, employeeAgentId, (agent) => ({ ...agent, job: null }));
        }
        return departed;
      }
      if (event.payload.returnedBalance > 0) {
        assertDomesticTransfer({
          transactionId: event.id,
          reason: 'enterprise-liquidation',
          fromSector: 'enterprise',
          fromId: event.payload.enterpriseId,
          toSector: 'agent',
          toId: event.payload.ownerAgentId,
          amount: event.payload.returnedBalance,
        });
      }
      let next = updateEnterprise(projection, event.payload.enterpriseId, (enterprise) =>
        applyEnterpriseDomainEvent(enterprise, {
          type: 'EnterpriseClosed',
          closedAt: event.occurredAt,
        }),
      );
      next = updateAgent(next, event.payload.ownerAgentId, (agent) => ({
        ...agent,
        balance: agent.balance + event.payload.returnedBalance,
        inventory: addInventoryBatch(agent.inventory, event.payload.returnedInventory),
      }));
      for (const employeeAgentId of event.payload.employeeAgentIds) {
        next = updateAgent(next, employeeAgentId, (agent) => ({ ...agent, job: null }));
      }
      return next;
    }
    default:
      return undefined;
  }
}

function assertDomesticTransfer(input: {
  readonly transactionId: string;
  readonly reason: string;
  readonly fromSector: 'agent' | 'enterprise';
  readonly fromId: string;
  readonly toSector: 'agent' | 'enterprise';
  readonly toId: string;
  readonly amount: number;
}): void {
  const transaction = createMoneyTransfer({
    transactionId: input.transactionId,
    reason: input.reason,
    from: economicAccount(input.fromSector, input.fromId),
    to: economicAccount(input.toSector, input.toId),
    amount: input.amount,
  });
  assertMoneySupplyDelta({ transaction, moneySupplyDelta: 0 });
}

function addInventoryBatch(current: Inventory, added: Inventory): Inventory {
  const next = { ...current };
  for (const [commodityName, quantity] of Object.entries(added)) {
    next[commodityName] = (next[commodityName] ?? 0) + quantity;
  }
  return next;
}

function updateAgent(
  projection: WorldProjection,
  agentId: AgentId,
  update: (agent: WorldAgentState) => WorldAgentState,
): WorldProjection {
  const current = projection.agents[agentId];
  if (current === undefined) {
    throw new Error(`unknown agent ${agentId}`);
  }
  return {
    ...projection,
    agents: { ...projection.agents, [agentId]: update(current) },
  };
}

function updateEnterprise(
  projection: WorldProjection,
  enterpriseId: string,
  update: (enterprise: WorldEnterpriseState) => WorldEnterpriseState,
): WorldProjection {
  const current = projection.enterprises[enterpriseId];
  if (current === undefined) {
    throw new Error(`unknown enterprise ${enterpriseId}`);
  }
  return {
    ...projection,
    enterprises: { ...projection.enterprises, [enterpriseId]: update(current) },
  };
}
