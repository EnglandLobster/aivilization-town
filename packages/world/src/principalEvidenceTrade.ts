import {
  samePrincipal,
  samePrincipalRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  PRINCIPAL_EVIDENCE_TRADE_POLICY,
  EVIDENCE_TRADE_ESCROW,
  decidePrincipalEvidenceTrade,
  advancePrincipalEvidenceTrade,
  applyPrincipalEvidenceTradeCommit,
  evidenceTradeEscrowBalance,
  principalTradeRequest,
  tradeFactsEqual,
  type PrincipalTradeEvent,
  type PrincipalTradeDecision,
} from '@aivilization/commerce';
import { enablePublicPrincipalTradeAuthority } from '@aivilization/governance';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import { applyWorldEventWithPrincipalAuthority } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  assertWorldPrincipalOperationSource,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import {
  principalEvidenceTradePorts,
  principalPermitTradeEvidence,
  principalTradeAccount,
} from './principalTradePorts';
import { decodePrincipalTradeOperation } from './principalTradeCommandCodec';
import {
  preparePrincipalPaidPermitEffects,
  applyPrincipalPaidPermitEffects,
  type PrincipalPaidPermitEffects,
} from './principalPermitTradeEffects';
import {
  preparePrincipalTradeEnterpriseEffects,
  type PrincipalTradeEnterpriseEffect,
} from './principalTradeEnterpriseAccounting';
import {
  prepareEscrowCommonTransfers,
  applyEscrowAccounting,
  residentEscrowIncoming,
} from './residentEscrowAccounting';

export type ResidentPrincipalEvidenceTradePayload = {
  readonly policyVersion: typeof PRINCIPAL_EVIDENCE_TRADE_POLICY.version;
  readonly actorId: string;
  readonly events: readonly PrincipalTradeEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly enterpriseEvents: readonly PrincipalTradeEnterpriseEffect[];
  readonly paidPermit?: PrincipalPaidPermitEffects;
};
type Context = {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
  readonly publicPrincipalExecution?: PublicPrincipalExecution;
};
function wrap(input: Context, payload: ResidentPrincipalEvidenceTradePayload): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:principal-trade`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentPrincipalEvidenceTradeCommitted',
    payload,
  });
}
const no = (reason: string) => ({ accepted: false as const, reason });
function prepare(input: Context, actorId: string, d: PrincipalTradeDecision) {
  if (!d.accepted) return d;
  if (!d.events.length) return { accepted: true as const, events: [] };
  try {
    const event = d.events[0]!;
    if (d.events.length !== 1) throw Error('principal-trade-single-packet-required');
    const common = prepareEscrowCommonTransfers({
      state: input.projection.commonAccounts,
      context: 'trade-v3',
      referenceId: event.type === 'PrincipalTradeCommitted' ? event.order.id : 'enable',
      actorId,
      at: input.projection.clock.now,
      requestId: input.requestId,
      transactions: d.transactions,
    });
    if (!common.accepted) return common;
    const paidPermit = preparePrincipalPaidPermitEffects(
      input.projection,
      event,
      input.collective,
      input.publicPrincipalExecution,
    );
    const payload: ResidentPrincipalEvidenceTradePayload = {
      policyVersion: PRINCIPAL_EVIDENCE_TRADE_POLICY.version,
      actorId,
      events: d.events,
      transactions: d.transactions,
      commonAccountEvents: common.events,
      enterpriseEvents:
        event.type === 'PrincipalTradeCommitted'
          ? preparePrincipalTradeEnterpriseEffects(input.projection, event.order)
          : [],
      ...(paidPermit ? { paidPermit } : {}),
    };
    const e = wrap(input, payload);
    applyPrincipalEvidenceTradeProjection(
      input.projection,
      e,
      input.publicPrincipalExecution,
      input.collective,
    );
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-principal-trade-operation');
  }
}
export function enablePrincipalEvidenceTradeEvent(input: Context) {
  return prepare(input, 'system', {
    accepted: true,
    events: [{ type: 'PrincipalEvidenceTradeEnabled', policy: PRINCIPAL_EVIDENCE_TRADE_POLICY }],
    transactions: [],
  });
}
export function residentPrincipalTradeOperation(
  input: Context & { readonly actorId: string; readonly request: PrincipalOperationRequest },
) {
  const w = input.projection;
  if (!w.residentTrade?.principalOrders) return no('principal-trade-not-enabled');
  try {
    const c = decodePrincipalTradeOperation(input.request),
      evidence = principalPermitTradeEvidence(
        w,
        c.type === 'offer'
          ? c.source.id
          : (w.residentTrade.principalOrders.orders[c.id]?.source.id ?? ''),
      );
    if (!samePrincipalRequest(principalTradeRequest(w.residentTrade, c, evidence), input.request))
      return no('principal-trade-version-or-resource-conflict');
    return prepare(
      input,
      input.actorId,
      decidePrincipalEvidenceTrade(
        w.residentTrade,
        input.actorId,
        w.clock.now,
        c,
        principalEvidenceTradePorts(
          w,
          input.actorId,
          input.collective,
          input.publicPrincipalExecution,
        ),
      ),
    );
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-principal-trade-operation');
  }
}
export function advanceResidentPrincipalEvidenceTrade(input: Context): readonly WorldEvent[] {
  let projection = input.projection;
  const events: WorldEvent[] = [];
  for (const id of Object.keys(projection.residentTrade?.principalOrders?.orders ?? {}).sort()) {
    const d = prepare(
      {
        ...input,
        projection,
        requestId: `${input.requestId}-${events.length}`,
        nextSequence: input.nextSequence + events.length,
      },
      'system',
      advancePrincipalEvidenceTrade(projection.residentTrade!, id, projection.clock.now, {
        evidence: (id) => principalPermitTradeEvidence(projection, id),
      }),
    );
    if (!d.accepted) throw Error(`principal-trade-settlement-failed:${id}:${d.reason}`);
    for (const e of d.events) {
      projection = applyWorldEventWithPrincipalAuthority(projection, e, input.collective);
      events.push(e);
    }
  }
  return events;
}
/** Source authorization, owning permit facts, all accounts and all child effects must agree before any state is returned. */
export function applyPrincipalEvidenceTradeProjection(
  w: WorldProjection,
  e: WorldEvent,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentPrincipalEvidenceTradeCommitted') return undefined;
  const p = e.payload,
    parent = w.residentTrade,
    event = p.events[0];
  if (
    !parent ||
    !w.premisesRights?.principalPolicy ||
    !w.premises?.resourcePrincipals ||
    p.policyVersion !== PRINCIPAL_EVIDENCE_TRADE_POLICY.version ||
    e.occurredAt !== w.clock.now ||
    p.events.length !== 1 ||
    !event
  )
    throw Error('invalid-principal-trade-world-packet');
  if (event.type === 'PrincipalEvidenceTradeEnabled') {
    if (
      p.actorId !== 'system' ||
      p.transactions.length ||
      p.commonAccountEvents.length ||
      p.enterpriseEvents.length ||
      p.paidPermit ||
      !w.publicGovernance?.authority.grant.principalPermits
    )
      throw Error('invalid-principal-trade-world-activation');
    return {
      ...w,
      residentTrade: applyPrincipalEvidenceTradeCommit(parent, p.events, p.transactions),
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicPrincipalTradeAuthority(w.publicGovernance.authority),
      },
    };
  }
  const { receipt, order } = event,
    actual = principalPermitTradeEvidence(w, order.source.id);
  if (
    !actual ||
    !tradeFactsEqual(actual, event.evidence) ||
    receipt.actorId !== p.actorId ||
    receipt.at !== w.clock.now
  )
    throw Error('principal-trade-owning-domain-evidence-mismatch');
  if (receipt.side !== 'system') {
    if (
      !receipt.authorization ||
      !w.agents[p.actorId] ||
      !worldPrincipalAvailable(w, receipt.authorization.principal, collective)
    )
      throw Error('principal-trade-actual-authority-required');
    assertWorldPrincipalOperationSource(w, receipt.authorization, execution, collective);
  } else if (p.actorId !== 'system') throw Error('principal-trade-system-author-required');
  for (const side of ['payer', 'revenue'] as const) {
    const account = principalTradeAccount(w, order[side]),
      principal = order.source[side === 'payer' ? 'buyer' : 'seller'];
    if (
      !account ||
      !samePrincipal(account.principal, principal) ||
      !Number.isFinite(account.balance) ||
      account.balance < 0 ||
      (['offer', 'accept'].includes(receipt.operation) &&
        (account.status !== 'open' || !worldPrincipalAvailable(w, principal, collective)))
    )
      throw Error('principal-trade-actual-account-required');
  }
  const residentTrade = applyPrincipalEvidenceTradeCommit(parent, p.events, p.transactions);
  if (!tradeFactsEqual(preparePrincipalTradeEnterpriseEffects(w, order), p.enterpriseEvents))
    throw Error('principal-trade-enterprise-source-mismatch');
  const after = applyPrincipalPaidPermitEffects(w, event, p.paidPermit, collective, execution);
  const accounting = applyEscrowAccounting({
    world: w,
    context: 'trade-v3',
    referenceIds: [order.id],
    actorId: p.actorId,
    transactions: p.transactions,
    commonEvents: p.commonAccountEvents,
    tradeEnterpriseEvents: p.enterpriseEvents,
    escrowAccount: EVIDENCE_TRADE_ESCROW,
    beforeEscrow: evidenceTradeEscrowBalance(parent),
    afterEscrow: evidenceTradeEscrowBalance(residentTrade),
    allowTreasury: !!w.publicGovernance?.authority.grant.principalTrade,
  });
  if (
    receipt.operation === 'accept' &&
    order.payer.sector === 'treasury' &&
    (accounting.treasury ?? 0) < (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0)
  )
    throw Error('principal-trade-treasury-reserve-violated');
  const next = {
    ...after,
    residentTrade,
    agents: accounting.agents,
    enterprises: accounting.enterprises,
    ...(accounting.common ? { commonAccounts: accounting.common } : {}),
    ...(accounting.treasury === undefined ? {} : { treasury: accounting.treasury }),
  };
  for (const account of Object.values(next.commonAccounts?.accounts ?? {}))
    if (
      account.balance + residentEscrowIncoming(next, account.id) >
      next.commonAccounts!.policy.maxBalance + 1e-8
    )
      throw Error('principal-trade-common-account-refund-or-revenue-capacity');
  return next;
}
