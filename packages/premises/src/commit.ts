import { assertPremisesPrincipalCommit } from './principalCommit';
import type { Inventory } from '@aivilization/economy';
import {
  moveInventory,
  materialEffortCost,
  validInventory,
  type MaterialAllocation,
} from '@aivilization/materials';
import type { PremisesState, PremisesEvent } from './model';
import type { ConstructionWorkDecision } from './work';
import { applyPremisesEvent } from './state';
import { inventoryEqual } from './projects';
import { sameBlueprint } from './policy';
export type ConstructionEffort = NonNullable<ConstructionWorkDecision['effort']>;
/** Checks physical conservation and recorded work in a complete transaction, without re-deciding authority. */
export function applyPremisesCommit(
  before: PremisesState | undefined,
  events: readonly PremisesEvent[],
  efforts: readonly ConstructionEffort[] = [],
) {
  let state = before;
  for (const e of events) state = applyPremisesEvent(state, e);
  if (!state) throw new Error('premises-not-enabled');
  assertPremisesPrincipalCommit(before, state, events);
  const allocations: MaterialAllocation[] = [],
    completed = new Set<string>(),
    destroyed = new Set<string>(),
    collected: Record<string, Inventory> = {},
    residentDeltas: Record<string, Inventory> = {},
    work: Record<string, number> = {};
  for (const e of efforts) {
    const p = before?.projects[e.projectId],
      session = p?.session;
    if (
      !p ||
      !session ||
      session.actorId !== e.actorId ||
      e.from !== session.settledAt ||
      e.through > session.until ||
      e.through - e.from !== e.workMs ||
      !Number.isSafeInteger(e.workMs) ||
      e.workMs <= 0 ||
      work[p.id]
    )
      throw new Error('invalid-construction-effort');
    const nextProgress = p.progressMs + e.workMs;
    const energy =
        materialEffortCost(nextProgress, p.plan.workMs, p.plan.energyCost) -
        materialEffortCost(p.progressMs, p.plan.workMs, p.plan.energyCost),
      satiety =
        materialEffortCost(nextProgress, p.plan.workMs, p.plan.satietyCost) -
        materialEffortCost(p.progressMs, p.plan.workMs, p.plan.satietyCost);
    if (
      Math.abs(energy - e.energyCost) > 1e-8 ||
      Math.abs(satiety - e.satietyCost) > 1e-8 ||
      ![e.energyCost, e.satietyCost].every((n) => Number.isFinite(n) && n >= 0)
    )
      throw new Error('invalid-construction-effort-cost');
    work[p.id] = e.workMs;
  }
  for (const e of events) {
    if (e.type === 'ConstructionResourcesAllocated') {
      const p = state.projects[e.projectId],
        old = before?.projects[e.projectId];
      if (
        !p ||
        old?.status !== 'open' ||
        p.status !== 'completed' ||
        completed.has(p.id) ||
        e.allocations.length !== p.reservations.length
      )
        throw new Error('invalid-construction-completion');
      const total: Record<string, number> = {},
        seen = new Set<string>();
      for (const a of e.allocations) {
        const r = p.reservations.find((r) => r.id === a.reservationId);
        if (
          !r ||
          seen.has(r.id) ||
          a.consumer.domain !== 'premises' ||
          a.consumer.id !== p.id ||
          a.evidenceId !== e.evidenceId ||
          !inventoryEqual(a.items, r.materials)
        )
          throw new Error('invalid-construction-allocation');
        seen.add(r.id);
        for (const [k, n] of Object.entries(a.items)) total[k] = (total[k] ?? 0) + n;
      }
      if (!inventoryEqual(total, p.plan.materials))
        throw new Error('construction-material-conservation');
      allocations.push(...e.allocations);
      completed.add(p.id);
    }
    if (e.type === 'PremisesDemolished') {
      const old = before?.buildings[e.buildingId],
        b = state.buildings[e.buildingId],
        p = state.projects[e.projectId];
      if (
        !old ||
        !b ||
        !p ||
        old.status === 'demolished' ||
        b.status !== 'demolished' ||
        p.kind !== 'demolish' ||
        p.buildingId !== b.id ||
        p.status !== 'completed' ||
        destroyed.has(b.id) ||
        !inventoryEqual(old.embodied, e.consumed) ||
        !validInventory(e.recovered, 64, 1000000, true) ||
        !validInventory(e.waste, 64, 1000000, true) ||
        !inventoryEqual(moveInventory(e.recovered, e.waste, 'add'), e.consumed) ||
        !inventoryEqual(b.salvage, e.recovered)
      )
        throw new Error('invalid-premises-demolition');
      const expected = Object.fromEntries(
        Object.entries(e.consumed).map(([k, n]) => [
          k,
          Math.floor(n * state.policy.salvageFraction * 1e6) / 1e6,
        ]),
      );
      if (!inventoryEqual(e.recovered, expected)) throw new Error('invalid-premises-recovery');
      destroyed.add(b.id);
    }
    if (e.type === 'PremisesSalvageCollected') {
      if (
        before?.buildings[e.buildingId]?.status !== 'demolished' ||
        !validInventory(e.items, 64, 1000000)
      )
        throw new Error('invalid-premises-salvage');
      collected[e.buildingId] = moveInventory(collected[e.buildingId] ?? {}, e.items, 'add');
      residentDeltas[e.actorId] = moveInventory(residentDeltas[e.actorId] ?? {}, e.items, 'add');
    }
  }
  for (const p of Object.values(state.projects)) {
    const old = before?.projects[p.id];
    if (
      p.progressMs - (old?.progressMs ?? 0) !== (work[p.id] ?? 0) ||
      (!old && (p.status !== 'open' || p.progressMs !== 0))
    )
      throw new Error('construction-work-conservation');
    if (p.status === 'completed' && old?.status !== 'completed' && !completed.has(p.id))
      throw new Error('construction-completion-evidence-required');
  }
  for (const b of Object.values(state.buildings)) {
    const old = before?.buildings[b.id],
      finished = [...completed]
        .map((id) => state.projects[id]!)
        .filter((p) => p.buildingId === b.id);
    if (finished.length > 1) throw new Error('multiple-premises-completions');
    const p = finished[0];
    if (
      !old &&
      (!p ||
        p.kind !== 'build' ||
        b.status !== 'operational' ||
        b.condition !== 1000 ||
        b.wearSettledAt !== b.at)
    )
      throw new Error('premises-construction-evidence-required');
    if (old && old.status !== 'demolished' && b.status === 'demolished' && !destroyed.has(b.id))
      throw new Error('premises-demolition-evidence-required');
    const expectedEmbodied = destroyed.has(b.id)
      ? {}
      : moveInventory(old?.embodied ?? {}, p?.plan.materials ?? {}, 'add');
    if (!inventoryEqual(b.embodied, expectedEmbodied))
      throw new Error('premises-embodied-material-conservation');
    if (
      !destroyed.has(b.id) &&
      !inventoryEqual(moveInventory(b.salvage, collected[b.id] ?? {}, 'add'), old?.salvage ?? {})
    )
      throw new Error('premises-salvage-conservation');
    const expectedBlueprint =
      p?.kind === 'modify' || p?.kind === 'build' ? p.plan.blueprint : old?.blueprint;
    if (!expectedBlueprint || !sameBlueprint(b.blueprint, expectedBlueprint))
      throw new Error('premises-blueprint-evidence-required');
    if (old) {
      const elapsed = b.wearSettledAt - old.wearSettledAt;
      if (
        elapsed % state.policy.wearIntervalMs !== 0 ||
        (b.status === 'demolished' && elapsed !== 0)
      )
        throw new Error('invalid-premises-wear-interval');
      const condition = Math.min(
        1000,
        Math.max(
          0,
          old.condition - (elapsed / state.policy.wearIntervalMs) * state.policy.wearPerInterval,
        ) + (p?.kind === 'maintain' ? p.plan.repairPoints : 0),
      );
      if (b.condition !== condition) throw new Error('premises-condition-evidence-required');
    }
  }
  for (const site of Object.values(state.sites)) {
    const occupied = Object.values(state.buildings)
        .filter((b) => b.siteId === site.id && !b.footprintReleased)
        .reduce((n, b) => n + b.blueprint.floorArea, 0),
      reserved = Object.values(state.projects)
        .filter((p) => p.siteId === site.id && p.status === 'open')
        .reduce((n, p) => n + p.plan.addedFloorArea, 0);
    if (site.occupiedFloorArea !== occupied || site.reservedFloorArea !== reserved)
      throw new Error('premises-area-conservation');
  }
  return { state, allocations, residentDeltas };
}
