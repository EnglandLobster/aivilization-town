import {
  effectiveController,
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  residentMaterialEvent,
  productionEmployer,
  mayStoreWorldPremises,
  premisesFacilityAvailability,
  settleResidentMaterialEvent,
  regrowResidentMaterialSourcesEvent,
  applyWorldEvent,
  type MaterialAuthorization,
  type WorldEvent,
} from '@aivilization/world';
import type {
  MaterialStock,
  MaterialProduction,
  MaterialCommand,
  MaterialSource,
} from '@aivilization/materials';
import {
  materialExpertiseMultiplier,
  materialProductionWorkWindow,
  materialSourceLaborCapacity,
  materialSourceRecipe,
  residentMaterialExperience,
  type MaterialRecipe,
} from '@aivilization/materials';
import { enterpriseController, enterpriseControlVersion } from '@aivilization/enterprise';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { controllerAvailable, principalVisibleTo } from './resourceControlAccess';
import { parseMaterialCommand } from './materialCommands';
import { ToolRefusal, stringArg, pageItems } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
import { openWorldPolicies } from './manifest';
import { ownLaborContext } from './laborContext';
export function materialAuthorization(
  s: OpenSocietyState,
  authorize: ControlAuthorizationPort,
): MaterialAuthorization {
  return {
    authorize,
    controlAvailable: (c) => controllerAvailable(s, c),
    mayStoreAt: (actor, id) =>
      s.world.agents[actor]?.locationId === id &&
      !!s.world.locations[id] &&
      mayStoreWorldPremises(s.world, actor, id),
    // The materials domain also holds the source reservation through settlement.
    hasExternalObligation: (id) =>
      Object.values(s.world.premises?.projects ?? {}).some(
        (p) => p.status === 'open' && p.reservations.some((r) => r.sourceStockId === id),
      ),
  };
}
const controller = (s: OpenSocietyState, v: MaterialStock, a: string) =>
  principalVisibleTo(s, effectiveController(v), a);
const target = (s: OpenSocietyState, v: MaterialStock, a: string) =>
  !!v.control.offer &&
  v.control.offer.expiresAt > s.world.clock.now &&
  principalVisibleTo(s, v.control.offer.target, a);
const readable = (s: OpenSocietyState, v: MaterialStock, a: string) =>
  controller(s, v, a) || target(s, v, a) || v.readers.includes(a);
const discoverable = (s: OpenSocietyState, v: MaterialStock, a: string) =>
  readable(s, v, a) || v.contributors.includes(a);
const jobReadable = (s: OpenSocietyState, j: MaterialProduction, a: string) =>
  j.workers.includes(a) ||
  (!!s.world.materials?.stocks[j.stockId] && readable(s, s.world.materials.stocks[j.stockId]!, a));
const metadata = (v: MaterialStock) => ({
  id: v.id,
  title: v.title,
  locationId: v.locationId,
  revision: v.revision,
  status: v.status,
  controller: effectiveController(v),
  controlVersion: v.control.version,
  ...(v.control.offer ? { offer: v.control.offer } : {}),
});
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  c: MaterialCommand,
  requestId: string,
  authorize: ControlAuthorizationPort,
  enterpriseId?: string,
): ToolExecution {
  const d = residentMaterialEvent({
    projection: s.world,
    actorId: a,
    command: c,
    authorization: materialAuthorization(s, authorize),
    requestId: `materials-${digest([a, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
    policies: openWorldPolicies(m.seed, s.world, m.rhythm, m.canonicalPolicyContinuation),
    ...(enterpriseId ? { enterpriseId } : {}),
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  const records = d.events.flatMap((e) =>
    e.type === 'ResidentMaterialsCommitted'
      ? e.payload.events.flatMap((v) => (v.type === 'MaterialReceiptRecorded' ? [v.receipt] : []))
      : [],
  );
  return {
    data: {
      receipts: records,
      ...(s.world.productiveEmployment
        ? { labor: ownLaborContext(d.events.reduce(applyWorldEvent, s.world), a) }
        : {}),
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, a) },
  };
}
export function executeMaterialTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  name: string,
  args: Record<string, unknown>,
  requestId: string,
): ToolExecution {
  if (
    Object.hasOwn(args, 'enterpriseId') &&
    (typeof args.enterpriseId !== 'string' || !args.enterpriseId.trim())
  )
    throw new ToolRefusal('invalid-production-employer-id');
  const state = s.world.materials;
  if (!state) throw new ToolRefusal('materials-not-enabled');
  const id = stringArg(args, 'id'),
    result = (data: unknown) => ({ data, effects: {} });
  // Only the caller's own committed practice; other residents' experience stays private.
  const ownPace = (recipe: MaterialRecipe) => {
    const experienceMs = residentMaterialExperience(state, a, recipe);
    const multiplier = materialExpertiseMultiplier(state.expertise!.policy, experienceMs);
    return {
      experienceMs,
      multiplier,
      workMsPerUnit: Math.max(1, Math.round(recipe.workMs * multiplier)),
    };
  };
  if (name === 'sources.list' || name === 'sources.read') {
    if (!state.extraction) throw new ToolRefusal('finite-material-sources-not-enabled');
    const source = state.extraction.sources[id];
    if (name === 'sources.read' && !source) throw new ToolRefusal('material-source-not-found');
    const sourceMetadata = (v: MaterialSource) => ({
      ...v,
      laborSlots: materialSourceLaborCapacity(state, v.id, s.world.clock.now),
      ...(state.expertise ? { yourPace: ownPace(materialSourceRecipe(v)) } : {}),
    });
    return result({
      policy: state.extraction.policy,
      origin: state.extraction.origin ?? null,
      ...(state.regrowth
        ? {
            regrowth: {
              ...state.regrowth.policy,
              meaning:
                'A source below its original quantity regrows this share of that quantity per simulated day, in whole units, never above the original.',
            },
          }
        : {}),
      ...(name === 'sources.list'
        ? pageItems(
            Object.values(state.extraction.sources)
              .sort((a, b) => a.id.localeCompare(b.id, 'en'))
              .map(sourceMetadata),
            args,
          )
        : { source: sourceMetadata(source!) }),
      gatherWith: 'town production gather',
      workWith: 'town production start',
      capacityMeaning:
        'Raw-source labor slots are separate from indoor workstations. Buildings do not increase these slots; counts are current facts, not reservations or a promise of future availability.',
    });
  }
  if (name === 'production.recipes')
    return result({
      policyVersion: state.policy.version,
      ...(state.extraction
        ? {
            sourcePolicy: state.extraction.policy.version,
            rawMaterialsWith: 'town sources list',
            legacyProduction: 'disabled',
          }
        : {}),
      ...(state.expertise
        ? {
            learningByDoing: {
              ...state.expertise.policy,
              meaning:
                'Your own committed working time on the same outputs shortens the time and body effort of your later batches; a shared batch uses its least practiced worker. Nobody is assigned a skill.',
            },
          }
        : {}),
      ...pageItems(
        state.expertise
          ? state.policy.recipes.map((recipe) => ({ ...recipe, yourPace: ownPace(recipe) }))
          : state.policy.recipes,
        args,
      ),
    });
  if (name === 'stocks.list')
    return result(
      pageItems(
        Object.values(state.stocks)
          .filter((v) => discoverable(s, v, a))
          .map(metadata),
        args,
      ),
    );
  if (name === 'stocks.read' || name === 'stocks.ledger') {
    const v = state.stocks[id];
    if (!v || !discoverable(s, v, a)) throw new ToolRefusal('material-stock-not-readable');
    if (name === 'stocks.ledger')
      return result(
        pageItems(
          Object.values(state.receipts)
            .filter((r) => r.stockId === id && (readable(s, v, a) || r.actorId === a))
            .sort((l, r) => l.at - r.at || l.id.localeCompare(r.id)),
          args,
        ),
      );
    return result({
      ...metadata(v),
      facilityUse: premisesFacilityAvailability(s.world, v.locationId) ?? { enforced: false },
      ...(state.custodies && readable(s, v, a)
        ? {
            freightReservations: pageItems(
              Object.values(state.custodies.records)
                .filter(
                  (c) =>
                    (c.status === 'reserved' || c.status === 'loaded') &&
                    (c.sourceStockId === id || c.destinationStockId === id),
                )
                .map((c) => ({
                  id: c.id,
                  status: c.status,
                  freightId: c.consumerId,
                  heldInTransit: c.sourceStockId === id ? c.held : {},
                  reservedReturnSpace:
                    c.sourceStockId === id && c.status === 'loaded' ? c.original : {},
                  reservedIncomingSpace: c.destinationStockId === id ? c.original : {},
                  readWith: `town freight read --id ${c.consumerId}`,
                })),
              args,
            ),
          }
        : {}),
      ...(readable(s, v, a)
        ? {
            contents: pageItems(
              Object.entries(v.inventory).map(([item, quantity]) => ({ item, quantity })),
              args,
            ),
            contributors: v.contributors,
            readers: v.readers,
            openProductions: pageItems(
              Object.values(state.productions)
                .filter((j) => j.stockId === id && j.status === 'open')
                .map((j) => ({
                  id: j.id,
                  revision: j.revision,
                  progressMs: j.progressMs,
                  quantity: j.quantity,
                  completed: j.completed,
                })),
              args,
            ),
          }
        : {}),
    });
  }
  if (name === 'production.list')
    return result(
      pageItems(
        Object.values(state.productions)
          .filter((j) => jobReadable(s, j, a))
          .map((j) => ({
            id: j.id,
            stockId: j.stockId,
            productName: j.productName,
            revision: j.revision,
            status: j.status,
            completed: j.completed,
            quantity: j.quantity,
          })),
        args,
      ),
    );
  if (name === 'production.read') {
    const j = state.productions[id];
    if (!j || !jobReadable(s, j, a)) throw new ToolRefusal('production-not-readable');
    const employer = productionEmployer(s.world, j.id);
    return result({
      ...j,
      ...(employer
        ? {
            employment: {
              enterpriseId: employer.enterpriseId,
              ownQuotedWage:
                employer.productionEmployment!.assignments[j.id]!.wageOffers[a] ?? null,
              stockController: effectiveController(state.stocks[j.stockId]!),
              propertyEffect:
                'Wages fund labor; output remains in the named stock under its actual controller.',
              wageHistoryWith: 'town city observe --view labor',
              claimWith: 'town business claim-wage',
              stopWith: 'town production leave',
              bodyAndPay:
                'One real material participation earns wages; do not separately start business work.',
            },
          }
        : {}),
      ...(j.sourceId
        ? {
            sourceWork: {
              sourceId: j.sourceId,
              laborSlots: materialSourceLaborCapacity(state, j.sourceId, s.world.clock.now),
              readWith: `town sources read --id ${j.sourceId}`,
              capacityMeaning:
                'Raw-source labor slots, not indoor workstations. Personal body, location and time permissions are still checked.',
            },
          }
        : {}),
      workWindow: materialProductionWorkWindow(state, j),
      workTiming: {
        now: s.world.clock.now,
        untilMeans:
          'Absolute simulation deadline: now + chosen duration. Any positive partial duration within workWindow is allowed; it need not equal recipe.workMs.',
        participation:
          'Personal presence, capability, effort budget and workstation are still checked. You may leave early; completed work persists.',
      },
    });
  }
  return execute(
    s,
    m,
    a,
    parseMaterialCommand(
      name,
      Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'enterpriseId')),
    ),
    requestId,
    personalControlAuthorization(a),
    typeof args.enterpriseId === 'string' ? args.enterpriseId : undefined,
  );
}
const allowed = new Set([
  'stocks.configure',
  'stocks.withdraw',
  'stocks.offer',
  'stocks.accept',
  'stocks.cancel-offer',
  'stocks.settle',
  'stocks.close',
  'production.create',
  'production.gather',
  'production.cancel',
]);
function collectiveCommand(s: OpenSocietyState, cid: string, action: CollectiveResourceAction) {
  if (!allowed.has(action.capability))
    throw new ToolRefusal('unsupported-collective-material-action');
  if (Object.hasOwn(action.arguments, 'id')) throw new ToolRefusal('invalid-material-command');
  const { enterpriseId, expectedEnterpriseControlVersion, ...args } = action.arguments;
  const employerSpecified = Object.hasOwn(action.arguments, 'enterpriseId');
  const versionSpecified = Object.hasOwn(action.arguments, 'expectedEnterpriseControlVersion');
  if (employerSpecified || versionSpecified) {
    if (
      !['production.create', 'production.gather'].includes(action.capability) ||
      typeof enterpriseId !== 'string' ||
      !enterpriseId.trim() ||
      !Number.isSafeInteger(expectedEnterpriseControlVersion) ||
      Number(expectedEnterpriseControlVersion) < 1
    )
      throw new ToolRefusal('invalid-collective-production-employer');
    const enterprise = s.world.enterprises[enterpriseId];
    const subject = enterprise && enterpriseController(enterprise);
    if (!subject || subject.kind !== 'collective' || subject.id !== cid)
      throw new ToolRefusal('collective-does-not-control-production-employer');
    if (enterpriseControlVersion(enterprise) !== expectedEnterpriseControlVersion)
      throw new ToolRefusal('enterprise-control-revision-conflict');
  }
  const c = parseMaterialCommand(action.capability, { ...args, id: action.resourceId });
  const stockId =
    c.type === 'create-production' || c.type === 'create-extraction'
      ? c.stockId
      : c.type === 'cancel-production'
        ? s.world.materials?.productions[c.id]?.stockId
        : c.id;
  const stock = stockId ? s.world.materials?.stocks[stockId] : undefined;
  if (!stock) throw new ToolRefusal('material-stock-unavailable');
  const subject =
    c.type === 'control-stock' && c.control.type === 'accept'
      ? stock.control.offer?.target
      : effectiveController(stock);
  if (subject?.kind !== 'collective' || subject.id !== cid)
    throw new ToolRefusal('collective-does-not-control-stock');
  return { command: c, ...(employerSpecified ? { enterpriseId: enterpriseId as string } : {}) };
}
export function validateMaterialResourceAction(
  s: OpenSocietyState,
  cid: string,
  a: CollectiveResourceAction,
) {
  try {
    collectiveCommand(s, cid, a);
    return undefined;
  } catch (e) {
    if (e instanceof ToolRefusal) return e.reason;
    throw e;
  }
}
export function executeApprovedMaterialResource(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  a: string,
  cid: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
): ToolExecution {
  const parsed = collectiveCommand(s, cid, action);
  return execute(
    s,
    m,
    a,
    parsed.command,
    requestId,
    (c) => (c.kind === 'collective' && c.id === cid ? { actorId: a, decisionId } : undefined),
    parsed.enterpriseId,
  );
}
export function advanceOpenMaterials(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  requestId: string,
): readonly WorldEvent[] {
  const jobs = Object.values(s.world.materials?.productions ?? {})
      .filter(
        (j) =>
          j.session ||
          (j.status === 'open' &&
            j.sourceExpiresAt !== undefined &&
            j.sourceExpiresAt <= s.world.clock.now),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: WorldEvent[] = [];
  let working = s;
  for (const j of jobs) {
    const d = settleResidentMaterialEvent({
      projection: working.world,
      actorId: 'system',
      productionId: j.id,
      authorization: materialAuthorization(working, () => undefined),
      requestId: `material-tick-${digest([requestId, j.id, s.world.clock.now]).slice(0, 32)}`,
      simulationId: m.simulationId,
      nextSequence: working.worldSequence + 1,
    });
    if (!d.accepted) throw new Error(`material-settlement-failed:${j.id}:${d.reason}`);
    for (const e of d.events) {
      working = { ...working, world: applyWorldEvent(working.world, e), worldSequence: e.sequence };
      events.push(e);
    }
  }
  for (const e of regrowResidentMaterialSourcesEvent({
    projection: working.world,
    simulationId: m.simulationId,
    requestId: `material-regrowth-${digest([requestId, s.world.clock.now]).slice(0, 32)}`,
    nextSequence: working.worldSequence + 1,
  })) {
    working = { ...working, world: applyWorldEvent(working.world, e), worldSequence: e.sequence };
    events.push(e);
  }
  return events;
}
