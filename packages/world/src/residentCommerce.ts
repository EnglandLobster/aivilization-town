import {
  decideCommerce,
  type CommerceCommand,
  type CommerceEvent,
  type CommercePolicy,
  type StockTransfer,
} from '@aivilization/commerce';
import type { AccountingTransaction } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export type ResidentCommercePayload = {
  policyVersion: 'resident-commerce-v1';
  events: readonly CommerceEvent[];
  transactions: readonly AccountingTransaction[];
  stockTransfers: readonly StockTransfer[];
};
export function residentCommerceEvent(input: {
  projection: WorldProjection;
  actorId: string;
  command: CommerceCommand;
  requestId: string;
  simulationId: string;
  nextSequence: number;
  leaseSettlementId?: string;
  mobilitySettlementId?: string;
}): { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string } {
  if (
    'id' in input.command &&
    input.command.id.startsWith('lease-deposit-') &&
    input.leaseSettlementId !== input.command.id
  )
    return { accepted: false, reason: 'lease-deposit-controlled-by-lease' };
  if (
    input.projection.residentMobility &&
    'id' in input.command &&
    input.command.id.startsWith('ride-deposit-') &&
    input.mobilitySettlementId !== input.command.id
  )
    return { accepted: false, reason: 'ride-deposit-controlled-by-mobility' };
  const w = input.projection,
    s = w.residentCommerce;
  if (!s) return { accepted: false, reason: 'commerce-not-enabled' };
  const idle = (id: string) =>
    w.agents[id] !== undefined &&
    w.transitByAgent?.[id] === undefined &&
    (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now;
  const d = decideCommerce(
    s,
    input.actorId,
    w.clock.now,
    input.command,
    {
      exists: (id) => Object.hasOwn(w.agents, id),
      balance: (id) => w.agents[id]?.balance ?? 0,
      stock: (id, item) => w.agents[id]?.inventory[item] ?? 0,
      commodityExists: (name) =>
        Object.values(w.marketPools).some((pool) => pool.commodity === name),
      coLocated: (a, b) =>
        idle(a) &&
        idle(b) &&
        w.agents[a]?.locationId !== null &&
        w.agents[a]?.locationId === w.agents[b]?.locationId,
    },
    input.requestId,
  );
  if (!d.accepted) return d;
  return {
    accepted: true,
    events: [
      createEventEnvelope({
        id: input.requestId + ':commerce',
        simulationId: input.simulationId,
        type: 'ResidentCommerceCommitted',
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        payload: {
          policyVersion: 'resident-commerce-v1' as const,
          events: d.events,
          transactions: d.transactions,
          stockTransfers: d.stockTransfers,
        },
      }),
    ],
  };
}
export function enableResidentCommerceEvent(input: {
  simulationId: string;
  requestId: string;
  nextSequence: number;
  at: number;
  policy: CommercePolicy;
}): WorldEvent {
  return createEventEnvelope({
    id: input.requestId + ':commerce-enabled',
    simulationId: input.simulationId,
    type: 'ResidentCommerceCommitted',
    sequence: input.nextSequence,
    occurredAt: input.at,
    payload: {
      policyVersion: 'resident-commerce-v1' as const,
      events: [{ type: 'CommerceEnabled' as const, policy: input.policy }],
      transactions: [],
      stockTransfers: [],
    },
  });
}
