import { expect, test } from 'vitest';
import {
  emptyPremisesState,
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  type PremisesBuilding,
} from './index';
import { residentialStructureAt, assertResidentialStructureInterval } from './residentialStructure';
const building: PremisesBuilding = {
  id: 'home',
  siteId: 'site',
  locationId: 'premises-home',
  ownerId: 'builder',
  title: 'Unknown title',
  control: {
    policyVersion: 'resource-control-v1',
    version: 1,
    controller: { kind: 'resident', id: 'builder' },
    changedBy: 'builder',
    at: 0,
  },
  blueprint: {
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
  },
  condition: 500,
  status: 'operational',
  access: { entry: 'listed', visitors: [], operators: [], residents: [] },
  embodied: { Wood: 8 },
  salvage: {},
  footprintReleased: false,
  wearSettledAt: 0,
  revision: 1,
  at: 0,
};
const state = (b = building) => ({
  ...emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY),
  buildings: { home: b },
});
test('only actual existing residential structure provides facts; name, ACL and administrative closure do not change physical structure', () => {
  const s = state();
  expect(residentialStructureAt(s, 'premises-home')).toEqual({
    locationId: 'premises-home',
    buildingId: 'home',
    revision: 1,
    condition: 500,
  });
  expect(
    residentialStructureAt(
      state({ ...building, title: 'five star', status: 'closed' }),
      'premises-home',
    ),
  ).toEqual(residentialStructureAt(s, 'premises-home'));
  expect(residentialStructureAt(s, 'missing')).toBeUndefined();
  expect(
    residentialStructureAt(state({ ...building, status: 'demolished' }), 'premises-home'),
  ).toBeUndefined();
  expect(
    residentialStructureAt(state({ ...building, condition: 0 }), 'premises-home'),
  ).toBeUndefined();
  expect(
    residentialStructureAt(
      state({ ...building, blueprint: { ...building.blueprint, primaryUse: 'production' } }),
      'premises-home',
    ),
  ).toBeUndefined();
});
test('elapsed effects cannot cross owning wear boundary or silently read unsettled/future structure', () => {
  const s = state(),
    boundary = s.policy.wearIntervalMs;
  expect(() => assertResidentialStructureInterval(s, 0, boundary)).not.toThrow();
  expect(() => assertResidentialStructureInterval(s, 0, boundary + 1)).toThrow(
    'physical-housing-requires-settled-premises-boundaries',
  );
  expect(() => assertResidentialStructureInterval(s, boundary, boundary)).toThrow();
  expect(() =>
    assertResidentialStructureInterval(state({ ...building, wearSettledAt: 1 }), 0, 1),
  ).toThrow();
  expect(() => assertResidentialStructureInterval(s, 1, 0)).toThrow();
});
