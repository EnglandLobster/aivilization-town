import {
  constructedPrincipalControl,
  authorizePremisesPrincipal,
  principalPremisesReceipt,
} from './principal';
import { moveInventory, materialId } from '@aivilization/materials';
import {
  sameController,
  authorizeController,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
  assertPrincipalAuthorization,
  principalOperationKey,
} from '@aivilization/authority';
import type { MaterialAllocation } from '@aivilization/materials';
import type { PremisesState, PremisesPorts, PremisesBuilding, PremisesEvent } from './model';
import {
  inventoryEqual,
  type ConstructionDecision,
  type ConstructionResourceAction,
} from './projects';
/** Material evidence and physical completion are returned together for the world transaction. */
export function finalizeConstruction(
  s: PremisesState,
  actorId: string,
  at: number,
  id: string,
  evidenceId: string,
  ports: PremisesPorts,
  cancel = false,
  cancellationProof?: PrincipalAuthorization<PrincipalOperationRequest>,
): ConstructionDecision {
  const p = s.projects[id],
    site = p && s.sites[p.siteId];
  if (!p || !site || p.status !== 'open')
    return { accepted: false, reason: 'construction-not-open' };
  if (
    !Number.isSafeInteger(at) ||
    at < p.at ||
    !materialId(evidenceId) ||
    p.revision >= Number.MAX_SAFE_INTEGER ||
    site.revision >= Number.MAX_SAFE_INTEGER ||
    site.reservedFloorArea < p.plan.addedFloorArea
  )
    return { accepted: false, reason: 'invalid-construction-finalization' };
  let proof = cancellationProof;
  if (cancel && p.progressMs < p.plan.workMs) {
    if (p.principalAuthorization) {
      proof ??= authorizePremisesPrincipal(
        s,
        actorId,
        { type: 'cancel-construction', id: p.id, expectedRevision: p.revision },
        ports,
      );
      if (proof) {
        try {
          assertPrincipalAuthorization(proof, p.controller, proof.request, actorId);
        } catch {
          return { accepted: false, reason: 'construction-controller-authority-required' };
        }
      }
      if (
        !proof ||
        proof.request.resourceKind !== 'construction-project' ||
        proof.request.operation.capability !== 'premises.cancel-construction' ||
        principalOperationKey(proof.request.operation.arguments) !==
          principalOperationKey({
            type: 'cancel-construction',
            id: p.id,
            expectedRevision: proof.request.resourceRevision,
          }) ||
        proof.actorId !== actorId ||
        proof.request.resourceId !== p.id ||
        (proof.request.resourceRevision !== p.revision &&
          proof.request.resourceRevision !== p.revision - 1)
      )
        return { accepted: false, reason: 'construction-controller-authority-required' };
    } else if (
      !(p.controller.kind === 'resident' || p.controller.kind === 'collective') ||
      !authorizeController(
        { kind: p.controller.kind, id: p.controller.id },
        actorId,
        ports.authorize,
      )
    )
      return { accepted: false, reason: 'construction-controller-authority-required' };
  }
  if (p.session) return { accepted: false, reason: 'construction-work-still-active' };
  const completed = p.progressMs === p.plan.workMs;
  if (!completed && !cancel) return { accepted: false, reason: 'construction-work-incomplete' };
  const currentBuilding = s.buildings[p.buildingId];
  if (
    completed &&
    p.kind !== 'build' &&
    (!currentBuilding ||
      currentBuilding.revision >= Number.MAX_SAFE_INTEGER ||
      currentBuilding.status === 'demolished' ||
      !sameController(currentBuilding.control.controller, p.controller))
  )
    return { accepted: false, reason: 'construction-building-unavailable' };
  if (
    completed &&
    p.kind === 'demolish' &&
    (currentBuilding!.status !== 'closed' ||
      ports.occupiedOrReserved(p.buildingId) > 0 ||
      ports.hasObligations(p.buildingId))
  )
    return { accepted: false, reason: 'premises-unsettled' };
  const allocations: MaterialAllocation[] = [],
    materials: ConstructionResourceAction[] = [];
  for (const ref of p.reservations) {
    const r = ports.reservation(ref.id);
    if (
      !r ||
      r.status !== 'bound' ||
      r.consumer.domain !== 'premises' ||
      r.consumer.id !== p.id ||
      !sameController(r.beneficiary, p.controller) ||
      !inventoryEqual(r.held, ref.materials)
    )
      return { accepted: false, reason: 'construction-material-reservation-unavailable' };
    if (completed)
      allocations.push({ reservationId: r.id, consumer: r.consumer, items: r.held, evidenceId });
    materials.push({
      reservationId: r.id,
      expectedRevision: r.revision,
      authorization: {
        consumer: r.consumer,
        beneficiary: r.beneficiary,
        evidenceId,
        ...(completed ? { allocation: r.held } : {}),
        finish: true,
      },
    });
  }
  const { settlementBlock, ...unblocked } = p;
  void settlementBlock;
  const events: PremisesEvent[] = [
    {
      type: 'ConstructionProjectChanged',
      project: {
        ...unblocked,
        status: completed ? 'completed' : 'cancelled',
        revision: p.revision + 1,
        at,
      },
    },
    {
      type: 'ConstructionSiteChanged',
      site: {
        ...site,
        reservedFloorArea: site.reservedFloorArea - p.plan.addedFloorArea,
        occupiedFloorArea: site.occupiedFloorArea + (completed ? p.plan.addedFloorArea : 0),
        revision: site.revision + 1,
      },
    },
    ...(proof && !cancellationProof ? [principalPremisesReceipt(evidenceId, at, proof)] : []),
  ];
  if (completed) {
    const old = s.buildings[p.buildingId];
    if (p.kind === 'build') {
      if (old) return { accepted: false, reason: 'construction-building-already-exists' };
      const building: PremisesBuilding = {
        id: p.buildingId,
        siteId: p.siteId,
        locationId: `premises-${p.buildingId}`,
        ownerId: p.createdBy,
        control: p.principalAuthorization
          ? constructedPrincipalControl(p.principalAuthorization, at)
          : {
              policyVersion: s.policy.control.version,
              controller:
                p.controller.kind === 'resident' || p.controller.kind === 'collective'
                  ? { kind: p.controller.kind, id: p.controller.id }
                  : (() => {
                      throw Error('legacy-construction-principal-not-supported');
                    })(),
              version: 1,
              changedBy: p.createdBy,
              at,
              ...(p.decisionId ? { decisionId: p.decisionId } : {}),
            },
        title: p.title,
        blueprint: p.plan.blueprint,
        condition: 1000,
        status: 'operational',
        access: { entry: 'listed', visitors: [], operators: [], residents: [] },
        embodied: p.plan.materials,
        salvage: {},
        footprintReleased: false,
        wearSettledAt: at,
        revision: 1,
        at,
      };
      events.push({ type: 'PremisesBuildingChanged', building });
    } else if (p.kind === 'demolish') {
      const b = currentBuilding!;
      const recovered = Object.fromEntries(
        Object.entries(b.embodied)
          .map(([k, n]) => [k, Math.floor(n * s.policy.salvageFraction * 1e6) / 1e6] as const)
          .filter(([, n]) => n > 0),
      );
      const waste = moveInventory(b.embodied, recovered, 'remove');
      const footprintReleased = Object.keys(recovered).length === 0;
      if (footprintReleased)
        events[1] = {
          type: 'ConstructionSiteChanged',
          site: {
            ...site,
            occupiedFloorArea: site.occupiedFloorArea - b.blueprint.floorArea,
            revision: site.revision + 1,
          },
        };
      events.push(
        {
          type: 'PremisesBuildingChanged',
          building: {
            ...b,
            status: 'demolished',
            embodied: {},
            salvage: recovered,
            footprintReleased,
            revision: b.revision + 1,
            at,
          },
        },
        {
          type: 'PremisesDemolished',
          buildingId: b.id,
          projectId: p.id,
          consumed: b.embodied,
          recovered,
          waste,
        },
      );
    } else {
      if (!old || old.status === 'demolished')
        return { accepted: false, reason: 'construction-building-unavailable' };
      events.push({
        type: 'PremisesBuildingChanged',
        building: {
          ...old,
          blueprint: p.kind === 'modify' ? p.plan.blueprint : old.blueprint,
          condition:
            p.kind === 'maintain'
              ? Math.min(1000, old.condition + p.plan.repairPoints)
              : old.condition,
          embodied: moveInventory(old.embodied, p.plan.materials, 'add'),
          revision: old.revision + 1,
          at,
        },
      });
    }
    events.push({
      type: 'ConstructionResourcesAllocated',
      projectId: p.id,
      evidenceId,
      allocations,
    });
  }
  return { accepted: true, events, materials };
}

/** Completion waits for explicit retry if an external obligation blocks settlement; the clock and worker remain free. */
export function recordConstructionSettlementBlock(
  s: PremisesState,
  id: string,
  at: number,
  reason: string,
): ConstructionDecision {
  const p = s.projects[id];
  if (
    !p ||
    p.status !== 'open' ||
    p.session ||
    p.progressMs !== p.plan.workMs ||
    !Number.isSafeInteger(at) ||
    at < p.at ||
    p.revision >= Number.MAX_SAFE_INTEGER ||
    !reason.trim() ||
    reason.length > 200
  )
    return { accepted: false, reason: 'invalid-construction-settlement-block' };
  return {
    accepted: true,
    materials: [],
    events: [
      {
        type: 'ConstructionProjectChanged',
        project: {
          ...p,
          settlementBlock: { reason, at },
          revision: p.revision + 1,
          at,
        },
      },
    ],
  };
}
