import { materialSourceRecipe } from './extractionModel';
import { applyMaterialExpertise, materialBatchExpertise } from './growth';
import { materialEffortCost, affordableWorkMs } from './work';
import { materialAdministration } from './administration';
import { containsInventory, fitsStock, moveInventory, scaleInventory } from './inventoryFlow';
import {
  materialId,
  no,
  type MaterialsState,
  type MaterialProduction,
  type MaterialCommand,
  type MaterialDecision,
  type MaterialPorts,
  type MaterialEvent,
  type MaterialReceipt,
  type MaterialEffort,
  type ProductionEndReason,
} from './model';
const stripped = (j: MaterialProduction): Omit<MaterialProduction, 'session'> => {
  const { session, ...rest } = j;
  void session;
  return rest;
};
const bodyValid = (b: ReturnType<MaterialPorts['body']>) =>
  !!b && b.capable && [b.energy, b.satiety].every((n) => Number.isFinite(n) && n >= 0);

/** The same remaining-time bound used for decisions and authorized resident queries. */
export function materialProductionWorkWindow(s: MaterialsState, job: MaterialProduction) {
  if (job.status !== 'open' || job.session) return null;
  return {
    minimumDurationMs: 1,
    maximumDurationMs: Math.min(
      s.policy.maxShiftMs,
      job.quantity * job.recipe.workMs - job.progressMs,
    ),
  };
}
export function decideMaterialProduction(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  c: Extract<
    MaterialCommand,
    {
      type:
        | 'create-production'
        | 'create-extraction'
        | 'start-production'
        | 'leave-production'
        | 'cancel-production';
    }
  >,
  ports: MaterialPorts,
): MaterialDecision {
  if (
    !ports.exists(actorId) ||
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !materialId(receiptId) ||
    s.receipts[receiptId]
  )
    return no('invalid-material-actor-time-or-receipt');
  if (c.type === 'create-production' || c.type === 'create-extraction') {
    const stock = s.stocks[c.stockId],
      source = c.type === 'create-extraction' ? s.extraction?.sources[c.sourceId] : undefined,
      baseRecipe =
        c.type === 'create-production'
          ? s.policy.recipes.find((r) => r.id === c.recipeId)
          : source && materialSourceRecipe(source),
      // The batch snapshot carries the pace its listed workers have actually learned.
      expertise = baseRecipe && materialBatchExpertise(s, baseRecipe, c.workers),
      recipe =
        baseRecipe && expertise
          ? applyMaterialExpertise(baseRecipe, expertise.multiplier)
          : baseRecipe;
    if (
      c.type === 'create-extraction' &&
      (!source ||
        source.revision !== c.sourceRevision ||
        source.revision >= Number.MAX_SAFE_INTEGER ||
        source.at > at ||
        source.locationId !== stock?.locationId)
    )
      return no('material-source-location-or-revision-conflict');
    if (!stock || stock.status !== 'open') return no('material-stock-unavailable');
    const grant = materialAdministration(stock, actorId, c, ports);
    if (!grant) return no('resource-controller-authority-required');
    if (stock.revision !== c.expectedRevision || stock.revision >= Number.MAX_SAFE_INTEGER)
      return no('material-stock-revision-conflict');
    if (
      !materialId(c.id) ||
      s.productions[c.id] ||
      !recipe ||
      !Number.isSafeInteger(c.quantity) ||
      c.quantity < 1 ||
      c.quantity > s.policy.maxBatch ||
      !Number.isSafeInteger(recipe.workMs * c.quantity) ||
      (source !== undefined &&
        !Number.isSafeInteger(at + s.extraction!.policy.reservationDurationMs)) ||
      !c.productName.trim() ||
      c.productName.length > 120 ||
      c.description.length > 2000 ||
      !c.workers.length ||
      c.workers.length > s.policy.maxWorkers ||
      new Set(c.workers).size !== c.workers.length ||
      c.workers.some((id) => !ports.exists(id))
    )
      return no('invalid-production-definition');
    if (
      Object.keys(s.productions).length >= s.policy.maxJobs ||
      Object.values(s.productions).filter((j) => j.stockId === stock.id).length >=
        s.policy.maxJobsPerStock
    )
      return no('production-limit');
    const held = scaleInventory(recipe.inputs, c.quantity);
    if (source ? source.remaining < c.quantity : !containsInventory(stock.inventory, held))
      return no(source ? 'insufficient-material-source' : 'insufficient-stock-materials');
    const inventory = source ? stock.inventory : moveInventory(stock.inventory, held, 'remove');
    const production: MaterialProduction = {
      ...(expertise ? { expertise } : {}),
      id: c.id,
      stockId: stock.id,
      createdBy: actorId,
      ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
      productName: c.productName,
      description: c.description,
      recipe: structuredClone(recipe),
      ...(source
        ? { sourceId: source.id, sourceExpiresAt: at + s.extraction!.policy.reservationDurationMs }
        : {}),
      quantity: c.quantity,
      workers: [...c.workers],
      completed: 0,
      progressMs: 0,
      held,
      status: 'open',
      revision: 1,
      at,
    };
    if (
      !fitsStock(
        { ...s, productions: { ...s.productions, [c.id]: production } },
        stock.id,
        inventory,
        ports.locationStorageCapacity?.(stock.locationId),
      )
    )
      return no('material-stock-capacity');
    return {
      accepted: true,
      events: [
        ...(source
          ? [
              {
                type: 'MaterialSourceChanged' as const,
                source: {
                  ...source,
                  remaining: source.remaining - c.quantity,
                  revision: source.revision + 1,
                  at,
                },
              },
            ]
          : []),
        {
          type: 'MaterialStockChanged',
          stock: { ...stock, inventory, revision: stock.revision + 1, at },
        },
        { type: 'MaterialProductionChanged', production },
        {
          type: 'MaterialReceiptRecorded',
          receipt: {
            id: receiptId,
            actorId,
            at,
            operation: c.type,
            stockId: stock.id,
            productionId: c.id,
            ...(grant.decisionId ? { decisionId: grant.decisionId } : {}),
            ...(grant.principalAuthorization
              ? { principalAuthorization: grant.principalAuthorization }
              : {}),
            transfers: [
              {
                from: source ? { kind: 'source', id: source.id } : { kind: 'stock', id: stock.id },
                to: { kind: 'production', id: c.id },
                items: held,
              },
            ],
            conversions: [],
            efforts: [],
          },
        },
      ],
    };
  }
  const job = s.productions[c.id],
    stock = job && s.stocks[job.stockId];
  if (!job || job.status !== 'open' || !stock || stock.status === 'closed')
    return no('production-unavailable');
  if (job.revision !== c.expectedRevision || job.revision >= Number.MAX_SAFE_INTEGER)
    return no('production-revision-conflict');
  if (at < job.at) return no('invalid-material-time');
  if (c.type === 'start-production') {
    if (
      job.sourceExpiresAt !== undefined &&
      (at >= job.sourceExpiresAt || c.until > job.sourceExpiresAt)
    )
      return no('material-source-reservation-expired-or-too-short');
    if (job.session) return no('production-already-working');
    if (!job.workers.includes(actorId)) return no('production-worker-not-authorized');
    if (
      ports.workstationAvailable &&
      !ports.workstationAvailable(job.id, actorId, stock.locationId)
    )
      return no(
        job.sourceId
          ? 'material-source-labor-capacity-unavailable'
          : 'production-workstation-unavailable',
      );
    if (
      !ports.present(actorId, stock.locationId) ||
      !ports.idle(actorId) ||
      !(ports.mayWorkAt ?? ports.mayStoreAt)(actorId, stock.locationId)
    )
      return no('material-presence-and-idle-required');
    const b = ports.body(actorId);
    if (!bodyValid(b) || b!.residentialTier < job.recipe.minResidentialTier)
      return no('production-worker-not-capable');
    if (
      !Number.isSafeInteger(c.until) ||
      c.until <= at ||
      c.until - at > materialProductionWorkWindow(s, job)!.maximumDurationMs
    )
      return no('invalid-production-duration');
    const energy =
        materialEffortCost(
          job.progressMs + c.until - at,
          job.recipe.workMs,
          job.recipe.energyCost,
        ) - materialEffortCost(job.progressMs, job.recipe.workMs, job.recipe.energyCost),
      satiety =
        materialEffortCost(
          job.progressMs + c.until - at,
          job.recipe.workMs,
          job.recipe.satietyCost,
        ) - materialEffortCost(job.progressMs, job.recipe.workMs, job.recipe.satietyCost);
    if (b!.energy < energy || b!.satiety < satiety)
      return no('insufficient-production-effort-budget');
    return {
      accepted: true,
      reservation: { actorId, locationId: stock.locationId, until: c.until },
      events: [
        {
          type: 'MaterialProductionChanged',
          production: {
            ...job,
            session: { actorId, startedAt: at, settledAt: at, until: c.until, workedMs: 0 },
            revision: job.revision + 1,
            at,
          },
        },
        {
          type: 'MaterialReceiptRecorded',
          receipt: {
            id: receiptId,
            actorId,
            at,
            operation: c.type,
            stockId: stock.id,
            productionId: job.id,
            transfers: [],
            conversions: [],
            efforts: [],
          },
        },
      ],
    };
  }
  if (c.type === 'leave-production' && job.session?.actorId !== actorId)
    return no('personal-production-participation-required');
  const grant =
    c.type === 'cancel-production' ? materialAdministration(stock, actorId, c, ports) : undefined;
  if (c.type === 'cancel-production' && !grant) return no('resource-controller-authority-required');
  return settleMaterialProduction(
    s,
    job.id,
    at,
    receiptId,
    actorId,
    ports,
    c.type === 'cancel-production' ? 'cancel' : 'leave',
    grant?.decisionId,
    grant?.principalAuthorization,
  );
}
/** Called by the simulation application at bounded boundaries; never exposed as a resident-authored event/delta. */
export function settleMaterialProduction(
  s: MaterialsState,
  id: string,
  at: number,
  receiptId: string,
  actorId: string,
  ports: MaterialPorts,
  mode: 'tick' | 'leave' | 'cancel' = 'tick',
  decisionId?: string,
  principalAuthorization?: MaterialReceipt['principalAuthorization'],
): MaterialDecision {
  const job = s.productions[id],
    stock = job && s.stocks[job.stockId];
  if (!job || !stock || job.status !== 'open') return no('production-unavailable');
  if (!Number.isSafeInteger(at) || at < job.at || !materialId(receiptId) || s.receipts[receiptId])
    return no('invalid-material-time-or-receipt');
  if (job.revision >= Number.MAX_SAFE_INTEGER || stock.revision >= Number.MAX_SAFE_INTEGER)
    return no('material-revision-limit');
  const sourceExpired = job.sourceExpiresAt !== undefined && at >= job.sourceExpiresAt;
  if (sourceExpired) mode = 'cancel';
  const session = job.session;
  if (mode === 'tick' && !session) return { accepted: true, events: [] };
  if (mode === 'tick' && session && at === session.settledAt) return { accepted: true, events: [] };
  let workMs = 0,
    through = session?.settledAt ?? at;
  if (session) {
    if (at < session.settledAt) return no('invalid-material-time');
    const b = ports.body(session.actorId),
      elapsed = Math.max(0, Math.min(at, session.until) - session.settledAt);
    if (
      ports.exists(session.actorId) &&
      ports.present(session.actorId, stock.locationId) &&
      ports.sessionReserved(job) &&
      (!ports.workstationAvailable ||
        ports.workstationAvailable(job.id, session.actorId, stock.locationId)) &&
      bodyValid(b)
    ) {
      workMs = ports.settledWorkMs
        ? ports.settledWorkMs(job, elapsed)
        : affordableWorkMs({
            progressMs: job.progressMs,
            remainingMs: job.quantity * job.recipe.workMs - job.progressMs,
            elapsedMs: elapsed,
            unitMs: job.recipe.workMs,
            energyCost: job.recipe.energyCost,
            satietyCost: job.recipe.satietyCost,
            availableEnergy: b!.energy,
            availableSatiety: b!.satiety,
          });
      if (
        !Number.isSafeInteger(workMs) ||
        workMs < 0 ||
        workMs > elapsed ||
        workMs > job.quantity * job.recipe.workMs - job.progressMs
      )
        return no('invalid-physical-work-proof');
    }
    through = session.settledAt + workMs;
  }
  const progressMs = job.progressMs + workMs,
    completed = Math.floor(progressMs / job.recipe.workMs),
    units = completed - job.completed;
  const consumed = scaleInventory(job.recipe.inputs, units),
    produced = scaleInventory(job.recipe.outputs, units);
  let held = moveInventory(job.held, consumed, 'remove'),
    inventory = moveInventory(stock.inventory, produced, 'add');
  const efforts: MaterialEffort[] =
    session && workMs > 0
      ? [
          {
            actorId: session.actorId,
            productionId: id,
            from: session.settledAt,
            through,
            workMs,
            energyCost:
              materialEffortCost(progressMs, job.recipe.workMs, job.recipe.energyCost) -
              materialEffortCost(job.progressMs, job.recipe.workMs, job.recipe.energyCost),
            satietyCost:
              materialEffortCost(progressMs, job.recipe.workMs, job.recipe.satietyCost) -
              materialEffortCost(job.progressMs, job.recipe.workMs, job.recipe.satietyCost),
          },
        ]
      : [];
  const transfers: MaterialReceipt['transfers'][number][] = [];
  const source = job.sourceId ? s.extraction?.sources[job.sourceId] : undefined;
  const returnedToSource = source && mode === 'cancel' ? (held[source.commodity] ?? 0) : 0;
  if (returnedToSource && source!.revision >= Number.MAX_SAFE_INTEGER)
    return no('material-source-revision-limit');
  if (mode === 'cancel' && Object.keys(held).length) {
    transfers.push({
      from: { kind: 'production', id },
      to: source ? { kind: 'source', id: source.id } : { kind: 'stock', id: stock.id },
      items: held,
    });
    if (!source) inventory = moveInventory(inventory, held, 'add');
    held = {};
  }
  const finished = completed === job.quantity;
  const physicalEndedAt = session ? ports.physicalWorkEndedAt?.(job) : undefined;
  if (
    physicalEndedAt !== undefined &&
    (!Number.isSafeInteger(physicalEndedAt) ||
      physicalEndedAt < session!.settledAt ||
      physicalEndedAt > Math.min(at, session!.until) ||
      physicalEndedAt !== through)
  )
    return no('invalid-physical-work-end-proof');
  const continues =
    !!session &&
    mode === 'tick' &&
    !finished &&
    at < session.until &&
    through === at &&
    physicalEndedAt === undefined;
  const endReason: ProductionEndReason | undefined = continues
    ? undefined
    : sourceExpired && !finished
      ? 'source-expired'
      : finished
        ? 'completed'
        : mode === 'cancel'
          ? 'cancelled'
          : mode === 'leave'
            ? 'left'
            : session && !ports.sessionReserved(job)
              ? 'reservation-mismatch'
              : session &&
                  (!ports.exists(session.actorId) ||
                    !ports.present(session.actorId, stock.locationId) ||
                    !bodyValid(ports.body(session.actorId)))
                ? 'worker-unavailable'
                : session &&
                    ports.workstationAvailable &&
                    !ports.workstationAvailable(job.id, session.actorId, stock.locationId)
                  ? 'facility-unavailable'
                  : physicalEndedAt !== undefined ||
                      (session && through < Math.min(at, session.until))
                    ? 'effort-exhausted'
                    : 'shift-ended';
  const production: MaterialProduction = {
    ...stripped(job),
    ...(session && endReason
      ? { lastStop: { actorId: session.actorId, at: physicalEndedAt ?? at, reason: endReason } }
      : {}),
    status: finished ? 'completed' : mode === 'cancel' ? 'cancelled' : 'open',
    completed,
    progressMs,
    held,
    revision: job.revision + 1,
    at,
    ...(continues && session
      ? { session: { ...session, settledAt: at, workedMs: session.workedMs + workMs } }
      : {}),
  };
  const events: MaterialEvent[] = [{ type: 'MaterialProductionChanged', production }];
  if (source && returnedToSource)
    events.push({
      type: 'MaterialSourceChanged',
      source: {
        ...source,
        remaining: source.remaining + returnedToSource,
        revision: source.revision + 1,
        at,
      },
    });
  if (units > 0 || transfers.length)
    events.push({
      type: 'MaterialStockChanged',
      stock: { ...stock, inventory, revision: stock.revision + 1, at },
    });
  events.push({
    type: 'MaterialReceiptRecorded',
    receipt: {
      id: receiptId,
      actorId,
      at,
      ...(endReason ? { endReason } : {}),
      operation:
        mode === 'tick'
          ? 'production-progress'
          : mode === 'leave'
            ? 'leave-production'
            : 'cancel-production',
      stockId: stock.id,
      productionId: id,
      ...(decisionId ? { decisionId } : {}),
      ...(principalAuthorization ? { principalAuthorization } : {}),
      transfers,
      conversions: units
        ? [{ productionId: id, recipeVersion: job.recipe.version, units, consumed, produced }]
        : [],
      efforts,
    },
  });
  return {
    accepted: true,
    events,
    ...(session && !continues && ports.sessionReserved(job) ? { release: session } : {}),
  };
}
export function nextMaterialBoundary(s: MaterialsState, now: number): number | undefined {
  let next: number | undefined;
  for (const j of Object.values(s.productions)) {
    if (j.status === 'open' && j.sourceExpiresAt !== undefined && j.sourceExpiresAt > now)
      next = next === undefined ? j.sourceExpiresAt : Math.min(next, j.sourceExpiresAt);
    if (j.session) {
      const candidate = Math.min(
        j.session.until,
        Math.floor(now / s.policy.settlementIntervalMs + 1) * s.policy.settlementIntervalMs,
      );
      if (candidate > now) next = next === undefined ? candidate : Math.min(next, candidate);
    }
  }
  return next;
}
