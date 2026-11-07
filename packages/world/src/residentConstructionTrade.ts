import { enablePublicConstructionTradeAuthority } from '@aivilization/governance';
import type { PrincipalOperationRequest } from '@aivilization/authority';
import { decodeConstructionTradeOperation } from './constructionTradeCommandCodec';
import { samePrincipal } from '@aivilization/authority';
import {
  CONSTRUCTION_TRADE_POLICY,
  emptyConstructionTradeState,
  applyConstructionTradeEvent,
  decideConstructionTrade,
  expireConstructionTradeOffers,
  evidenceTradeEscrowBalance,
  tradeFactsEqual,
  EVIDENCE_TRADE_ESCROW,
  type ConstructionTradeCommand,
  type ConstructionTradeEvent,
  type ConstructionTradeDecision,
  type ConstructionTradePorts,
} from '@aivilization/commerce';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  assertWorldPrincipalOperationSource,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import {
  residentConstructionTradeEvidence,
  constructionTradeAccount,
} from './constructionTradePorts';
import {
  prepareConstructionTradeEnterpriseEffects,
  assertConstructionTradeEnterpriseEffects,
} from './constructionTradeEnterpriseAccounting';
import type { PrincipalTradeEnterpriseEffect } from './principalTradeEnterpriseAccounting';
import {
  prepareEscrowCommonTransfers,
  applyEscrowAccounting,
  residentEscrowIncoming,
} from './residentEscrowAccounting';
export type ResidentConstructionTradePayload = {
  readonly policyVersion: typeof CONSTRUCTION_TRADE_POLICY.version;
  readonly actorId: string;
  readonly enable?: true;
  readonly enablePublicAuthority?: true;
  readonly events: readonly ConstructionTradeEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly enterpriseEvents: readonly PrincipalTradeEnterpriseEffect[];
};
type Context = {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
  readonly publicPrincipalExecution?: PublicPrincipalExecution;
};
const no = (reason: string) => ({ accepted: false as const, reason });
function ports(input: Context, actorId: string, orderId?: string): ConstructionTradePorts {
  const w = input.projection;
  return {
    exists: (id) => !!w.agents[id],
    evidence: (id) => residentConstructionTradeEvidence(w, id),
    authorize: (p, r) =>
      authorizeWorldPrincipalOperation(
        w,
        actorId,
        p,
        r,
        input.publicPrincipalExecution,
        input.collective,
      ),
    account: (a) => {
      const account = constructionTradeAccount(w, a);
      if (!account) return undefined;
      const own = w.residentTrade?.constructionOrders?.orders[orderId ?? ''];
      const ownReserve =
        own && [own.payer, own.revenue].some((x) => tradeFactsEqual(x, a))
          ? own.escrowMicros / 1e6
          : 0;
      const incomingCapacity =
        a.sector === 'collective'
          ? Math.max(
              0,
              (w.commonAccounts?.policy.maxBalance ?? 0) -
                account.balance -
                residentEscrowIncoming(w, a.id) +
                ownReserve,
            )
          : CONSTRUCTION_TRADE_POLICY.maxAmount;
      const availableUnits = (value: number) =>
        Math.floor(Math.min(CONSTRUCTION_TRADE_POLICY.maxAmount, Math.max(0, value)) * 1e6) / 1e6;
      return {
        ...account,
        balance: availableUnits(account.balance),
        incomingCapacity: availableUnits(incomingCapacity),
      };
    },
  };
}
function wrap(input: Context, payload: ResidentConstructionTradePayload): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:construction-trade`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentConstructionTradeCommitted',
    payload,
  });
}
function prepare(input: Context, actorId: string, d: ConstructionTradeDecision) {
  if (!d.accepted) return d;
  if (!d.events.length) return { accepted: true as const, events: [] };
  try {
    if (d.events.length !== 1) throw Error('construction-trade-single-packet-required');
    const e = d.events[0]!,
      old = input.projection.residentTrade?.constructionOrders;
    if (!old) throw Error('construction-trade-not-enabled');
    const state = applyConstructionTradeEvent(old, e);
    const common = prepareEscrowCommonTransfers({
      state: input.projection.commonAccounts,
      context: 'construction-trade',
      referenceId: e.order.id,
      actorId,
      at: input.projection.clock.now,
      requestId: input.requestId,
      transactions: d.transactions,
    });
    if (!common.accepted) return common;
    const payload: ResidentConstructionTradePayload = {
      policyVersion: CONSTRUCTION_TRADE_POLICY.version,
      actorId,
      events: d.events,
      transactions: d.transactions,
      commonAccountEvents: common.events,
      enterpriseEvents: prepareConstructionTradeEnterpriseEffects(input.projection, state, e.order),
    };
    const event = wrap(input, payload);
    applyConstructionTradeProjection(
      input.projection,
      event,
      input.publicPrincipalExecution,
      input.collective,
    );
    return { accepted: true as const, events: [event] };
  } catch (e) {
    return no(e instanceof Error ? e.message : 'invalid-construction-trade-world-packet');
  }
}
export function enableResidentConstructionTradeEvent(
  input: Context & { readonly enablePublicAuthority?: true },
) {
  try {
    const event = wrap(input, {
      policyVersion: CONSTRUCTION_TRADE_POLICY.version,
      actorId: 'system',
      enable: true,
      ...(input.enablePublicAuthority ? { enablePublicAuthority: true as const } : {}),
      events: [],
      transactions: [],
      commonAccountEvents: [],
      enterpriseEvents: [],
    });
    applyConstructionTradeProjection(input.projection, event);
    return { accepted: true as const, events: [event] };
  } catch (e) {
    return no(e instanceof Error ? e.message : 'construction-trade-enable-failed');
  }
}
export function residentConstructionTradeOperation(
  input: Context & { readonly actorId: string; readonly command: ConstructionTradeCommand },
) {
  const state = input.projection.residentTrade?.constructionOrders;
  if (!state) return no('construction-trade-not-enabled');
  return prepare(
    input,
    input.actorId,
    decideConstructionTrade(
      state,
      input.actorId,
      input.projection.clock.now,
      input.requestId,
      input.command,
      ports(input, input.actorId, input.command.type === 'offer' ? undefined : input.command.id),
    ),
  );
}
export function advanceResidentConstructionTrade(input: Context): readonly WorldEvent[] {
  let projection = input.projection;
  const events: WorldEvent[] = [];
  const state = projection.residentTrade?.constructionOrders;
  if (!state) return events;
  const d = expireConstructionTradeOffers(state, projection.clock.now);
  if (!d.accepted) throw Error(d.reason);
  for (const e of d.events) {
    const result = prepare(
      {
        ...input,
        projection,
        requestId: `${input.requestId}-${events.length}`,
        nextSequence: input.nextSequence + events.length,
      },
      'system',
      { accepted: true, events: [e], transactions: [] },
    );
    if (!result.accepted) throw Error(result.reason);
    for (const event of result.events) {
      projection = applyConstructionTradeProjection(projection, event)!;
      events.push(event);
    }
  }
  return events;
}
/** Replay corroborates independent premises and authority facts before publishing accounts and the order together. */
export function applyConstructionTradeProjection(
  w: WorldProjection,
  event: WorldEvent,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (event.type !== 'ResidentConstructionTradeCommitted') return undefined;
  const p = event.payload,
    parent = w.residentTrade;
  if (
    !parent ||
    !w.premises ||
    p.policyVersion !== CONSTRUCTION_TRADE_POLICY.version ||
    event.occurredAt !== w.clock.now
  )
    throw Error('invalid-construction-trade-world-version');
  if (p.enable) {
    if (
      parent.constructionOrders ||
      p.actorId !== 'system' ||
      p.events.length ||
      p.transactions.length ||
      p.commonAccountEvents.length ||
      p.enterpriseEvents.length
    )
      throw Error('invalid-construction-trade-enablement');
    return {
      ...w,
      ...(p.enablePublicAuthority
        ? {
            publicGovernance: (() => {
              if (!w.publicGovernance) throw Error('public-governance-required');
              return {
                ...w.publicGovernance,
                authority: enablePublicConstructionTradeAuthority(w.publicGovernance.authority),
              };
            })(),
          }
        : {}),
      residentTrade: { ...parent, constructionOrders: emptyConstructionTradeState() },
    };
  }
  const e = p.events[0],
    old = parent.constructionOrders;
  if (
    p.enablePublicAuthority ||
    !old ||
    p.events.length !== 1 ||
    !e ||
    e.actorId !== p.actorId ||
    e.order.at !== w.clock.now ||
    !tradeFactsEqual(e.transactions, p.transactions)
  )
    throw Error('invalid-construction-trade-world-packet');
  const actual = residentConstructionTradeEvidence(w, e.order.projectId);
  if (e.type === 'ConstructionTradeCommitted') {
    if (!actual || !tradeFactsEqual(actual, e.order.evidence))
      throw Error('construction-trade-owning-source-mismatch');
    assertWorldPrincipalOperationSource(w, e.authorization, execution, collective);
    if (parent.orders[e.order.id] || parent.principalOrders?.orders[e.order.id])
      throw Error('construction-trade-order-id-conflict');
  } else {
    if (p.actorId !== 'system') throw Error('construction-trade-expiry-author-required');
  }
  for (const side of e.type === 'ConstructionTradeCommitted'
    ? (['payer', 'revenue'] as const)
    : []) {
    const a = constructionTradeAccount(w, e.order[side]);
    if (
      !a ||
      !samePrincipal(a.principal, e.order[side === 'payer' ? 'buyer' : 'seller']) ||
      (e.type === 'ConstructionTradeCommitted' &&
        ['offer', 'accept'].includes(e.command.type) &&
        a.status !== 'open')
    )
      throw Error('construction-trade-account-or-public-grant-required');
  }
  const state = applyConstructionTradeEvent(old, e),
    residentTrade = { ...parent, constructionOrders: state };
  assertConstructionTradeEnterpriseEffects(w, state, e.order, p.enterpriseEvents);
  const accounting = applyEscrowAccounting({
    world: w,
    context: 'construction-trade',
    referenceIds: [e.order.id],
    actorId: p.actorId,
    transactions: p.transactions,
    commonEvents: p.commonAccountEvents,
    tradeEnterpriseEvents: p.enterpriseEvents,
    allowTreasury: !!w.publicGovernance?.authority.grant.constructionTrade,
    escrowAccount: EVIDENCE_TRADE_ESCROW,
    beforeEscrow: evidenceTradeEscrowBalance(parent),
    afterEscrow: evidenceTradeEscrowBalance(residentTrade),
  });
  if (
    e.order.payer.sector === 'treasury' &&
    p.transactions.some((t) =>
      t.entries.some((v) => v.account.sector === 'treasury' && v.amount < 0),
    ) &&
    (accounting.treasury ?? 0) < (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0)
  )
    throw Error('construction-trade-treasury-reserve-violated');
  const next = {
    ...w,
    residentTrade,
    agents: accounting.agents,
    enterprises: accounting.enterprises,
    ...(accounting.treasury === undefined ? {} : { treasury: accounting.treasury }),
    ...(accounting.common ? { commonAccounts: accounting.common } : {}),
  };
  for (const a of Object.values(next.commonAccounts?.accounts ?? {}))
    if (
      a.balance + residentEscrowIncoming(next, a.id) >
      next.commonAccounts!.policy.maxBalance + 1e-8
    )
      throw Error('construction-trade-reserved-capacity-exceeded');
  return next;
}

/** Shared exact operation boundary for resident, collective and public adapters. */
export function residentConstructionTradeRequestOperation(
  input: Context & { readonly actorId: string; readonly request: PrincipalOperationRequest },
) {
  try {
    return residentConstructionTradeOperation({
      ...input,
      command: decodeConstructionTradeOperation(input.request),
    });
  } catch (e) {
    return no(e instanceof Error ? e.message : 'invalid-construction-trade-command');
  }
}
