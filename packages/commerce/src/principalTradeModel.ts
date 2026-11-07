import type {
  ResourcePrincipal,
  PrincipalAuthorization,
  PrincipalOperationRequest,
  PrincipalAuthorizationPort,
} from '@aivilization/authority';
import type { AccountingTransaction } from '@aivilization/economy';
import type { PermitTradeBasis, PermitTradeEvidence, EvidenceTradeState } from './tradeModel';
/** Explicit companion order aggregate; legacy orders and the shared escrow keep their historical semantics. */
export const PRINCIPAL_EVIDENCE_TRADE_POLICY = {
  version: 'resident-principal-evidence-trade-v3',
  settlement: 'recorded-operational-permission-time',
  maxOrders: 10000,
  maxPerSeller: 500,
  maxAmount: 1000000,
  maxTermsChars: 8000,
  maxWindowMs: 30 * 86400000,
  moneyScale: 1000000,
} as const;
export type PrincipalTradeAccount = {
  readonly sector: 'agent' | 'collective' | 'enterprise' | 'treasury';
  readonly id: string;
};
export type PrincipalPermitTradeBasis = Omit<PermitTradeBasis, 'seller' | 'buyer'> & {
  readonly seller: ResourcePrincipal;
  readonly buyer: ResourcePrincipal;
  readonly principalVersion: 'resident-premises-principal-permits-v2';
};
export type PrincipalPermitTradeEvidence = Omit<PermitTradeEvidence, 'basis' | 'sourceVersion'> & {
  readonly basis: PrincipalPermitTradeBasis;
  readonly sourceVersion: 'principal-premises-provision-v2';
};
export type PrincipalTradeTerms = {
  readonly id: string;
  readonly title: string;
  readonly terms: string;
  readonly source: PrincipalPermitTradeBasis;
  readonly payer: PrincipalTradeAccount;
  readonly revenue: PrincipalTradeAccount;
  readonly amount: number;
  readonly acceptBy: number;
};
export type PrincipalTradeProof = PrincipalAuthorization<PrincipalOperationRequest>;
export type PrincipalTradeOrder = PrincipalTradeTerms & {
  readonly offeredAuthorization: PrincipalTradeProof;
  readonly acceptedAuthorization?: PrincipalTradeProof;
  readonly createdAt: number;
  readonly at: number;
  readonly revision: number;
  readonly status: 'offered' | 'funded' | 'settled' | 'cancelled' | 'expired';
  readonly fundedMicros: number;
  readonly earnedMicros: number;
  readonly escrowMicros: number;
  readonly paidMicros: number;
  readonly refundedMicros: number;
  readonly evidence: PrincipalPermitTradeEvidence;
};
export type PrincipalTradeCommand =
  | {
      readonly type: 'offer';
      readonly id: string;
      readonly title: string;
      readonly terms: string;
      readonly source: {
        readonly kind: 'permit';
        readonly id: string;
        readonly expectedRevision: number;
      };
      readonly payer: PrincipalTradeAccount;
      readonly revenue: PrincipalTradeAccount;
      readonly amount: number;
      readonly acceptBy: number;
    }
  | { readonly type: 'accept'; readonly id: string; readonly expectedRevision: number }
  | {
      readonly type: 'withdraw';
      readonly id: string;
      readonly expectedRevision: number;
      readonly side: 'seller' | 'buyer';
    }
  | {
      readonly type: 'observe';
      readonly id: string;
      readonly expectedRevision: number;
      readonly side: 'seller' | 'buyer';
    };
export type PrincipalTradeReceipt = {
  readonly id: string;
  readonly orderId: string;
  readonly previousRevision: number;
  readonly actorId: string;
  readonly at: number;
  readonly operation: PrincipalTradeCommand['type'] | 'expire';
  readonly side: 'seller' | 'buyer' | 'system';
  readonly authorization?: PrincipalTradeProof;
  readonly command?: PrincipalTradeCommand;
};
export type PrincipalTradeState = {
  readonly policy: typeof PRINCIPAL_EVIDENCE_TRADE_POLICY;
  readonly orders: Readonly<Record<string, PrincipalTradeOrder>>;
  readonly receipts: Readonly<Record<string, PrincipalTradeReceipt>>;
};
export type PrincipalTradeEvent =
  | {
      readonly type: 'PrincipalEvidenceTradeEnabled';
      readonly policy: typeof PRINCIPAL_EVIDENCE_TRADE_POLICY;
    }
  | {
      readonly type: 'PrincipalTradeCommitted';
      readonly order: PrincipalTradeOrder;
      readonly receipt: PrincipalTradeReceipt;
      readonly evidence: PrincipalPermitTradeEvidence;
    };
export type PrincipalTradePorts = {
  readonly evidence: (permitId: string) => PrincipalPermitTradeEvidence | undefined;
  readonly account: (
    account: PrincipalTradeAccount,
  ) =>
    | {
        readonly principal: ResourcePrincipal;
        readonly balance: number;
        readonly status: 'open' | 'settling';
      }
    | undefined;
  readonly available: (principal: ResourcePrincipal) => boolean;
  readonly authorize: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  readonly exists: (actorId: string) => boolean;
};
export type PrincipalTradeDecision =
  | { readonly accepted: false; readonly reason: string }
  | {
      readonly accepted: true;
      readonly events: readonly PrincipalTradeEvent[];
      readonly transactions: readonly AccountingTransaction[];
    };
export type PrincipalTradeParent = Pick<EvidenceTradeState, 'orders' | 'principalOrders'>;
