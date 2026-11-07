import { enterpriseServiceEstateIds, type ServicesState } from '@aivilization/services';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';

export function enterpriseServiceEstateRefusal(
  world: WorldProjection,
  enterpriseId: string,
  directory?: ServicesState,
): string | undefined {
  if (!world.serviceClosurePolicy && !world.publicGovernance?.authority.grant.services)
    return undefined;
  if (!directory?.principalPolicy) return 'service-principal-directory-port-required';
  return enterpriseServiceEstateIds(directory, enterpriseId, world.clock.now).length
    ? 'enterprise-service-estate-unsettled'
    : undefined;
}

/** Validate the external aggregate before either closure settlement can change cash or membership. */
export function assertEnterpriseServiceClosure(
  world: WorldProjection,
  event: WorldEvent,
  directory?: ServicesState,
): void {
  const enterpriseId =
    event.type === 'EnterpriseClosed'
      ? event.payload.enterpriseId
      : event.type === 'ResidentCapitalCommitted' &&
          event.payload.events.some((e) => e.type === 'EnterpriseCapitalClosed')
        ? event.payload.enterpriseId
        : undefined;
  if (enterpriseId === undefined) return;
  const reason = enterpriseServiceEstateRefusal(world, enterpriseId, directory);
  if (reason) throw Error(reason);
}
