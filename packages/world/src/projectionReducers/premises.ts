import { assertResidentDepartureActivitySource } from '../residentDepartureActivitySource';
import { tradeFactsEqual } from '@aivilization/commerce';
import { applyPremisesPrincipalActivation } from '../premisesPrincipals';
import {
  assertWorldPrincipalOperationSource,
  type PublicPrincipalExecution,
} from '../resourcePrincipalAuthority';
import type { PrincipalCollectivePort } from '../principalCollectivePort';
import { assertMaterialConsumerEnvelope } from '../materialConsumerEnvelope';
import {
  applyPremisesCommit,
  premisesHasPermitObligations,
  unsettledPremisesProvisions,
} from '@aivilization/premises';
import { applyMaterialCommit } from '@aivilization/materials';
import { asLocationId } from '@aivilization/sim-core';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
import { constructionSessionReserved } from '../residentPremises';
export function applyPremisesProjection(
  w: WorldProjection,
  e: WorldEvent,
  publicExecution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  const activation = applyPremisesPrincipalActivation(w, e);
  if (activation) return activation;
  if (e.type !== 'ResidentPremisesCommitted') return undefined;
  if (e.payload.departure) {
    const source = e.payload.departure,
      changed = e.payload.events[0];
    assertResidentDepartureActivitySource(w, source, source.actorId, e.occurredAt);
    const old =
      changed?.type === 'ConstructionProjectChanged'
        ? w.premises?.projects[changed.project.id]
        : undefined;
    if (
      !old?.session ||
      old.status !== 'open' ||
      old.at !== w.clock.now ||
      old.session.actorId !== source.actorId ||
      old.session.settledAt !== w.clock.now ||
      e.payload.events.length !== 1 ||
      e.payload.efforts.length ||
      e.payload.materialEvents.length ||
      e.payload.reservation
    )
      throw Error('departure-construction-source-mismatch');
    const { session, ...rest } = old;
    const expectedRelease =
      w.clock.now < session.until
        ? {
            actorId: session.actorId,
            startedAt: session.startedAt,
            previousAvailableAt: session.until,
            endedAt: w.clock.now,
          }
        : undefined;
    if (!tradeFactsEqual(e.payload.release, expectedRelease))
      throw Error('departure-construction-release-mismatch');

    if (
      changed?.type !== 'ConstructionProjectChanged' ||
      !tradeFactsEqual(changed.project, {
        ...rest,
        revision: old.revision + 1,
        lastStop: { actorId: session.actorId, at: w.clock.now, reason: 'worker-unavailable' },
      })
    )
      throw Error('departure-construction-changed-physical-facts');
  }

  if (e.payload.policyVersion !== 'resident-premises-v1' || e.occurredAt !== w.clock.now)
    throw Error('invalid-premises-commit-version-or-time');
  if (e.payload.events.some((v) => v.type === 'PremisesResourcePrincipalsEnabled'))
    throw Error('premises-principals-need-explicit-world-event');
  if (e.payload.events.some((v) => v.type === 'PremisesPrincipalControlChanged'))
    throw Error('premises-control-needs-principal-envelope');
  for (const event of e.payload.events)
    if (event.type === 'PremisesPrincipalOperationRecorded')
      assertWorldPrincipalOperationSource(
        w,
        event.receipt.authorization,
        publicExecution,
        collective,
      );
  if (w.premisesRights)
    for (const event of e.payload.events) {
      if (
        event.type === 'ConstructionProjectChanged' &&
        !w.premises?.projects[event.project.id] &&
        ['modify', 'demolish'].includes(event.project.kind) &&
        premisesHasPermitObligations(w.premisesRights, event.project.buildingId, w.clock.now)
      )
        throw Error('premises-use-rights-unsettled');
      if (event.type === 'PremisesBuildingChanged') {
        if (unsettledPremisesProvisions(w.premisesRights, event.building.id, w.clock.now).length)
          throw Error('premises-provision-settlement-required');
        const before = w.premises?.buildings[event.building.id],
          after = event.building;
        if (
          before &&
          after.status !== 'operational' &&
          before.status === 'operational' &&
          premisesHasPermitObligations(w.premisesRights, before.id, w.clock.now)
        )
          throw Error('premises-use-rights-unsettled');
      }
    }
  assertMaterialConsumerEnvelope(w.materials, e.payload.materialEvents, 'premises');
  const result = applyPremisesCommit(w.premises, e.payload.events, e.payload.efforts),
    material = applyMaterialCommit(w.materials, e.payload.materialEvents, result.allocations),
    agents = { ...w.agents },
    activityTimeByAgent = { ...w.activityTimeByAgent },
    locations = { ...w.locations };
  if (Object.keys(material.residentDeltas).length || material.efforts.length)
    throw Error('unrelated-construction-material-effects');
  for (const event of e.payload.materialEvents) {
    if (event.type !== 'MaterialReservationChanged' || !event.reservation.principalVersion)
      continue;
    const r = event.reservation,
      old = w.materials?.reservations?.records[r.id],
      projectEvent = e.payload.events
        .filter((v) => v.type === 'ConstructionProjectChanged' && v.project.id === r.consumer.id)
        .at(-1);
    if (
      !old ||
      projectEvent?.type !== 'ConstructionProjectChanged' ||
      !projectEvent.project.reservations.some((ref) => ref.id === r.id) ||
      (old.status === 'offered'
        ? !!w.premises?.projects[r.consumer.id] || r.status !== 'bound'
        : r.status !== 'settled' ||
          !['completed', 'cancelled'].includes(projectEvent.project.status))
    )
      throw Error('principal-construction-transition-required');
  }
  for (const p of Object.values(result.state.projects)) {
    for (const ref of p.reservations) {
      const r = material.state.reservations?.records[ref.id];
      if (
        !r ||
        r.consumer.domain !== 'premises' ||
        r.consumer.id !== p.id ||
        r.beneficiary.kind !== p.controller.kind ||
        r.beneficiary.id !== p.controller.id ||
        r.stockId !== ref.sourceStockId ||
        r.revision < ref.committedRevision ||
        (p.status === 'open' ? r.status !== 'bound' : r.status !== 'settled')
      )
        throw Error('construction-material-binding-mismatch');
    }
  }
  for (const effort of e.payload.efforts) {
    const a = agents[effort.actorId],
      old = w.premises?.projects[effort.projectId];
    if (
      !a ||
      !old ||
      !constructionSessionReserved(w, old) ||
      effort.through > w.clock.now ||
      a.locationId !== old.workLocationId ||
      w.transitByAgent?.[effort.actorId]
    )
      throw Error('construction-effort-reservation-mismatch');
    const energy = a.physiology.energy - effort.energyCost,
      satiety = a.physiology.satiety - effort.satietyCost;
    if (!Number.isFinite(energy) || !Number.isFinite(satiety) || energy < 0 || satiety < 0)
      throw Error('construction-effort-underflow');
    agents[effort.actorId] = { ...a, physiology: { ...a.physiology, energy, satiety } };
  }
  for (const [id, items] of Object.entries(result.residentDeltas)) {
    const a = agents[id];
    if (!a) throw Error('premises-salvage-resident-missing');
    const inventory = { ...a.inventory };
    for (const [k, n] of Object.entries(items)) {
      const next = (inventory[k] ?? 0) + n;
      if (!Number.isFinite(next) || next < 0) throw Error('premises-salvage-inventory-overflow');
      inventory[k] = next;
    }
    agents[id] = { ...a, inventory };
  }
  const r = e.payload.reservation;
  for (const p of Object.values(result.state.projects)) {
    const old = w.premises?.projects[p.id];
    if (
      p.session &&
      !old?.session &&
      (!r ||
        r.agentId !== p.session.actorId ||
        r.startedAt !== p.session.startedAt ||
        r.availableAt !== p.session.until)
    )
      throw Error('construction-work-reservation-required');
    if (
      old?.session &&
      !p.session &&
      old.session.until > w.clock.now &&
      constructionSessionReserved(w, old)
    ) {
      const release = e.payload.release;
      if (
        !release ||
        release.actorId !== old.session.actorId ||
        release.startedAt !== old.session.startedAt ||
        release.previousAvailableAt !== old.session.until
      )
        throw Error('construction-work-release-required');
    }
  }
  if (r) {
    const p = Object.values(result.state.projects).find(
      (p) =>
        p.session?.actorId === r.agentId &&
        p.session.startedAt === r.startedAt &&
        p.session.until === r.availableAt,
    );
    if (
      !agents[r.agentId] ||
      !p ||
      w.transitByAgent?.[r.agentId] ||
      (w.activityTimeByAgent[r.agentId]?.availableAt ?? 0) > w.clock.now ||
      agents[r.agentId]!.locationId !== p.workLocationId ||
      r.startedAt !== w.clock.now ||
      r.commandType !== 'ResidentConstructionWork' ||
      r.settlementTiming !== 'effects-at-completion' ||
      !Number.isSafeInteger(r.availableAt) ||
      r.availableAt <= r.startedAt ||
      r.durationSeconds * 1000 !== r.availableAt - r.startedAt
    )
      throw Error('invalid-construction-work-reservation');
    activityTimeByAgent[r.agentId] = { ...r, committedAt: w.clock.now };
  }
  const release = e.payload.release;
  if (release) {
    if (
      !Object.values(w.premises?.projects ?? {}).some(
        (p) =>
          p.session?.actorId === release.actorId &&
          p.session.startedAt === release.startedAt &&
          p.session.until === release.previousAvailableAt &&
          !result.state.projects[p.id]?.session,
      )
    )
      throw Error('construction-work-stop-required');
    const old = activityTimeByAgent[release.actorId];
    if (
      !old ||
      old.commandType !== 'ResidentConstructionWork' ||
      old.startedAt !== release.startedAt ||
      old.availableAt !== release.previousAvailableAt ||
      release.endedAt !== w.clock.now ||
      release.endedAt < old.startedAt ||
      release.endedAt >= old.availableAt
    )
      throw Error('invalid-construction-work-release');
    activityTimeByAgent[release.actorId] = {
      ...old,
      availableAt: release.endedAt,
      durationSeconds: (release.endedAt - old.startedAt) / 1000,
    };
  }
  for (const event of e.payload.events)
    if (event.type === 'PremisesBuildingChanged') {
      const b = event.building,
        site = result.state.sites[b.siteId]!,
        old = w.premises?.buildings[b.id];
      if (!old) {
        const parent = locations[site.parentLocationId];
        if (!parent?.connections || locations[b.locationId])
          throw Error('invalid-premises-location-creation');
        locations[b.locationId] = {
          locationId: asLocationId(b.locationId),
          name: b.title,
          kind: b.blueprint.primaryUse,
          capacity: b.blueprint.capacity,
          activityAffinities: [],
          source: `resident-premises:${b.id}`,
          connections: [
            {
              targetLocationId: parent.locationId,
              travelDurationSeconds: site.accessTravelMs / 1000,
            },
          ],
          ...(parent.regionId ? { regionId: parent.regionId } : {}),
        };
        locations[parent.locationId] = {
          ...parent,
          connections: [
            ...parent.connections,
            {
              targetLocationId: asLocationId(b.locationId),
              travelDurationSeconds: site.accessTravelMs / 1000,
            },
          ],
        };
      } else {
        const location = locations[b.locationId];
        if (!location) throw Error('premises-location-missing');
        // Capacity is physical geometry; entry/residence/operation guards also check availability and grants.
        locations[b.locationId] = {
          ...location,
          name: b.title,
          kind: b.blueprint.primaryUse,
          capacity: b.blueprint.capacity,
        };
      }
    }
  return {
    ...w,
    premises: result.state,
    materials: material.state,
    agents,
    activityTimeByAgent,
    locations,
  };
}
