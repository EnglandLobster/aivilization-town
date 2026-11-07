import { expect, test } from 'vitest';
import {
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
  type ServicesState,
} from '@aivilization/services';
import {
  createWorldProjection,
  applyWorldEvent,
  applyWorldEventWithPrincipalAuthority,
} from './projection';
import { enableServiceClosureEvent } from './serviceClosurePolicy';
import { enterpriseServiceEstateRefusal } from './servicePrincipalEstate';
function fixture() {
  const world = createWorldProjection({ agents: [], moneySupply: 0 });
  const directory: ServicesState = {
    ...emptyServicesState(STAFFED_SERVICES_POLICY),
    principalPolicy: INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
  };
  const event = enableServiceClosureEvent({
    projection: world,
    directory,
    simulationId: 'test',
    requestId: 'enable',
    nextSequence: 1,
  });
  return { world, directory, event };
}
test('explicit dependency preserves public authority and legacy replay; missing directory cannot prove clearance', () => {
  const { world, directory, event } = fixture();
  expect(enterpriseServiceEstateRefusal(world, 'firm')).toBeUndefined();
  expect(() => applyWorldEvent(world, event)).toThrow('service-principal-directory-port-required');
  const next = applyWorldEventWithPrincipalAuthority(world, event, undefined, directory);
  expect(next.publicGovernance).toEqual(world.publicGovernance);
  expect(next.agents).toEqual(world.agents);
  expect(enterpriseServiceEstateRefusal(next, 'firm')).toBe(
    'service-principal-directory-port-required',
  );
  expect(enterpriseServiceEstateRefusal(next, 'firm', directory)).toBeUndefined();
  expect(
    applyWorldEventWithPrincipalAuthority(structuredClone(world), event, undefined, directory),
  ).toEqual(next);
  expect(() => applyWorldEventWithPrincipalAuthority(next, event, undefined, directory)).toThrow(
    'invalid-service-closure-activation',
  );
  const occupied: ServicesState = {
    ...directory,
    services: {
      clinic: {
        id: 'clinic',
        ownerId: 'author',
        enterpriseId: 'firm',
        kind: 'appointment',
        locationId: 'site',
        title: 'Clinic',
        description: 'Original',
        capacity: 1,
        revision: 1,
        active: true,
      },
    },
  };
  expect(enterpriseServiceEstateRefusal(next, 'firm', occupied)).toBe(
    'enterprise-service-estate-unsettled',
  );
  expect(() => applyWorldEventWithPrincipalAuthority(world, event, undefined, occupied)).toThrow(
    'service-closure-existing-orphan-responsibility',
  );
  expect(
    enterpriseServiceEstateRefusal(next, 'firm', {
      ...occupied,
      services: { clinic: { ...occupied.services.clinic!, active: false } },
    }),
  ).toBeUndefined();
});
