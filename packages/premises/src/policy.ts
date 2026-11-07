import { RESOURCE_CONTROL_POLICY, assertResourceControlPolicy } from '@aivilization/authority';
import { validInventory } from '@aivilization/materials';
import {
  FIXTURE_KINDS,
  type PremisesPolicy,
  type PublicLandUsePolicy,
  type PremisesBlueprint,
  type ConstructionPlan,
} from './model';
export const PREMISES_POLICY: PremisesPolicy = {
  version: 'resident-premises-v1',
  control: RESOURCE_CONTROL_POLICY,
  maxSites: 1000,
  maxBuildings: 1000,
  maxProjects: 5000,
  maxProjectsPerController: 100,
  maxFloorArea: 2000,
  maxWorkers: 30,
  maxReservations: 20,
  maxShiftMs: 8 * 3600000,
  settlementIntervalMs: 60000,
  areaPerOccupant: 4,
  maxStoragePerArea: 100,
  baseMaterialsPerArea: { Wood: 1 },
  fixtureMaterials: {
    workstations: { 'Iron Ingot': 1 },
    careStations: { 'Iron Ingot': 1, 'Copper Ingot': 1 },
    teachingStations: { Book: 1 },
    storageUnits: { Wood: 0.01 },
  },
  workMsPerArea: 60000,
  fixtureWorkMs: {
    workstations: 60000,
    careStations: 120000,
    teachingStations: 60000,
    storageUnits: 100,
  },
  energyPerWorkHour: 10,
  satietyPerWorkHour: 5,
  maintenanceFraction: 0.25,
  refitFraction: 0.1,
  demolitionWorkFraction: 0.5,
  salvageFraction: 0.5,
  wearIntervalMs: 86400000,
  wearPerInterval: 1,
};
export const PUBLIC_LAND_USE_POLICY: PublicLandUsePolicy = {
  version: 'public-construction-use-v1',
  revision: 1,
  mode: 'open-with-funded-project',
  maxActiveProjectsPerController: 5,
  provenance: 'explicit-scenario-initial-institution-not-resident-consensus',
};
export function assertPremisesPolicy(p: PremisesPolicy) {
  assertResourceControlPolicy(p.control);
  if (
    p.version !== 'resident-premises-v1' ||
    ![
      p.maxSites,
      p.maxBuildings,
      p.maxProjects,
      p.maxProjectsPerController,
      p.maxFloorArea,
      p.maxWorkers,
      p.maxReservations,
      p.maxShiftMs,
      p.settlementIntervalMs,
      p.areaPerOccupant,
      p.maxStoragePerArea,
      p.workMsPerArea,
      p.wearIntervalMs,
      p.wearPerInterval,
      ...Object.values(p.fixtureWorkMs),
    ].every((n) => Number.isSafeInteger(n) && n > 0) ||
    !validInventory(p.baseMaterialsPerArea, 64, 1000000) ||
    FIXTURE_KINDS.some((k) => !validInventory(p.fixtureMaterials[k], 64, 1000000)) ||
    ![p.energyPerWorkHour, p.satietyPerWorkHour].every((n) => Number.isFinite(n) && n > 0) ||
    ![p.maintenanceFraction, p.refitFraction, p.demolitionWorkFraction].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 1,
    ) ||
    !Number.isFinite(p.salvageFraction) ||
    p.salvageFraction < 0 ||
    p.salvageFraction > 1
  )
    throw new Error('invalid-premises-policy');
}
export function assertPublicLandUsePolicy(p: PublicLandUsePolicy) {
  if (
    p.version !== 'public-construction-use-v1' ||
    !Number.isSafeInteger(p.revision) ||
    p.revision < 1 ||
    !['open-with-funded-project', 'authorization-required'].includes(p.mode) ||
    !Number.isSafeInteger(p.maxActiveProjectsPerController) ||
    p.maxActiveProjectsPerController < 1 ||
    !p.provenance.trim()
  )
    throw new Error('invalid-public-land-use-policy');
}
export function validBlueprint(b: PremisesBlueprint, p: PremisesPolicy) {
  return (
    ['residence', 'production', 'social', 'education', 'healthcare', 'market', 'food'].includes(
      b.primaryUse,
    ) &&
    Number.isSafeInteger(b.floorArea) &&
    b.floorArea >= p.areaPerOccupant &&
    b.floorArea <= p.maxFloorArea &&
    Number.isSafeInteger(b.capacity) &&
    b.capacity > 0 &&
    b.capacity * p.areaPerOccupant <= b.floorArea &&
    Object.keys(b.fixtures).length === FIXTURE_KINDS.length &&
    FIXTURE_KINDS.every(
      (k) =>
        Number.isSafeInteger(b.fixtures[k]) &&
        b.fixtures[k] >= 0 &&
        b.fixtures[k] <= (k === 'storageUnits' ? b.floorArea * p.maxStoragePerArea : b.capacity),
    ) &&
    b.fixtures.workstations + b.fixtures.careStations + b.fixtures.teachingStations <= b.capacity
  );
}
export function planConstruction(
  p: PremisesPolicy,
  blueprint: PremisesBlueprint,
  kind: 'build' | 'modify' | 'maintain' | 'demolish',
  existing?: { blueprint: PremisesBlueprint; condition: number },
): ConstructionPlan | undefined {
  assertPremisesPolicy(p);
  if (!validBlueprint(blueprint, p)) return undefined;
  if (
    kind !== 'build' &&
    (!existing ||
      !validBlueprint(existing.blueprint, p) ||
      !Number.isSafeInteger(existing.condition) ||
      existing.condition < 0 ||
      existing.condition > 1000)
  )
    return undefined;
  if (
    kind === 'modify' &&
    existing &&
    (blueprint.floorArea < existing.blueprint.floorArea ||
      blueprint.capacity < existing.blueprint.capacity ||
      FIXTURE_KINDS.some((k) => blueprint.fixtures[k] < existing.blueprint.fixtures[k]))
  )
    return undefined;
  if (
    (kind === 'maintain' || kind === 'demolish') &&
    existing &&
    !sameBlueprint(blueprint, existing.blueprint)
  )
    return undefined;
  const repairPoints = kind === 'maintain' ? 1000 - existing!.condition : 0;
  if (kind === 'maintain' && repairPoints === 0) return undefined;
  const area =
    kind === 'modify' ? blueprint.floorArea - existing!.blueprint.floorArea : blueprint.floorArea;
  const fixtures = Object.fromEntries(
    FIXTURE_KINDS.map((k) => [
      k,
      kind === 'modify'
        ? blueprint.fixtures[k] - existing!.blueprint.fixtures[k]
        : blueprint.fixtures[k],
    ]),
  );
  const materials: Record<string, number> = {};
  const refit = kind === 'modify' && area === 0 && FIXTURE_KINDS.every((k) => fixtures[k] === 0);
  if (refit && existing && sameBlueprint(blueprint, existing.blueprint)) return undefined;
  const add = (v: Readonly<Record<string, number>>, n: number) => {
    for (const [k, q] of Object.entries(v)) materials[k] = (materials[k] ?? 0) + q * n;
  };
  if (kind !== 'demolish') {
    add(p.baseMaterialsPerArea, refit ? blueprint.floorArea : area);
    for (const k of FIXTURE_KINDS) add(p.fixtureMaterials[k], fixtures[k]!);
  }
  const factor =
    kind === 'maintain'
      ? (repairPoints / 1000) * p.maintenanceFraction
      : kind === 'demolish'
        ? p.demolitionWorkFraction
        : refit
          ? p.refitFraction
          : 1;
  for (const k of Object.keys(materials)) {
    materials[k] = Math.ceil(materials[k]! * factor * 1000000) / 1000000;
    if (materials[k] === 0) delete materials[k];
  }
  const workMs = Math.ceil(
    ((refit ? blueprint.floorArea : area) * p.workMsPerArea +
      FIXTURE_KINDS.reduce((n, k) => n + fixtures[k]! * p.fixtureWorkMs[k], 0)) *
      factor,
  );
  if (
    !Number.isSafeInteger(workMs) ||
    workMs <= 0 ||
    (kind !== 'demolish' && !validInventory(materials, 64, 1000000))
  )
    return undefined;
  return {
    modelVersion: p.version,
    blueprint: structuredClone(blueprint),
    materials,
    workMs,
    energyCost: (workMs / 3600000) * p.energyPerWorkHour,
    satietyCost: (workMs / 3600000) * p.satietyPerWorkHour,
    addedFloorArea: kind === 'build' || kind === 'modify' ? area : 0,
    repairPoints,
  };
}
export function sameBlueprint(a: PremisesBlueprint, b: PremisesBlueprint) {
  return (
    a.primaryUse === b.primaryUse &&
    a.floorArea === b.floorArea &&
    a.capacity === b.capacity &&
    FIXTURE_KINDS.every((k) => a.fixtures[k] === b.fixtures[k])
  );
}
