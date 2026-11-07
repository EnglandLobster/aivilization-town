import {
  applyEvidenceTradeCommit,
  EVIDENCE_TRADE_ESCROW,
  evidenceTradeEscrowBalance,
  tradeFactsEqual,
} from '@aivilization/commerce';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
import { residentTradeEvidence } from '../evidenceTradePorts';
import { applyEscrowAccounting } from '../residentEscrowAccounting';
import { applyPaidPermitEffects } from '../evidencePermitTrade';
import type { PublicGoodsFundingProof } from '../publicGoodsProcurement';
export function applyEvidenceTradeProjection(
  w: WorldProjection,
  e: WorldEvent,
  fundingProof?: PublicGoodsFundingProof,
): WorldProjection | undefined {
  if (e.type !== 'ResidentEvidenceTradeCommitted') return undefined;
  const p = e.payload;
  if (p.events.some((e) => e.type === 'TradePublicFundingEnabled'))
    throw Error('public-trade-funding-needs-explicit-world-activation');
  const funding = p.events.find(
    (e) => e.type === 'TradeReceiptRecorded' && e.receipt.operation === 'fund',
  );
  if (funding || fundingProof) {
    const changed = p.events[0];
    if (
      !fundingProof ||
      !funding ||
      funding.type !== 'TradeReceiptRecorded' ||
      p.events.length !== 2 ||
      changed?.type !== 'TradeOrderChanged' ||
      changed.order.id !== fundingProof.orderId ||
      changed.order.revision !== fundingProof.expectedRevision + 1 ||
      changed.order.amount !== fundingProof.amount ||
      changed.order.fundingDecisionId !== fundingProof.proposalId ||
      changed.order.status !== 'funded' ||
      changed.order.payer.sector !== 'treasury' ||
      funding.receipt.role !== 'public-funder' ||
      funding.receipt.decisionId !== fundingProof.proposalId ||
      p.actorId !== fundingProof.actorId ||
      p.paidPermit
    )
      throw Error('exact-public-goods-composite-event-required');
  }
  if (
    !['resident-evidence-trade-v1', 'resident-evidence-trade-v2'].includes(p.policyVersion) ||
    e.occurredAt !== w.clock.now
  )
    throw Error('invalid-evidence-trade-version-or-time');
  // Never accept a claim echoed from the incoming event as independent proof.
  for (const read of p.evidenceReads) {
    const actual = residentTradeEvidence(w, read.evidence.basis);
    if (!actual || !tradeFactsEqual(actual, read.evidence))
      throw Error('trade-owning-domain-evidence-mismatch');
  }
  const residentTrade = applyEvidenceTradeCommit(
    w.residentTrade,
    p.events,
    p.transactions,
    p.evidenceReads,
  );
  if (residentTrade.policy.version !== p.policyVersion)
    throw Error('trade-policy-envelope-mismatch');
  if (
    p.events.some(
      (v) => v.type === 'EvidenceTradeEnabled' || v.type === 'EvidenceTradePolicyUpgraded',
    ) &&
    (p.actorId !== 'system' ||
      !w.logistics ||
      !w.serviceEngagements ||
      p.commonAccountEvents.length ||
      (p.policyVersion === 'resident-evidence-trade-v2' && !w.premisesRights))
  )
    throw Error('invalid-evidence-trade-enablement');
  for (const event of p.events)
    if (
      event.type === 'TradeReceiptRecorded' &&
      (event.receipt.actorId !== p.actorId || event.receipt.at !== w.clock.now)
    )
      throw Error('trade-receipt-actor-or-time-mismatch');
  const rightsWorld = applyPaidPermitEffects(w, p.actorId, p.events, p.paidPermit);
  const { agents, common, treasury } = applyEscrowAccounting({
    world: w,
    context: p.policyVersion === 'resident-evidence-trade-v2' ? 'trade-v2' : 'trade',
    actorId: p.actorId,
    referenceIds: p.events.filter((v) => v.type === 'TradeOrderChanged').map((v) => v.order.id),
    transactions: p.transactions,
    commonEvents: p.commonAccountEvents,
    escrowAccount: EVIDENCE_TRADE_ESCROW,
    beforeEscrow: evidenceTradeEscrowBalance(w.residentTrade),
    afterEscrow: evidenceTradeEscrowBalance(residentTrade),
    allowTreasury: !!w.residentTrade?.publicFunding,
  });
  if (funding && (treasury ?? 0) < (w.governance?.publicBudget?.minimumTreasuryReserve ?? 0))
    throw Error('public-goods-treasury-reserve-violated');
  return {
    ...rightsWorld,
    residentTrade,
    agents,
    ...(treasury === undefined ? {} : { treasury }),
    ...(common ? { commonAccounts: common } : {}),
  };
}
