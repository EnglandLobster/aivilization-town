import { assertResidentMaterialInterruption } from '../residentMaterials';
import { decodePrincipalMaterialOperation } from '../materialCommandCodec';
import { worldPrincipalAvailable } from '../resourcePrincipalAuthority';
import type { PrincipalCollectivePort } from '../principalCollectivePort';
import {
  assertWorldPrincipalOperationSource,
  type PublicPrincipalExecution,
} from '../resourcePrincipalAuthority';
import { applyResourcePrincipalsProjection } from '../resourcePrincipals';
import { applyResidentExtractionActivation } from '../residentExtraction';
import { applyProductiveMaterialCompensation } from '../productiveCompensation';
import { materialSourceWorkAvailable } from '@aivilization/materials';
import { applyMaterialCommit } from '@aivilization/materials';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
import { mayStoreWorldPremises, worldPremisesUseUntil } from '../premisesAccess';
export function applyMaterialsProjection(
  w: WorldProjection,
  e: WorldEvent,
  publicExecution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  const activation =
    applyResourcePrincipalsProjection(w, e, collective) ?? applyResidentExtractionActivation(w, e);
  if (activation) return activation;
  if (e.type !== 'ResidentMaterialsCommitted') return undefined;
  assertResidentMaterialInterruption(w, e.payload.interruption, e.payload.events);
  if (
    e.payload.events.some(
      (v) =>
        v.type === 'MaterialResourcePrincipalsEnabled' ||
        v.type === 'MaterialPrincipalControlChanged',
    )
  )
    throw Error('material-principals-need-explicit-world-event');
  if (e.payload.events.some((v) => v.type === 'MaterialExtractionEnabled'))
    throw Error('material-extraction-needs-explicit-world-activation');
  if (
    e.payload.policyVersion !== 'resident-materials-v1' ||
    (w.productiveEmployment ? e.occurredAt > w.clock.now : e.occurredAt !== w.clock.now)
  )
    throw new Error('invalid-material-commit-version-or-time');
  if (
    e.payload.events.some(
      (v) =>
        v.type === 'MaterialReceiptRecorded' &&
        v.receipt.operation === 'consumer-materials' &&
        v.receipt.reservationId &&
        w.materials?.reservations?.records[v.receipt.reservationId]?.principalVersion,
    )
  )
    throw Error('principal-reservation-needs-consumer-commit');
  for (const v of e.payload.events)
    if (v.type === 'MaterialReceiptRecorded' && v.receipt.principalAuthorization)
      assertWorldPrincipalOperationSource(
        w,
        v.receipt.principalAuthorization,
        publicExecution,
        collective,
      );
  for (const event of e.payload.events) {
    if (
      event.type !== 'MaterialReceiptRecorded' ||
      event.receipt.operation !== 'reserve-materials' ||
      !event.receipt.principalAuthorization
    )
      continue;
    const c = decodePrincipalMaterialOperation(event.receipt.principalAuthorization.request);
    if (
      c.type !== 'reserve-materials' ||
      !w.premises ||
      !worldPrincipalAvailable(w, c.offer.beneficiary, collective)
    )
      throw Error('principal-reservation-beneficiary-unavailable');
  }
  const result = applyMaterialCommit(w.materials, e.payload.events),
    agents = { ...w.agents },
    activityTimeByAgent = { ...w.activityTimeByAgent };
  const body = e.payload.elapsedBody;
  if (w.productiveEmployment && !body && result.efforts.some((v) => v.workMs > 0))
    throw Error('productive-work-needs-body-proof');
  if (body) {
    const agent = w.agents[body.actorId],
      job = w.materials?.productions[body.productionId];
    const effort = result.efforts.filter(
      (v) => v.productionId === body.productionId && v.actorId === body.actorId,
    );
    if (
      !w.productiveEmployment ||
      body.policyVersion !== 'resident-productive-physiology-v1' ||
      !agent ||
      !job?.session ||
      job.session.actorId !== body.actorId ||
      job.session.settledAt !== body.from ||
      body.until !== e.occurredAt ||
      body.until > job.session.until ||
      body.until <= body.from ||
      !Number.isSafeInteger(body.workedMs) ||
      body.workedMs < 0 ||
      body.workedMs > body.until - body.from ||
      (body.endedAt !== undefined &&
        (!Number.isSafeInteger(body.endedAt) || body.endedAt !== body.from + body.workedMs)) ||
      effort.reduce((sum, v) => sum + v.workMs, 0) !== body.workedMs ||
      !Number.isFinite(body.lowEnergyMs) ||
      body.lowEnergyMs < 0 ||
      body.lowEnergyMs > body.until - body.from ||
      (['energy', 'satiety', 'health'] as const).some(
        (k) =>
          body.previous[k] !== agent.physiology[k] ||
          !Number.isFinite(body.next[k]) ||
          body.next[k] < 0 ||
          body.next[k] > body.previous[k],
      )
    )
      throw Error('invalid-productive-body-proof');
    agents[body.actorId] = { ...agent, physiology: { ...body.next } };
  }
  if (w.premisesRights)
    for (const event of e.payload.events) {
      if (event.type !== 'MaterialReceiptRecorded') continue;
      const r = event.receipt,
        stock = r.stockId && result.state.stocks[r.stockId];
      if (
        stock &&
        (r.operation === 'deposit' || r.operation === 'create-stock') &&
        !mayStoreWorldPremises(w, r.actorId, stock.locationId)
      )
        throw Error('material-storage-permit-required');
    }
  for (const [id, delta] of Object.entries(result.residentDeltas)) {
    const a = agents[id];
    if (!a) throw new Error('material-resident-missing');
    const inventory = { ...a.inventory };
    for (const [item, q] of Object.entries(delta)) {
      const n = (inventory[item] ?? 0) + q;
      if (!Number.isFinite(n) || n < 0) throw new Error('invalid-material-resident-inventory');
      if (n === 0) delete inventory[item];
      else inventory[item] = n;
    }
    agents[id] = { ...a, inventory };
  }
  for (const effort of result.efforts) {
    const a = agents[effort.actorId],
      old = w.materials?.productions[effort.productionId],
      reservation = w.activityTimeByAgent[effort.actorId];
    if (
      !a ||
      !old?.session ||
      !reservation ||
      reservation.commandType !== 'ResidentMaterialWork' ||
      reservation.startedAt !== old.session.startedAt ||
      reservation.availableAt !== old.session.until
    )
      throw new Error('material-effort-reservation-mismatch');
    const energy = a.physiology.energy - effort.energyCost,
      satiety = a.physiology.satiety - effort.satietyCost;
    if (body && body.actorId === effort.actorId && body.productionId === effort.productionId)
      continue;
    if (!Number.isFinite(energy) || !Number.isFinite(satiety) || energy < 0 || satiety < 0)
      throw new Error('material-effort-underflow');
    agents[effort.actorId] = { ...a, physiology: { ...a.physiology, energy, satiety } };
  }
  const r = e.payload.reservation;
  if (r) {
    const changed = e.payload.events.find(
      (v) => v.type === 'MaterialProductionChanged' && v.production.session?.actorId === r.agentId,
    );
    if (
      !agents[r.agentId] ||
      w.transitByAgent?.[r.agentId] ||
      (w.activityTimeByAgent[r.agentId]?.availableAt ?? 0) > w.clock.now ||
      r.startedAt !== w.clock.now ||
      r.commandType !== 'ResidentMaterialWork' ||
      r.settlementTiming !== 'effects-at-completion' ||
      r.availableAt <= r.startedAt ||
      !Number.isSafeInteger(r.availableAt) ||
      r.durationSeconds * 1000 !== r.availableAt - r.startedAt ||
      changed?.type !== 'MaterialProductionChanged' ||
      changed.production.session?.until !== r.availableAt ||
      changed.production.session?.startedAt !== r.startedAt
    )
      throw new Error('invalid-material-work-reservation');
    const stock = result.state.stocks[changed.production.stockId];
    if (
      changed.production.sourceId &&
      (!w.materials ||
        !materialSourceWorkAvailable(w.materials, changed.production.id, r.agentId, w.clock.now))
    )
      throw Error('material-source-capacity-exceeded');
    if (
      w.premisesRights &&
      (!stock || worldPremisesUseUntil(w, r.agentId, stock.locationId, 'operate') < r.availableAt)
    )
      throw Error('production-permit-window-exceeded');
    activityTimeByAgent[r.agentId] = { ...r, committedAt: w.clock.now };
  }
  const release = e.payload.release;
  if (release) {
    const old = activityTimeByAgent[release.actorId];
    if (
      !old ||
      old.commandType !== 'ResidentMaterialWork' ||
      old.startedAt !== release.startedAt ||
      old.availableAt !== release.previousAvailableAt ||
      release.endedAt !== (body?.endedAt ?? e.occurredAt) ||
      release.endedAt < old.startedAt ||
      release.endedAt >= old.availableAt
    )
      throw new Error('invalid-material-work-release');
    activityTimeByAgent[release.actorId] = {
      ...old,
      availableAt: release.endedAt,
      durationSeconds: (release.endedAt - old.startedAt) / 1000,
    };
  }
  return applyProductiveMaterialCompensation({
    before: w,
    after: { ...w, materials: result.state, agents, activityTimeByAgent },
    events: e.payload.events,
    eventId: e.id,
    ...(e.payload.employment ? { employment: e.payload.employment } : {}),
  });
}
