import { applyPremisesPrincipalControl } from './principalControl';
import { materialId, validInventory } from '@aivilization/materials';
import {
  sameController,
  validController,
  validResourcePrincipal,
  assertPrincipalAuthorization,
  principalOperationKey,
  principalId,
} from '@aivilization/authority';
import {
  assertPremisesPolicy,
  assertPublicLandUsePolicy,
  validBlueprint,
  sameBlueprint,
} from './policy';
import { inventoryEqual } from './projects';
import { assertPremisesFacilityUsePolicy } from './facilities';
import type {
  PremisesPolicy,
  PublicLandUsePolicy,
  PremisesState,
  PremisesEvent,
  ConstructionSite,
} from './model';
export function emptyPremisesState(
  policy: PremisesPolicy,
  landUsePolicy: PublicLandUsePolicy,
): PremisesState {
  assertPremisesPolicy(policy);
  assertPublicLandUsePolicy(landUsePolicy);
  return { policy, landUsePolicy, sites: {}, buildings: {}, projects: {} };
}
export function validConstructionSite(s: ConstructionSite) {
  return (
    materialId(s.id) &&
    !!s.parentLocationId.trim() &&
    Number.isSafeInteger(s.usableFloorArea) &&
    s.usableFloorArea > 0 &&
    Number.isSafeInteger(s.accessTravelMs) &&
    s.accessTravelMs > 0 &&
    Number.isSafeInteger(s.occupiedFloorArea) &&
    s.occupiedFloorArea >= 0 &&
    Number.isSafeInteger(s.reservedFloorArea) &&
    s.reservedFloorArea >= 0 &&
    s.occupiedFloorArea + s.reservedFloorArea <= s.usableFloorArea &&
    s.sourceId.trim().length > 0
  );
}
export function applyPremisesEvent(s: PremisesState | undefined, e: PremisesEvent): PremisesState {
  if (e.type === 'PremisesEnabled') {
    if (s) throw new Error('premises-already-enabled');
    return emptyPremisesState(e.policy, e.landUsePolicy);
  }
  if (!s) throw new Error('premises-not-enabled');
  if (e.type === 'PremisesResourcePrincipalsEnabled') {
    if (
      s.resourcePrincipals ||
      e.policy.version !== 'premises-resource-principals-v2' ||
      Object.keys(e.policy).length !== 1
    )
      throw Error('invalid-premises-principals-activation');
    return { ...s, resourcePrincipals: structuredClone(e.policy), principalReceipts: {} };
  }
  if (e.type === 'PremisesPrincipalControlChanged') return applyPremisesPrincipalControl(s, e);
  if (e.type === 'PremisesPrincipalOperationRecorded') {
    const r = e.receipt;
    if (
      !s.resourcePrincipals ||
      !principalId(r.id) ||
      s.principalReceipts?.[r.id] ||
      !Number.isSafeInteger(r.at) ||
      r.at < 0
    )
      throw Error('invalid-premises-principal-receipt');
    assertPrincipalAuthorization(
      r.authorization,
      r.authorization.principal,
      r.authorization.request,
      r.authorization.actorId,
    );
    return { ...s, principalReceipts: { ...s.principalReceipts, [r.id]: structuredClone(r) } };
  }
  if (e.type === 'ServiceFacilityEndowed') {
    const f = e.endowment;
    if (
      !f.locationId.trim() ||
      f.locationId.length > 200 ||
      s.serviceFacilityEndowments?.[f.locationId] ||
      Object.values(s.buildings).some((b) => b.locationId === f.locationId) ||
      ![f.careStations, f.teachingStations].every(
        (n) => Number.isSafeInteger(n) && n >= 0 && n <= 100,
      ) ||
      f.careStations + f.teachingStations < 1 ||
      !['scenario-seed', 'authorized-extension'].includes(f.source) ||
      !f.sourceId.trim() ||
      f.sourceId.length > 200 ||
      Object.keys(s.serviceFacilityEndowments ?? {}).length >= 1000
    )
      throw Error('invalid-service-facility-endowment');
    return {
      ...s,
      serviceFacilityEndowments: { ...s.serviceFacilityEndowments, [f.locationId]: f },
    };
  }
  if (e.type === 'PremisesFacilityUseEnabled') {
    if (s.facilityUsePolicy) throw Error('premises-facility-use-already-enabled');
    assertPremisesFacilityUsePolicy(e.policy);
    return { ...s, facilityUsePolicy: e.policy };
  }
  if (e.type === 'ConstructionSiteRegistered') {
    if (
      s.sites[e.site.id] ||
      e.site.revision !== 1 ||
      e.site.occupiedFloorArea !== 0 ||
      e.site.reservedFloorArea !== 0 ||
      !validConstructionSite(e.site)
    )
      throw new Error('invalid-construction-site-registration');
    return { ...s, sites: { ...s.sites, [e.site.id]: e.site } };
  }
  if (e.type === 'ConstructionSiteChanged') {
    const old = s.sites[e.site.id];
    if (
      !old ||
      e.site.revision !== old.revision + 1 ||
      e.site.usableFloorArea !== old.usableFloorArea ||
      e.site.parentLocationId !== old.parentLocationId ||
      e.site.accessTravelMs !== old.accessTravelMs ||
      e.site.source !== old.source ||
      e.site.sourceId !== old.sourceId ||
      !validConstructionSite(e.site)
    )
      throw new Error('invalid-construction-site-event');
    return { ...s, sites: { ...s.sites, [e.site.id]: e.site } };
  }
  if (e.type === 'PremisesBuildingChanged') {
    const old = s.buildings[e.building.id];
    if (
      e.building.revision !== (old?.revision ?? 0) + 1 ||
      !materialId(e.building.id) ||
      !s.sites[e.building.siteId] ||
      !validBlueprint(e.building.blueprint, s.policy) ||
      !(e.building.control.policyVersion === 'resource-principals-v2'
        ? s.resourcePrincipals && validResourcePrincipal(e.building.control.controller)
        : validController(e.building.control.controller)) ||
      (old &&
        old.control.policyVersion === 'resource-principals-v2' &&
        e.building.control.policyVersion !== 'resource-principals-v2') ||
      !Number.isSafeInteger(e.building.condition) ||
      e.building.condition < 0 ||
      e.building.condition > 1000 ||
      !Number.isSafeInteger(e.building.at) ||
      !Number.isSafeInteger(e.building.wearSettledAt) ||
      e.building.wearSettledAt < 0 ||
      e.building.wearSettledAt > e.building.at ||
      !validInventory(e.building.embodied, 64, 1000000, true) ||
      !validInventory(e.building.salvage, 64, 1000000, true) ||
      (e.building.status !== 'demolished' &&
        (Object.keys(e.building.salvage).length > 0 || e.building.footprintReleased)) ||
      (e.building.status === 'demolished' &&
        (Object.keys(e.building.embodied).length > 0 ||
          e.building.footprintReleased !== (Object.keys(e.building.salvage).length === 0))) ||
      (old?.status === 'demolished' &&
        (e.building.status !== 'demolished' ||
          !sameBlueprint(old.blueprint, e.building.blueprint))) ||
      (old &&
        (old.siteId !== e.building.siteId ||
          old.locationId !== e.building.locationId ||
          old.ownerId !== e.building.ownerId ||
          old.at > e.building.at ||
          old.wearSettledAt > e.building.wearSettledAt))
    )
      throw new Error('invalid-premises-building-event');
    return { ...s, buildings: { ...s.buildings, [e.building.id]: e.building } };
  }
  if (e.type === 'ConstructionProjectChanged') {
    const old = s.projects[e.project.id];
    const session = e.project.session;
    if (
      session &&
      (!e.project.workers.includes(session.actorId) ||
        ![session.startedAt, session.settledAt, session.until, session.workedMs].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        session.startedAt > session.settledAt ||
        session.settledAt > session.until ||
        session.until <= session.startedAt ||
        session.settledAt !== e.project.at ||
        session.workedMs > session.settledAt - session.startedAt ||
        (old?.session
          ? session.actorId !== old.session.actorId ||
            session.startedAt !== old.session.startedAt ||
            session.until !== old.session.until ||
            session.workedMs - old.session.workedMs !== e.project.progressMs - old.progressMs
          : session.startedAt !== e.project.at ||
            session.workedMs !== 0 ||
            e.project.progressMs !== (old?.progressMs ?? 0)))
    )
      throw new Error('invalid-construction-session-event');
    if (
      e.project.revision !== (old?.revision ?? 0) + 1 ||
      (old && old.status !== 'open') ||
      (old &&
        (old.siteId !== e.project.siteId ||
          old.buildingId !== e.project.buildingId ||
          old.kind !== e.project.kind ||
          old.createdBy !== e.project.createdBy ||
          principalOperationKey(old.principalAuthorization ?? null) !==
            principalOperationKey(e.project.principalAuthorization ?? null) ||
          old.decisionId !== e.project.decisionId ||
          old.title !== e.project.title ||
          old.description !== e.project.description ||
          old.workLocationId !== e.project.workLocationId ||
          !sameController(old.controller, e.project.controller) ||
          !sameBlueprint(old.plan.blueprint, e.project.plan.blueprint) ||
          !inventoryEqual(old.plan.materials, e.project.plan.materials) ||
          old.plan.workMs !== e.project.plan.workMs ||
          old.plan.energyCost !== e.project.plan.energyCost ||
          old.plan.satietyCost !== e.project.plan.satietyCost ||
          old.plan.addedFloorArea !== e.project.plan.addedFloorArea ||
          old.plan.repairPoints !== e.project.plan.repairPoints ||
          JSON.stringify(old.reservations) !== JSON.stringify(e.project.reservations) ||
          JSON.stringify(old.workers) !== JSON.stringify(e.project.workers) ||
          JSON.stringify(old.landUse) !== JSON.stringify(e.project.landUse) ||
          old.at > e.project.at ||
          old.progressMs > e.project.progressMs)) ||
      !(e.project.principalAuthorization
        ? s.resourcePrincipals && validResourcePrincipal(e.project.controller)
        : (e.project.controller.kind === 'resident' ||
            e.project.controller.kind === 'collective') &&
          validController({ kind: e.project.controller.kind, id: e.project.controller.id })) ||
      !materialId(e.project.id) ||
      !s.sites[e.project.siteId] ||
      !Number.isSafeInteger(e.project.at) ||
      e.project.at < 0 ||
      !validBlueprint(e.project.plan.blueprint, s.policy) ||
      !Number.isSafeInteger(e.project.plan.workMs) ||
      e.project.plan.workMs <= 0 ||
      ![e.project.plan.energyCost, e.project.plan.satietyCost].every(
        (n) => Number.isFinite(n) && n >= 0,
      ) ||
      !validInventory(e.project.plan.materials, 64, 1000000, true) ||
      !Number.isSafeInteger(e.project.plan.addedFloorArea) ||
      e.project.plan.addedFloorArea < 0 ||
      e.project.plan.modelVersion !== s.policy.version ||
      (e.project.status !== 'open' && !!e.project.session) ||
      (e.project.status === 'completed' && e.project.progressMs !== e.project.plan.workMs) ||
      !Number.isSafeInteger(e.project.progressMs) ||
      e.project.progressMs < 0 ||
      e.project.progressMs > e.project.plan.workMs
    )
      throw new Error('invalid-construction-project-event');
    return { ...s, projects: { ...s.projects, [e.project.id]: e.project } };
  }
  return s; // Allocation evidence is consumed by the atomic materials/world adapter.
}
