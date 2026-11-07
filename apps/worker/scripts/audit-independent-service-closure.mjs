// Read-port diagnostic, not authorization to close an enterprise or a free experiment.
import assert from 'node:assert/strict';
import { createWorldProjection, enterpriseServiceEstateRefusal } from '@aivilization/world';
import {
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
  enterpriseServiceEstateIds,
} from '@aivilization/services';
const world = createWorldProjection({ agents: [], moneySupply: 0 });
const directory = {
  ...emptyServicesState(STAFFED_SERVICES_POLICY),
  principalPolicy: INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
  services: {
    clinic: {
      id: 'clinic',
      ownerId: 'original-author',
      enterpriseId: 'firm',
      kind: 'appointment',
      locationId: 'clinic-site',
      title: 'Recorded service',
      description: 'Existing directory snapshot',
      capacity: 1,
      revision: 1,
      active: true,
    },
  },
};
const owned = enterpriseServiceEstateIds(directory, 'firm', world.clock.now);
assert.deepEqual(owned, ['clinic']);
const refusal = enterpriseServiceEstateRefusal(world, 'firm', directory);
console.log(
  JSON.stringify(
    {
      version: 'independent-service-closure-audit-v1',
      acceptance: false,
      publicGrantPresent: !!world.publicGovernance?.authority.grant.services,
      owningDomainOutstanding: owned,
      applicationRefusal: refusal ?? null,
      gapConfirmed: owned.length > 0 && refusal === undefined,
      scope: 'Authoritative directory read-port; no closure command, event or world mutation.',
    },
    null,
    2,
  ),
);
