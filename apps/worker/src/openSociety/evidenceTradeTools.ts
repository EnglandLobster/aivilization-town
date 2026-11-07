import { principalPermitTradeEvidence } from '@aivilization/world';
import { principalVisibleTo } from './resourceControlAccess';
import {
  personalControlAuthorization,
  type ControlAuthorizationPort,
  type Controller,
} from '@aivilization/authority';
import type { TradeOrder } from '@aivilization/commerce';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
import { residentEvidenceTradeEvent, residentTradeEvidence } from '@aivilization/world';
import type { OpenSocietyState, OpenSocietyManifest } from './types';
import type { ToolExecution } from './informationTools';
import { parseEvidenceTradeCommand } from './evidenceTradeCommands';
import { controllerAvailable, controllerVisibleTo } from './resourceControlAccess';
import { stringArg, pageItems, ToolRefusal } from './arguments';
import { digest } from './journal';
import { worldExperiences } from './worldTools';
const readable = (s: OpenSocietyState, o: TradeOrder, actor: string) =>
  (!!s.world.residentTrade?.publicFunding && o.payer.sector === 'treasury') ||
  [o.source.seller, o.source.buyer].some((c) => controllerVisibleTo(s, c, actor));
function execute(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
  authorize: ControlAuthorizationPort,
  actingFor?: Controller,
): ToolExecution {
  const d = residentEvidenceTradeEvent({
    projection: s.world,
    actorId,
    command: parseEvidenceTradeCommand(name, args),
    requestId: `trade-${digest([actorId, requestId]).slice(0, 32)}`,
    simulationId: m.simulationId,
    nextSequence: s.worldSequence + 1,
    authorization: {
      authorize,
      controllerAvailable: (c) => controllerAvailable(s, c),
      ...(actingFor ? { actingFor } : {}),
    },
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
export function executeEvidenceTradeTool(
  s: OpenSocietyState,
  m: OpenSocietyManifest,
  actorId: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
  requestId: string,
): ToolExecution {
  const state = s.world.residentTrade;
  if (!state) throw new ToolRefusal('evidence-trade-not-enabled');
  const result = (data: unknown): ToolExecution => ({ data, effects: {} });
  if (name === 'trades.rules')
    return result({
      policy: state.policy,
      principalOrderPolicy: state.principalOrders?.policy ?? null,
      principalOperationsWith: state.principalOrders
        ? 'town principals operate --request <exact trades.* operation>'
        : null,
      publicFunding: state.publicFunding ?? null,
      realSources:
        state.policy.version === 'resident-evidence-trade-v2'
          ? ['freight', 'service', 'permit']
          : ['freight', 'service'],
      sourceUse: 'One source can back one order. It must not have started at offer or acceptance.',
      consent:
        'Seller offers; buyer independently accepts. Private orders escrow on acceptance; enabled treasury freight orders await exact governance fund-goods approval. Public payment does not change named recipient ownership. Actual participants still act personally.',
      payment:
        'Freight fees are separate from goods price. Service sources must have zero hourly charge; the order price is proportional to actual recorded duration.',
      permissions:
        state.policy.version === 'resident-evidence-trade-v2'
          ? 'Trade acceptance atomically escrows price, accepts the original permission and starts availability records. Price follows actual operational permission time, not attendance or satisfaction.'
          : null,
      settlement:
        'Real delivery awaits buyer confirmation. Disputes freeze earned payment; an exact settlement requires the counterparty consent. Timeout does not mean satisfaction.',
      readWith: 'town trades read --id ID',
    });
  if (name === 'trades.list')
    return result(
      pageItems(
        [
          ...Object.values(state.orders).filter((o) => readable(s, o, actorId)),
          ...Object.values(state.principalOrders?.orders ?? {}).filter((o) =>
            [o.source.seller, o.source.buyer].some((p) => principalVisibleTo(s, p, actorId)),
          ),
        ]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map(({ id, title, status, revision, acceptBy }) => ({
            id,
            title,
            status,
            revision,
            acceptBy,
          })),
        args,
      ),
    );
  if (name === 'trades.read' || name === 'trades.ledger') {
    const id = stringArg(args, 'id'),
      principalOrder = state.principalOrders?.orders[id];
    if (principalOrder) {
      if (
        ![principalOrder.source.seller, principalOrder.source.buyer].some((p) =>
          principalVisibleTo(s, p, actorId),
        )
      )
        throw new ToolRefusal('trade-order-not-found');
      if (name === 'trades.ledger')
        return result(
          pageItems(
            Object.values(state.principalOrders.receipts)
              .filter((r) => r.orderId === id)
              .sort((a, b) => a.previousRevision - b.previousRevision),
            args,
          ),
        );
      return result({
        ...principalOrder,
        policyVersion: state.principalOrders.policy.version,
        currentSource: principalPermitTradeEvidence(s.world, principalOrder.source.id) ?? null,
        sourceReadWith: 'town permits read --id ' + principalOrder.source.id,
        requestBase: {
          resourceKind: 'evidence-order',
          resourceId: id,
          resourceRevision: principalOrder.revision,
          controlVersion: 1,
        },
        operations: ['trades.accept', 'trades.withdraw', 'trades.observe'],
        operateWith: 'town principals operate --request <requestBase + operation>',
        effectBoundary:
          'Exact original subject accounts; recorded availability is not attendance or satisfaction.',
      });
    }
    const o = state.orders[id];
    if (!o || !readable(s, o, actorId)) throw new ToolRefusal('trade-order-not-found');
    if (name === 'trades.ledger')
      return result(
        pageItems(
          Object.values(state.receipts)
            .filter((r) => r.orderId === o.id)
            .sort((a, b) => a.orderRevision - b.orderRevision),
          args,
        ),
      );
    return result({
      ...o,
      currentSource: residentTradeEvidence(s.world, o.source) ?? null,
      sourceReadWith:
        o.source.kind === 'freight'
          ? `town freight read --id ${o.source.id}`
          : o.source.kind === 'permit'
            ? `town permits read --id ${o.source.id}`
            : `town engagements read --id ${o.source.id}`,
    });
  }
  return execute(s, m, actorId, name, args, requestId, personalControlAuthorization(actorId));
}
function collectiveArgs(s: OpenSocietyState, cid: string, action: CollectiveResourceAction) {
  if (!s.world.residentTrade || Object.hasOwn(action.arguments, 'id'))
    throw new ToolRefusal('invalid-collective-trade-action');
  const args = { ...action.arguments, id: action.resourceId },
    c = parseEvidenceTradeCommand(action.capability, args),
    o = s.world.residentTrade.orders[action.resourceId];
  let parties: readonly Controller[] = [];
  if (c.type === 'offer') {
    const evidence = residentTradeEvidence(s.world, c.source);
    if (evidence) parties = [evidence.basis.seller];
  } else if (o)
    parties =
      c.type === 'accept' || c.type === 'confirm'
        ? [o.source.buyer]
        : c.type === 'waive'
          ? [o.source.seller]
          : [o.source.seller, o.source.buyer];
  if (!parties.some((p) => p.kind === 'collective' && p.id === cid))
    throw new ToolRefusal('collective-trade-controller-mismatch');
  return args;
}
export function validateEvidenceTradeResourceAction(
  s: OpenSocietyState,
  cid: string,
  action: CollectiveResourceAction,
) {
  try {
    collectiveArgs(s, cid, action);
    return undefined;
  } catch (e) {
    return e instanceof ToolRefusal ? e.reason : 'invalid-collective-trade-action';
  }
}
export function executeApprovedEvidenceTradeResource(
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
    { kind: 'collective', id: cid },
  );
}
