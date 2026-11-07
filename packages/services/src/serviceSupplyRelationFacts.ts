import type { Service } from './model';
/** The immutable enterpriseId remains the original publication source; an explicit v5 fact owns future supply. */
export function currentServiceEnterprise(service: Service): string | undefined {
  return service.supplyRelation
    ? (service.supplyRelation.enterpriseId ?? undefined)
    : service.enterpriseId;
}
export function serviceSupplyRelationVersion(service: Service): number {
  return service.supplyRelation?.version ?? 1;
}
