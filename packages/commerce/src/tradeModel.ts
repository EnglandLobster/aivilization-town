import type { ConstructionTradeState } from './constructionTradeModel';
import type { PrincipalTradeState } from './principalTradeModel';
import type { Controller, ControlAuthorizationPort } from '@aivilization/authority';
import type { AccountingTransaction, Inventory } from '@aivilization/economy';

export const EVIDENCE_TRADE_POLICY = {
  version: 'resident-evidence-trade-v1',
  maxOrders: 10000,
  maxPerSeller: 500,
  maxAmount: 1000000,
  maxTermsChars: 8000,
  maxStatements: 32,
  maxWindowMs: 30 * 86400000,
} as const;
export const EVIDENCE_TRADE_POLICY_V2 = {
  ...EVIDENCE_TRADE_POLICY,
  version: 'resident-evidence-trade-v2',
} as const;
export type EvidenceTradePolicy = typeof EVIDENCE_TRADE_POLICY | typeof EVIDENCE_TRADE_POLICY_V2;
export type TradeAccount = { readonly sector: 'agent' | 'collective'; readonly id: string };
export type TradePayer =
  | TradeAccount
  | { readonly sector: 'treasury'; readonly id: 'public-treasury' };
export const TRADE_PUBLIC_FUNDING_POLICY = {
  version: 'resident-trade-public-funding-v1',
  treasuryId: 'public-treasury',
  sourceKind: 'freight',
  visibility: 'public-terms-and-ledger',
} as const;
export type TradeSourceRef = {
  readonly kind: 'freight' | 'service' | 'permit';
  readonly id: string;
};
type SourceParties = {
  readonly id: string;
  readonly seller: Controller;
  readonly buyer: Controller;
  readonly createdAt: number;
};
export type FreightTradeBasis = SourceParties & {
  readonly kind: 'freight';
  readonly sourceStockId: string;
  readonly destinationStockId: string;
  readonly sourceLocationId: string;
  readonly destinationLocationId: string;
  readonly items: Inventory;
  readonly deadline: number;
};
export type ServiceTradeBasis = SourceParties & {
  readonly kind: 'service';
  readonly providerId: string;
  readonly recipientId: string;
  readonly locationId: string;
  readonly pricePerHour: number;
  readonly maxDurationMs: number;
  readonly startAt: number;
  readonly endAt: number;
};
/** Immutable commercial reference to an owning-domain permission; this grants no right by itself. */
export type PermitTradeBasis = SourceParties & {
  readonly kind: 'permit';
  readonly buildingId: string;
  readonly issuerVersion: number;
  readonly users: readonly string[];
  readonly scopes: readonly ('entry' | 'operate' | 'store' | 'reside')[];
  readonly mode: 'shared' | 'exclusive';
  readonly title: string;
  readonly terms: string;
  readonly startAt: number;
  readonly endAt: number;
  readonly acceptBy: number;
};
export type PermitTradeEvidence = {
  readonly basis: PermitTradeBasis;
  readonly sourceVersion: 'premises-provision-v1';
  readonly revision: number;
  readonly permitRevision: number;
  readonly at: number;
  readonly status: 'offered' | 'accepted' | 'withdrawn' | 'released' | 'expired';
  readonly acceptedAt?: number;
  readonly closedAt?: number;
  readonly provision?: {
    readonly orderId: string;
    readonly revision: number;
    readonly settledAt: number;
    readonly availableMs: number;
    readonly unavailableMs: number;
  };
};
export type TradeBasis = FreightTradeBasis | ServiceTradeBasis | PermitTradeBasis;
/** Only owning-domain adapters construct these facts. They are never resident-supplied proof. */
export type TradeEvidence =
  | PermitTradeEvidence
  | {
      readonly basis: FreightTradeBasis;
      readonly sourceVersion: 'resident-logistics-v1';
      readonly revision: number;
      readonly at: number;
      readonly status:
        | 'offered'
        | 'accepted'
        | 'funded'
        | 'loaded'
        | 'return-required'
        | 'delivered'
        | 'returned'
        | 'cancelled';
    }
  | {
      readonly basis: ServiceTradeBasis;
      readonly sourceVersion: 'resident-service-engagements-v1';
      readonly revision: number;
      readonly at: number;
      readonly status: 'offered' | 'accepted' | 'funded' | 'ended';
      readonly progressMs: number;
      readonly hasPresence: boolean;
    };
export type TradeTerms = {
  readonly id: string;
  readonly title: string;
  readonly terms: string;
  readonly source: TradeBasis;
  readonly payer: TradePayer;
  readonly revenue: TradeAccount;
  readonly amount: number;
  readonly acceptBy: number;
};
export type TradeStatus =
  | 'offered'
  | 'accepted'
  | 'funded'
  | 'awaiting-confirmation'
  | 'disputed'
  | 'completed'
  | 'refunded'
  | 'settled'
  | 'cancelled'
  | 'expired';
export type TradeRole = 'seller' | 'buyer';
export type TradeOrder = TradeTerms & {
  readonly fundingDecisionId?: string;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly revision: number;
  readonly at: number;
  readonly status: TradeStatus;
  readonly evidence: TradeEvidence;
  readonly resolved: boolean;
  readonly funded: number;
  readonly earned: number;
  readonly escrow: number;
  readonly paid: number;
  readonly refunded: number;
  readonly statements: readonly {
    readonly authorId: string;
    readonly role: TradeRole;
    readonly kind: 'dispute' | 'settlement';
    readonly content: string;
    readonly at: number;
  }[];
  readonly settlement?: {
    readonly role: TradeRole;
    readonly authorId: string;
    readonly refund: number;
    readonly terms: string;
    readonly orderRevision: number;
    readonly status: 'proposed' | 'accepted' | 'declined';
  };
};
export type TradeOperation =
  | 'offer'
  | 'fund'
  | 'accept'
  | 'withdraw'
  | 'expire'
  | 'observe'
  | 'confirm'
  | 'dispute'
  | 'propose-settlement'
  | 'respond-settlement'
  | 'waive';
export type TradeReceipt = {
  readonly settlement?: {
    readonly fromStatus: TradeStatus | null;
    readonly toStatus: TradeStatus;
    readonly funded: number;
    readonly paid: number;
    readonly refunded: number;
    readonly escrowBefore: number;
    readonly escrowAfter: number;
  };
  readonly id: string;
  readonly orderId: string;
  readonly orderRevision: number;
  readonly actorId: string;
  readonly role: TradeRole | 'system' | 'public-funder';
  readonly decisionId?: string;
  readonly operation: TradeOperation;
  readonly at: number;
  readonly content?: string;
  readonly refund?: number;
  readonly accept?: boolean;
};
export type TradeEvidenceRead = { readonly receiptId: string; readonly evidence: TradeEvidence };
export type EvidenceTradeEvent =
  | {
      readonly type: 'TradePublicFundingEnabled';
      readonly policy: typeof TRADE_PUBLIC_FUNDING_POLICY;
    }
  | { readonly type: 'EvidenceTradeEnabled'; readonly policy: EvidenceTradePolicy }
  | {
      readonly type: 'EvidenceTradePolicyUpgraded';
      readonly fromVersion: 'resident-evidence-trade-v1';
      readonly policy: typeof EVIDENCE_TRADE_POLICY_V2;
    }
  | { readonly type: 'TradeOrderChanged'; readonly order: TradeOrder }
  | { readonly type: 'TradeReceiptRecorded'; readonly receipt: TradeReceipt };
export type EvidenceTradeState = {
  readonly principalOrders?: PrincipalTradeState;
  /** Explicitly enabled only after owning-world integration; legacy snapshots omit it. */
  readonly constructionOrders?: ConstructionTradeState;
  readonly publicFunding?: typeof TRADE_PUBLIC_FUNDING_POLICY;
  readonly policy: EvidenceTradePolicy;
  readonly orders: Readonly<Record<string, TradeOrder>>;
  readonly receipts: Readonly<Record<string, TradeReceipt>>;
};
export type EvidenceTradeCommand =
  | (Omit<TradeTerms, 'source'> & {
      readonly type: 'offer';
      readonly source: TradeSourceRef & { readonly expectedRevision: number };
    })
  | {
      readonly type: 'accept' | 'fund' | 'withdraw' | 'observe' | 'confirm' | 'waive';
      readonly id: string;
      readonly expectedRevision: number;
    }
  | {
      readonly type: 'dispute';
      readonly id: string;
      readonly expectedRevision: number;
      readonly content: string;
    }
  | {
      readonly type: 'propose-settlement';
      readonly id: string;
      readonly expectedRevision: number;
      readonly content: string;
      readonly refund: number;
    }
  | {
      readonly type: 'respond-settlement';
      readonly id: string;
      readonly expectedRevision: number;
      readonly accept: boolean;
    };
export type EvidenceTradePorts = {
  readonly publicFunding?: {
    readonly balance: number;
    readonly authorize: (
      order: TradeOrder,
      actorId: string,
    ) => { readonly decisionId: string } | undefined;
  };
  /** Internal exact-decision scope. A resident can act personally or for one collective, never silently as the other party. */
  readonly actingFor?: Controller;
  readonly exists: (id: string) => boolean;
  readonly authorize: ControlAuthorizationPort;
  readonly controllerAvailable: (controller: Controller) => boolean;
  readonly account: (account: TradeAccount) =>
    | {
        readonly controller: Controller;
        readonly balance: number;
        readonly status: 'open' | 'settling';
      }
    | undefined;
  readonly evidence: (source: TradeSourceRef) => TradeEvidence | undefined;
};
export type EvidenceTradeDecision =
  | {
      readonly accepted: true;
      readonly events: readonly EvidenceTradeEvent[];
      readonly transactions: readonly AccountingTransaction[];
      readonly evidenceReads: readonly TradeEvidenceRead[];
    }
  | { readonly accepted: false; readonly reason: string };
export const tradeRejected = (reason: string): EvidenceTradeDecision => ({
  accepted: false,
  reason,
});
export function assertEvidenceTradePolicy(p: EvidenceTradePolicy) {
  const expected =
    p.version === 'resident-evidence-trade-v2' ? EVIDENCE_TRADE_POLICY_V2 : EVIDENCE_TRADE_POLICY;
  if (
    Object.keys(p).length !== Object.keys(expected).length ||
    Object.entries(expected).some(([k, v]) => p[k as keyof EvidenceTradePolicy] !== v)
  )
    throw Error('unsupported-evidence-trade-policy');
}
export function emptyEvidenceTradeState(
  policy: EvidenceTradePolicy = EVIDENCE_TRADE_POLICY,
): EvidenceTradeState {
  assertEvidenceTradePolicy(policy);
  return { policy, orders: {}, receipts: {} };
}
