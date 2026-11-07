import { constructionVisibleTo as projectReadable } from './resourceControlAccess';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { planConstruction, type PremisesBuilding } from '@aivilization/premises';
import {
  residentConstructionEvent,
  residentPremisesEvent,
  ageResidentPremisesEvent,
  settleResidentConstructionEvent,
  residentMaterialReservationEvent,
  expireResidentMaterialReservationEvent,
  applyWorldEvent,
  premisesWorldObligations,
  premisesOccupancy,
  premisesFacilityAvailability,
  type PremisesAuthorization,
  type WorldEvent,
} from '@aivilization/world';
import type { MaterialReservation } from '@aivilization/materials';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { controllerAvailable, principalVisibleTo } from './resourceControlAccess';
import { materialAuthorization } from './materialTools';
import {
  parseConstructionCommand,
  parsePremisesCommand,
  parseMaterialOffer,
  exactPremisesArgs,
  premisesBlueprint,
  constructionKind,
} from './premisesCommands';
import { stringArg, numberArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
export function premisesAuthorization(
  s: OpenSocietyState,
  authorize: ControlAuthorizationPort,
): PremisesAuthorization {
  return {
    authorize,
    controlAvailable: (c) => controllerAvailable(s, c),
    additionalObligations: (id) => {
      const location = s.world.premises?.buildings[id]?.locationId;
      if (!location || !s.services) return false;
      const serviceIds = new Set(
        Object.values(s.services.services)
          .filter((v) => v.locationId === location)
          .map((v) => v.id),
      );
      const slotIds = new Set(
        Object.values(s.services.slots)
          .filter((v) => serviceIds.has(v.serviceId))
          .map((v) => v.id),
      );
      return (
        Object.values(s.services.services).some((v) => serviceIds.has(v.id) && v.active) ||
        Object.values(s.services.slots).some(
          (v) => slotIds.has(v.id) && v.active && v.end > s.world.clock.now,
        ) ||
        Object.values(s.services.bookings).some(
          (v) =>
            slotIds.has(v.slotId) && ['requested', 'accepted', 'checked-in'].includes(v.status),
        ) ||
        Object.values(s.services.queues).some(
          (v) => serviceIds.has(v.serviceId) && v.status === 'waiting',
        )
      );
    },
  };
}
const metadata = (b: PremisesBuilding) => ({
  id: b.id,
  siteId: b.siteId,
  locationId: b.locationId,
  title: b.title,
  blueprint: b.blueprint,
  condition: b.condition,
  status: b.status,
  revision: b.revision,
  controller: b.control.controller,
  controlVersion: b.control.version,
  footprintReleased: b.footprintReleased,
});
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorize: ControlAuthorizationPort,
): ToolExecution {
  if (name === 'materials.reserve' && args.consumerDomain === 'logistics' && !s.world.logistics)
    throw new ToolRefusal('logistics-not-enabled');
  if (
    name === 'materials.reserve' &&
    args.consumerDomain === 'services' &&
    !s.world.serviceEngagements
  )
    throw new ToolRefusal('service-engagements-not-enabled');
  const context = {
    projection: s.world,
    actorId: a,
    requestId: `premises-${digest([a, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
    authorization: premisesAuthorization(s, authorize),
  };
  const d = name.startsWith('construction.')
    ? residentConstructionEvent({ ...context, command: parseConstructionCommand(name, args) })
    : name.startsWith('materials.')
      ? residentMaterialReservationEvent({
          ...context,
          authorization: materialAuthorization(s, authorize),
          command:
            name === 'materials.reserve'
              ? { type: 'offer', offer: parseMaterialOffer(args) }
              : (exactPremisesArgs(args, ['id', 'expectedRevision']),
                {
                  type: 'withdraw',
                  id: stringArg(args, 'id'),
                  revision: numberArg(args, 'expectedRevision'),
                }),
        })
      : residentPremisesEvent({
          ...context,
          id: stringArg(args, 'id'),
          revision: numberArg(args, 'expectedRevision'),
          command: parsePremisesCommand(name, args),
        });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      committed: true,
      events: d.events.map((e) => ({ id: e.id, type: e.type, at: e.occurredAt })),
      resourceId: stringArg(args, 'id'),
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, a) },
  };
}
export function executePremisesTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const state = s.world.premises;
  if (!state) throw new ToolRefusal('premises-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} }),
    id = stringArg(args, 'id');
  if (name === 'sites.list')
    return result({
      landUsePolicy: state.landUsePolicy,
      ...pageItems(Object.values(state.sites), args),
    });
  if (name === 'sites.read') {
    const site = state.sites[id];
    if (!site) throw new ToolRefusal('construction-site-not-found');
    return result({
      site,
      landUsePolicy: state.landUsePolicy,
      buildings: pageItems(
        Object.values(state.buildings)
          .filter((b) => b.siteId === id)
          .map(metadata),
        args,
      ),
    });
  }
  if (name === 'construction.plan') {
    const kind = constructionKind(args),
      existing = state.buildings[stringArg(args, 'buildingId')];
    const plan = planConstruction(state.policy, premisesBlueprint(args), kind, existing);
    if (!plan) throw new ToolRefusal('invalid-construction-blueprint');
    return result({
      plan,
      workLocation: existing ? state.sites[existing.siteId]?.parentLocationId : null,
      authorizationGranted: false,
    });
  }
  if (name === 'construction.list')
    return result(
      pageItems(
        Object.values(state.projects)
          .filter((p) => projectReadable(s, p, a))
          .map((p) => ({
            id: p.id,
            kind: p.kind,
            buildingId: p.buildingId,
            title: p.title,
            status: p.status,
            revision: p.revision,
            progressMs: p.progressMs,
            workMs: p.plan.workMs,
            ...(p.settlementBlock ? { settlementBlock: p.settlementBlock } : {}),
          })),
        args,
      ),
    );
  if (name === 'construction.read') {
    const p = state.projects[id];
    if (!p || !projectReadable(s, p, a)) throw new ToolRefusal('construction-not-readable');
    return result(p);
  }
  if (name === 'premises.list')
    return result(pageItems(Object.values(state.buildings).map(metadata), args));
  if (name === 'premises.read') {
    const b = state.buildings[id];
    if (!b) throw new ToolRefusal('premises-not-found');
    const controls = principalVisibleTo(s, b.control.controller, a),
      offered =
        b.control.offer &&
        b.control.offer.expiresAt > s.world.clock.now &&
        principalVisibleTo(s, b.control.offer.target, a);
    return result({
      ...metadata(b),
      facilityUse: premisesFacilityAvailability(s.world, b.locationId) ?? { enforced: false },
      entry: b.access.entry,
      ...(controls || offered
        ? {
            ownerId: b.ownerId,
            control: b.control,
            access: b.access,
            embodied: b.embodied,
            salvage: b.salvage,
            obligations: {
              occupantsAndReservations: premisesOccupancy(s.world, id),
              world: premisesWorldObligations(s.world, id),
              services: premisesAuthorization(s, () => undefined).additionalObligations(id),
            },
            projects: pageItems(
              Object.values(state.projects).filter((p) => p.buildingId === id),
              args,
            ),
          }
        : {}),
    });
  }
  if (name === 'materials.list' || name === 'materials.read') {
    const visible = (r: MaterialReservation) => {
      const stock = s.world.materials?.stocks[r.stockId];
      return (
        principalVisibleTo(s, r.beneficiary, a) ||
        (!!stock && principalVisibleTo(s, stock.control.controller, a))
      );
    };
    const records = s.world.materials?.reservations?.records ?? {};
    if (name === 'materials.list')
      return result(pageItems(Object.values(records).filter(visible), args));
    const r = records[id];
    if (!r || !visible(r)) throw new ToolRefusal('material-reservation-not-readable');
    return result(r);
  }
  return execute(s, m, a, name, args, requestId, personalControlAuthorization(a));
}
const allowed = new Set([
  'construction.create',
  'construction.cancel',
  'construction.finish',
  'premises.configure',
  'premises.close',
  'premises.reopen',
  'premises.offer',
  'premises.accept',
  'premises.cancel-offer',
  'premises.collect-salvage',
  'materials.reserve',
  'materials.withdraw',
]);
function collectiveArgs(s: OpenSocietyState, cid: string, action: CollectiveResourceAction) {
  if (!s.world.premises || !allowed.has(action.capability) || Object.hasOwn(action.arguments, 'id'))
    throw new ToolRefusal('unsupported-collective-premises-action');
  const args = { ...action.arguments, id: action.resourceId },
    name = action.capability;
  let subject;
  if (name.startsWith('construction.')) {
    const c = parseConstructionCommand(name, args);
    subject =
      c.type === 'create' ? c.construction.controller : s.world.premises.projects[c.id]?.controller;
  } else if (name.startsWith('materials.')) {
    const stockId =
      name === 'materials.reserve'
        ? parseMaterialOffer(args).stockId
        : s.world.materials?.reservations?.records[action.resourceId]?.stockId;
    if (name === 'materials.withdraw') exactPremisesArgs(args, ['id', 'expectedRevision']);
    subject = stockId ? s.world.materials?.stocks[stockId]?.control.controller : undefined;
  } else {
    const c = parsePremisesCommand(name, args),
      b = s.world.premises.buildings[action.resourceId];
    subject =
      c.type === 'control' && c.control.type === 'accept'
        ? b?.control.offer?.target
        : b?.control.controller;
  }
  if (subject?.kind !== 'collective' || subject.id !== cid)
    throw new ToolRefusal('collective-does-not-control-premises-resource');
  return args;
}
export function validatePremisesResourceAction(
  s: OpenSocietyState,
  cid: string,
  action: CollectiveResourceAction,
) {
  try {
    collectiveArgs(s, cid, action);
    return undefined;
  } catch (e) {
    if (e instanceof ToolRefusal) return e.reason;
    throw e;
  }
}
export function executeApprovedPremisesResource(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  cid: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
) {
  return execute(s, m, a, action.capability, collectiveArgs(s, cid, action), requestId, (c) =>
    c.kind === 'collective' && c.id === cid ? { actorId: a, decisionId } : undefined,
  );
}
export function nextOpenPremisesBoundary(s: OpenSocietyState) {
  const expiry = Object.values(s.world.materials?.reservations?.records ?? {})
    .filter((r) => r.status === 'offered' && r.expiresAt > s.world.clock.now)
    .map((r) => r.expiresAt);
  return expiry.length ? Math.min(...expiry) : undefined;
}
export function advanceOpenPremises(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  requestId: string,
): readonly WorldEvent[] {
  if (!s.world.premises) return [];
  const events: WorldEvent[] = [];
  let working = s;
  const append = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    if (!d.accepted) throw Error(`premises-settlement-failed:${d.reason}`);
    for (const e of d.events) {
      working = { ...working, world: applyWorldEvent(working.world, e), worldSequence: e.sequence };
      events.push(e);
    }
  };
  const context = (suffix: string) => ({
    projection: working.world,
    actorId: 'system',
    authorization: premisesAuthorization(working, () => undefined),
    simulationId: m.simulationId,
    nextSequence: working.worldSequence + 1,
    requestId: `premises-tick-${digest([requestId, suffix, s.world.clock.now]).slice(0, 32)}`,
  });
  append(ageResidentPremisesEvent(context('wear')));
  for (const p of Object.values(working.world.premises!.projects)
    .filter((p) => p.session)
    .sort((a, b) => a.id.localeCompare(b.id)))
    append(settleResidentConstructionEvent({ ...context(p.id), projectId: p.id }));
  for (const r of Object.values(working.world.materials?.reservations?.records ?? {})
    .filter((r) => r.status === 'offered' && r.expiresAt <= working.world.clock.now)
    .sort((a, b) => a.id.localeCompare(b.id)))
    append(
      expireResidentMaterialReservationEvent({
        ...context(`expiry-${r.id}`),
        authorization: materialAuthorization(working, () => undefined),
        reservationId: r.id,
      }),
    );
  return events;
}
