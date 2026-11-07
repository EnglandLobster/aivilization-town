import type { ResourceSaleEnterpriseEffect } from './resourceSaleEnterpriseAccounting';
import type { PeriodicEnterpriseEffect } from './periodicEnterpriseAccounting';
import { applyEnterpriseDomainEvent } from '@aivilization/enterprise';
import type { ServiceEnterpriseAccounting } from './serviceEmploymentModel';
import type { CapitalEnterpriseEffect } from './capitalModel';
import type { PrincipalTradeEnterpriseEffect } from './principalTradeEnterpriseAccounting';
import type { CommonAccountSettlementContext } from '@aivilization/economy';
import type { WorldProjection } from './projection';
/** Closed owning-domain proofs for the two real enterprise settlement consumers. No generic balance setter. */
export function escrowEnterpriseEffects(input: {
  world: WorldProjection;
  context: CommonAccountSettlementContext;
  referenceIds: readonly string[];
  service?: readonly ServiceEnterpriseAccounting[];
  capital?: readonly CapitalEnterpriseEffect[];
  trade?: readonly PrincipalTradeEnterpriseEffect[];
  resourceSales?: readonly ResourceSaleEnterpriseEffect[];
  periodic?: readonly PeriodicEnterpriseEffect[];
}) {
  const enterprises = { ...input.world.enterprises },
    ids = new Set<string>();
  for (const f of input.service ?? []) {
    if (
      input.context !== 'services' ||
      !input.world.serviceEmployment ||
      !input.referenceIds.includes(f.event.serviceId) ||
      !enterprises[f.enterpriseId] ||
      f.event.type !== 'EnterpriseServiceAccountingRecorded'
    )
      throw Error('invalid-service-enterprise-accounting-event');
    enterprises[f.enterpriseId] = applyEnterpriseDomainEvent(enterprises[f.enterpriseId], f.event);
    ids.add(f.enterpriseId);
  }
  for (const f of input.capital ?? []) {
    const reference =
      f.event.type === 'EnterpriseCapitalAgreementCommitted'
        ? f.event.event.agreement.id
        : f.enterpriseId;
    if (
      input.context !== 'capital' ||
      !input.world.capitalAgreements ||
      !input.referenceIds.includes(reference) ||
      !enterprises[f.enterpriseId]
    )
      throw Error('invalid-capital-enterprise-accounting-event');
    enterprises[f.enterpriseId] = applyEnterpriseDomainEvent(enterprises[f.enterpriseId], f.event);
    ids.add(f.enterpriseId);
  }
  for (const f of input.trade ?? []) {
    if (
      !['trade-v3', 'construction-trade'].includes(input.context) ||
      (input.context === 'trade-v3'
        ? !input.world.residentTrade?.principalOrders
        : !input.world.residentTrade?.constructionOrders) ||
      (input.context === 'construction-trade'
        ? f.event.position.sourceKind !== 'construction'
        : f.event.position.sourceKind !== undefined) ||
      !input.referenceIds.includes(f.event.position.orderId) ||
      !enterprises[f.enterpriseId] ||
      f.event.type !== 'EnterpriseTradeAccountingRecorded'
    )
      throw Error('invalid-principal-trade-enterprise-accounting-event');
    enterprises[f.enterpriseId] = applyEnterpriseDomainEvent(enterprises[f.enterpriseId], f.event);
    ids.add(f.enterpriseId);
  }
  for (const f of input.resourceSales ?? []) {
    if (
      !['resource-sales', 'resource-sales-v2'].includes(input.context) ||
      !input.world.resourceSales ||
      !input.referenceIds.includes(f.event.receipt.saleId) ||
      !enterprises[f.enterpriseId] ||
      f.event.type !== 'EnterpriseResourceSaleAccountingRecorded'
    )
      throw Error('invalid-resource-sale-enterprise-accounting-event');
    enterprises[f.enterpriseId] = applyEnterpriseDomainEvent(enterprises[f.enterpriseId], f.event);
    ids.add(f.enterpriseId);
  }
  for (const f of input.periodic ?? []) {
    const id =
      f.event.type === 'EnterprisePeriodicPositionRegistered' ? f.event.position.id : f.event.id;
    if (
      input.context !== 'periodic-obligations' ||
      !input.world.periodicObligations ||
      !input.referenceIds.includes(id) ||
      !enterprises[f.enterpriseId]
    )
      throw Error('invalid-periodic-enterprise-accounting-event');
    enterprises[f.enterpriseId] = applyEnterpriseDomainEvent(enterprises[f.enterpriseId], f.event);
    ids.add(f.enterpriseId);
  }
  return { enterprises, ids };
}
