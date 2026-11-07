import {
  type PrincipalValue,
  assertPrincipalAuthorization,
  principalOperationKey,
  samePrincipal,
} from '@aivilization/authority';
import type { PremisesState, PremisesEvent } from './model';
import { samePremisesProof } from './principal';

const object = (v: unknown): v is Readonly<Record<string, PrincipalValue>> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Validate recorded authorization/effect binding; external authority is separately checked by world. */
export function assertPremisesPrincipalCommit(
  before: PremisesState | undefined,
  after: PremisesState,
  events: readonly PremisesEvent[],
) {
  if (events.some((e) => e.type === 'PremisesResourcePrincipalsEnabled') && events.length !== 1)
    throw Error('premises-principals-activation-must-stand-alone');
  if (events.some((e) => e.type === 'PremisesPrincipalControlChanged') && events.length !== 1)
    throw Error('premises-control-needs-stand-alone-commit');
  const receipts = events.flatMap((e) =>
    e.type === 'PremisesPrincipalOperationRecorded' ? [e.receipt] : [],
  );
  const used = new Set<string>();
  for (const event of events) {
    if (
      event.type === 'ConstructionProjectChanged' &&
      !before?.projects[event.project.id] &&
      event.project.principalAuthorization
    ) {
      const p = event.project,
        proof = p.principalAuthorization!,
        request = proof.request,
        receipt = receipts.find((r) => samePremisesProof(r.authorization, proof));
      assertPrincipalAuthorization(proof, p.controller, request, p.createdBy);
      const expected = {
        type: 'create-construction',
        construction: {
          id: p.id,
          kind: p.kind,
          buildingId: p.buildingId,
          siteId: p.siteId,
          expectedSiteRevision: before?.sites[p.siteId]?.revision ?? -1,
          ...(p.kind === 'build'
            ? {}
            : { expectedBuildingRevision: before?.buildings[p.buildingId]?.revision ?? -1 }),
          controller: p.controller,
          title: p.title,
          description: p.description,
          blueprint: p.plan.blueprint,
          workers: p.workers,
          reservations: p.reservations.map((r) => ({
            id: r.id,
            revision: r.committedRevision - 1,
          })),
        },
      };
      const b = before?.buildings[p.buildingId],
        site = before?.sites[p.siteId];
      if (
        !receipt ||
        receipt.at !== p.at ||
        request.operation.capability !== 'premises.create-construction' ||
        principalOperationKey(request.operation.arguments) !== principalOperationKey(expected) ||
        (p.kind === 'build'
          ? request.resourceKind !== 'construction-site' ||
            request.resourceId !== p.siteId ||
            request.resourceRevision !== site?.revision ||
            request.controlVersion !== before?.landUsePolicy.revision
          : !b ||
            request.resourceKind !== 'premises' ||
            request.resourceId !== b.id ||
            request.resourceRevision !== b.revision ||
            request.controlVersion !== b.control.version)
      )
        throw Error('principal-construction-authorization-mismatch');
      used.add(receipt.id);
    }
    if (event.type === 'PremisesBuildingChanged') {
      const b = event.building,
        old = before?.buildings[b.id];
      if (b.control.policyVersion !== 'resource-principals-v2') continue;
      if (!old) {
        const p = Object.values(after.projects).find(
          (p) => p.kind === 'build' && p.buildingId === b.id && p.status === 'completed',
        );
        if (
          !p?.principalAuthorization ||
          b.control.version !== 1 ||
          b.control.at !== b.at ||
          b.ownerId !== p.createdBy ||
          !samePrincipal(b.control.controller, p.controller) ||
          principalOperationKey(b.control.authorization) !==
            principalOperationKey(p.principalAuthorization)
        )
          throw Error('principal-building-construction-source-mismatch');
      } else if (principalOperationKey(old.control) !== principalOperationKey(b.control))
        throw Error('principal-building-control-needs-transfer-event');
    }
  }
  for (const r of receipts) {
    if (used.has(r.id)) continue;
    const proof = r.authorization,
      request = proof.request,
      c = request.operation.arguments;
    if (c.type === 'cancel-construction') {
      const p = before?.projects[request.resourceId],
        next = p && after.projects[p.id];
      if (
        !p?.principalAuthorization ||
        !next ||
        request.resourceKind !== 'construction-project' ||
        request.resourceRevision !== p.revision ||
        request.controlVersion !== 1 ||
        request.operation.capability !== 'premises.cancel-construction' ||
        principalOperationKey(c) !==
          principalOperationKey({
            type: 'cancel-construction',
            id: p.id,
            expectedRevision: p.revision,
          }) ||
        !['cancelled', 'completed'].includes(next.status) ||
        next.at !== r.at
      )
        throw Error('principal-construction-cancel-mismatch');
      assertPrincipalAuthorization(proof, p.controller, request, proof.actorId);
      used.add(r.id);
    } else if (c.type === 'manage-premises') {
      const b = before?.buildings[request.resourceId],
        next = b && after.buildings[b.id],
        command = c.command;
      if (
        !b ||
        !next ||
        !object(command) ||
        b.control.policyVersion !== 'resource-principals-v2' ||
        b.control.offer ||
        request.resourceKind !== 'premises' ||
        request.resourceRevision !== b.revision ||
        request.controlVersion !== b.control.version ||
        request.operation.capability !== 'premises.manage-premises' ||
        c.id !== b.id ||
        c.expectedRevision !== b.revision ||
        next.at !== r.at ||
        !events.some((e) => e.type === 'PremisesBuildingChanged' && e.building.id === b.id)
      )
        throw Error('principal-building-operation-mismatch');
      assertPrincipalAuthorization(proof, b.control.controller, request, proof.actorId);
      if (
        command.type === 'configure'
          ? next.title !== command.title ||
            principalOperationKey(next.access) !== principalOperationKey(command.access!)
          : command.type === 'close'
            ? next.status !== 'closed'
            : command.type === 'reopen'
              ? next.status !== 'operational'
              : command.type === 'collect-salvage'
                ? !events.some(
                    (e) =>
                      e.type === 'PremisesSalvageCollected' &&
                      e.buildingId === b.id &&
                      e.actorId === proof.actorId &&
                      command.recipientId === proof.actorId &&
                      principalOperationKey(e.items) === principalOperationKey(command.items!),
                  )
                : true
      )
        throw Error('principal-building-operation-effect-mismatch');
      used.add(r.id);
    }
    if (!used.has(r.id)) throw Error('unrelated-premises-principal-receipt');
  }
  // Cancelling a principal's project must never fall through the legacy physical ledger.
  for (const p of Object.values(after.projects)) {
    const old = before?.projects[p.id];
    if (
      old?.principalAuthorization &&
      old.status === 'open' &&
      p.status === 'cancelled' &&
      !receipts.some(
        (r) =>
          r.authorization.request.resourceKind === 'construction-project' &&
          r.authorization.request.resourceId === p.id &&
          r.authorization.request.operation.capability === 'premises.cancel-construction',
      )
    )
      throw Error('principal-construction-cancel-proof-required');
  }
  // Physical wear and completion remain automatic; discretionary changes require current source evidence.
  for (const event of events) {
    if (event.type !== 'PremisesBuildingChanged') continue;
    const b = event.building,
      old = before?.buildings[b.id];
    if (!old || old.control.policyVersion !== 'resource-principals-v2') continue;
    const administration =
      old.title !== b.title ||
      principalOperationKey(old.access) !== principalOperationKey(b.access) ||
      (old.status !== b.status && b.status !== 'demolished') ||
      (principalOperationKey(old.salvage) !== principalOperationKey(b.salvage) &&
        old.status === 'demolished');
    if (
      administration &&
      !receipts.some(
        (r) =>
          r.authorization.request.resourceKind === 'premises' &&
          r.authorization.request.resourceId === b.id,
      )
    )
      throw Error('principal-building-operation-proof-required');
  }
}
