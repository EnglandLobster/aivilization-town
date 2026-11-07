import {
  EVIDENCE_TRADE_POLICY_V2,
  advanceEvidenceTrade,
  applyEvidenceTradeCommit,
  decideEvidenceTrade,
  type EvidenceTradeCommand,
  type EvidenceTradeDecision,
  type EvidenceTradeEvent,
  type EvidenceTradePolicy,
  type TradeEvidenceRead,
} from '@aivilization/commerce';
import type { AccountingTransaction, CommonAccountEvent } from '@aivilization/economy';
import { createEventEnvelope } from '@aivilization/sim-core';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { residentEvidenceTradePorts, type EvidenceTradeAuthorization } from './evidenceTradePorts';
import { prepareEscrowCommonTransfers, residentEscrowIncoming } from './residentEscrowAccounting';
import { preparePaidPermitEffects, type PaidPermitEffects } from './evidencePermitTrade';
export type ResidentEvidenceTradePayload = {
  readonly policyVersion: EvidenceTradePolicy['version'];
  readonly actorId: string;
  readonly events: readonly EvidenceTradeEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly evidenceReads: readonly TradeEvidenceRead[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly paidPermit?: PaidPermitEffects;
};
type Context = {
  projection: WorldProjection;
  actorId: string;
  requestId: string;
  simulationId: string;
  nextSequence: number;
  authorization: EvidenceTradeAuthorization;
};
function wrap(input: Context, d: EvidenceTradeDecision) {
  if (!d.accepted) return d;
  if (!d.events.length) return { accepted: true as const, events: [] };
  const w = input.projection,
    residentTrade = applyEvidenceTradeCommit(
      w.residentTrade,
      d.events,
      d.transactions,
      d.evidenceReads,
    );
  const permit = preparePaidPermitEffects(w, input.actorId, d, input.authorization);
  if (!permit.accepted) return permit;
  const changed = d.events.find((e) => e.type === 'TradeOrderChanged');
  const accounting = prepareEscrowCommonTransfers({
    state: w.commonAccounts,
    context: residentTrade.policy.version === 'resident-evidence-trade-v2' ? 'trade-v2' : 'trade',
    referenceId: changed?.order.id ?? 'enable',
    actorId: input.actorId,
    at: w.clock.now,
    requestId: input.requestId,
    transactions: d.transactions,
  });
  if (!accounting.accepted) return accounting;
  for (const account of Object.values(accounting.state?.accounts ?? {}))
    if (
      account.balance + residentEscrowIncoming({ ...w, residentTrade }, account.id) >
      accounting.state!.policy.maxBalance + 1e-8
    )
      return {
        accepted: false as const,
        reason: 'trade-common-account-refund-or-revenue-capacity',
      };
  const payload: ResidentEvidenceTradePayload = {
    policyVersion: residentTrade.policy.version,
    actorId: input.actorId,
    events: d.events,
    transactions: d.transactions,
    evidenceReads: d.evidenceReads,
    commonAccountEvents: accounting.events,
    ...('effects' in permit && permit.effects ? { paidPermit: permit.effects } : {}),
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:trade`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        type: 'ResidentEvidenceTradeCommitted',
        payload,
      }),
    ],
  };
}
export function residentEvidenceTradeEvent(input: Context & { command: EvidenceTradeCommand }) {
  const w = input.projection;
  if (!w.residentTrade) return { accepted: false as const, reason: 'evidence-trade-not-enabled' };
  return wrap(
    input,
    decideEvidenceTrade(
      w.residentTrade,
      input.actorId,
      w.clock.now,
      input.command,
      residentEvidenceTradePorts(w, input.authorization),
    ),
  );
}
export function advanceResidentEvidenceTrade(input: Omit<Context, 'actorId' | 'authorization'>) {
  let projection = input.projection;
  const events: WorldEvent[] = [];
  for (const id of Object.keys(projection.residentTrade?.orders ?? {}).sort()) {
    const authorization = { authorize: () => undefined, controllerAvailable: () => false };
    const d = wrap(
      {
        ...input,
        projection,
        authorization,
        actorId: 'system',
        requestId: `${input.requestId}-${events.length}`,
        nextSequence: input.nextSequence + events.length,
      },
      advanceEvidenceTrade(
        projection.residentTrade!,
        id,
        projection.clock.now,
        residentEvidenceTradePorts(projection, authorization),
      ),
    );
    if (!d.accepted) throw Error(`trade-settlement-failed:${id}:${d.reason}`);
    for (const e of d.events) {
      projection = applyWorldEvent(projection, e);
      events.push(e);
    }
  }
  return events;
}
export function enableResidentEvidenceTradeEvent(
  input: Omit<Context, 'actorId' | 'authorization'> & { policy: EvidenceTradePolicy },
) {
  const w = input.projection;
  if (w.residentTrade)
    return { accepted: false as const, reason: 'evidence-trade-already-enabled' };
  if (!w.logistics || !w.serviceEngagements)
    return { accepted: false as const, reason: 'evidence-trade-physical-domains-required' };
  if (input.policy.version === 'resident-evidence-trade-v2' && !w.premisesRights)
    return { accepted: false as const, reason: 'paid-permit-rights-required' };
  const payload: ResidentEvidenceTradePayload = {
    policyVersion: input.policy.version,
    actorId: 'system',
    events: [{ type: 'EvidenceTradeEnabled', policy: input.policy }],
    transactions: [],
    evidenceReads: [],
    commonAccountEvents: [],
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:trade-enabled`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        type: 'ResidentEvidenceTradeCommitted',
        payload,
      }),
    ],
  };
}
export function upgradeResidentEvidenceTradeEvent(
  input: Omit<Context, 'actorId' | 'authorization'>,
) {
  if (input.projection.residentTrade?.policy.version !== 'resident-evidence-trade-v1')
    return { accepted: false as const, reason: 'trade-v1-required-for-upgrade' };
  if (!input.projection.premisesRights)
    return { accepted: false as const, reason: 'paid-permit-rights-required' };
  return wrap(
    {
      ...input,
      actorId: 'system',
      authorization: { authorize: () => undefined, controllerAvailable: () => false },
    },
    {
      accepted: true,
      events: [
        {
          type: 'EvidenceTradePolicyUpgraded',
          fromVersion: 'resident-evidence-trade-v1',
          policy: EVIDENCE_TRADE_POLICY_V2,
        },
      ],
      transactions: [],
      evidenceReads: [],
    },
  );
}
