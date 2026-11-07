import { enterpriseRequiresManagement } from '@aivilization/enterprise';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  applyEnterpriseDomainEvent,
  decideEnterpriseControl,
  assertEnterpriseManagementAuthority,
} from '@aivilization/enterprise';
import type { ControlCommand, Controller, ControlAuthorizationPort } from '@aivilization/authority';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export function enterpriseControlEvent(input: {
  projection: WorldProjection;
  actorId: string;
  enterpriseId: string;
  command: ControlCommand;
  authorize: ControlAuthorizationPort;
  available: (controller: Controller) => boolean;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}) {
  const e = input.projection.enterprises[input.enterpriseId];
  if (!e || !input.projection.agents[input.actorId])
    return { accepted: false as const, reason: 'enterprise-control-actor-or-resource-missing' };
  const d = decideEnterpriseControl({
    enterprise: e,
    actorId: input.actorId,
    at: input.projection.clock.now,
    command: input.command,
    authorize: input.authorize,
    available: (c) =>
      c.kind === 'resident' ? !!input.projection.agents[c.id] : input.available(c),
  });
  if (!d.accepted) return d;
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:enterprise-control`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: input.projection.clock.now,
        type: 'ResidentEnterpriseControlCommitted',
        payload: { actorId: input.actorId, event: d.event },
      }),
    ],
  };
}
export function applyEnterpriseControlProjection(
  w: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  if (event.type !== 'ResidentEnterpriseControlCommitted') return undefined;
  const p = event.payload,
    e = w.enterprises[p.event.enterpriseId];
  if (
    !e ||
    !w.agents[p.actorId] ||
    p.event.control.changedBy !== p.actorId ||
    p.event.control.at !== event.occurredAt ||
    event.occurredAt !== w.clock.now
  )
    throw Error('enterprise-control-world-source-mismatch');
  return {
    ...w,
    enterprises: { ...w.enterprises, [e.enterpriseId]: applyEnterpriseDomainEvent(e, p.event) },
  };
}

/** Shared event audit for financial effects; it never recalculates prices or business outcomes. */
export function assertEnterpriseOperationSource(w: WorldProjection, event: WorldEvent) {
  if (
    event.type !== 'TradeExecuted' &&
    event.type !== 'ExternalTradeExecuted' &&
    event.type !== 'CommodityProduced'
  )
    return;
  const p = event.payload;
  const enterpriseId =
    event.type === 'ExternalTradeExecuted'
      ? 'enterpriseId' in event.payload.trader
        ? event.payload.trader.enterpriseId
        : undefined
      : event.payload.enterpriseId;
  const e = enterpriseId ? w.enterprises[enterpriseId] : undefined;
  if (!e || !enterpriseRequiresManagement(e)) return;
  const operation =
    event.type === 'TradeExecuted'
      ? 'trade'
      : event.type === 'CommodityProduced'
        ? 'produce'
        : event.payload.direction;
  assertEnterpriseManagementAuthority(e, p.managementAuthority, operation);
  if (
    event.type !== 'ExternalTradeExecuted' &&
    event.payload.agentId !== p.managementAuthority!.actorId
  )
    throw Error('enterprise-operation-actor-mismatch');
}
