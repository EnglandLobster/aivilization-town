import { sameResourceControl, principalOperationKey } from '@aivilization/authority';
import type { Service } from './model';
export function sameServiceControlFacts(a: Service | undefined, b: Service): boolean {
  if (!a)
    return (
      b.control === undefined &&
      b.namedProviders === undefined &&
      b.principalAt === undefined &&
      b.supplyRelation === undefined
    );
  if (
    principalOperationKey(a.supplyRelation ?? null) !==
      principalOperationKey(b.supplyRelation ?? null) ||
    a.principalAt !== b.principalAt ||
    principalOperationKey(a.namedProviders ?? []) !== principalOperationKey(b.namedProviders ?? [])
  )
    return false;
  if (
    a.control?.policyVersion === 'resource-principals-v2' ||
    b.control?.policyVersion === 'resource-principals-v2'
  )
    return (
      !!a.control &&
      !!b.control &&
      principalOperationKey(a.control) === principalOperationKey(b.control)
    );
  return sameResourceControl(a.control, b.control);
}
