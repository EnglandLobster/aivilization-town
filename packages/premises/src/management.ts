import { authorizePremisesPrincipal, principalPremisesReceipt } from './principal';
import {
  decideResourceControl,
  resourceAdministration,
  revisedResourceControl,
  type ControlCommand,
} from '@aivilization/authority';
import {
  containsInventory,
  moveInventory,
  materialId,
  validInventory,
} from '@aivilization/materials';
import type { Inventory } from '@aivilization/economy';
import type { PremisesAccess, PremisesPorts, PremisesState, PremisesEvent } from './model';
import type { ConstructionDecision } from './projects';
export type PremisesCommand =
  | { readonly type: 'configure'; readonly title: string; readonly access: PremisesAccess }
  | { readonly type: 'close' | 'reopen' }
  | { readonly type: 'control'; readonly control: ControlCommand }
  | { readonly type: 'collect-salvage'; readonly recipientId: string; readonly items: Inventory };
const no = (reason: string): ConstructionDecision => ({ accepted: false, reason });
export function managePremises(
  s: PremisesState,
  actorId: string,
  at: number,
  id: string,
  expectedRevision: number,
  c: PremisesCommand,
  ports: PremisesPorts,
): ConstructionDecision {
  const b = s.buildings[id];
  if (!b) return no('premises-not-found');
  if (b.revision !== expectedRevision || b.revision >= Number.MAX_SAFE_INTEGER)
    return no('premises-revision-conflict');
  if (!materialId(actorId) || !ports.exists(actorId) || !Number.isSafeInteger(at) || at < b.at)
    return no('invalid-premises-actor-or-time');
  const active = Object.values(s.projects).some((p) => p.buildingId === id && p.status === 'open');
  const proof =
    c.type !== 'control' && b.control.policyVersion === 'resource-principals-v2'
      ? authorizePremisesPrincipal(
          s,
          actorId,
          { type: 'manage-premises', id, expectedRevision, command: c },
          ports,
        )
      : undefined;
  const grant =
    b.control.policyVersion === 'resource-principals-v2'
      ? proof
        ? {
            actorId,
            ...(proof.source.kind === 'collective' ? { decisionId: proof.source.decisionId } : {}),
          }
        : undefined
      : resourceAdministration(b, actorId, ports.authorize);
  const control = () =>
    b.control.policyVersion === 'resource-principals-v2'
      ? b.control
      : revisedResourceControl({ ...b, control: b.control }, grant!, at)!;
  const receipt = proof
    ? [principalPremisesReceipt(`premises-${id}-${b.revision + 1}`, at, proof)]
    : [];
  if (c.type === 'control') {
    if (active) return no('premises-construction-in-progress');
    const d = decideResourceControl({
      resource: b,
      actorId,
      at,
      command: c.control,
      policy: s.policy.control,
      authorize: ports.authorize,
      available: ports.controlAvailable,
    });
    if (!d.accepted) return d;
    return {
      accepted: true,
      materials: [],
      events: [
        {
          type: 'PremisesBuildingChanged',
          building: {
            ...b,
            control: d.control,
            revision: b.revision + 1,
            at,
          },
        },
      ],
    };
  }
  if (!grant) return no('resource-controller-authority-required');
  if (c.type === 'collect-salvage') {
    const site = s.sites[b.siteId];
    if (
      b.status !== 'demolished' ||
      !site ||
      site.revision >= Number.MAX_SAFE_INTEGER ||
      !validInventory(c.items, 64, 1000000) ||
      !containsInventory(b.salvage, c.items)
    )
      return no('premises-salvage-unavailable');
    if (c.recipientId !== actorId) return no('material-recipient-must-execute');
    if (!ports.present(actorId, site.parentLocationId) || !ports.idle(actorId))
      return no('premises-presence-and-idle-required');
    const salvage = moveInventory(b.salvage, c.items, 'remove'),
      footprintReleased = Object.keys(salvage).length === 0;
    const events: PremisesEvent[] = [
      ...receipt,
      {
        type: 'PremisesBuildingChanged',
        building: {
          ...b,
          salvage,
          footprintReleased,
          revision: b.revision + 1,
          at,
        },
      },
      {
        type: 'PremisesSalvageCollected',
        buildingId: id,
        actorId,
        items: c.items,
        at,
        ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
      },
    ];
    if (footprintReleased && !b.footprintReleased)
      events.push({
        type: 'ConstructionSiteChanged',
        site: {
          ...site,
          occupiedFloorArea: site.occupiedFloorArea - b.blueprint.floorArea,
          revision: site.revision + 1,
        },
      });
    return { accepted: true, materials: [], events };
  }
  if (b.status === 'demolished') return no('premises-demolished');
  if (b.control.version >= Number.MAX_SAFE_INTEGER) return no('control-version-limit');
  if (c.type === 'configure') {
    if (
      !c.title.trim() ||
      c.title.length > 120 ||
      !['public', 'listed'].includes(c.access.entry) ||
      [c.access.visitors, c.access.operators, c.access.residents].some(
        (ids) =>
          ids.length > s.policy.maxWorkers ||
          new Set(ids).size !== ids.length ||
          ids.some((a) => !ports.exists(a)),
      )
    )
      return no('invalid-premises-configuration');
    return {
      accepted: true,
      materials: [],
      events: [
        ...receipt,
        {
          type: 'PremisesBuildingChanged',
          building: {
            ...b,
            title: c.title,
            access: structuredClone(c.access),
            control: control(),
            revision: b.revision + 1,
            at,
          },
        },
      ],
    };
  }
  if (active) return no('premises-construction-in-progress');
  if (c.type === 'close') {
    if (b.status !== 'operational') return no('premises-already-closed');
    if (ports.occupiedOrReserved(id) > 0 || ports.hasObligations(id))
      return no('premises-unsettled');
  } else if (b.status !== 'closed' || b.condition <= 0) return no('premises-reopening-unavailable');
  return {
    accepted: true,
    materials: [],
    events: [
      ...receipt,
      {
        type: 'PremisesBuildingChanged',
        building: {
          ...b,
          status: c.type === 'close' ? 'closed' : 'operational',
          control: control(),
          revision: b.revision + 1,
          at,
        },
      },
    ],
  };
}
/** Strictly additive aging is evaluated from the last completed physical interval. No society preference is inferred. */
export function agePremises(s: PremisesState, at: number): ConstructionDecision {
  if (!Number.isSafeInteger(at) || at < 0) return no('invalid-premises-time');
  const events: PremisesEvent[] = [];
  for (const b of Object.values(s.buildings).sort((a, b) => a.id.localeCompare(b.id))) {
    if (b.status === 'demolished') continue;
    if (at < b.at || at < b.wearSettledAt) return no('invalid-premises-time');
    const intervals = Math.floor((at - b.wearSettledAt) / s.policy.wearIntervalMs);
    if (!intervals) continue;
    if (b.revision >= Number.MAX_SAFE_INTEGER) return no('premises-revision-limit');
    events.push({
      type: 'PremisesBuildingChanged',
      building: {
        ...b,
        condition: Math.max(0, b.condition - intervals * s.policy.wearPerInterval),
        wearSettledAt: b.wearSettledAt + intervals * s.policy.wearIntervalMs,
        revision: b.revision + 1,
        at,
      },
    });
  }
  return { accepted: true, materials: [], events };
}
export function nextPremisesWearBoundary(s: PremisesState, now: number): number | undefined {
  const values = Object.values(s.buildings)
    .filter((b) => b.status !== 'demolished')
    .map((b) => b.wearSettledAt + s.policy.wearIntervalMs)
    .filter((t) => t > now);
  return values.length ? Math.min(...values) : undefined;
}
