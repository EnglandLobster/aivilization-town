import type {
  ResourcePrincipal,
  PrincipalAuthorization,
  PrincipalOperationRequest,
  PrincipalAuthorizationPort,
} from '@aivilization/authority';
import type { AccountingTransaction } from '@aivilization/economy';
import type { PrincipalTradeAccount } from './principalTradeModel';
import type { ConstructionTradeBasis, ConstructionTradeEvidence } from './constructionTradeFacts';
export const CONSTRUCTION_TRADE_POLICY = {
  version: 'construction-trade-v1',
  maxOrders: 10000,
  maxAmount: 1000000,
  maxWindowMs: 30 * 86400000,
  maxTermsChars: 8000,
} as const;
export type ConstructionTradeTerms = {
  readonly id: string;
  readonly projectId: string;
  readonly sourceRevision: number;
  readonly seller: ResourcePrincipal;
  readonly buyer: ResourcePrincipal;
  readonly payer: PrincipalTradeAccount;
  readonly revenue: PrincipalTradeAccount;
  readonly amount: number;
  readonly acceptBy: number;
  readonly title: string;
  readonly terms: string;
};
export type ConstructionTradeSide = 'seller' | 'buyer';
export type ConstructionTradeCommand =
  | { readonly type: 'offer'; readonly terms: ConstructionTradeTerms }
  | {
      readonly type: 'accept' | 'observe' | 'withdraw';
      readonly id: string;
      readonly expectedRevision: number;
      readonly side: ConstructionTradeSide;
    }
  | {
      readonly type: 'propose-settlement';
      readonly id: string;
      readonly expectedRevision: number;
      readonly side: ConstructionTradeSide;
      readonly proposalId: string;
      readonly paySeller: number;
      readonly text: string;
    }
  | {
      readonly type: 'accept-settlement';
      readonly id: string;
      readonly expectedRevision: number;
      readonly side: ConstructionTradeSide;
      readonly proposalId: string;
    };
export type ConstructionTradeOrder = ConstructionTradeTerms & {
  readonly basis: ConstructionTradeBasis;
  readonly evidence: ConstructionTradeEvidence;
  readonly revision: number;
  readonly at: number;
  readonly createdAt: number;
  readonly status: 'offered' | 'funded' | 'disputed' | 'completed' | 'settled' | 'cancelled';
  readonly fundedMicros: number;
  readonly escrowMicros: number;
  readonly paidMicros: number;
  readonly refundedMicros: number;
  readonly settlement?: {
    readonly id: string;
    readonly side: ConstructionTradeSide;
    readonly actorId: string;
    readonly paySellerMicros: number;
    readonly text: string;
  };
};
export type ConstructionTradeCommandEvent = {
  readonly type: 'ConstructionTradeCommitted';
  readonly receiptId: string;
  readonly actorId: string;
  readonly command: ConstructionTradeCommand;
  readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
  readonly previousRevision: number;
  readonly order: ConstructionTradeOrder;
  readonly transactions: readonly AccountingTransaction[];
};
export type ConstructionTradeExpiryEvent = {
  readonly type: 'ConstructionTradeOfferExpired';
  readonly receiptId: string;
  readonly actorId: 'system';
  readonly command: {
    readonly type: 'expire';
    readonly id: string;
    readonly expectedRevision: number;
  };
  readonly previousRevision: number;
  readonly order: ConstructionTradeOrder;
  readonly transactions: readonly AccountingTransaction[];
};
export type ConstructionTradeEvent = ConstructionTradeCommandEvent | ConstructionTradeExpiryEvent;
export type ConstructionTradeState = {
  readonly policy: typeof CONSTRUCTION_TRADE_POLICY;
  readonly orders: Readonly<Record<string, ConstructionTradeOrder>>;
  readonly receipts: Readonly<Record<string, ConstructionTradeEvent>>;
};
export type ConstructionTradePorts = {
  readonly evidence: (id: string) => ConstructionTradeEvidence | undefined;
  readonly account: (account: PrincipalTradeAccount) =>
    | {
        readonly principal: ResourcePrincipal;
        readonly balance: number;
        /** Current receive room, including this order's own reserved allowance on settlement. */
        readonly incomingCapacity: number;
        readonly status: 'open' | 'settling';
      }
    | undefined;
  readonly authorize: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  readonly exists: (actorId: string) => boolean;
};
export type ConstructionTradeDecision =
  | { readonly accepted: false; readonly reason: string }
  | {
      readonly accepted: true;
      readonly events: readonly ConstructionTradeEvent[];
      readonly transactions: readonly AccountingTransaction[];
    };
