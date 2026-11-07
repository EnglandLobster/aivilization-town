import {
  authorizePremisesPrincipal,
  principalPremisesReceipt,
  type PrincipalCreateConstruction,
} from './principal';
import { authorizeController, sameController, validController } from '@aivilization/authority';
import {
  materialId,
  moveInventory,
  validInventory,
  type MaterialConsumerAuthorization,
  type MaterialReservation,
} from '@aivilization/materials';
import type { Inventory } from '@aivilization/economy';
import { planConstruction } from './policy';
import type {
  PremisesState,
  PremisesPorts,
  PremisesBlueprint,
  ConstructionProject,
  PremisesEvent,
} from './model';
export type ConstructionResourceAction = {
  readonly reservationId: string;
  readonly expectedRevision: number;
  readonly authorization: MaterialConsumerAuthorization;
};
export type ConstructionDecision =
  | {
      readonly accepted: true;
      readonly events: readonly PremisesEvent[];
      readonly materials: readonly ConstructionResourceAction[];
    }
  | { readonly accepted: false; readonly reason: string };
export type CreateConstruction = {
  readonly id: string;
  readonly kind: ConstructionProject['kind'];
  readonly buildingId: string;
  readonly siteId: string;
  readonly expectedSiteRevision: number;
  readonly expectedBuildingRevision?: number;
  readonly controller: ConstructionProject['controller'];
  readonly title: string;
  readonly description: string;
  readonly blueprint: PremisesBlueprint;
  readonly workers: readonly string[];
  readonly reservations: readonly { readonly id: string; readonly revision: number }[];
};
const no = (reason: string): ConstructionDecision => ({ accepted: false, reason });
export function createConstruction(
  s: PremisesState,
  actorId: string,
  at: number,
  evidenceId: string,
  c: CreateConstruction | PrincipalCreateConstruction,
  ports: PremisesPorts,
  principal = false,
): ConstructionDecision {
  if (
    !materialId(actorId) ||
    !ports.exists(actorId) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !materialId(evidenceId) ||
    !materialId(c.id) ||
    s.projects[c.id] ||
    !materialId(c.buildingId) ||
    !(principal
      ? s.resourcePrincipals && ports.principalAvailable?.(c.controller)
      : (c.controller.kind === 'resident' || c.controller.kind === 'collective') &&
        validController({ kind: c.controller.kind, id: c.controller.id }) &&
        ports.controlAvailable({ kind: c.controller.kind, id: c.controller.id })) ||
    !c.title.trim() ||
    c.title.length > 120 ||
    c.description.length > 2000 ||
    !c.workers.length ||
    c.workers.length > s.policy.maxWorkers ||
    new Set(c.workers).size !== c.workers.length ||
    c.workers.some((id) => !ports.exists(id))
  )
    return no('invalid-construction-definition');
  const proof = principal
    ? authorizePremisesPrincipal(
        s,
        actorId,
        { type: 'create-construction', construction: c },
        ports,
      )
    : undefined;
  const grant = principal
    ? proof
      ? {
          actorId,
          ...(proof.source.kind === 'collective' ? { decisionId: proof.source.decisionId } : {}),
        }
      : undefined
    : c.controller.kind === 'resident' || c.controller.kind === 'collective'
      ? authorizeController(
          { kind: c.controller.kind, id: c.controller.id },
          actorId,
          ports.authorize,
        )
      : undefined;
  if (!grant) return no('construction-controller-authority-required');
  const site = s.sites[c.siteId],
    existing = s.buildings[c.buildingId];
  if (!site) return no('construction-site-not-found');
  if (site.revision !== c.expectedSiteRevision || site.revision >= Number.MAX_SAFE_INTEGER)
    return no('construction-site-revision-conflict');
  if (
    (c.kind === 'build' && existing) ||
    (c.kind !== 'build' &&
      (!existing || existing.siteId !== site.id || existing.status === 'demolished'))
  )
    return no('construction-building-unavailable');
  if (
    existing &&
    (existing.revision !== c.expectedBuildingRevision ||
      existing.revision >= Number.MAX_SAFE_INTEGER ||
      at < existing.at ||
      !sameController(existing.control.controller, c.controller))
  )
    return no('construction-building-authority-or-version-conflict');
  if (Object.values(s.projects).some((p) => p.buildingId === c.buildingId && p.status === 'open'))
    return no('construction-already-in-progress');
  if (
    Object.keys(s.projects).length >= s.policy.maxProjects ||
    Object.values(s.projects).filter((p) => sameController(p.controller, c.controller)).length >=
      s.policy.maxProjectsPerController ||
    (c.kind === 'build' &&
      Object.keys(s.buildings).length +
        Object.values(s.projects).filter((p) => p.kind === 'build' && p.status === 'open').length >=
        s.policy.maxBuildings)
  )
    return no('construction-project-limit');
  if (
    c.kind === 'demolish' &&
    existing &&
    (existing.status !== 'closed' ||
      ports.occupiedOrReserved(existing.id) > 0 ||
      ports.hasObligations(existing.id))
  )
    return no('premises-unsettled');
  const plan = planConstruction(s.policy, c.blueprint, c.kind, existing);
  if (!plan) return no('invalid-construction-blueprint');
  if (
    existing &&
    c.kind !== 'demolish' &&
    !validInventory(moveInventory(existing.embodied, plan.materials, 'add'), 64, 1000000, true)
  )
    return no('construction-embodied-material-limit');
  if (
    existing &&
    c.kind === 'modify' &&
    existing.blueprint.primaryUse !== c.blueprint.primaryUse &&
    (existing.status !== 'closed' ||
      ports.occupiedOrReserved(existing.id) > 0 ||
      ports.hasObligations(existing.id))
  )
    return no('premises-use-change-requires-settlement');
  if (plan.addedFloorArea > site.usableFloorArea - site.occupiedFloorArea - site.reservedFloorArea)
    return no('construction-site-area-unavailable');
  // Existing permitted footprint remains usable when the public rule for new area changes.
  const landGrant =
    c.kind !== 'build' && plan.addedFloorArea === 0
      ? {
          authorityId: `existing-premises-${c.buildingId}`,
          policyVersion: s.policy.version,
          revision: existing!.revision,
        }
      : ports.siteGrant(site.id, c.controller, c.id, plan.addedFloorArea);
  if (!landGrant) return no('construction-site-permission-required');
  if (
    c.reservations.length > s.policy.maxReservations ||
    new Set(c.reservations.map((r) => r.id)).size !== c.reservations.length
  )
    return no('invalid-construction-reservations');
  const reservations: MaterialReservation[] = [],
    total: Record<string, number> = {},
    // All construction uses the site's external work area, including repair of inaccessible premises.
    workLocationId = site.parentLocationId;
  for (const ref of c.reservations) {
    const r = ports.reservation(ref.id);
    if (
      !r ||
      r.revision !== ref.revision ||
      r.status !== 'offered' ||
      r.expiresAt <= at ||
      r.consumer.domain !== 'premises' ||
      r.consumer.id !== c.id ||
      !sameController(r.beneficiary, c.controller) ||
      ports.stockLocation(r.stockId) !== workLocationId
    )
      return no('construction-material-reservation-unavailable');
    reservations.push(r);
    for (const [k, n] of Object.entries(r.held)) {
      total[k] = (total[k] ?? 0) + n;
      if (!Number.isFinite(total[k])) return no('construction-material-overflow');
    }
  }
  if (!inventoryEqual(total, plan.materials))
    return no('construction-materials-do-not-match-blueprint');
  const project: ConstructionProject = {
    id: c.id,
    kind: c.kind,
    buildingId: c.buildingId,
    siteId: site.id,
    workLocationId,
    controller: { ...c.controller },
    ...(proof ? { principalAuthorization: structuredClone(proof) } : {}),
    createdBy: actorId,
    ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
    title: c.title,
    description: c.description,
    plan,
    workers: [...c.workers],
    reservations: reservations.map((r) => ({
      id: r.id,
      sourceStockId: r.stockId,
      committedRevision: r.revision + 1,
      materials: { ...r.held },
    })),
    landUse: landGrant,
    progressMs: 0,
    status: 'open',
    revision: 1,
    at,
  };
  return {
    accepted: true,
    events: [
      {
        type: 'ConstructionSiteChanged',
        site: {
          ...site,
          reservedFloorArea: site.reservedFloorArea + plan.addedFloorArea,
          revision: site.revision + 1,
        },
      },
      { type: 'ConstructionProjectChanged', project },
      ...(proof ? [principalPremisesReceipt(evidenceId, at, proof)] : []),
    ],
    materials: reservations.map((r) => ({
      reservationId: r.id,
      expectedRevision: r.revision,
      authorization: { consumer: r.consumer, beneficiary: r.beneficiary, evidenceId },
    })),
  };
}
export function inventoryEqual(a: Inventory, b: Inventory) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (k) =>
      Number.isFinite(a[k] ?? 0) &&
      Number.isFinite(b[k] ?? 0) &&
      Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-8,
  );
}
export function initialPublicSiteGrant(
  s: PremisesState,
  siteId: string,
  controller: ConstructionProject['controller'],
) {
  if (
    !s.sites[siteId] ||
    s.landUsePolicy.mode !== 'open-with-funded-project' ||
    Object.values(s.projects).filter(
      (p) => p.status === 'open' && sameController(p.controller, controller),
    ).length >= s.landUsePolicy.maxActiveProjectsPerController
  )
    return undefined;
  return {
    authorityId: `initial-public-site-${siteId}`,
    policyVersion: s.landUsePolicy.version,
    revision: s.landUsePolicy.revision,
  };
}
