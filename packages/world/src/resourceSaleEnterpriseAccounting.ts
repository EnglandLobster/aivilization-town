import {
  decideRecordEnterpriseResourceSaleAccounting,
  applyEnterpriseDomainEvent,
  type EnterpriseResourceSaleAccountingEvent,
  ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY,
  ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2,
} from '@aivilization/enterprise';
import type { ResourceSale } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
export type ResourceSaleEnterpriseEffect = {
  readonly enterpriseId: string;
  readonly event: EnterpriseResourceSaleAccountingEvent;
};
export function prepareResourceSaleEnterpriseEffects(
  w: WorldProjection,
  sale: ResourceSale,
): readonly ResourceSaleEnterpriseEffect[] {
  if (sale.status !== 'settled') return [];
  let enterprises = w.enterprises;
  const effects: ResourceSaleEnterpriseEffect[] = [];
  for (const side of ['payer', 'revenue'] as const) {
    const a = sale[side];
    if (a.sector !== 'enterprise') continue;
    const e = enterprises[a.id],
      proof = side === 'payer' ? sale.acceptedAuthorization : sale.offeredAuthorization;
    if (!e || !proof) throw Error('resource-sale-enterprise-original-source-required');
    const d = decideRecordEnterpriseResourceSaleAccounting(
      e,
      {
        saleId: sale.id,
        resourceId: sale.source.id,
        side,
        at: sale.at,
        amountMicros: sale.paidMicros,
        authorization: proof,
      },
      w.resourceSales?.policy.version === 'resident-resource-sales-v2'
        ? ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY_V2.version
        : ENTERPRISE_RESOURCE_SALES_ACCOUNTING_POLICY.version,
    );
    if (!d.accepted) throw Error(d.reason);
    effects.push({ enterpriseId: a.id, event: d.event });
    enterprises = { ...enterprises, [a.id]: applyEnterpriseDomainEvent(e, d.event) };
  }
  return effects;
}
