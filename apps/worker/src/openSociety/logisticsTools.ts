import {
  executeFreightCustodyTool,
  freightCustodyRules,
  invitedCustodian,
} from './freightCustodyTools';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { residentLogisticsEvent, residentLogisticsPorts } from '@aivilization/world';
import { freightCustodian, loadedFreight, type Freight } from '@aivilization/logistics';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { parseLogisticsCommand } from './logisticsCommands';
import { controllerAvailable, controllerVisibleTo } from './resourceControlAccess';
import { stringArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
function payer(s: OpenSocietyState, f: Freight) {
  return residentLogisticsPorts(s.world, {
    authorize: () => undefined,
    controllerAvailable: () => false,
  }).account(f.payer);
}
function readable(s: OpenSocietyState, f: Freight, actorId: string) {
  const account = payer(s, f);
  return (
    (!!s.world.residentTrade?.publicFunding &&
      Object.values(s.world.residentTrade.orders).some(
        (o) => o.payer.sector === 'treasury' && o.source.kind === 'freight' && o.source.id === f.id,
      )) ||
    f.carrierId === actorId ||
    freightCustodian(s.world.logistics?.custody, f).carrierId === actorId ||
    [f.controller, f.recipient, ...(account ? [account.controller] : [])].some((c) =>
      controllerVisibleTo(s, c, actorId),
    )
  );
}
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorize: ControlAuthorizationPort,
): ToolExecution {
  const d = residentLogisticsEvent({
    projection: s.world,
    actorId,
    command: parseLogisticsCommand(name, args),
    authorization: { authorize, controllerAvailable: (c) => controllerAvailable(s, c) },
    requestId: `freight-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
  });
  if (!d.accepted) throw new ToolRefusal(d.reason);
  return {
    data: {
      committed: true,
      id: stringArg(args, 'id'),
      events: d.events.map((e) => ({ id: e.id, at: e.occurredAt, type: e.type })),
    },
    effects: { worldEvents: d.events, experiences: worldExperiences(s, d.events, actorId) },
  };
}
export function executeLogisticsTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const state = s.world.logistics;
  if (!state) throw new ToolRefusal('logistics-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'freight.rules')
    return result({
      policy: state.policy,
      handoff: freightCustodyRules(s),
      vehicleCapacity: 'vehicles read',
      custody:
        'Only actual carrier/vehicle travel moves loaded goods. Cargo is not consumable personal inventory.',
      cancellation:
        'Loaded cargo and escrow remain until actual return; expiry does not teleport or discard goods.',
      readWith: 'town freight read --id ID',
    });
  if (name === 'freight.handoff' || name === 'freight.handoffs') {
    const f = state.freight[stringArg(args, 'id')];
    if (!f) throw new ToolRefusal('freight-not-found');
    return executeFreightCustodyTool(s, m, actorId, name, args, requestId, readable(s, f, actorId));
  }
  if (name === 'freight.list')
    return result(
      pageItems(
        Object.values(state.freight)
          .filter((f) => readable(s, f, actorId) || invitedCustodian(s, f.id, actorId))
          .map(({ id, title, status, revision, deadline }) => ({
            id,
            title,
            status,
            revision,
            deadline,
          })),
        args,
      ),
    );
  if (name === 'freight.read' || name === 'freight.ledger') {
    const f = state.freight[stringArg(args, 'id')];
    if (!f || (!readable(s, f, actorId) && !invitedCustodian(s, f.id, actorId)))
      throw new ToolRefusal('freight-not-found');
    if (name === 'freight.ledger')
      return result(
        pageItems(
          Object.values(state.receipts).filter((r) => r.freightId === f.id),
          args,
        ),
      );
    const custody = s.world.materials?.custodies?.records[f.id];
    let cargoLocation: unknown = {
      locationId: f.status === 'delivered' ? f.destinationLocationId : f.sourceLocationId,
    };
    const holder = freightCustodian(state.custody, f);
    if (loadedFreight(f)) {
      const v = holder.vehicleId ? s.world.residentMobility?.vehicles[holder.vehicleId] : undefined,
        a = s.world.agents[holder.carrierId],
        transit = s.world.transitByAgent?.[holder.carrierId];
      cargoLocation = holder.vehicleId
        ? {
            kind: 'vehicle',
            vehicleId: holder.vehicleId,
            locationId: v?.locationId ?? null,
            journey: v?.journey
              ? {
                  from: v.journey.from,
                  to: v.journey.to,
                  departedAt: v.journey.departedAt,
                  arrivesAt: v.journey.arrivesAt,
                }
              : null,
          }
        : {
            kind: 'resident',
            carrierId: holder.carrierId,
            locationId: a?.locationId ?? null,
            transit: transit ?? null,
          };
    }
    return result({ ...f, currentCustodian: holder, custody: custody ?? null, cargoLocation });
  }
  return execute(s, m, actorId, name, args, requestId, personalControlAuthorization(actorId));
}
function collectiveArgs(s: OpenSocietyState, cid: string, action: CollectiveResourceAction) {
  if (
    !['freight.offer', 'freight.accept', 'freight.fund', 'freight.cancel'].includes(
      action.capability,
    ) ||
    Object.hasOwn(action.arguments, 'id')
  )
    throw new ToolRefusal('unsupported-collective-freight-action');
  const args = { ...action.arguments, id: action.resourceId },
    c = parseLogisticsCommand(action.capability, args),
    f = s.world.logistics?.freight[action.resourceId];
  const controllers =
    c.type === 'offer'
      ? [c.controller]
      : !f
        ? []
        : c.type === 'accept'
          ? [f.recipient]
          : c.type === 'fund'
            ? [payer(s, f)?.controller]
            : [f.controller, f.recipient, payer(s, f)?.controller];
  if (!s.world.logistics || !controllers.some((v) => v?.kind === 'collective' && v.id === cid))
    throw new ToolRefusal('collective-freight-controller-mismatch');
  return args;
}
export function validateLogisticsResourceAction(
  s: OpenSocietyState,
  cid: string,
  action: CollectiveResourceAction,
) {
  try {
    collectiveArgs(s, cid, action);
    return undefined;
  } catch (e) {
    return e instanceof ToolRefusal ? e.reason : 'invalid-collective-freight-action';
  }
}
export function executeApprovedLogisticsResource(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  cid: string,
  decisionId: string,
  action: CollectiveResourceAction,
  requestId: string,
) {
  return execute(
    s,
    m,
    actorId,
    action.capability,
    collectiveArgs(s, cid, action),
    requestId,
    (c) => (c.kind === 'collective' && c.id === cid ? { actorId, decisionId } : undefined),
  );
}
